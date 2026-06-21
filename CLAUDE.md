# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project Overview

**SwiftLap** — a swim performance tracking app for competitive swimmers and coaches. Logs times, tracks goals, analyzes uploaded stroke videos, generates race plans, and provides a coach dashboard. (The repo/npm package and the duplicate Render service are still named "SwiftLapLogic" for legacy reasons; the product/brand name is **SwiftLap**.)

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

## Delete endpoints (2026-06-21)

`DELETE /api/times/:id` and `DELETE /api/goals/:id` (in `times.js`/`goals.js`) let
a swimmer remove their own logged time / goal (accidental-tap recovery). Both are
scoped to `swimmer_id = req.user.id`. Delete UI is now shipped on **all three
clients** (web 🗑 button, iOS swipe-to-delete, Android trash icon — each with a
confirm).

## No demo seeding on signup (2026-06-21)

New swimmers used to get a seeded demo goal/time/workout (`src/lib/seed.js`
`seedDemoData`, called from `auth.js` signup + oauth-sync) so the dashboard wasn't
empty — but it made fresh accounts look pre-filled like the demo. **Removed both
calls and deleted `src/lib/seed.js`**; new accounts start empty. The watch route
still deletes any leftover `source='demo'` rows on the first real workout (harmless
safety net for older seeded accounts).

## Canonical host (swiftlap.in)

`src/index.js` has a top-of-stack middleware that 301-redirects any browser
request whose `Host` ends in `.onrender.com` to `https://swiftlap.in` (same
path) — this is how people given the old Render link get bounced to the domain.
Render's default `*.onrender.com` subdomain can't be deleted, so the redirect is
the way to "turn it off." **Skipped on purpose:** `/api` (a 301 can rewrite a
POST→GET, and breaks any client still pinned to the Render URL) and `/healthz`
(the keepalive ping must wake *this* dyno); GET/HEAD only. All clients (web, iOS
`Shared/AppConfig.swift`, Android `core/AppConfig.kt`) already use swiftlap.in,
and both GitHub workflows (`keepalive.yml`, `video-cleanup.yml`) now point at
swiftlap.in too, so nothing depends on the onrender hostname anymore.

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
- `meets.js` (reworked 2026-05-27 — **multi-event meets, upcoming/over**): a `meet_results` row is now one *event* of a meet, carrying an optional `expected_seconds` (upcoming) and a now-nullable `time_seconds` (actual). `/meets/create` accepts an `events[]` array (each with expected and/or actual times). New `/meets/log-result` fills in the actual time for an existing event (→ `swim_times` + PB-check). `/meets/:swimmerId` now lists **all** meets (upcoming + over) with a derived `status`, `eventCount`, `pendingCount`. Logging any race time also calls `notifyGroupRankChanges`.
- `notifications.js` + `lib/notifications.js` (2026-05-27 — **in-app inbox**; **remote push added 2026-06-01**): `GET /notifications/:userId` (own only) returns `{ notifications, unread }`; `POST /notifications/read` marks one (`body.id`) or all read. `POST /notifications/register-device` / `/unregister-device` store/remove a device's APNs token (`device_tokens`, upsert on token). `POST /notifications/test` is a self-only diagnostic that pushes a test alert to the caller's own devices and returns `{ apnsConfigured, devices }`. `createNotification(userId, type, title, body, data)` inserts the inbox row **and** best-effort fans out an APNs push to that user's devices (prunes tokens Apple reports dead). Event hooks: a video upload notifies the swimmer's **coach** (`video_review`); logging a race time triggers `notifyGroupRankChanges` (`group_rank`).
- `lib/apns.js` (2026-06-01 — **APNs sender, zero deps**): built-in `http2` + `crypto`; ES256-signs a cached provider JWT from the `.p8` and POSTs to Apple's HTTP/2 gateway. Env: `APNS_KEY_ID`, `APNS_TEAM_ID` (default `98QNV4FG3G`), `APNS_P8` (PEM, `\n`-escaped ok), `APNS_BUNDLE_ID` (default `com.swiftlap.ios`), `APNS_PRODUCTION` (`true`→prod gateway for TestFlight/App Store; unset→sandbox for Xcode dev builds). `isConfigured()` gates everything, so push silently no-ops until the env is set. **iOS dev builds get sandbox tokens → keep `APNS_PRODUCTION` unset until you ship via TestFlight/App Store, then set it to `true`.** **Live since 2026-06-01** — env set on the **SwiftLap** Render service (`swiftlap.onrender.com`, Oregon), which is the one the apps call; the **SwiftLapLogic** service (Singapore) is an unused duplicate that also auto-deploys from this repo. Verified end-to-end via `/notifications/test`.
- `lib/groupLeaderboard.js` (2026-05-27): `computeGroupLeaderboard(groupId)` (extracted from `groups.js`, now shared) + `notifyGroupRankChanges(swimmerId)` which diffs each member's rank vs `group_members.last_rank` and notifies on change.
- **Analytics dashboard** (2026-06-20): the `analytics` event log (written by `lib/tracking.js` `trackEvent`/`logError`; clients also POST custom events to `/analytics/track`, e.g. `training_plan_view`, `insights_view`) now has a schema migration (`db/migrations/2026-06-20-analytics.sql` — idempotent; codifies the previously hand-made table + indexes). `GET /analytics/summary` (server-operator only, `requireCron`) was expanded from a last-100 count into a full window aggregation: `?days=N` (default 30, cap 90) returns KPIs (total events, unique/active-7d/30d users, signups, logins, times logged, errors), `byType` counts, a zero-filled `perDay` series, and `recentEvents`/`recentErrors`. **Operator dashboard at `public/admin.html`** (`noindex`, standalone, Deep Ocean styling) — prompts for the `CRON_SECRET` (kept in `sessionStorage`), sends it as `x-cron-secret`, and renders the KPIs, a daily-activity bar chart, an events-by-type table, and error/event feeds. This is an operator-only tool, so no iOS/Android parity is required (clients only need to keep emitting events via `/analytics/track`).

### Pending manual Supabase migrations (run in SQL editor before deploy)
- `db/migrations/2026-05-27-meet-events.sql` — adds `meet_results.expected_seconds`, makes `time_seconds` nullable, adds `result_logged_at`.
- `db/migrations/2026-05-27-notifications.sql` — creates `notifications`, adds `group_members.last_rank`.
- `db/migrations/2026-06-01-device-tokens.sql` — creates `device_tokens` (APNs push). ✅ Run 2026-06-01 (RLS enabled; backend uses the service-role key so RLS doesn't affect it).
- `db/migrations/2026-06-20-analytics.sql` — codifies the existing `analytics` table + indexes (idempotent; safe to run against the live hand-made table — just adds the missing indexes).

## Pre-App-Store polish pass (2026-06-01)

UX/feedback pass across **backend + web + iOS** (no DB migration — all new endpoints reuse existing tables):
- **Dedup:** `/batches/create` rejects a duplicate batch name for the same coach (case-insensitive, 409); `/meets/create` rejects a meet the swimmer already has (same name + same date, 409, returns the existing `meet`).
- **Coach-facing lists:** `GET /goals/assigned/:coachId` (coach-assigned goals across the roster, each with `swimmerName` + live `status` ahead/behind/no_data), `GET /training-routines/assigned/:coachId` (each with `swimmerName`).
- **Recommendations (coach side):** `GET /meets/recommendations/coach/:coachId` (sent list + `swimmerName`), `POST /meets/recommendation/update` (edit name/date/note — coach-owned), `DELETE /meets/recommendation/:id` (withdraw). `/meets/recommend` now calls `createNotification` per swimmer (`meet_recommendation`) → inbox + push + the Meets-tile badge.
- **Web (`public/`):** repainted to the **Deep Ocean** palette (accent `#0ea5e9`→`#0AB6BC`, surface→navy `#0A2540`, primary gradient teal→aqua, danger→coral). Clickable Team-Overview stat boxes (drill to swimmer list), Assign view has batch→swimmer narrowing + assigned goals/routines lists, Recommend view shows an editable Sent Recommendations list, invite confirmation is a transient toast. Dedup errors surface via existing `alert(data.error)`.

## Transactional email (2026-06-01)

**Who sends what:**
- **Supabase Auth** sends the only auth emails: the **coach invite** (`requests.js` → `supabase.auth.admin.inviteUserByEmail`, the one always-on email) and **signup confirmation** (only if "Confirm email" is ON in the Supabase project — it's OFF, since `/auth/signup` auto-logs-in). No password-reset/magic-link flow exists. OAuth sends nothing. The "from" address is whatever the Supabase project's Auth → SMTP is set to (default `noreply@mail.app.supabase.io` until custom SMTP is configured).
- **App-sent (new) — `src/lib/email.js`:** a **welcome email** on every new account (`/auth/signup` + first-time `/auth/oauth-sync`). Uses **nodemailer over SMTP** (provider-agnostic — Resend/SendGrid/Mailgun/SES). Best-effort + self-gating: `isConfigured()` is false until SMTP env is set, so sign-up never breaks. Branded Deep Ocean HTML.

**Env to go live (set on the Render `SwiftLap` service):** `SMTP_HOST`, `SMTP_PORT` (587 STARTTLS / 465 TLS), `SMTP_USER`, `SMTP_PASS` (secret), `MAIL_FROM` (default `SwiftLap <hello@swiftlap.in>`), `APP_URL` (link target, also the invite `redirectTo`). **Domain `swiftlap.in`** is the chosen sender domain — verify it with the provider (SPF + DKIM + DMARC DNS records) before mail is trusted. To put the **Supabase** invite/confirm emails on the same domain, set the same SMTP in Supabase Dashboard → Authentication → Emails → SMTP Settings.

## API authentication (enforced as of 2026-05-24)

Every `/api` route now requires a valid Supabase access token. `src/lib/auth.js`
provides `authGate` (mounted on `/api` in `index.js`): it verifies the Bearer
token via `supabase.auth.getUser()` and loads the caller's profile into
`req.user`. Route handlers derive the acting user from `req.user` (never the
request body) and enforce per-resource ownership with the helpers in
`lib/auth.js` (`isSelf`, `coachOwnsSwimmer`, `coachOwnsBatch`, `inGroup`,
`canAccessSwimmer`, `forbidden`).

**Two Supabase clients (`src/db.js`):** `supabase` (service-role key, bypasses
RLS) for all `.from()`/`.storage`/`.auth.admin`/`auth.getUser(token)` work, and
`supabaseAuth` (anon key) used **only** for user `signUp`/`signInWithPassword`.
This matters: calling a session-mutating auth method on the admin client makes
its later `.from()` calls run as that user under RLS instead of as the service
role — which previously broke email signup (the `profiles` insert ran as the new
user and RLS rejected it). Keep sign-in/sign-up on `supabaseAuth`; everything
else on `supabase`.

- **Public paths** (no token): `/health`, `/config`, `/auth/login`,
  `/auth/signup`, `/auth/oauth-sync`.
- **Cron/admin** (`requireCron`, header `x-cron-secret` == `CRON_SECRET`):
  `/video/cleanup`, `/analytics/summary`.
- **Watch device** (no user session): pairs via a 4-digit code (rate-limited on
  `/watch/verify-code` — 10 attempts/IP per 10-min window — since a 4-digit code is
  brute-forceable), then authenticates
  with a per-device **HMAC token**. `/watch/verify-code` returns the token
  (`signWatchToken`); `/watch/workout` requires it (`verifyWatchToken` — header
  `x-watch-token` or body `watchToken`), derives the swimmer from it, and still
  checks `watch_linked_at` so unlinking revokes. Token secret: `WATCH_TOKEN_SECRET`
  (optional; falls back to the service-role key). These two endpoints stay public.
- Clients attach the token: web wraps `fetch` (`public/app.js`), iOS sets
  `APIClient.tokenProvider` (`SwiftLapApp`). Both let the Supabase SDK refresh it.

**Required env before deploy:** set `CRON_SECRET` in Render **and** as a GitHub
Actions secret (used by `.github/workflows/video-cleanup.yml`), or video cleanup
+ the analytics summary will 401. (`WATCH_TOKEN_SECRET` is optional.)

**Top open priorities (pick up here):**
1. **Monetization** (free login + subscription): a `subscription_status` on profiles + entitlement checks on gated endpoints (+ StoreKit on iOS, Stripe on web). The auth foundation above is the prerequisite.
2. Move video blobs off Supabase Storage to **Cloudflare R2** (free egress) before scale.
3. **Stroke Analysis** video feedback is a **stub** (`lib/feedback.js`), labeled DEMO in the UIs (renamed from "AI feedback" 2026-05-24) — make it real (on-device Option D, or a model) when ready.

Done since: per-device watch tokens (2026-05-25); account-deletion completeness (2026-05-25).

Manual Supabase steps already done 2026-05-22: ran `db/migrations/2026-05-22-video-coach-feedback.sql`; set the `videos` storage bucket to **private**.
