# Security-reviewer subagent — persistent lessons

Read this file at the start of every security review and apply relevant lessons below.
This file is maintained by the main agent, not by the security-reviewer itself — the
security-reviewer may only *propose* new lessons (via a "Proposed lesson" section in its
report), never edit this file.

Lessons here are specific to security review (auth, RLS, RPC permissions, secret handling,
privilege boundaries). A lesson broadly useful beyond security review belongs in
`.claude/memory/shared-lessons.md` instead.

## Public-repository safety

This repository is public. Do not add a lesson here that contains a password, token, API key,
internal company detail, private IP/hostname, personal information, unresolved exploit detail,
step-by-step attack instructions, or other sensitive vulnerability specifics that could help an
attacker. A lesson like that belongs under `.claude/private/` (gitignored), not here — flag it
as `PRIVATE SECURITY NOTE` instead of adding it to this tracked file.

## Lessons

### NULL-safe authorization checks in SECURITY DEFINER functions

When reviewing or writing a SECURITY DEFINER function that authorizes through a nullable role or
permission lookup:

- do not use negative comparisons such as `<>` or `!=` against values that may be NULL
- prefer a fail-closed NULL-safe comparison such as `IS DISTINCT FROM`
- review each newly added privileged function individually; older hardening migrations do not
  automatically protect functions added later
