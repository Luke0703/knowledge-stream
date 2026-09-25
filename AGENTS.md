# AGENTS.md

## Project
Knowledge Stream prototype. Target completion: 2026-10-20.

## Source of truth
Read `docs/SPEC.md` before implementation. Do not silently expand scope beyond it.

## Stack
React + TypeScript + Vite, Cloudflare Workers + Static Assets, Cloudflare D1, YouTube IFrame Player API.

## Working rules
- Mobile-first. iPhone Safari is a required test target.
- Keep CSS responsible for layout/snap behavior; keep player lifecycle, loading, playback and state in TypeScript.
- Do not download, proxy, store, or re-host YouTube video/audio.
- Prefer a small number of mounted YouTube players around the active item.
- General users do not need accounts in the prototype.
- Persist local watch/save/not-interested state locally unless SPEC says otherwise.
- Database schema changes must use migrations.
- Keep admin functionality isolated under /admin and do not invent custom authentication when Cloudflare Access can protect it.
- Do not add YouTube Data API, TikTok, Instagram, AI classification, direct uploads, comments, or advanced recommendations unless SPEC is updated first.
- Implement one GitHub issue/phase at a time. Keep changes reviewable.
- Before declaring a task complete, run available typecheck/build/tests and report anything that still requires real-device or Cloudflare-account verification.
