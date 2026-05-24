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

## Cross-platform parity

Every feature/change must be replicated across **web (`public/`) + the native iOS app (`../SwiftLapApp`) + future Android**. Never ship to one client only. The endpoint usually lives here once; the parity work is per-client UI.

## Current state & next steps (as of 2026-05-22)

There is now a **native iOS + watchOS app** in the sibling folder `../SwiftLapApp` (repo `KimayaVP/SwiftLapApp`) that mirrors this web app and uses these same APIs. See its `CLAUDE.md`.

Recently added endpoints (all under `/api`):
- `auth.js`: `/auth/oauth-sync` (Google/Apple, links by email), `/auth/delete-account` (App Store requirement; deletes user data + Supabase auth user).
- `video.js`: videos now stored as **paths + signed URLs** (private bucket); `/video/coach-feedback` (coach reviews a clip); `/video/cleanup` (deletes clips >14 days, run by `.github/workflows/video-cleanup.yml`).
- `requests.js`: `/requests/send` rejects `swimmer_to_coach` (coach-only linking); `/requests/invite` emails non-users a signup link.

**Top open priorities (pick up here):**
1. **🔴 API auth is not enforced.** The server uses the **service-role key** (bypasses RLS) and trusts client-supplied `userId`/`swimmerId` with no token check — any client can read/modify/delete others' data. Fix this (verify the caller's token, identify the user server-side) before launch. It is also the prerequisite for monetization.
2. **Monetization** (free login + subscription): needs #1, then a `subscription_status` on profiles + entitlement checks on gated endpoints (+ StoreKit on iOS, Stripe on web).
3. Move video blobs off Supabase Storage to **Cloudflare R2** (free egress) before scale.
4. "AI" video feedback is a **stub** (`lib/feedback.js`), labeled Beta in the UIs — make it real (on-device Option D, or a model) or keep it clearly a demo for App Store.

Manual Supabase steps already done 2026-05-22: ran `db/migrations/2026-05-22-video-coach-feedback.sql`; set the `videos` storage bucket to **private**.
