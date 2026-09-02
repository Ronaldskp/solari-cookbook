# SPEC_AMENDMENT_REQUIRED — Sandbox clean-state restore (REVERT)

Status: **AMENDMENT APPLIED IN IMPLEMENTATION** (smallest possible change;
product semantics preserved). Awaiting Spec revision acknowledgement.

## Requirement (frozen Spec §7.1 / §6)

Between reliability scenarios ChaosLens must restore the clean application
state via snapshot `REVERT` on the **same** sandbox, then re-fetch the preview
URL and re-run the health check before the next Browser session.

## Actual SDK / service limitation (verified on the real account, 2026-09-02)

Against `@solarisdk/sdk@0.1.2` and the live gateway (`api.getsolari.com`):

| Probe | Result |
| --- | --- |
| `sandbox.snapshot(name)` | **works** — returns `snap_…` id |
| `sandbox.revert(snapId)` while running | **`409 {"error":"Not revertable"}`** (reproduced across two sandboxes/runs) |
| `sandbox.pause()` then revert | `pause()` itself fails with `404 {"error":"Not found"}` |
| `sandboxes.create({ fromSnapshot })` while original sandbox alive | `429 ConcurrencyLimitExceeded` (free plan: 1 concurrent sandbox) |
| kill original → `sandboxes.create({ fromSnapshot })` | **works** — fresh sandbox boots from snapshot with disk **and running app process restored** (verified: marker file + live `/health` after restore) |

Documentation checked: docs.getsolari.com `/snapshots` documents `revert()`
with no listed restrictions; the observed gateway behavior contradicts it for
this account's pool sessions. Changelog shows service deploys on Sep 1–2, 2026
touching session/sandbox state handling.

## Evidence

- `scripts/diagnose-revert.ts` — variant A: `409 Not revertable` while
  running; variant B: `pause()` → `404 Not found`.
- `scripts/diagnose-fork.ts` — kill-then-fork restores marker file + running
  server process (`B app process restored + healthy: true`).
- Acceptance run `artifacts/acceptance/2026-09-02T14-26-33-638Z/audit-result.json`:
  `REVERT: failed to revert sandbox to snapshot: GatewayError: Not revertable`.

## Smallest possible amendment

Replace in-place `REVERT` with the SDK's documented snapshot-restore path,
keeping every other guarantee identical:

> After each scenario: stop the application stream, destroy the current
> sandbox, boot a fresh sandbox from the ready snapshot (`fromSnapshot`),
> re-resolve the preview URL, and re-verify application health before the next
> Browser session starts. A scenario runs only when the restored state is
> HEALTHY; otherwise the audit reports an infrastructure `ERROR`.

Differences from the frozen wording:

- The sandbox **id changes** between scenarios (in-place id stability is not
  achievable while `revert` returns 409).
- One concurrent sandbox is still the maximum; restore is sequential.

## Impact

- None on product semantics: every scenario still starts from the same
  proven-clean snapshot; preview/health re-verification still gates each
  scenario; infrastructure failures still classify as `ERROR`, never app FAIL.
- Evidence model unchanged; per-scenario `server.log` reflects the restored
  instance (honest, since state is snapshot-identical).
- Implementation: `src/sandbox/snapshot.ts → restoreCleanState()`,
  `src/orchestrator.ts` swaps the active sandbox between scenarios.
- Reversible: if `revert()` becomes available again, `restoreCleanState()` can
  switch back to in-place revert without touching any other module.
