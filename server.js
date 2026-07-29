/**
 * Gambit Chess Academy — Local Server (Lite)
 * Stockfish loads in the browser from CDN (pure JS, no WASM threads needed).
 * Server only proxies chess APIs and serves static files.
 */

const express = require('express');
const path    = require('path');
const https   = require('https');
const http    = require('http');
const fs      = require('fs');

// Minimal .env loader (no dependency). Loads KEY=VALUE lines from a local
// .env file into process.env if not already set. Used for LICHESS_TOKEN.
(function loadDotEnv(){
  try {
    const envPath = path.join(__dirname, '.env');
    if(!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for(let line of lines){
      line = line.trim();
      if(!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if(eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))){
        val = val.slice(1, -1);
      }
      if(key && process.env[key] === undefined) process.env[key] = val;
    }
  } catch(e){ /* non-fatal */ }
})();

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Cross-origin isolation → SharedArrayBuffer → multi-threaded Stockfish.
// "credentialless" (not "require-corp") so cross-origin fonts/avatars keep
// loading without CORP headers; browsers without support ignore it and the
// engine falls back to the single-threaded build.
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  next();
});

// Large static data files that rarely change should be cacheable.
// Stockfish engine truly never changes → immutable, 1 year.
app.use('/stockfish', (req, res, next) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  next();
});
// Opening database JSON: cache for a day, revalidate.
app.use(['/openings_data.json', '/openings_v5.json', '/opening_detect.json', '/course_italian.json', '/book_moves.json'], (req, res, next) => {
  res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
  next();
});

// CRITICAL: Disable caching for HTML/JS so users always get the latest code
app.use((req, res, next) => {
  if (req.path.startsWith('/stockfish/')) return next();           // already set
  if (req.path === '/openings_data.json') return next();           // already set
  if (req.path === '/openings_v5.json') return next();             // already set
  if (req.path === '/opening_detect.json') return next();          // already set
  if (req.path === '/course_italian.json') return next();          // already set
  if (req.path === '/book_moves.json') return next();              // already set
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Ensure WASM files are served with the correct MIME type
// (required for WebAssembly.instantiateStreaming to work properly)
express.static.mime.define({ 'application/wasm': ['wasm'] });

app.use(express.static(path.join(__dirname, 'public')));

function nodeFetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const reqOpts = {
      method: opts.method || 'GET',
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'GambitChessAcademy/1.0', ...opts.headers }
    };
    const req = lib.request(reqOpts, (r) => {
      // follow redirects (up to a small limit) — some APIs 3xx to a canonical URL
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && (opts._redirects||0) < 5) {
        r.resume(); // drain
        const next = new URL(r.headers.location, url).toString();
        return resolve(nodeFetch(next, { ...opts, _redirects: (opts._redirects||0)+1 }));
      }
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        resolve({
          ok: r.statusCode >= 200 && r.statusCode < 300,
          status: r.statusCode,
          headers: r.headers,
          json: () => { try { return JSON.parse(data); } catch(e){ return null; } },
          text: () => data
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(opts.timeout || 45000, () => { req.destroy(); reject(new Error('Timeout')); });
    if(opts.body) req.write(opts.body);
    req.end();
  });
}

// ════════════════════════════════════════════════════════
// AI COACH — proxies to Anthropic Claude for plain-English chess explanations.
// The user provides their own Anthropic API key in the browser; the server
// proxies the call so the key is never exposed in JavaScript code.
// ════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════
// COACH NOTES — Gemini (Flash) turns this app's own analysis into prose.
//
// The key lives ONLY here, in GEMINI_API_KEY. It is never sent to the browser.
//
// The browser posts STRUCTURED FINDINGS (verdict, better move, what that move
// achieves, themes, priorities) and the prompt is composed server-side from
// those named fields. It deliberately does NOT accept prompt text: an endpoint
// that forwards arbitrary text is an open relay on our own API quota.
//
// All chess conclusions are made before this point. Gemini only chooses words.
// ════════════════════════════════════════════════════════
const coachLib = require('./server-lib/gemini-explain.cjs');

// Model IDs get retired — gemini-2.5-flash stopped accepting new API keys, and
// a hardcoded name meant a silent outage. So: try the configured model first,
// then fall back through known-good Flash models, and remember whichever one
// answers so later requests go straight to it.
const GEMINI_MODELS = [
  process.env.GEMINI_MODEL,     // an explicit override always wins
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
].filter(Boolean);
let geminiModel = null;         // the one that worked, once we know it

const geminiUrl = (model) =>
  'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';

/** Is this failure "wrong model name" rather than a real problem? */
function isModelUnavailable(status, data){
  if(status !== 404 && status !== 400) return false;
  const msg = ((data && data.error && data.error.message) || '').toLowerCase();
  return msg.includes('not found') || msg.includes('no longer available')
      || msg.includes('not supported') || msg.includes('unsupported model');
}

/** Keep the payload small and typed — never trust the client's shapes. */
function sanitiseFacts(raw){
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  const arr = (v, n, max) => Array.isArray(v)
    ? v.filter(x => typeof x === 'string').slice(0, n).map(x => x.slice(0, max))
    : undefined;
  const out = {
    played: str(raw?.played, 12) || '',
    verdict: str(raw?.verdict, 20) || '',
    phase: str(raw?.phase, 20),
    best: str(raw?.best, 12),
    bestPiece: str(raw?.bestPiece, 12),
    bestTo: str(raw?.bestTo, 4),
    samePieceWrongSquare: !!raw?.samePieceWrongSquare,
    bestCaptures: !!raw?.bestCaptures,
    bestGivesCheck: !!raw?.bestGivesCheck,
    bestIdeas: arr(raw?.bestIdeas, 4, 120),
    playedMotifs: arr(raw?.playedMotifs, 4, 40),
    missedMotifs: arr(raw?.missedMotifs, 4, 40),
    themes: arr(raw?.themes, 6, 40),
    priorities: arr(raw?.priorities, 4, 80),
    openFiles: arr(raw?.openFiles, 8, 2),
    recentSummaries: arr(raw?.recentSummaries, 6, 200),
  };
  Object.keys(out).forEach(k => out[k] === undefined && delete out[k]);
  return out;
}

app.post('/api/coach-note', async (req, res) => {
  const key = process.env.GEMINI_API_KEY;
  // 503, not 500: the service is simply not configured, and the client should
  // fall back to its own wording rather than retry.
  if(!key) return res.status(503).json({ error: 'Coach notes are not configured on this server.' });

  const facts = sanitiseFacts(req.body && req.body.facts);
  if(!facts.played || !facts.verdict){
    return res.status(400).json({ error: 'A move and a verdict are required.' });
  }

  try {
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: coachLib.buildSystemInstruction() }] },
      contents: [{ role: 'user', parts: [{ text: coachLib.buildUserPromptFromFacts(facts) }] }],
      generationConfig: {
        temperature: 0.85,
        // Gemini 3 reasons before answering, and that reasoning is billed and
        // budgeted alongside the answer. At 200 tokens the thinking consumed
        // the lot and the "note" came back as truncated fragments of the
        // instructions. Writing one coaching sentence needs no reasoning, and
        // the ceiling is generous so the answer is never the thing that gets cut.
        thinking_level: 'minimal',
        maxOutputTokens: 800,
        candidateCount: 1,
      },
    });
    const headers = {
      'x-goog-api-key': key,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    };

    // Use the model we already know works; otherwise walk the candidates once.
    const candidates = geminiModel ? [geminiModel] : GEMINI_MODELS;
    let r = null, data = null, used = null, lastError = null;
    for(const model of candidates){
      r = await nodeFetch(geminiUrl(model), { method: 'POST', headers: headers, body: body });
      data = r.json();
      if(r.ok){ used = model; break; }
      if(isModelUnavailable(r.status, data)){
        lastError = (data && data.error && data.error.message) || ('model ' + model + ' unavailable');
        continue;                                  // retired name — try the next
      }
      const msg = (data && data.error && data.error.message) || ('Gemini API error (HTTP ' + r.status + ')');
      return res.status(r.status).json({ error: msg });
    }
    if(!used){
      return res.status(502).json({ error: 'No usable Gemini model. ' + (lastError || '') });
    }
    if(geminiModel !== used){
      geminiModel = used;
      console.log('Coach notes using Gemini model:', used);
    }

    const blocked = data && data.promptFeedback && data.promptFeedback.blockReason;
    if(blocked) return res.status(502).json({ error: 'Response blocked: ' + blocked });

    const candidate = (data.candidates || [])[0] || {};
    const parts = (candidate.content || {}).parts || [];
    const raw = parts.map(p => p.text || '').join('').trim();
    if(!raw) return res.status(502).json({ error: 'Empty response from Gemini.' });

    // A note cut off at the token ceiling is a fragment, not a sentence. Reject
    // it so the client keeps its own wording — a half-sentence on screen is
    // worse than the template it replaced.
    if(candidate.finishReason && candidate.finishReason !== 'STOP'){
      return res.status(502).json({ error: 'Incomplete note (' + candidate.finishReason + ').' });
    }

    // The same validation the package uses: strips preambles/markdown, rejects
    // engine talk, trims to the word limit. Enforced here so a stray mention of
    // "centipawns" can never reach a student.
    const note = coachLib.parseExplanation(raw);
    res.json({ text: note.summary, truncated: note.truncated, model: used });
  } catch(e){
    // A rule-breaking draft raises here; the client falls back to its own text.
    console.error('Coach note error:', e && e.message);
    res.status(502).json({ error: (e && e.message) || 'Coach note failed.' });
  }
});

app.post('/api/explain', async (req, res) => {
  const { apiKey, model, prompt } = req.body || {};
  if(!apiKey || typeof apiKey !== 'string' || !apiKey.startsWith('sk-')){
    return res.status(400).json({ error: 'A valid Anthropic API key is required (starts with sk-).' });
  }
  if(!prompt || prompt.length > 8000){
    return res.status(400).json({ error: 'Invalid prompt.' });
  }
  try {
    const body = JSON.stringify({
      model: model || 'claude-sonnet-4-5',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });
    const r = await nodeFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body)
      },
      body: body
    });
    const data = r.json();
    if(!data){
      return res.status(502).json({ error: 'Empty response from Claude API.' });
    }
    if(!r.ok){
      const msg = data?.error?.message || `Anthropic API error (HTTP ${r.status})`;
      return res.status(r.status).json({ error: msg });
    }
    // Extract text content
    const text = (data.content || [])
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');
    res.json({ text, model: data.model, usage: data.usage });
  } catch(e){
    console.error('Explain error:', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

app.get('/api/chesscom/archives/:user', async (req, res) => {
  try {
    const r = await nodeFetch(`https://api.chess.com/pub/player/${req.params.user}/games/archives`);
    if (!r.ok) return res.status(r.status).json({ error: 'User not found' });
    res.json(r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/chesscom/games/:user/:year/:month', async (req, res) => {
  const { user, year, month } = req.params;
  try {
    const r = await nodeFetch(`https://api.chess.com/pub/player/${user}/games/${year}/${month}`);
    if (!r.ok) return res.status(r.status).json({ error: 'Not found' });
    res.json(r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/lichess/games/:user', async (req, res) => {
  const { user } = req.params;
  const params = new URLSearchParams(req.query);
  try {
    const r = await nodeFetch(
      `https://lichess.org/api/games/user/${user}?${params}`,
      { headers: { Accept: 'application/x-ndjson' } }
    );
    if (!r.ok) return res.status(r.status).json({ error: 'User not found' });
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.send(r.text());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/explorer', async (req, res) => {
  // Token-authenticated proxy to the Lichess opening explorer.
  // The token lives ONLY in the server env (LICHESS_TOKEN) — never sent to the browser.
  const fen = req.query.fen;
  if (!fen) return res.status(400).json({ error: 'fen required' });
  const token = process.env.LICHESS_TOKEN;
  if (!token) return res.status(503).json({ error: 'no-token' });

  const db = (req.query.db === 'masters') ? 'masters' : 'lichess';
  const base = db === 'masters'
    ? `https://explorer.lichess.ovh/masters?fen=${encodeURIComponent(fen)}&moves=12&topGames=0`
    : `https://explorer.lichess.ovh/lichess?variant=standard&fen=${encodeURIComponent(fen)}&speeds=blitz,rapid,classical&ratings=1600,1800,2000,2200,2500&moves=12&topGames=0&recentGames=0`;
  try {
    const r = await nodeFetch(base, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'GambitChessAcademy (https://github.com/osamaoma/gambit-chess-academy)'
      },
      timeout: 20000
    });
    if (!r.ok) return res.status(r.status).json({ error: `HTTP ${r.status}` });
    const data = r.json();
    if (!data) return res.status(502).json({ error: 'invalid JSON' });
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(data);
  } catch (e) {
    console.error('explorer proxy error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', mode: 'lite', explorer: process.env.LICHESS_TOKEN ? 'live' : 'offline' });
});


app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Listen on 0.0.0.0 so Render (and other cloud platforms) can route to us.
// Locally this still works as http://localhost:PORT.
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n♟  Gambit Chess Academy is running');
  if (process.env.RENDER || process.env.NODE_ENV === 'production') {
    console.log(`   Listening on port ${PORT} (production)\n`);
  } else {
    console.log(`\n   http://localhost:${PORT}\n`);
    console.log('   Open the URL above in your browser.');
    console.log('   (Press Ctrl+C to stop)\n');
  }
});
