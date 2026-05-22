# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project Overview

**SwiftLapLogic** — a swim performance tracking app for competitive swimmers and coaches. Logs times, tracks goals, analyzes uploaded stroke videos, generates race plans, and provides a coach dashboard.

## Tech Stack

- **Backend:** Node.js + Express v5 (`src/index.js`)
- **Database:** Supabase (Postgres) via `@supabase/supabase-js` — connection in `src/db.js`
- **Frontend:** Static HTML/CSS/JS in `public/` (note: README mentions React Native as a future direction; current frontend is vanilla)
- **File uploads:** Multer (used by video route)
- **Watch app:** lives in a **separate sibling repo** at `../SwiftLapWatch/` (i.e. `/Users/Kimaya/SwiftLap-project/SwiftLapWatch/`), not inside this folder. It has its own git repo and its own CLAUDE.md.

## Folder Structure

```
SwiftLap/
├── src/
│   ├── index.js              # Express entry; mounts all routes under /api
│   ├── db.js                 # Supabase client
│   ├── workouts.js           # Workout generation logic
│   ├── lib/                  # Shared business logic
│   │   ├── badges.js
│   │   ├── feedback.js
│   │   ├── plan.js
│   │   ├── tracking.js
│   │   └── utils.js
│   └── routes/               # Express routers (each owns its own path prefix)
│       ├── auth.js
│       ├── achievements.js
│       ├── batches.js
│       ├── coach.js
│       ├── coachBadges.js
│       ├── comments.js
│       ├── goals.js
│       ├── groups.js
│       ├── insights.js
│       ├── leaderboard.js
│       ├── meets.js
│       ├── requests.js
│       ├── settings.js
│       ├── times.js
│       ├── training.js
│       ├── video.js
│       └── watch.js
├── public/                   # Static frontend (index.html, app.js, styles.css)
│                             #   Swimmer dashboard is a tile grid (#homeView) that
│                             #   navigates to #view-* sections via showSection()/showHome().
├── db/
│   └── migrations/           # Hand-run SQL migrations (apply manually in Supabase SQL editor)
├── docs/
│   └── create-manual.js
├── package.json
└── .env                      # Supabase credentials, PORT (gitignored)
```

## Database migrations

SQL in `db/migrations/` is **not auto-applied** — paste each file into the Supabase SQL editor to run it. Files are named `YYYY-MM-DD-description.sql`.

## Routing Convention

All routers are mounted under `/api` in `src/index.js`. **Each router defines its own path prefix internally** (e.g. `/goals`, `/watch`). When adding a new route file, register it the same way.

## Run / Dev

- Install: `npm install`
- Start: `npm start` (runs `node src/index.js`, defaults to port 3000)
- No test suite yet (`npm test` is a no-op).

## Git Workflow

- Long-lived branches: `main`, `staging`
- Feature branches follow `feature/m{N}-description` (milestones m2 through m21+)

## Maintenance

**Keep this file and the memory index up to date.** Whenever the folder structure, stack, routing convention, or major workflows change, update this CLAUDE.md and the memory at `~/.claude/projects/-Users-Kimaya-SwiftLap-project/memory/` in the same change.
