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

### Proxy/confused-deputy escalation via a "grant permissions" capability

When reviewing a proposal to delegate a "grant/revoke permissions" capability to a non-admin
role, check not just whether the holder can escalate *themselves* (self-grant), but whether they
can escalate an *arbitrary third-party account* they control or collude with (proxy/confused-
deputy escalation). A permission that can grant *other* permissions is effectively as powerful as
the union of everything it can grant, not just the specific flag it's named for — "no self-grant"
and "cannot grant this permission to others" rules do not, by themselves, close the proxy path of
granting a *different* permission to a *different* account the holder controls.

### New SQL functions default to PUBLIC-executable — always make an explicit GRANT/REVOKE decision

Postgres grants `EXECUTE` on a newly created function to `PUBLIC` by default — this is not
opt-in, it must be explicitly revoked if unwanted. When reviewing or designing a new SQL function
(especially `SECURITY DEFINER`), never assume "it's only meant to be called internally" is
actually enforced — it isn't, unless revoked. Test to apply: does the function accept an
identity/token and look up server-held state (secrets, another user's data) by it? If so, it must
be restricted (`revoke ... from public, anon, authenticated`, grant back only to the specific
caller that needs it). If it only operates on values the caller already supplies/controls (no
table lookup by identity), a broad grant is safe.

This pattern has previously been encountered and fixed in this project's own history — a class of
internal helper function was left `PUBLIC`-executable after creation and had to be explicitly
revoked once the exposure was identified. Treat that precedent as a reason to check this
deliberately on every new function, not as a one-time fix that already covers future additions.
