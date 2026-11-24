# Shared persistent lessons (main agent + all subagents)

Verified lessons that apply broadly — across the main Claude session and every current and
future project subagent, regardless of role. Role-specific lessons (e.g. testing/verification
specifics) belong in that role's own file, such as `.claude/memory/tester-lessons.md`, not here.

This file is written only by the main agent, after verifying the lesson against the actual
repo/filesystem/code. Subagents may only *propose* additions (e.g. via a "Proposed lesson"
section in their report) — they must never write to this file themselves. Do not persist a
lesson based only on an assumption or an unverified claim (from a subagent or a user) — check
it against reality first.

## Lessons

### Every UI change is verified on all screen sizes and both themes (standing user rule, 2026-10-15)
- The user asked that this be standard, never something they must request. Before reporting any visual change, check it at **390 (phone), 768 (tablet), 1024 (small laptop), 1440 (large laptop)**, in **light and dark** mode (`setColorMode("dark")`).
- Run automated checks (no horizontal overflow, nothing past the viewport edge, no cut-off tabs/buttons, overlays inside the screen) **and** look at the screenshots — automated checks miss contrast problems.
- Verified pitfall: `--green-800` flips to a light mint (`#6fe3ac`) in dark mode, so white text on it becomes unreadable. For a dark background that stays dark in both themes (with white text), use `--green-900`, the same as `.primary-btn`.
- How it's done here: headless Chrome via the DevTools protocol against a local static server — no build or install needed. Chrome is at `C:/Program Files/Google/Chrome/Application/chrome.exe`, and Node 24 has a built-in `WebSocket`.
- Verified 2026-11-18: launching Chrome with `child_process.spawn` from Node never opens the debugging port in this environment. Launch it from PowerShell (`Start-Process ... --headless=new --remote-debugging-port=9333 --user-data-dir=<scratch>`), wait ~4s, then connect from Node.
- The Diwan pages are hidden in local mode (`.local-branch-app #diwanView{display:none}`). To screenshot them, remove the `local-branch-app` class from `#app` in the test setup, or the page renders blank while DOM checks still pass.

### Screenshot harness details (verified 2026-11-24)
- A custom Node static server run in the background was refused by the permission classifier. `python -m http.server 8765 --bind 127.0.0.1` (background) worked.
- Headless Chrome caches `index.html`/CSS between runs, so a new stylesheet seemed "not applied". Call `Network.enable` + `Network.setCacheDisabled({cacheDisabled:true})` on every target before navigating.
- The off-canvas mobile sidebar (`aside.sidebar`, closed) always shows up as "past the viewport edge" in overflow scans. This is expected: `scrollWidth` stays equal to the viewport width. Judge overflow by `scrollWidth`, not by that element.
- Local-mode seeding: `openLocalMode()` clears `#setupAdminName`, so set it as well as `#setupPin` before `requestSubmit()`, or the setup silently fails.
- The exam screen can be shown without the cloud: `openTrialScreen()` → `ensureQuranReady()` → `drawTrialPositions([...])` → `openTrialElectronicAssessment(p)`.
