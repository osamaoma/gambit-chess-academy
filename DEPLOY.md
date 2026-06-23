# Deploying Gambit Chess Academy to Render

Step-by-step guide to get the app running on Render's free tier.

## Prerequisites

- A free GitHub account (or GitLab / Bitbucket)
- A free Render account: https://render.com/

## Step 1 — Push the code to GitHub

From inside the `gambit_lite/` folder (the one with `server.js`):

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
```

Create a new empty repository on GitHub (no README, no .gitignore), copy its URL, then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/gambit-chess-academy.git
git push -u origin main
```

> Note: `node_modules/` is excluded by `.gitignore`, but `package-lock.json` **is** committed so Render installs the exact same dependency versions. The Stockfish `.wasm` file (~7MB) and `openings_data.json` (~500KB) are committed because the app needs them at runtime.

## Step 2 — Deploy on Render

### Option A — One-click via render.yaml (recommended)

1. Go to https://dashboard.render.com/
2. Click **New +** → **Blueprint**
3. Connect your GitHub account and select the repo
4. Render detects `render.yaml` and shows the planned service
5. Click **Apply** — your app deploys in ~2 minutes

### Option B — Manual Web Service

1. Click **New +** → **Web Service**
2. Connect the GitHub repo
3. Configure:
   - **Name:** `gambit-chess-academy` (or your choice)
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** `Free`
4. Click **Create Web Service**

## Step 3 — Open your app

Render gives you a URL like `https://gambit-chess-academy.onrender.com`. Open it — Stockfish should load, every opening from the Lichess database should appear under the Openings tab, the Opening Explorer button should pull live data, and the runtime FEN validator should log `✓ All 898 quiz positions valid` to the browser console.

## Free tier limitations

Render's free plan spins down the service after ~15 minutes of inactivity. The first request after a spin-down takes 30-60 seconds to wake up. After that, performance is normal.

Upgrade to the **Starter** plan ($7/month) to keep the service always-on. Edit `render.yaml`:

```yaml
plan: starter
```

…then commit + push. Render redeploys automatically.

## Auto-deploy

With `autoDeploy: true` in `render.yaml` (the default), every `git push` to `main` triggers a new deployment. No manual steps needed.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Build fails with `cannot find module 'express'` | Make sure `package.json` is in the root of your repo |
| App boots but Stockfish doesn't load | Check that `public/stockfish/` (both `.js` and `.wasm`) is committed to git |
| Openings tab is empty | Check that `public/openings_data.json` is committed to git |
| Opening Explorer shows "Couldn't reach Lichess" | The Explorer needs outbound internet to `explorer.lichess.ovh`. Render allows this by default; if self-hosting behind a firewall, allow that host. Everything else works offline. |
| First load is slow | Free tier spin-down — see "Free tier limitations" above |
| Health check fails | Make sure the `/api/status` endpoint is reachable — it should return `{"status":"ok","mode":"lite"}` |
| `node: command not found` during build | Render uses Node 20 by default (set in `render.yaml`); check `engines.node` in `package.json` |

## Privacy

This app is fully self-contained:

- All user progress is stored in **browser localStorage** — never sent to a server
- The optional AI Coach feature requires the user to enter their own Anthropic API key (the key is only proxied through the server to api.anthropic.com; the server never stores it)
- The chess.com and lichess game-import endpoints fetch public games only — no authentication required

## Enabling live Master-game stats (Course Creator)

Lichess locked their opening-explorer API behind login in Feb 2026. To show real
%/Games/Winrate stats in the Course Creator, give the server a free Lichess token:

1. Log in at lichess.org → https://lichess.org/account/oauth/token
2. Click "New personal access token". No special scopes are needed for the explorer.
   Give it a name (e.g. "Gambit explorer") and create it. Copy the token.
3. In Render: your service → Environment → Add Environment Variable:
       Key:   LICHESS_TOKEN
       Value: (paste the token)
   Save — Render redeploys automatically.

That's it. The token lives ONLY on the server (never shipped to the browser).
- With a token set: Course Creator shows live Master-game stats (Move/%/Games/Win rate).
- Without a token: it automatically falls back to the offline Book-moves panel
  (real opening names + ECO + engine eval), which always works.

To run locally with stats:  LICHESS_TOKEN=yourtoken node server.js
