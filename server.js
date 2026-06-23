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

app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', mode: 'lite' });
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
