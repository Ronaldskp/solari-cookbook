# ChaosLens V1.1 Implementation Report

Date: 2026-09-02
Spec: `docs/CHAOSLENS_SPEC_V1.1.md` (frozen)
Plan: `docs/CHAOSLENS_PLAN.md`

---

# 1. Status

**PENDING ACCEPTANCE RUN** — final status set after the real Solari acceptance run completes.

<!-- FINAL: READY_FOR_CODE_REVIEW | BLOCKED -->

# 2. Baseline

| Item | Value |
| --- | --- |
| Repository | `solari-sdk/solari-cookbook` fork (`Ronaldskp/solari-cookbook`) |
| Base | `main` @ `d304843` |
| Feature branch | `feat/chaoslens-v1` @ <!-- HEAD --> |
| SDK | `@solarisdk/sdk@0.1.2`, `@solarisdk/browser@0.1.2` |
| Node | v24.15.0 (local), sandbox runtime verified in Phase 0 |
| Tests | vitest, `npm test` |
| Build | `npm run build` (tsc --noEmit, strict) |

# 3. Implemented (per frozen Spec)

| Spec area | Status | Notes |
| --- | --- | --- |
| §6 end-to-end workflow | DONE | `src/orchestrator.ts` |
| §7.1 Sandbox lifecycle (clone/install/start/health/preview/snapshot/revert/cleanup) | DONE | `src/sandbox/*` |
| §7.2 Browser lifecycle (recording, release/wait, replay poll ≥30s, 404=PROCESSING) | DONE | `src/browser/session.ts` |
| §8 three fault classes (500 / latency / offline) | DONE | `src/faults/*` |
| §9 deterministic flow (goto/click/fill/waitForVisible/waitForHidden + `wait` superset) | DONE | `src/browser/flow-runner.ts` |
| §10 assertions (visible/hidden/disabled/requestCount/text/baselineSuccess) | DONE | `src/assertions/evaluate.ts` |
| §11 PASS/FAIL/ERROR classification | DONE | `src/report/model.ts` |
| §12 baseline gate | DONE | orchestrator |
| §13 score formula + INCONCLUSIVE | DONE | `computeScore`, tests pin 33 |
| §14 evidence bundle per scenario | DONE | `src/browser/evidence.ts` |
| §15 HTML report | DONE | `src/report/html.ts` |
| §16 demo checkout with frozen outcome pattern | DONE | `demo/checkout-app` |
| §17 explicit config contract, fail-fast validation | DONE | `src/config.ts` |
| §18 CLI (`--config`, `--output`, `--verbose`) | DONE | `src/cli.ts` |
| §21 security (env-only key, redaction, synthetic data, .env gitignored) | DONE | `src/env.ts`, `src/redact.ts` |
| §22 resource lifecycle with finally-cleanup | DONE | orchestrator/session/snapshot |
| §23 one sandbox, sequential scenarios, fresh session per run | DONE | by construction |
| §24 fail-loud error model | DONE | `src/errors.ts` + staged errors |
| §25 software tests (9 areas) | DONE | 59 tests, all green |

# 4. Solari Smoke Results (Phase 0, real account)

| Smoke | Result |
| --- | --- |
| Sandbox | PASS |
| Runtime (node/npm/python3/git) | PASS |
| Minimal server | PASS |
| Preview URL | PASS |
| Browser → Preview | PASS |
| Screenshot | PASS |
| Recording + Replay | **FAIL — server-side blocker** |
| Cleanup | PASS |

Recording blocker evidence: five sessions created with `recording: true`, all
properly released (`GET /sessions/:id` → `"status":"released"`), yet
`GET /sessions/:id/replay-url` returns
`404 {"error":"No replay available for this session"}` persistently (3s to
10+ minutes; re-probes later the same day still 404). Eliminated: loopback
proxy path, direct gateway `wss://` connection, session length/activity.
Usage matches official docs + cookbook exactly. Solari deployed recording- and
status-related changes on Sep 1–2, 2026 (changelog.getsolari.com). Consequence:
any audit run currently ends `INCONCLUSIVE` (Spec §24: missing replay evidence
makes the run incomplete) even when all verdicts are deterministic and proven.

# 5. Automated Tests

```text
npm test
 Test Files  9 passed (9)
      Tests  59 passed (59)
```

Coverage areas: config validation; fault configuration; assertion evaluation;
status classification; scoring (33 pinned, legacy 67 explicitly excluded);
artifact serialization; secret redaction; HTML report; error handling incl.
AC-02 startup failure without `SOLARI_API_KEY`.

# 6. Real Solari Acceptance

<!-- Fill from acceptance run evidence -->

| Item | Result |
| --- | --- |
| Sandbox | PENDING |
| Clone from public repository | PENDING |
| Application install + start + health | PENDING |
| Snapshot | PENDING |
| Revert + re-preview + re-health between scenarios | PENDING |
| Baseline (real browser) | PENDING |
| HTTP 500 | PENDING |
| Latency | PENDING |
| Offline | PENDING |
| Screenshots | PENDING |
| Recording | PENDING |
| Replay retrieval | PENDING |
| Logs (server/console/network/fault) | PENDING |
| HTML report | PENDING |
| Cleanup (browsers released, sandbox killed) | PENDING |

# 7. Acceptance Criteria

<!-- AC-01..AC-26 with PASS / NOT VERIFIED -->

# 8. Deviations

- Flow steps include one superset addition: `wait` (deterministic pause). The
  Spec lists the five minimum step types (§9); the frozen latency demo requires
  a deterministic second programmatic click while the first request is still
  pending, which needs a timed pause. No product semantics changed.
- `SPEC_AMENDMENT_REQUIRED.md` was NOT produced: the recording failure is not
  proven to be a permanent SDK limitation (service deploys landed Sep 1–2);
  it is documented as a server-side blocker and re-verified before release.

# 9. Security

- API key scan: `slr_live_` never appears in source, configs, tests, README,
  or artifacts (redactor + gitignore + review).
- Preview-token scan: `pt_token` redacted in console/logs, network evidence,
  reports, and JSON artifacts. Incident handled: one local run log containing
  a short-lived preview token was committed for ~1 commit, then untracked and
  removed from the fork; the token was tied to an already-killed sandbox and
  expired within the hour.
- Synthetic data only in the demo (`demo@example.com`, `123 Test Street`).
- Cleanup: every run releases browsers and kills the sandbox in `finally`.

# 10. Remaining Issues

- Recording/replay retrieval currently unavailable server-side for this
  account (see §4). Until it recovers, acceptance runs are `INCONCLUSIVE`
  rather than scored, per Spec §24.
- Replay URLs expire; raw downloaded replays are the durable artifact.
