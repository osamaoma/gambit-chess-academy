# Gambit Chess Academy — Project Handoff (2026-07-05)

## Overview

**Gambit Chess Academy** is a premium chess learning platform built on a single-file HTML/CSS/JS architecture (~2.4 MB `public/index.html`). The site teaches openings through structured lessons, drills, and spaced-repetition review, with a premium dark monochrome+gold aesthetic, professional board visualization, and deep game analysis.

**Live:** `gambit-chess-academy.onrender.com` (deployed to Render)  
**Repository:** `https://github.com/osamaoma/gambit-chess-academy`  
**Current User:** Omer Osama (`omer.osama@gmail.com`)

---

## Architecture & Tech Stack

### Single-File HTML + Vanilla JS
- **Location:** `C:\Users\user\Downloads\gambit_chess_academy_lite_2\gambit_lite\public\index.html` (~2.4 MB)
- **No build step.** All CSS, JS, and HTML in one file. Development via direct file edits + git.
- **Piece set:** Cburnett (CC BY-SA 3.0) + Chessnut (Apache 2.0) fallback
- **Board:** 56px squares by default, responsive via clamp (34–52px for Course Creator, 44–66px when viz removed)
- **Markup sections:** wrapped in `<div id="sec-X" class="section">` (hash-routed via `showSection()`)

### Data Files
- **`openings_v5.json`** (545 KB, fetched `?v=N` cache-bust) — opening library with 22 openings; 2 fully curated (Italian Game, Ruy López) with per-move notes, plans, and intro summaries. Learn-flow reads `v.s` (SAN array), `v.notes` (per-ply explanations), `v.plan` (end-of-line summary).
- **`book_moves.json`** — eco/move lookup for opening detection (unused in learn flow, handy for explorer)
- **`opening_detect.json`** — opening name→ECO mapping

### External Assets (CDN)
- **Fonts:** Fontshare CDN (Clash Display, Satoshi, DM Mono) via `<link rel="preconnect">` + `@import` in CSS (fallbacks: serif/sans for Clash, monospace for DM)
- **Google Fonts:** DM Mono backup (fallback in CSS: `'DM Mono',monospace`)

---

## Visual Identity — "Chessmasters" Theme

### Palette
- **Background:** `#0a0a0b` (near-black)
- **Gold accents:** `#d4af37` (primary), `#dcae4c` (gradient lighter), `#bd8a2f` (gradient darker), `#c2912b`, `#e8c75a`
- **Text:** `#fff` (primary), `var(--text2)` (~#b0b0b0), `var(--text3)` (~#707070)
- **Board:** brown squares (a1 is dark), orange arrows

### Typography
- **Display:** Clash Display (Fontshare), bold, letter-spacing -0.01–-0.015em
- **Body:** Satoshi (Fontshare), 400–600 weight
- **Data/Code:** DM Mono (Google Fonts), monospace

### Components
- **Logo:** badged king mark (gold-gradient rounded square `#f2d489→#bd8a2f` with dark king silhouette); responsive wordmark (shows full "Gambit Chess Academy" on desktop, "Gambit" on tablet, badge-only <430px); subtle glow animation
- **Buttons:** `.btn-gold` (gold background, dark text), `.btn-outline` (border, no fill), `.nop-mini-btn` (inline), responsive sizing
- **Cards:** `.ol-rcard` (board thumbnail + body, lifts on hover), `.acad-card` (legacy Academy cards)
- **Panels:** `.op-clean-wrap` (openings hero), `.nlearn-stage` (lesson board), `.cc-stage` (course creator workspace)

### Animations
- **Motion:** Respect `@media (prefers-reduced-motion)` throughout; use CSS transforms (translate, scale, opacity) for smoothness
- **Examples:** `.ol-rcard:hover { transform:translateY(-3px) }`, logo glow pulse, review-pill pulsing dot, node pop-in (nlearn)
- **Duration:** 0.18–0.6s cubic-bezier easing (`var(--ease)` = custom easing var)

---

## Completed Features

### 1. Logo & Branding
- **Badged king mark** replaces bare gold king; placed in:
  - `.nav-logo` (top-left of app nav)
  - `.lp-logo` (landing page)
  - `.sw-mark` (sign-up wall modal)
- **Responsive:** wordmark drops "Chess Academy" <680px, badge-only <430px
- **Animation:** glow pulse (0s–100% opacity) in `prefers-reduced-motion: no-preference`

### 2. Premium Openings Library (ChessReps-style grid)
- **Navigation:** "Opening Academy" nav tab → `sec-openings` (was orphaned, now wired)
- **Published openings:** Italian Game + Ruy López only (filter `/italian|ruy|spanish/i` in `olRenderGrid`)
- **Card format:** horizontal layout (board thumbnail + name + description + progress bar + "N lines" + "due" badge + adaptive CTA)
- **Toolbar:** "X/Y lines learned · N due for review (pulsing pill) · Create a Course"
- **Intro page:** opening summary + 5 key plans + board diagram + "See all N variations" + "Learn the main line" + "Mixed drill"

### 3. Italian Game (30 lines in 6 chapters, fully curated — rebuilt 2026-07-05)
- **Course philosophy:** built-in courses cap at 30–50 high-probability lines, not thousands of micro-sub-variations
- **Chapters (families):** Giuoco Piano (5), Giuoco Pianissimo (5), Evans Gambit (4), Two Knights Defense (7), Scotch Gambit (4), Quiet Lines (5)
- **Per-move notes:** every ply explained (654 notes total; shared move prefixes reuse identical notes via prefix-keyed bank)
- **Plans:** end-of-line summary per line + opening-level 5 key-plans intro
- **Validated:** all SAN legal via python-chess (strict capture/check notation); all 30 lines verified to walk fully in the app's own engine (includes en passant in Polerio, Nbxd2/Nce7 disambiguation)
- **Build tooling:** scratchpad `italian/` (lines.py, notes_*.py, assemble.py, write_course.py) — pattern to reuse for Ruy López rebuild
- **UI:** variation list groups by chapter with per-family progress ("n/m learned" + bar) and chapter-scoped drill (olStartMixedDrill(opIdx, fi))

### 4. Ruy López (27 lines in 6 chapters, fully curated — rebuilt 2026-07-05)
- **Chapters (families):** Closed Ruy López (6: Chigorin/Breyer/Zaitsev/Smyslov/Worrall/d3), Berlin Defence (4), Exchange Variation (4), Marshall Attack + anti-Marshalls (3), Open Variation (3: main/Dilworth/Keres), Third-Move Alternatives (7)
- **Per-move notes:** every ply explained (484 notes; prefix-keyed bank, old 6 curated lines reused as anchors/extensions)
- **Validated:** python-chess legality + strict notation; all 27 lines verified to walk fully in the app engine (includes en passant in Open main: 12.exf6)
- **Fixed:** old Ruy data had broken metadata (tp=1..6 instead of ply counts, no families array)
- **OL_FAMILY_INTRO:** Ruy chapter intros added alongside the Italian ones

### 5. Spaced Repetition (SM-2-lite)
- **Mastery store:** `localStorage.gambit_ol_mastery` = `{lineId: {m(timestamp), due, iv(interval), reps, lapses}}`
- **Legacy migration:** old bare-timestamp entries treated as `due:now`
- **Helpers:**
  - `olIsDue(id)` — check if review is due
  - `olDueCount(op)` — count due lines in an opening
  - `olTotalDue()` — global due count
  - `olMarkMastered(id)` — grows interval on correct review
- **CTA adaptation:** "Try first line" → "Continue learning" → "Review N lines" (gold) → "Practice again"
- **Review pill:** pulsing dot + "N due for review" button → `olReviewDue()` jumps to first due line

### 6. Course Creator Workspace
- **Board:** responsive `--ccsq: clamp(44px, 6.8vh, 66px)` (up from 34–52px), reclaimed viz space
- **Layout:** 2-column grid (board + side panel spanning full height on mobile)
- **Features:**
  - Name input (editable, saves to `CC.name`)
  - PGN import (textarea, drag-drop)
  - Move tree visualization (hidden `#cc-repviz`)
  - Analysis lines panel (contained scroll)
  - Board controls (Undo, Flip, Reset, End line & add to course)
  - Note textarea per position
- **Fits one screen:** verified at 1300×940 (board 515px, side 560px max-height)

### 7. Landing Page (SEO hero, hash-routed)
- **Hero:** cinematic B&W checkerboard floor, vignette, Clash Display headline, gold king, pill nav
- **Skip detection:** `location.hash` check + `sessionStorage.gambit_entered` prevents re-render once user enters app
- **Deep-link:** users can land on `/some-section#section-id` and skip landing

### 8. Sign-Up Wall (Account Gating)
- **Modal:** appears on Learn/Save/Mark actions
- **localStorage account:** `{name, email, at(timestamp)}`
- **Gate scope:** browse free, Learn/Save/Mark require account
- **Function:** `gambitGate(reason, retry)` — show modal, then call retry on confirm

### 9. Game Review (Brass Observatory theme, scoped to `#sec-review`)
- **Structure:** chess.com's accuracy + classification table + eval graph + per-move coaching
- **Player panels:** avatar + name + rating, captured pieces + material edge, live clock per side
- **Eval graph:** timeline with phase markers (opening/middlegame/endgame), Evaluation/Time toggle
- **Time analysis:** parsed from PGN `%clk`, shows time-spent bars + clock-left in coaching callout
- **Deployed & live**

### 10. Personal Coach (onboarding + opening recommendations, added 2026-07-05)
- **Section:** `sec-coach` (nav tab "Coach", hash `#coach`); all JS namespaced `pcoach*`/`pc-*` (a legacy `coach*` namespace already exists around line ~10447 — do not reuse those names)
- **Flow:** connect Chess.com/Lichess username → fetch last 50 **rated** games → Stockfish batch analysis of the first 20 plies of each game (FEN-keyed eval cache, depth 11) → recurring-mistake patterns (exact position repeats, then opening-family groups) → guided Game-Review-style step-through (board with played/best arrows, classification badges, evals, coaching; pulls curated course notes + "learn this line" deep-link when the best move is in a curated line) → summary (style twin via perf* vectors, common mistakes, openings to study, style recs)
- **Persistence:** `localStorage.gambit_coach` {style, patterns, weak, recs…}; `gambit_coach_invited` gates the one-time post-signup invite
- **Badges:** `★ Recommended` (`.ol-rec`) on opening cards + intro title; recommended openings surface in the grid even if not curated, sorted first; openings-home banner shown until a plan exists
- **Post-signup hook:** in `gambitSignup` — direct signups route to `#coach`; mid-action signups get a dismissible toast (`.pc-toast`) and their pending action still runs
- **Testing:** `window._coachMaxGames = N` caps the game count for fast test runs
- **Fixed in passing:** `fetchLichessGames` operator-precedence bug that mapped every Lichess player name to "Stockfish" (also affected Game Review's game list)

### 11. Practice Hub — drill modes (added 2026-07-06)
- **Entry:** gold "Practice" button in the openings toolbar → `olOpenPractice()` (renders into `sec-olearn`)
- **Modes (`oldrill.drillMode`):** `learn` (recall with a written hint per move — the curated note with the move masked, `olDrillHint()`), `blitz` (Challenge · 1 minute: wall-clock deadline via `oldrill.endAt`, score HUD, wrong moves quick-reveal + auto-advance, queue reshuffles until time), `zen` (Challenge · untimed — the classic drill)
- **Scope:** all openings or per-opening checkboxes (published + Coach-recommended); prefs persist in `localStorage.gambit_practice`; blitz personal best in `gambit_blitz_best`
- **Queue items now carry `{op, opIdx, vIdx}`** so multi-opening queues work; flawless line recall marks mastery (except learn mode); line label shows "Opening — Line · n/N"
- **Back-compat:** per-line Drill / chapter Drill / Mixed drill unchanged (drillMode 'zen')
- **Fixed in passing:** `olUciKey` read `olearn.sans` even in drills — any drill started without first opening a lesson silently crashed at move 2+ (now takes the move list as a param). Also exposed `olRenderDrillPicker` on window (module scope broke the pre-existing inline Restart button).

### 12. Quiz System
- **Home picker:** opening grid with progress
- **Quiz flow:** spaced-repetition drill on decision points within a line
- **Per-quiz state:** tracks user moves vs. expected, scores, time

---

## Data Structure

### `openings_v5.json`
```json
{
  "openings": [
    {
      "f": "Italian Game",
      "eco": "C50",
      "style": "positional",
      "bk": "e4",
      "desc": "Card description",
      "intro": { "summary": "…", "plans": ["…", "…"] },
      "curated": true,
      "v": [
        {
          "n": "Main Line (c3 + d4 centre)",
          "eco": "C54",
          "s": ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", …],
          "u": ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5", …],
          "tp": 27,
          "fam": "Giuoco Piano",
          "fi": 0,
          "notes": [
            "1.e4 — open the king's pawn…",
            "1...e5 — Black says 'you want the centre?…'",
            …
          ],
          "plan": "You came out of the opening a clean pawn up…",
          "b": 0
        }
      ]
    }
  ],
  "positions": { /* opening book positions */ }
}
```

### Learn Flow Input
- `olStartLearn(opIdx, vIdx)` → sets `olearn = { op, v, sans, states, idx }` and calls `olRenderLearn()`
- `olRenderLearnStep()` reads `olearn.v.notes[idx-1]` (bolded on "N.move —"), renders board state, shows plan at end
- No `uci` needed; moves derived via `sanToMove(san, state)` + `buildHistory()`

---

## Key Code Patterns & Conventions

### Startup & Sections
```javascript
// Init deferred behind rAF + setTimeout fallback (fixes headless renderers)
let _gbInited = false;
function _gbRunInit(){ if(_gbInited) return; _gbInited = true; safeInit(); }
function _gbScheduleInit(){ requestAnimationFrame(_gbRunInit); setTimeout(_gbRunInit, 60); }

// Each section init is independent (one failure can't abort others)
try { acadInit(); } catch(e){ console.error('acad init failed:', e); }
try { olInit(); } catch(e){ console.error('ol init failed:', e); }
try { ccInit(); } catch(e){ console.error('cc init failed:', e); }

// Section navigation
window.showSection = function(id){
  // toggle active class, manage nav tab highlighting, push history
  // Openings library: lazy-load on section show if not yet loaded
  if(id === 'openings'){ try{ if(!OL){ olInit(); } else { olRenderGrid(); } }catch(e){} }
}
```

### Openings Curation (Python script pattern)
```python
import json, io
p = r"C:/Users/user/…/openings_v5.json"
d = json.load(io.open(p, encoding="utf-8"))

# edit d["openings"] in-place, then write back
for o in d["openings"]:
    if "opening-name" in o.get("f", "").lower():
        o["v"] = variations  # list of {n, eco, s, tp, fam, fi, notes, plan, b}
        o["desc"] = "card description"
        o["intro"] = {"summary": "…", "plans": ["…"]}
        o["curated"] = True

io.open(p, "w", encoding="utf-8").write(json.dumps(d, ensure_ascii=False, separators=(",", ":")))
```

### Board Rendering
```javascript
// Render a board to an element
renderBoardEl(elemId, ranksId, filesId, state, highlightSquares, arrows);

// Board parity: a1 is dark
function isLight(fi, r){ return (fi + r) % 2 === 0; }  // fi = file index (0–7, a–h), r = rank (0–7, 1–8)

// Piece symbols: use SVG `.ic` wrapper with currentColor
<span class="ic"><svg>…icon…</svg></span>

// Responsive board: use CSS custom property
#cc-board { --ccsq: clamp(44px, 6.8vh, 66px); }
#cc-board .sq { width: var(--ccsq); height: var(--ccsq); }
```

### CSS Patterns
```css
/* Variables */
:root {
  --bg: #0a0a0b;
  --bg2: #1a1a1c;
  --text: #fff;
  --text2: #b0b0b0;
  --gold: #d4af37;
  --ease: cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

/* Grid layout (workspace) */
.cc-stage {
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-areas: "board side";
  gap: 14px 28px;
}

/* Contained scroll */
.cc-side { max-height: min(560px, 60vh); overflow-y: auto; }

/* Responsive text (no px, clamp) */
font-size: clamp(14px, 1.1vw, 18px);
```

### localStorage Persistence
```javascript
// Account
localStorage.setItem('gambit_account', JSON.stringify({name, email, at: Date.now()}));

// Course Creator
localStorage.setItem('gambit_courses', JSON.stringify(CC.courseLines.map(…)));

// Openings mastery (spaced repetition)
localStorage.setItem('gambit_ol_mastery', JSON.stringify({
  "Italian Game#0": {m: ts, due: ts+interval, iv: 2.3, reps: 1},
  …
}));

// Quiz progress
localStorage.setItem('gambit_quiz_progress', JSON.stringify({steps, srs, streak, lastStudy}));
```

---

## Development Workflow

### Local Setup
1. **Web server:** Render.com deployment or local `python -m http.server 3000`
2. **Edit:** modify `public/index.html` directly (no build step)
3. **Openings data:** use Python scripts to edit `public/openings_v5.json`, then bump `?v=N` cache-bust in the fetch URL
4. **Verify:** reload preview, test the feature end-to-end (drive learn flow, check DOM)

### Preview Gotchas
- **rAF-deferred renders:** preview headless renderer doesn't fire `requestAnimationFrame` → use setTimeout fallback (ALREADY FIXED)
- **External fonts:** Fontshare CDN blocked by CSP in preview, but loads fine on Render (verified)
- **Screenshots:** occasionally time out on infra → verify via computed styles + DOM inspection instead
- **Cache-busting:** openings data fetched with `cache:'force-cache'` → bump `?v=N` on any JSON change to reach returning users

### Git Workflow
- Commit message format:
  ```
  [Feature/Fix]: short title

  - bullet point detail 1
  - bullet point detail 2

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```
- All changes to `public/index.html` and `public/openings_v5.json` tracked in git
- Push to `origin main` → auto-deploys to Render (webhook configured)

---

## Remaining Tasks

### High Priority
1. **Build more openings** to the Italian/Ruy standard — both flagship courses rebuilt 2026-07-05 to the 30–50-line-cap philosophy (Italian 30 lines, Ruy 27). Next candidates: Sicilian for Black, Queen's Gambit for 1.d4. Reuse the scratchpad build pipeline: lines.py → validate.py → prefix-keyed notes → assemble.py → write_course.py → app-engine walk verification.
   - Pattern: Python script with per-move notes (one sentence per ply, starting "N.move — "), plan per line, opening intro (summary + 5 plans)
   - Verify: walk each variation in learn flow to "End of variation"
   - Update filter regex in `olRenderGrid` to include new opening name

2. **Full review drills** (distinct from learn)
   - Learn: shows hint + correct move, teaches
   - Review: no hints, pure recall, tests knowledge
   - Same SAN sequence, different UI + hints toggle

3. **Pagination** for long lists (opening cards, game lists) for balanced ad impressions

### Medium Priority
1. **Community Courses** (upload/share user-built courses)
2. **SEO opening-guide pages** (static guides per opening, landing-pad for Google)
3. **Polish exam/certification flow** (if adding testing mode)
4. **Keyboard shortcuts** for board controls (arrow keys, spacebar for next, etc.)

### Low Priority
1. **Restore visualizations** (move tree, repertoire map) with premium styling once openings are more complete
2. **Mobile app** (native wrapper of web version)
3. **Offline mode** (cached data + service worker)

---

## Deployment & Monitoring

### Live Site
- **URL:** `gambit-chess-academy.onrender.com`
- **Hosting:** Render (auto-builds & deploys on git push to main)
- **Build command:** (static site, no build)
- **Env vars:** none required

### Analytics & Ads
- **Hash routing:** each section = `history.pushState('#' + id)` for pageview tracking
- **AdSense:** slots for "ADVERTISEMENT" sections (not yet configured for revenue)
- **GA / gtag:** hooked into `showSection()` for page-view events

---

## Memory & Context for Future Sessions

- **`site-visual-identity.md`** — full design language, logo, current visual state, responsive behavior
- **`game-review-design-direction.md`** — Game Review structure, eval graph design, player panels (4 days old, verify before citing)

---

## Key Files & Line Counts

- **`public/index.html`** — ~2.4 MB, ~27,000 lines (all CSS, JS, HTML)
- **`public/openings_v5.json`** — ~660 KB (minified; fetched with `?v=9` cache-bust)
- **`.claude/skills/frontend-design/`** — design skill (see skill name `/frontend-design` for advanced UI/UX tasks)

---

## Quick Reference: Common Tasks

### Add a new opening to the library
1. Write Python script to edit `openings_v5.json` (follow `ruy.py` pattern)
2. Add opening name to the filter regex in `olRenderGrid()`
3. Bump `?v=N` in `olInit()` fetch URL
4. Test: reload, verify card + learn flow

### Build the landing hero
- Markup: `#landing` section with `.cinematic-floor` + `.lp-logo` + `.lp-nav`
- CSS: B&W checkerboard floor via `::before`, vignette overlay, Clash Display headline
- Skip logic: `location.hash` + `sessionStorage.gambit_entered` check in `showSection()`

### Add a new icon
- SVG dictionary approach: define in `olRenderGrid()` or other render functions
- Wrap in `<span class="ic"><svg>…</svg></span>` for `currentColor` inheritance
- Examples: `PEN`, `GLOBE`, `ARROW` icons already in openings toolbar

### Style a new section
- Use CSS variables: `var(--bg)`, `var(--text)`, `var(--gold)`, `var(--ease)`
- Respect `@media (prefers-reduced-motion: no-preference)` for animations
- Responsive font: `clamp(min, ideal, max)` — no px units for critical sizes

---

**Handoff Complete.** Questions? Check memory files or grep the codebase for patterns. Current model: Claude Haiku 4.5.
