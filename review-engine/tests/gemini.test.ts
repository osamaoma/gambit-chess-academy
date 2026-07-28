import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { GeminiService } from '../src/explanation/gemini-service';
import { GeminiExplanationGenerator } from '../src/explanation/gemini-explanation-generator';
import { buildSystemInstruction, buildUserPrompt, promptCacheKeyInput } from '../src/explanation/prompt-builder';
import { parseExplanation } from '../src/explanation/response-parser';
import { GeminiError } from '../src/explanation/errors';
import { withRetry } from '../src/explanation/retry';
import { hashKey, LruCache } from '../src/explanation/cache';
import type { ExplanationInput } from '../src/types';

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const input = (over: Partial<ExplanationInput> = {}): ExplanationInput => ({
  input: {
    analysis: {
      fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      playedMove: 'a2a3', bestMove: 'g1f3', evalBefore: 20, evalAfter: -30, bestEval: 20,
      centipawnLoss: 50, mateBefore: null, mateAfter: null, principalVariation: [],
      depth: 18, legalMoves: ['a2a3', 'g1f3'], phase: 'opening', opening: null, mover: 'white',
    },
    boards: {} as never,
  },
  context: {
    phase: 'opening', material: { white: 3900, black: 3900, moverNet: 0 },
    openFiles: [], halfOpenFiles: [], kingsOnHome: { white: true, black: true },
    nonPawnMaterial: 7800, ply: 3,
  },
  classification: { classification: 'Inaccuracy', confidence: 0.8, reasons: ['x'], metadata: {} },
  comparison: {
    played: 'a2a3', best: 'g1f3', isSameMove: false, movesSamePiece: false,
    sharesDestination: false, bestCaptures: false, bestGivesCheck: false,
    playedPiece: 'pawn', bestPiece: 'knight',
  },
  themes: [{ id: 'development', label: 'Development', weight: 0.9 }],
  motifs: [],
  priorities: [{ id: 'develop', statement: 'finish development', weight: 0.9 }],
  ...over,
});

/** A transport that returns a fixed note, and records what it was sent. */
function fakeTransport(note: string, calls: { body?: unknown; headers?: unknown; url?: string }[] = []) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, headers: init.headers, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: note }] } }] }), { status: 200 });
  };
}

const service = (note: string, calls?: { body?: unknown; headers?: unknown; url?: string }[]) =>
  new GeminiService({ apiKey: 'test-key' }, fakeTransport(note, calls));

/* ── prompt ───────────────────────────────────────────────────────────────── */

describe('PromptBuilder', () => {
  it('forbids the model from analysing or re-judging anything', () => {
    const sys = buildSystemInstruction();
    assert.match(sys, /must not question it, re-analyse/i);
    assert.match(sys, /All chess analysis is already complete/i);
  });

  it('bans engine talk and caps the length', () => {
    const sys = buildSystemInstruction();
    for (const word of ['engine', 'Stockfish', 'centipawn']) {
      assert.ok(sys.includes(word), `system prompt should forbid "${word}"`);
    }
    assert.match(sys, /under 80 words/i);
  });

  it('passes the conclusions as facts, not a position to solve', () => {
    const p = buildUserPrompt(input());
    assert.match(p, /Verdict: Inaccuracy/);
    assert.match(p, /A better move existed: g1f3/);
    assert.match(p, /finish development/);
    // The raw FEN is deliberately absent: given a board, a model starts analysing.
    assert.ok(!p.includes('rnbqkbnr/pppppppp'));
  });

  it('shows earlier notes so wording does not repeat', () => {
    const p = buildUserPrompt(input({ recentSummaries: ['You developed smoothly.'] }));
    assert.match(p, /do NOT reuse their wording/i);
    assert.match(p, /You developed smoothly\./);
  });

  it('keys the cache on the chess facts, not on the reader position', () => {
    const a = promptCacheKeyInput(input({ recentSummaries: ['one'] }));
    const b = promptCacheKeyInput(input({ recentSummaries: ['completely different'] }));
    assert.equal(hashKey(a), hashKey(b));
  });
});

/* ── parser ───────────────────────────────────────────────────────────────── */

describe('ResponseParser', () => {
  it('strips preambles, markdown and wrapping quotes', () => {
    assert.equal(parseExplanation('Here is the note: **Develop your knight first.**').summary,
      'Develop your knight first.');
    assert.equal(parseExplanation('"Castle early to keep your king safe."').summary,
      'Castle early to keep your king safe.');
  });

  it('rejects banned vocabulary so it can never reach a student', () => {
    for (const bad of ['The engine prefers Nf3.', 'That costs 50 centipawns.', 'A poor evaluation.']) {
      assert.throws(() => parseExplanation(bad), (e: GeminiError) => e.kind === 'validation');
    }
  });

  it('does not false-positive on innocent words containing a banned substring', () => {
    assert.ok(parseExplanation('Eventually your rook will matter.').summary.length > 0);
  });

  it('trims an over-long note at a sentence boundary', () => {
    const long = Array.from({ length: 60 }, () => 'word').join(' ') + '. ' + Array.from({ length: 60 }, () => 'tail').join(' ') + '.';
    const out = parseExplanation(long);
    assert.equal(out.truncated, true);
    assert.ok(out.summary.split(/\s+/).length <= 80);
  });

  it('treats a rule break as retryable, since resampling usually fixes it', () => {
    try {
      parseExplanation('The engine likes this.');
      assert.fail('should have thrown');
    } catch (e) {
      assert.equal((e as GeminiError).retryable, true);
    }
  });
});

/* ── service ──────────────────────────────────────────────────────────────── */

describe('GeminiService', () => {
  it('refuses to construct without a key', () => {
    assert.throws(() => new GeminiService({ apiKey: '' }), /API key is required/);
  });

  it('sends the key as a header, keeping it out of the URL and access logs', async () => {
    const calls: { url?: string; headers?: unknown }[] = [];
    await service('Fine move.', calls).generate({ systemInstruction: 's', userPrompt: 'u' });
    assert.ok(!calls[0]!.url!.includes('test-key'));
    assert.equal((calls[0]!.headers as Record<string, string>)['x-goog-api-key'], 'test-key');
  });

  it('targets gemini-2.5-flash by default', async () => {
    const calls: { url?: string }[] = [];
    await service('Fine move.', calls).generate({ systemInstruction: 's', userPrompt: 'u' });
    assert.match(calls[0]!.url!, /models\/gemini-2\.5-flash:generateContent/);
  });

  it('classifies HTTP failures so retry can act on them', async () => {
    const fail = (status: number) => new GeminiService({ apiKey: 'k' },
      async () => new Response('nope', { status }));
    const kind = async (status: number) => {
      try { await fail(status).generate({ systemInstruction: '', userPrompt: '' }); return null; }
      catch (e) { return e as GeminiError; }
    };
    assert.equal((await kind(429))!.kind, 'rate-limit');
    assert.equal((await kind(503))!.kind, 'server');
    assert.equal((await kind(403))!.kind, 'auth');
    assert.equal((await kind(403))!.retryable, false);
  });

  it('surfaces a safety block distinctly from a malformed body', async () => {
    const blocked = new GeminiService({ apiKey: 'k' },
      async () => new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), { status: 200 }));
    await assert.rejects(blocked.generate({ systemInstruction: '', userPrompt: '' }),
      (e: GeminiError) => e.kind === 'blocked');
  });
});

/* ── retry ────────────────────────────────────────────────────────────────── */

describe('retry', () => {
  const noSleep = async () => {};

  it('retries transient failures and then succeeds', async () => {
    let n = 0;
    const out = await withRetry(async () => {
      if (++n < 3) throw new GeminiError('server', 'boom');
      return 'ok';
    }, undefined, noSleep);
    assert.equal(out, 'ok');
    assert.equal(n, 3);
  });

  it('gives up immediately on an error that will never succeed', async () => {
    let n = 0;
    await assert.rejects(withRetry(async () => { n++; throw new GeminiError('auth', 'bad key'); }, undefined, noSleep));
    assert.equal(n, 1);
  });
});

/* ── cache ────────────────────────────────────────────────────────────────── */

describe('cache', () => {
  it('is insensitive to object key order', () => {
    assert.equal(hashKey({ a: 1, b: [2, 3] }), hashKey({ b: [2, 3], a: 1 }));
  });

  it('evicts least-recently-used entries', () => {
    const c = new LruCache<string>(2);
    c.set('a', '1'); c.set('b', '2');
    c.get('a');              // 'a' becomes most recent, so 'b' is next out
    c.set('c', '3');
    assert.equal(c.get('b'), undefined);
    assert.equal(c.get('a'), '1');
  });
});

/* ── generator ────────────────────────────────────────────────────────────── */

describe('GeminiExplanationGenerator', () => {
  it('generates, then serves the identical position from cache', async () => {
    let calls = 0;
    const svc = new GeminiService({ apiKey: 'k' }, async () => {
      calls++;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Develop first.' }] } }] }), { status: 200 });
    });
    const gen = new GeminiExplanationGenerator(svc, { sleep: async () => {} });
    const first = await gen.generate(input());
    const second = await gen.generate(input());
    assert.equal(first.summary, 'Develop first.');
    assert.equal(first.source, 'model');
    assert.equal(second.source, 'cache');
    assert.equal(calls, 1);
  });

  it('resamples when the first draft breaks a writing rule', async () => {
    let n = 0;
    const svc = new GeminiService({ apiKey: 'k' }, async () => {
      const text = ++n === 1 ? 'The engine suggests Nf3.' : 'Bring your knight out to help the centre.';
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
    });
    const gen = new GeminiExplanationGenerator(svc, { sleep: async () => {} });
    const out = await gen.generate(input());
    assert.equal(out.summary, 'Bring your knight out to help the centre.');
    assert.equal(n, 2);
  });

  it('uses the fallback rather than failing the review', async () => {
    const svc = new GeminiService({ apiKey: 'k' }, async () => new Response('down', { status: 500 }));
    const gen = new GeminiExplanationGenerator(svc, {
      sleep: async () => {},
      retry: { attempts: 2, baseDelayMs: 1, maxDelayMs: 2, jitter: 0 },
      fallback: () => 'Develop your pieces before attacking.',
    });
    const out = await gen.generate(input());
    assert.equal(out.source, 'fallback');
  });

  it('reports the error when there is no fallback', async () => {
    const svc = new GeminiService({ apiKey: 'k' }, async () => new Response('down', { status: 401 }));
    const gen = new GeminiExplanationGenerator(svc, { sleep: async () => {} });
    await assert.rejects(gen.generate(input()), (e: GeminiError) => e.kind === 'auth');
  });

  it('coalesces concurrent requests for the same move into one call', async () => {
    let calls = 0;
    const svc = new GeminiService({ apiKey: 'k' }, async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Note.' }] } }] }), { status: 200 });
    });
    const gen = new GeminiExplanationGenerator(svc, { sleep: async () => {} });
    await Promise.all([gen.generate(input()), gen.generate(input()), gen.generate(input())]);
    assert.equal(calls, 1);
  });
});
