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
