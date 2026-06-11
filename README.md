# ♟ Gambit Chess Academy

A chess training platform running locally on your laptop.

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
