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

> Note: `node_modules/` and `package-lock.json` are excluded by `.gitignore`. The Stockfish `.wasm` file (~700KB) is committed because the app needs it at runtime.

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

Render gives you a URL like `https://gambit-chess-academy.onrender.com`. Open it — Stockfish should load, all openings should appear, and the runtime FEN validator should log `✓ All 875 quiz positions valid` to the browser console.

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
| First load is slow | Free tier spin-down — see "Free tier limitations" above |
| Health check fails | Make sure the `/api/status` endpoint is reachable — it should return `{"status":"ok","mode":"lite"}` |
| `node: command not found` during build | Render uses Node 18+ by default; check `engines.node` in `package.json` |

## Privacy

This app is fully self-contained:

- All user progress is stored in **browser localStorage** — never sent to a server
- The optional AI Coach feature requires the user to enter their own Anthropic API key (the key is only proxied through the server to api.anthropic.com; the server never stores it)
- The chess.com and lichess game-import endpoints fetch public games only — no authentication required
