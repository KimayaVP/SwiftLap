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
- `video.js`: videos now stored as **paths + signed URLs** (private bucket); `/video/coach-feedback` (coach reviews a clip); `/video/cleanup` (deletes clips >14 days, run by `.github/workflows/video-cleanup.yml`); `/video/pending/:coachId` (coach review queue — clips from the coach's swimmers with no coach feedback yet; powers the review-bell notifications on web + iOS).
- `batches.js`: `/batches/move` (move a swimmer between batches in one step — remove from `fromBatchId` + add to `toBatchId`; `fromBatchId` optional).
- `requests.js`: `/requests/send` rejects `swimmer_to_coach` (coach-only linking); `/requests/invite` emails non-users a signup link; `/requests/unlink` removes a swimmer from a coach's roster (`coach_id → null`) — callable by the swimmer or their coach.

## API authentication (enforced as of 2026-05-24)

Every `/api` route now requires a valid Supabase access token. `src/lib/auth.js`
provides `authGate` (mounted on `/api` in `index.js`): it verifies the Bearer
token via `supabase.auth.getUser()` and loads the caller's profile into
`req.user`. Route handlers derive the acting user from `req.user` (never the
request body) and enforce per-resource ownership with the helpers in
`lib/auth.js` (`isSelf`, `coachOwnsSwimmer`, `coachOwnsBatch`, `inGroup`,
`canAccessSwimmer`, `forbidden`).

- **Public paths** (no token): `/health`, `/config`, `/auth/login`,
  `/auth/signup`, `/auth/oauth-sync`.
- **Cron/admin** (`requireCron`, header `x-cron-secret` == `CRON_SECRET`):
  `/video/cleanup`, `/analytics/summary`.
- **Watch device** (no user session — proves linkage via 6-digit code +
  `watch_linked_at`): `/watch/verify-code`, `/watch/workout`. Closing this fully
  needs per-device tokens — a known follow-up.
- Clients attach the token: web wraps `fetch` (`public/app.js`), iOS sets
  `APIClient.tokenProvider` (`SwiftLapApp`). Both let the Supabase SDK refresh it.

**Required env before deploy:** set `CRON_SECRET` in Render **and** as a GitHub
Actions secret (used by `.github/workflows/video-cleanup.yml`), or video cleanup
+ the analytics summary will 401.

**Top open priorities (pick up here):**
1. **Monetization** (free login + subscription): a `subscription_status` on profiles + entitlement checks on gated endpoints (+ StoreKit on iOS, Stripe on web). The auth foundation above is the prerequisite.
2. Move video blobs off Supabase Storage to **Cloudflare R2** (free egress) before scale.
3. **Stroke Analysis** video feedback is a **stub** (`lib/feedback.js`), labeled Beta in the UIs (renamed from "AI feedback" 2026-05-24) — make it real (on-device Option D, or a model) or keep it clearly a demo for App Store.
4. Harden the **watch device** endpoints with per-device tokens (see above).

Manual Supabase steps already done 2026-05-22: ran `db/migrations/2026-05-22-video-coach-feedback.sql`; set the `videos` storage bucket to **private**.
