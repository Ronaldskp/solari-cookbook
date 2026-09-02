# ChaosLens V1.1 Implementation Report

Date: 2026-09-02
Spec: `docs/CHAOSLENS_SPEC_V1.1.md` (frozen)
Plan: `docs/CHAOSLENS_PLAN.md`

---

# 1. Status

**READY_FOR_CODE_REVIEW**

The full V1 implementation is complete, unit-tested, build-clean, and validated
by six real Solari acceptance runs. One environment-level caveat is documented
and does not reflect an implementation gap: Solari's replay retrieval endpoint
is intermittently unavailable for this account (service deploys landed Sep 1–2,
2026). While it is down, audits honestly report `INCONCLUSIVE` per Spec §24;
the one successful replay capture (run #4, offline scenario, 14.8 KB rrweb
NDJSON) proves the release → releaseAndWait → poll lifecycle end-to-end. No
code change is needed for the audit to produce a scored run once the service
recovers.

# 2. Baseline

| Item | Value |
| --- | --- |
| Repository | fork `Ronaldskp/solari-cookbook` (upstream `solari-sdk/solari-cookbook`) |
| Base | `main` @ `d304843` |
| Feature branch | `feat/chaoslens-v1` @ `18d4f19` (local + fork; further commits listed in git log) |
| SDK | `@solarisdk/sdk@0.1.2`, `@solarisdk/browser@0.1.2` (types inspected before coding) |
| Node | v24.15.0 local; sandbox runtime verified (Smoke-02) |
| Tests | vitest — `npm test` |
| Build | `npm run build` — tsc --noEmit, `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` |

# 3. Implemented (per frozen Spec)

| Spec area | Status | Where |
| --- | --- | --- |
| §6 end-to-end workflow | DONE | `src/orchestrator.ts` |
| §7.1 Sandbox lifecycle | DONE | `src/sandbox/create.ts`, `application.ts`, `snapshot.ts` |
| §7.2 Browser lifecycle (recording, release/wait, ≥30s poll, 404=PROCESSING) | DONE | `src/browser/session.ts` |
| §8 exactly three faults | DONE | `src/faults/{http-error,latency,offline}.ts` |
| §9 deterministic flow (5 minimum step types + `wait`) | DONE | `src/browser/flow-runner.ts` |
| §10 six assertion types | DONE | `src/assertions/evaluate.ts` |
| §11 PASS/FAIL/ERROR rules | DONE | `src/report/model.ts` |
| §12 baseline gate | DONE | orchestrator |
| §13 score formula + INCONCLUSIVE | DONE | `computeScore` (33 pinned in tests; legacy 67 explicitly excluded) |
| §14 evidence bundle (7 artifacts + raw replay when available) | DONE | `src/browser/evidence.ts` |
| §15 HTML report | DONE | `src/report/html.ts` |
| §16 demo checkout with frozen outcome pattern | DONE | `demo/checkout-app` |
| §17 explicit config, runtime validation, fail fast | DONE | `src/config.ts` |
| §18 CLI `--config/--output/--verbose`, concise output | DONE | `src/cli.ts` |
| §19 layout | DONE | `examples/chaoslens/` |
| §20 no runtime LLM | DONE | none anywhere in the verdict path |
| §21 security | DONE | `src/env.ts`, `src/redact.ts`, `.gitignore`, synthetic demo data |
| §22 resource lifecycle with finally-cleanup | DONE | orchestrator/session/snapshot |
| §23 1 sandbox, sequential scenarios, fresh session per run | DONE | by construction |
| §24 fail-loud behavior incl. missing key / unactivated fault / replay window | DONE | errors + classification |
| §25 smoke gate + software tests + real acceptance | DONE | see §4–§6 |

# 4. Solari Smoke Results (Phase 0, real account, no mocks)

| Smoke | Result |
| --- | --- |
| Sandbox | PASS |
| Runtime (node/npm/python3/git) | PASS |
| Minimal server (background process + health) | PASS |
| Preview URL (local client → preview, token redacted) | PASS |
| Browser → Preview | PASS |
| Screenshot | PASS |
| Recording + Replay | FAIL at gate time — **server-side blocker**, later intermittently recovered (see §6) |
| Cleanup (finally, incl. failure paths) | PASS |

Transcript: `artifacts/smoke/<timestamp>/smoke-result.json`.

# 5. Automated Tests

```text
npm test
 Test Files  9 passed (9)
      Tests  60 passed (60)
npm run build → clean
```

Covered: config validation; fault configuration; assertion evaluation (incl.
input-value reads and evaluation-error path); status classification; scoring
(33 pinned; BLOCKED; INCONCLUSIVE; legacy-67 guard); artifact serialization;
secret redaction; HTML report (verdicts, banners, escaping); error handling;
AC-02 missing-key startup failure; bundled example config validity.

# 6. Real Solari Acceptance

Six real runs (`artifacts/acceptance/*`), final three complete end-to-end:

| Item | Result | Evidence |
| --- | --- | --- |
| Sandbox create/connect | PASS | runs #4–#6 (`✓ Solari Sandbox created`) |
| Clone from public Git repository | PASS | fork `Ronaldskp/solari-cookbook` @ `feat/chaoslens-v1` cloned inside sandbox |
| Install + start + health | PASS | `install.log`, health poll logs |
| Snapshot of healthy state | PASS | `snap_…` ids per run |
| Clean-state restore between scenarios + re-preview + re-health | PASS | 3× per run: `✓ Clean state restored (healthy)` (via amended restore path) |
| Baseline run (real recorded browser) | PASS | runs #4–#6 `✓ Baseline passed` |
| HTTP 500 injection proven | PASS | `fault http-500 activated on https://…/api/checkout`; fault-events.json; network 500s |
| Latency injection proven | PASS | fault-events.json per-request delay records (8000 ms) |
| Offline injection proven | PASS | fault-events.json activation; failed requests in network evidence |
| Deterministic verdicts | PASS | baseline PASS / HTTP 500 FAIL / Slow API FAIL / Offline PASS — reproduced in runs #4, #5, #6 |
| Screenshot per scenario | PASS | `screenshot.png` in every scenario dir (two committed as README evidence) |
| Recording/replay retrieval | PARTIAL — lifecycle correct; endpoint intermittently 404 | run #4 offline: real replay downloaded (14,822 bytes rrweb NDJSON + presigned URL in `replay-url.txt`); runs #5–#6 all 404 after 36–90s polling |
| Console/network/fault/server logs persisted | PASS | per-scenario bundles |
| HTML report | PASS | `report.html` per run |
| Cleanup | PASS | `sandbox killed` on every run, including aborted runs #1–#3 |

Verdict evidence (identical across runs #4–#6), e.g. run #6:

```text
✓ Baseline passed
✗ HTTP 500   spinner still visible after 3000ms; order-error never visible
✗ Slow API   2 requests matched /api/checkout (max 1); button still enabled
✓ Offline    offline banner visible; email input value preserved
Audit INCONCLUSIVE — missing replay evidence (Spec §24)
```

# 7. Acceptance Criteria

| AC | Status | Note |
| --- | --- | --- |
| AC-01 install via README | NOT VERIFIED | steps executed successfully by the implementer; no independent fresh user yet |
| AC-02 missing key → explicit failure | PASS | unit-tested; no mock fallback |
| AC-03 real sandbox | PASS | 6 runs |
| AC-04 demo app inside sandbox | PASS | installed/started/healthy in-sandbox |
| AC-05 healthy baseline via preview URL | PASS | runs #4–#6 |
| AC-06 clean state + re-health between scenarios | PASS | amended restore path; every restore re-verified healthy |
| AC-07 real browser per run | PASS | 4 recorded sessions per full run |
| AC-08 500 proven | PASS | fault-events + network evidence |
| AC-09 latency proven | PASS | delay records with timestamps |
| AC-10 offline proven | PASS | activation + failed requests |
| AC-11 deterministic verdicts only | PASS | assertion records in every scenario-result.json |
| AC-12 ≥1 FAIL and ≥1 PASS | PASS | 2 FAIL + 1 PASS |
| AC-13 screenshot per scenario | PASS | verified in all full runs |
| AC-14 replay evidence per valid scenario after release/wait/poll | NOT VERIFIED (partial) | lifecycle proven; retrieval intermittently unavailable server-side; 1 real replay captured |
| AC-15 logs persisted | PASS | console/network/fault/server per scenario |
| AC-16 HTML report | PASS | every run |
| AC-17 report distinguishes PASS/FAIL/ERROR | PASS | chips + banners |
| AC-18 score formula | PASS | formula unit-tested; live audits withhold the score while INCONCLUSIVE, exactly as Spec §13 requires |
| AC-19 baseline failure blocks scoring | PASS | unit + code path |
| AC-20 infra errors never app FAIL | PASS | classification tests + run #2 REVERT infra failure → audit ERROR |
| AC-21 no keys/tokens in committed/generated artifacts | PASS | secret scan + redaction (§9) |
| AC-22 all browser sessions released | PASS | close + releaseAndWait per session |
| AC-23 sandbox destroyed after completion | PASS | every completed run |
| AC-24 cleanup after failure | PASS | aborted runs #1–#3 still killed the sandbox |
| AC-25 evidence from real Solari | PASS | all committed screenshots/evidence from real runs |
| AC-26 no simulated fallback in public demo | PASS | no mock/demo bypass exists in the audit path |

# 8. Deviations

1. **`wait` flow step** (superset addition). Spec §9 lists five *minimum* step
   types; the frozen latency demo requires a deterministic second programmatic
   click while the first request is pending — a timed pause. No product
   semantics changed.
2. **Clean-state restore via `fromSnapshot` instead of in-place `revert`** —
   mandated by observed gateway behavior (`409 Not revertable`, `pause()` 404)
   plus the 1-concurrent-sandbox plan limit. Fully documented with evidence in
   `docs/SPEC_AMENDMENT_REQUIRED.md`; semantics preserved (same proven-clean
   snapshot per scenario, preview/health re-verified); reversible if `revert`
   becomes available.
3. **Replay polling window**: default 36s (≥30s required), configurable via
   `CHAOSLENS_REPLAY_POLL_WINDOW_MS` (min 30s) — used at 90s for acceptance
   while the upload pipeline was unstable. Spec floor respected.
4. `SPEC_AMENDMENT_REQUIRED.md` produced for (2) only. Recording itself is not
   amended: it worked once during acceptance (run #4), so the frozen
   requirement is treated as service-unstable, not SDK-impossible.

# 9. Security

- **API key scan**: no real `slr_live_…` anywhere in repo/artifacts (only
  synthetic test fixtures, verified by scan).
- **Preview-token scan**: all `pt_token` occurrences redacted in logs,
  evidence, and reports. Incident handled: run #1's local log (short-lived
  preview token of a killed sandbox) was committed for one commit, then
  untracked and removed from the fork the same session.
- **Synthetic data**: demo uses only `demo@example.com` / `123 Test Street`.
- **Cleanup**: every run released all browsers and killed the sandbox in
  `finally`, including aborted runs. No billable resources left behind.

# 10. Remaining Issues

1. **Replay retrieval intermittently unavailable server-side** (org
   `cmtk44h8f00l6o201gok9894v`). Until stable, acceptance runs report
   `INCONCLUSIVE` instead of the frozen `33 / 100` score — per Spec §24 this
   is the correct behavior, not a workaround. Re-verification command:
   `npm run audit -- --config ./chaoslens.config.acceptance.ts --output ./artifacts/acceptance`.
2. In-place `revert()`/`pause()` rejected for this account's pool sandboxes —
   ChaosLens uses the documented `fromSnapshot` path (see §8.2). If Solari
   restores in-place revert, `restoreCleanState()` can switch back.
3. AC-01 awaits an independent fresh-user install pass (publication phase).
