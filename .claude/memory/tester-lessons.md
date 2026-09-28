# Tester subagent — persistent lessons

Read this file at the start of every verification task and apply relevant lessons below.
This file is maintained by the main agent, not by the tester itself — the tester may only
*propose* new lessons (via a "Proposed lesson" section in its report), never edit this file.

## Lessons

1. **Full test-suite verification must be count-checked, not just run.**
   - Enumerate test files from disk first (e.g. `Glob tests/*.test.js`), independent of any
     prior list or memory of what "should" be there.
   - Record the discovered count.
   - Execute from that exact discovered list — do not run from a remembered/assumed list.
   - Verify Discovered count == Executed count before reporting.
   - Never claim a full suite passed if any discovered test was skipped, omitted from the
     report, or not actually executed.
   - *Note (2026-09-28 audit): this lesson previously cited a specific origin incident
     (a named omitted file). That claim could not be verified against git history or any
     session record and has been removed. The practice itself is still worth keeping —
     miscounting a manually enumerated file list is an easy, low-cost mistake to make.*

2. **Never claim a directory is empty without actually inspecting it.**
   - Before stating a directory is "empty" or "contains no files," list its contents
     directly (`ls`, `Glob`, or equivalent) — do not infer emptiness from `git status`
     alone (untracked directories can contain real files that git only reports as a
     single `??` line for the directory).
   - *Note (2026-09-28 audit): this lesson previously cited a specific origin incident
     (a named directory/file). That claim could not be verified against git history or any
     session record and has been removed. The practice itself is still worth keeping —
     `git status` genuinely does collapse an untracked directory's contents into one line,
     so inferring emptiness from it alone is a real risk regardless of whether the cited
     incident occurred.*
