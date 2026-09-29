# Architect subagent — persistent lessons

Read this file at the start of every substantial planning task and apply relevant lessons below.
This file is maintained by the main agent, not by the architect itself — the architect may only
*propose* new lessons (via a "Proposed lesson" section in its report), never edit this file.

Lessons here are specific to architecture/planning work (tracing data flow, scoping file
changes, cross-mode impact, migration ordering implications). A lesson broadly useful beyond
planning belongs in `.claude/memory/shared-lessons.md` instead.

## Public-repository safety

This repository is public. Do not add a lesson here that contains a password, token, API key,
internal company detail, private IP/hostname, personal information, or other sensitive
infrastructure/vulnerability detail that could help an attacker. A lesson like that belongs under
`.claude/private/` (gitignored), not here — flag it as `PRIVATE NOTE` instead of adding it to
this tracked file.

## Lessons

### Inline migration comments explaining a schema-change cost are authoritative evidence

When a migration file contains an inline comment explaining *why* a schema change was costly
(e.g. a comment noting that `CREATE OR REPLACE FUNCTION` fails when a function's return shape
changes, requiring an explicit `DROP FUNCTION` first), treat that comment as authoritative
evidence of a real, previously-paid cost — not just a stylistic note. It's a strong signal when
evaluating whether a newly proposed pattern will reproduce or avoid that same cost, and should be
cited directly (by file/line) in any plan proposing a related schema change.

Verified: `supabase/participant-transfer-permission-toggle.sql:19-22` documents that Postgres
rejects `CREATE OR REPLACE FUNCTION` when the returned row shape changes (silently creating an
overload if only parameters changed, or erroring with 42P13 if the returned table shape changed),
requiring an explicit `DROP FUNCTION` first. This directly informed rejecting a "keep adding
individual boolean columns" approach in favor of a stable-shape (e.g. JSONB) storage design for a
granular permissions system, since each new boolean would otherwise repeat this drop+recreate
cost across every affected RPC.

### Verify each similar-looking flag's actual grant surface individually — don't assume uniformity

When several boolean toggles look uniform because they were each introduced by a separate
migration with a similar "same pattern as X" comment, don't assume they all have the same set of
roles allowed to grant/revoke them. Grep each toggle's actual RPC surface (e.g. every
`*_set_*<flag>*` function name) individually before designing a unification/refactor around them
— the grant surface can silently diverge per-flag even when the migration comments imply
uniformity.

Verified: of the four `committees` boolean flags (`can_edit_final`, `can_self_draw`, `show_score`,
`show_stats_summary`), grepping `supabase/*.sql` for `supervisor_set_committee_` shows three are
supervisor-settable (`can_edit_final` via `supabase/supervisor-role.sql`, `show_score` via
`supabase/committee-score-visibility.sql`, `show_stats_summary` via
`supabase/committee-stats-summary-visibility.sql`), while `can_self_draw`
(`supabase/committee-self-draw-permission.sql`) has no supervisor-callable RPC at all — admin-only.
This asymmetry materially changed a granular-permissions unification plan (whether supervisor's
existing committee-toggle rights should be preserved or revoked by the new design).
