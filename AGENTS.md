# AGENTS.md

## Project and scope
- Knowledge Stream mobile-first web prototype, target: **2026-10-20**.
- Read **`docs/SPEC.md`** first. Also read **`docs/PLAN.md`** and the assigned GitHub Issue.
- `docs/CODEX_START.md` is the starting Phase 1 prompt.
- If a technical limitation conflicts with the spec, report it and propose the smallest safe change. Do not silently revise product decisions.

## Tech constraints
- React + TypeScript + Vite SPA; one Cloudflare Worker with Static Assets and API.
- D1 via bindings inside Worker only; no browser-side D1 credentials or Cloudflare SDK access.
- Versioned HTTP API, shared DTOs, thin repositories for SQL, separate pure feed logic.
- UUID internal IDs distinct from YouTube external video IDs.
- D1 migrations tracked in Git. SQL must use parameter binding.
- Browser LocalStorage only through client-state wrapper. Viewed = active item on entering, **not video end**.
- User tabs: **動画 / 検索 / プロフィール（設定）**. Search = partial match over **own curated metadata in D1**, not YouTube search.

## YouTube constraints
- Use official YouTube IFrame Player API only. Do not download/store/proxy media; do not obscure player logos, controls, links, or ads.
- Keep independent UI outside player bounds; reserve safe-area for bottom navigation.
- CSS scroll-snap handles layout/snap; TS handles active state, playback, errors and limited iframe mounting.
- A YouTube iframe may intercept touch swipes. Do not put invisible touch overlays above iframe; verify iPhone Safari and supply explicit navigation outside player if necessary.
- Never assume autoplay works on mobile. One active auto-playing player max and only if sufficiently visible.
- Avoid YouTube Data API for MVP.

## Security / privacy
- General viewing without login. Admin UI and **admin API** must require Cloudflare Access, with Worker-side JWT verification and fail-closed behavior; do not ship fake or hardcoded admin auth.
- Validate/sanitize server inputs, rate-limit anonymous feedback, enforce duplicate vote uniqueness.
- No secrets/tokens in Git, frontend VITE_* variables, browser LocalStorage, logs, or generated docs.
- Anonymous client ID is not identity proof. Use server-side HMAC before persistence; don't reuse for ad tracking.
- Viewed/saved/not-interested stay local; anonymous feedback only reaches D1.
- Local, staging, production DBs must be separated; avoid accessing production during local development.

## Development workflow
- Work one Issue/phase at a time and keep changes reviewable. New feature branch and PR when feasible.
- Prefer Cloudflare's official React + Vite starter to inventing a deployment architecture.
- Before completion run typecheck/build/tests. Report failures and remaining manual/real-device verification.
- Never silently deploy production, change Cloudflare account policies, or create paid resources.
- Do not add TikTok/Instagram, general video submissions, login, AI classification, own media uploads, microservices, or new Cloudflare products without updating the spec.

## Acceptance
- Interactive feed and official YouTube UI must work on iPhone Safari.
- Unauthenticated admin API calls must fail.
- Player errors, empty feed, and autoplay-blocked state should not strand user.
