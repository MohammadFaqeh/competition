# CLAUDE.md

Operating guide for Claude Code in this repository. For full product behavior, read `SITE-SPEC.md` (the accurate, current reference) — `README.md` is a lighter quick-start and is known to be partially outdated (see SITE-SPEC §15.3).

## 1. Project overview

A static web application (Arabic, RTL) that runs an oral exam competition end-to-end: participant registration, fair random draw of exam positions, live electronic grading by committees, result approval, and export (Excel/PDF certificates). Domain: Quran memorization competition, plus a separate "Diwan al-Hifadh" multi-stage certification track and a standalone trial/practice section.

- **No build step.** Pure HTML/CSS/vanilla JS served as-is by any static HTTP server (deployed on GitHub Pages). Opening `index.html` directly via `file://` does not work because of `fetch` calls.
- **No framework.** UI is built from template literals injected via `innerHTML`, with `escapeHtml` used for all user-supplied text.
- **Two operating modes**, chosen on the gateway screen:
  - **Cloud branch**: backed by Supabase (Postgres + Auth + Edge Functions). Shared across devices. Roles: admin, supervisor, sub-admin, committee chairman/member.
  - **Local branch**: `localStorage` only, single supervisor account, nothing sent to any server.
- All sensitive logic and authorization is enforced in the database (RLS + `SECURITY DEFINER` RPCs), not in frontend code.

## 2. Important files and responsibilities

| Path | Responsibility |
|---|---|
| `index.html` | All screens: gateway, local setup, cloud login, admin dashboard, committee UI, trial section. |
| `app.js` | All frontend logic and calculations: participants, draw generation, scoring, Diwan al-Hifadh stage logic, exports. Large, dense file (4000+ lines) — read the relevant section before editing rather than skimming the whole file. |
| `cloud.js` | Supabase integration layer. Exposes `window.CloudCompetition` (annual competition) and `window.DiwanCompetition` (Diwan al-Hifadh). All RPC calls, auth, sync/polling live here. |
| `styles.css` | Full design system: CSS variables, light/dark mode, responsive layout, PDF template styles. |
| `supabase/` | SQL migrations (45 files), run in a strict order — each file often redefines functions from a prior file. The full order isn't fully enumerated anywhere (README's setup list only covers 15 of the 45 files); check file dependencies/git history when order isn't obvious. Also `supabase/functions/` (Edge Functions: `auto-backup`, `password-reset`). |
| `tests/` | Dependency-free Node tests (`node tests/<name>.test.js`) covering scoring, level matching, Diwan stage logic, sync/race conditions, etc. |
| `data/quran.json` (+ `quran-data.js`, `quran-lines*.json/js`) | Quran text and per-line layout data, lazy-loaded and cached client-side. |
| `assets/quran-pages/` | 604 mushaf page images used to render exam positions during live grading. |
| `vendor/` | Locally vendored third-party libraries (Supabase JS client, Lucide icons, SheetJS/xlsx, jsPDF, html2canvas) — no CDN, so the app works offline. |

## 3. Development rules

- Preserve the existing architecture (static files, vanilla JS, template-literal rendering, Supabase RPC pattern) unless there's a strong, explicit reason to change it — ask first if a change would be architectural.
- Before adding a new function/helper, check `app.js`/`cloud.js` for an existing one that does the same thing (e.g. `escapeHtml`, `secureShuffle`, `queueStateSave`, `resolveParticipantCommittee`) and reuse it.
- Avoid unnecessary rewrites or refactors of working code that isn't part of the requested change.
- The app must keep working as plain static files servable by any basic HTTP server — don't introduce anything that requires a build/bundle step.
- Do not introduce a build system (bundler, transpiler, package-manager-driven build) unless the user explicitly asks for one.
- Do not replace `vendor/` libraries with CDN-hosted equivalents — the app must keep working offline.
- Bump the `?v=` query string on changed `<script>`/`<link>` tags in `index.html` when editing `app.js`/`cloud.js`/`styles.css`, so browsers don't serve a stale cached copy.

## 4. Supabase / database rules

- `supabase/*.sql` migrations run in a specific order — never reorder or skip existing files. README's setup list only enumerates 15 of the 45 files and is known to be outdated, so don't treat it as a complete reference; when order isn't obvious, check function dependencies or git history. Add new changes as a new migration file, not by editing an already-applied one.
- Any database change must go through a proper new SQL migration file — do not describe schema/RPC changes as something to apply ad hoc in the Supabase SQL editor without a corresponding file in the repo.
- Never expose a `service_role` key or any other secret in frontend code (`app.js`, `cloud.js`, `index.html`, `supabase-config.js`). Only the public `anon` key belongs in frontend config; `service_role` usage is confined to Edge Functions.
- Preserve Row Level Security and the `SECURITY DEFINER` RPC authorization pattern — all access control must stay enforced in the database, not reintroduced as a frontend-only check.
- When touching authentication, roles, RPC functions, or permission flags (`can_edit_final`, `can_delete_data`, `can_transfer_participant`, `can_self_draw`, etc.), explicitly reason through the security implications (e.g. NULL-safe role checks per SITE-SPEC §11.2, gender-based data filtering done server-side, rate-limiting/lockout behavior) before finalizing the change.
- When redefining an existing SQL function in a new migration, copy all its fields/logic from the latest actual version, not from an intermediate one — this has caused real regressions before (SITE-SPEC §5.6).

## 5. Testing and verification

- After changes to scoring, level-matching, import, sync, or Diwan al-Hifadh stage logic, run the relevant Node tests (or the full suite) from `tests/`, e.g.:
  ```bash
  node tests/scoring.test.js
  node tests/level-catalog.test.js
  ```
- Consider regressions in both cloud mode (Supabase-backed) and local mode (`localStorage`-backed) when a change touches shared logic in `app.js` — the two modes share most UI/calculation code but diverge in persistence.
- Run `git diff` (or review changed files) before declaring a task complete, to confirm the change matches what was intended and nothing unrelated was touched.
- Do not claim something works, is fixed, or is tested unless it was actually run/verified in this session — state clearly when something was not verified (e.g. no live Supabase project or browser available).

## 6. Project documentation

- `SITE-SPEC.md` is the accurate, detailed source of truth for product behavior (written from the actual code, dated 2026-09-19) — treat it as the spec, not just background reading.
- Do not silently contradict `SITE-SPEC.md` when implementing a change.
- If an implementation change would conflict with what `SITE-SPEC.md` describes, point out the conflict to the user before making the behavioral change, rather than deciding unilaterally which one is "right."

## 7. Git safety

- Do not commit or push unless explicitly asked to in that turn.
- Do not discard or revert unrelated existing changes (staged, unstaged, or untracked) while working on a task.
- Avoid destructive Git commands (`reset --hard`, `checkout --`/`restore` over uncommitted work, `clean -f`, force-push, branch deletion) unless explicitly approved for that specific action.
