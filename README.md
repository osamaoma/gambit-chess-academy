# ♟ Gambit Chess Academy

A chess training platform running locally on your laptop.

## Openings (v4 — Lichess-sourced)

The Openings tab is built from the **Lichess opening database** (148 families,
3,733 variations). For each opening you can:

- Browse every **family** and drill into **all of its variations**.
- **Learn** a variation move-by-move — plain-English idea per move **plus a live
  Stockfish evaluation** of each position.
- **Drill** it from memory: pick **White or Black**, play the whole line back;
  a wrong move shows you the correct one and lets you continue. A clean run marks
  the variation **mastered**.
- Open the **Opening Explorer** (button inside the Learn view) to see what real
  players actually play next. Three sources: **Masters**, **Lichess** (all rated
  games), and **By rating** (rating-banded tiers, like chess.com's explorer).

### Opening Explorer — works out of the box
Press the Explorer button inside any opening's Learn view to see **the most
common moves played from the current position**, ranked by popularity. This
works instantly with **no token, no login, and no internet** — the move-
popularity stats are bundled in `public/explorer_stats.json`.

Three views (Masters / Lichess / By rating) are available. The bundled stats
show move popularity; **White/Black win rates** require live data, which needs a
free Lichess token (Lichess disabled anonymous access to its explorer in 2025).

Two optional ways to get win rates:

- **Add a token in the app:** open the Explorer, click "Add a token", paste a
  free Lichess token (no scopes needed, from
  https://lichess.org/account/oauth/token/create) — saved in your browser, then
  you get live win rates for all three views at any depth. You can also set
  `LICHESS_TOKEN` server-wide via `.env` so nobody needs to.
- **Bake win rates offline (one time):** run
  `LICHESS_TOKEN=lip_xxx node bake_explorer_stats.js` once. It fetches real
  win/draw/loss stats for every opening position and writes them into
  `public/explorer_stats.json`, so every user then sees win rates with no token.

> Note: chess.com has no public opening-explorer API, so all stats come from the
> Lichess opening book / database. The "By rating" view uses Lichess rated games
> filtered by rating band (token required for live rating-band data).

Opening data lives in `public/openings_data.json` and is served statically. The
Explorer calls the Lichess API through the local server proxy (`/api/explorer/:db`),
so it works without CORS issues. **Internet is only needed for the Explorer button** —
everything else (learning, drilling, engine eval) works fully offline.

### Optional: deepen lines to true 20+ ply
Every variation already ships with a valid mainline. If you want maximum depth
(real most-played continuations pulled live from Lichess), run once:

```cmd
node bake_explorer.js
```

It rewrites `public/openings_data.json` (a backup is saved first). Requires that
your network can reach `explorer.lichess.ovh`. This step is **entirely optional**.

## ⚠️ If the page is blank or "not responding"

The most common cause is **browser cache** holding an old broken version.

**Fix:**
1. Stop the server (`Ctrl+C` in the terminal)
2. In your browser, press `Ctrl+Shift+Delete` → Clear "Cached images and files"
3. Restart the server: `npm start`
4. In the browser, do a hard refresh: `Ctrl+F5` (or `Ctrl+Shift+R`)

Or simply open the URL in a **private/incognito window** which ignores cache.

## Setup

```cmd
cd gambit_lite
npm install
npm start
```

Then open: **http://localhost:3000**

## Features

### 📚 Opening Explorer
- 35+ openings with full theory, variations, and strategic ideas
- Interactive board: step through main lines, click any variation to play it out
- ECO codes and tagged styles (Solid / Sharp / Gambit / Positional)

### 📊 My Performance
- Enter your Chess.com or Lichess username
- Fetches your real games via public APIs
- Groups results by opening family with smart name normalization
  (so "Kings Indian Defense Orthodox Positional Defense 8.dxe5..." 
  groups with all your other Kings Indian games)
- Personalised study plan for openings where you struggle

### 🔬 Game Review
- Load real games, pick any one to review
- Built-in chess engine analyses every position in a **Web Worker**
  (UI stays responsive — no freezing)
- Move-by-move annotations: Brilliant !!, Good, Inaccuracy ?!, Mistake ?, Blunder ??
- Eval bar, accuracy %, and best-move suggestions
- Engine does ~5-second analysis on 40-move games

## How the engine works
- Pure JavaScript, runs in a Web Worker so it never blocks the page
- Depth-2 alpha-beta search with quiescence (looks at capture sequences)
- Strong enough to catch all common tactical mistakes and blunders
- No CDN or external download needed — engine is bundled with the app

## Stop the server
Press `Ctrl+C` in the terminal window.

## Change port
```cmd
set PORT=8080
npm start
```
