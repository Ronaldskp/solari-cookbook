# ChaosLens Implementation Plan

Execution plan for the frozen `CHAOSLENS_SPEC_V1.1.md`.
This document tracks real progress; every Phase carries `TODO → IN_PROGRESS → PASS / BLOCKED`.

---

## Baseline

| Item | Value |
| --- | --- |
| Repository root | `E:\Ronald\05-Personal\03-chaoslens` |
| Upstream | `https://github.com/solari-sdk/solari-cookbook.git` (origin) |
| Base branch | `main` @ `d304843f5ea0edb5c27829bb2ca30868645bef7a` ("desktop example: use mousepad…") |
| Feature branch | `feat/chaoslens-v1` (created from clean `main`; working tree had only untracked `docs/`) |
| SDK | `@solarisdk/sdk@0.1.2`, `@solarisdk/browser@0.1.2` (installed, types inspected) |
| Browser engine types | `patchright-core` (Playwright-compatible; `page.route`, `context.setOffline`, `page.screenshot` confirmed in `.d.ts`) |
| Local runtime | Node `v24.15.0`, npm `11.12.1`, git `2.54.0`, win32 |
| Sandbox runtime (target) | Solari `base` template, Linux microVM |
| Frozen spec | `docs/CHAOSLENS_SPEC_V1.1.md` (never overwritten) |

SDK capability audit from installed type definitions (evidence before any code):

- Sandbox: `commands.start()` (background handle, `onData`/`wait`/`kill`) for the long-running server; `git.clone()`; `files.*`; `previewUrl(port)` → `{ url, token }`; `snapshot(name?)` → id; `revert(snapshotId)` in place (id stable); `kill()` idempotent.
- Browser: `solari.launch({ recording: true })` → `BrowserSession`; `browser.contexts()[0]`; `browser.close()` = close + release; `solari.sessions.releaseAndWait(id)`; `solari.sessions.getReplayUrl(id)`; `solari.sessions.downloadReplay(id)`.
- Replay is async after release → poll ≥30s, 404 = PROCESSING.

---

## Phase 0 — Solari Capability Smoke Gate

**Goal:** prove with the real Solari SDK + real account that every capability the frozen Spec depends on actually works, before writing the orchestrator. No mocks.

**Files:** `examples/chaoslens/scripts/smoke-gate.ts` (+ small throwaway server file written into the sandbox at runtime).

**Implementation:**
1. Smoke-01 Sandbox: `sandboxes.create({ template: "base" })`, record sandboxId / template / region / success.
2. Smoke-02 Runtime: `commands.run` for `node --version`, `npm --version`, `python3 --version`, `git --version`; record real output.
3. Smoke-03 Minimal server: write tiny Node HTTP server into sandbox, start via `commands.start`, verify port listens + `/health` responds from inside.
4. Smoke-04 Preview URL: `sandbox.previewUrl(port)`, fetch health from local machine; record status / refresh behavior / token presence. All logs redact `pt_token`.
5. Smoke-05 Browser: `solari.launch()`, navigate to preview URL, assert reachable.
6. Smoke-06 Screenshot: `page.screenshot()` saved to disk.
7. Smoke-07 Recording: `solari.launch({ recording: true })`, perform clicks, `browser.close()` → `releaseAndWait` → poll `getReplayUrl`/`downloadReplay` ≥30s with backoff; 404 within window = PROCESSING.
8. Smoke-08 Cleanup: browser release + `sandbox.kill()` inside `finally`.

**Validation:** real transcripts of each smoke step saved under `examples/chaoslens/artifacts/smoke/<timestamp>/smoke-result.json`.

**Exit Criteria:**
```text
Sandbox PASS, Runtime PASS, Preview URL PASS, Browser PASS, Browser→Preview PASS,
Screenshot PASS, Recording PASS, Replay Retrieval PASS, Cleanup PASS
```

**Status:** `BLOCKED` — `SOLARI_API_KEY` missing (env var, user/system registry, sibling `.env` all checked). Waiting for credential provisioning; nothing is mocked or forged in the meantime.

---

## Phase 1 — Project Skeleton & Config

**Goal:** minimal-intrusion `examples/chaoslens/` following cookbook conventions (self-contained dir, `type: module`, `tsx` runner) + runtime-validated config contract.

**Files:**
```text
examples/chaoslens/
├── package.json, tsconfig.json, .gitignore, .env.example
├── chaoslens.config.example.ts
├── src/
│   ├── cli.ts
│   ├── types.ts          (shared domain types)
│   ├── config.ts         (load + runtime validation, fail fast)
│   ├── orchestrator.ts
│   ├── redact.ts         (secret scrubber)
│   ├── log.ts            (concise terminal output)
│   ├── sandbox/{create,application,snapshot}.ts
│   ├── browser/{session,flow-runner,evidence}.ts
│   ├── faults/{http-error,latency,offline}.ts
│   ├── assertions/evaluate.ts
│   └── report/{model.ts,html.ts}
├── demo/checkout-app/
├── tests/
└── artifacts/
```

**Implementation:** strict TS (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), no `any` except at SDK edges with justification, no extra abstractions. Config supports: repository URL, git ref, install command, start command, port, health path, critical flow (goto/click/fill/waitForVisible/waitForHidden + fault arming point), faults, assertions. Hand-written validator (no new runtime deps), fail fast with precise errors. Missing `SOLARI_API_KEY` → explicit startup failure (AC-02).

**Validation:** `npm run build` (tsc --noEmit) clean; unit tests for config validation.

**Exit Criteria:** skeleton compiles; valid + invalid configs accepted/rejected by tests.

**Status:** `TODO`

---

## Phase 2 — Sandbox Runtime

**Goal:** full sandbox lifecycle: create → clone → install → start → health → preview → snapshot → revert → logs → cleanup.

**Files:** `src/sandbox/create.ts`, `src/sandbox/application.ts`, `src/sandbox/snapshot.ts`.

**Implementation:**
- Create with `template: "base"`, rolling `timeoutMs` extended as audit progresses (`setTimeout`).
- `git.clone(repo, { branch: ref, path })`; run configured install command (`commands.run`, capture output).
- Start app with `commands.start` (background handle); stream stdout+stderr through the redactor into in-memory ring → persisted as `server.log` per scenario.
- Health: `previewUrl(port)`, poll health path from local machine until `READY` or `TIMEOUT` (bounded, ~60s).
- Snapshot after healthy baseline state; after every scenario: `revert(snapshotId)` → re-fetch `previewUrl` → re-run health check → only proceed when HEALTHY, else infrastructure `ERROR`. If revert leaves the app process unresponsive, one documented restart-then-rehealth attempt before ERROR.
- `kill()` in `finally` on every path.

**Validation:** unit tests around state machine with mocked SDK boundary; real behavior proven in Phase 11.

**Exit Criteria:** lifecycle compiles, mocked tests pass, no path leaves a sandbox un-killed.

**Status:** `TODO`

---

## Phase 3 — Browser Flow Engine

**Goal:** deterministic flow execution on a fresh recording browser per run. No autonomous agent.

**Files:** `src/browser/session.ts`, `src/browser/flow-runner.ts`.

**Implementation:**
- Per run: `solari.launch({ recording: true })` → default context → fresh page.
- Steps: `goto`, `click`, `fill`, `waitForVisible`, `waitForHidden` (all with explicit timeouts); selectors prefer `data-testid`.
- Fault hook: arm configured fault immediately before the configured step.
- Session teardown order (Spec §6): execute → collect in-session evidence → `browser.close()` → `sessions.releaseAndWait(id)` → poll replay (`getReplayUrl` + `downloadReplay`) ≥30s bounded backoff; 404 = PROCESSING → finally `solari.close()`.

**Validation:** flow-runner unit tests with fake Page; real sessions in Phase 11.

**Exit Criteria:** every run owns its session lifecycle; teardown executed on exceptions too.

**Status:** `TODO`

---

## Phase 4 — Fault Injection

**Goal:** exactly three fault classes, each provably activated.

**Files:** `src/faults/http-error.ts`, `src/faults/latency.ts`, `src/faults/offline.ts`.

**Implementation:**
- F1 HTTP 500: `page.route(target, handler)` → `route.fulfill({ status: 500, ... })`; counter records every intercepted request; `faultActivated` requires ≥1 intercepted request, else scenario = `ERROR` (never PASS).
- F2 Latency: `page.route(target)` → deterministic delay (config ms, 8000 for demo) then `route.continue()`; activation recorded with timestamps.
- F3 Offline: `context.setOffline(true)` immediately before the configured critical step; restore after; activation recorded.
- Every fault writes `{ timestamp, type, target, activated }` into `fault-events.json`.

**Validation:** fault model unit tests (activation accounting, ERROR on no activation); real injection proven by network evidence in Phase 11.

**Exit Criteria:** a scenario whose fault never fires cannot produce PASS.

**Status:** `TODO`

---

## Phase 5 — Assertions & Verdict Model

**Goal:** deterministic assertions + strict classification + score.

**Files:** `src/assertions/evaluate.ts`, verdict logic in `src/report/model.ts`.

**Implementation:** assertion types `visible`, `hidden`, `disabled`, `requestCount`, `text`, `baselineSuccess`, each evaluated with explicit timeout → `{ pass, observed, expected, timestamp }`. Classification: `PASS` = fault injected + all assertions pass; `FAIL` = fault injected + ≥1 application assertion failed; `ERROR` = harness/infrastructure/config/selector/fault-activation failure. Infrastructure problems never become application FAIL. Baseline gate: healthy run must PASS or audit = `BLOCKED` (no scoring). Score = `PASS / (PASS + FAIL) × 100`; any required-scenario ERROR → `INCONCLUSIVE`. Frozen demo outcome: 500 FAIL, Latency FAIL, Offline PASS → 33.

**Validation:** unit tests for every classification branch, score formula, baseline blocking, INCONCLUSIVE rule.

**Exit Criteria:** verdicts fully derivable from assertion records; no LLM anywhere in the path.

**Status:** `TODO`

---

## Phase 6 — Evidence Collection

**Goal:** complete, timestamped, redacted evidence bundle per scenario.

**Files:** `src/browser/evidence.ts`, artifact writer in `src/orchestrator.ts`, `src/redact.ts`.

**Implementation:** per scenario persist `scenario-result.json`, `screenshot.png`, `browser-console.log`, `network-events.json` (`timestamp, method, url, status, duration`), `fault-events.json`, `server.log`, `replay-url.txt`, plus raw `replay.ndjson` when `downloadReplay` succeeds. All records carry ISO timestamps; all text passes the redactor before disk.

**Validation:** serialization unit tests incl. redaction; real bundles inspected in Phase 11.

**Exit Criteria:** every scenario dir contains all required artifacts; scrubber verified.

**Status:** `TODO`

---

## Phase 7 — Demo Checkout Application

**Goal:** tiny zero-dependency Node checkout engineered for the frozen demo outcome.

**Files:** `demo/checkout-app/{package.json, server.js, public/index.html}`.

**Implementation:** plain `node:http` server + static page (no build, no deps → fast sandbox install). Flow: Product → Add to Cart → Checkout → Customer Details → Place Order → `POST /api/checkout`. All `data-testid` selectors. Engineered resilience profile (deterministic):
- Healthy: 200 → success text (baseline PASS).
- Under 500: app keeps spinner, no graceful error (assertions fail → FAIL).
- Under latency: button NOT disabled while pending → deterministic second programmatic click produces duplicate request (requestCount > 1 → FAIL).
- Under offline: `fetch` rejects → app shows offline error banner and preserves form state (assertions pass → PASS).
All form data synthetic (`demo@example.com`, `123 Test Street`); no real PII/passwords/card data.

**Validation:** local node run + flow walkthrough; deterministic duplication verified under real browser in Phase 11.

**Exit Criteria:** produces PASS/FAIL/FAIL/PASS pattern for baseline/500/latency/offline under real Solari.

**Status:** `TODO`

---

## Phase 8 — HTML Reliability Report

**Goal:** polished single-file `artifacts/<run-id>/report.html`, screenshot-ready.

**Files:** `src/report/html.ts`.

**Implementation:** self-contained inline CSS, no external assets; header "ChaosLens — See what your users see when your backend fails."; summary (application, flow, baseline, score 33/100 for demo); scenario cards with verdict chip, Observed, Failed assertion, embedded screenshot (base64), replay link, log/network evidence excerpts; explicit visual separation of application FAIL vs infrastructure ERROR.

**Validation:** HTML generation unit tests (verdict rendering, score, escaping); visual inspection of real report in Phase 11.

**Exit Criteria:** report renders standalone in a browser; clearly distinguishes PASS/FAIL/ERROR.

**Status:** `TODO`

---

## Phase 9 — Error Handling / Security / Cleanup

**Goal:** fail loudly, clean always, leak nothing.

**Files:** cross-cutting; `src/redact.ts`, try/finally discipline across orchestrator/sandbox/browser modules.

**Implementation:** typed `ChaosLensError` with stage (`SANDBOX_CREATE`, `APP_START`, `BROWSER_CREATE`, …); no catch-and-ignore, no silent fallback, no demo-only bypass. Redaction: `slr_live_*`, `pt_token=…` (incl. inside preview URLs), `Authorization` headers — applied to console, network events, server logs, report, JSON artifacts. `.env` gitignored; `.env.example` references the key by name only. Browser + sandbox cleanup on all exception paths; no billable resource leak.

**Validation:** redaction unit tests incl. URL-embedded tokens; error-path tests; cleanup-path tests with mocked SDK.

**Exit Criteria:** secret scan over repo + artifacts clean; every resource lifecycle has `finally` cleanup.

**Status:** `TODO`

---

## Phase 10 — Tests

**Goal:** real automated test suite (vitest), Solari boundary mocked.

**Files:** `tests/*.test.ts`.

**Implementation:** coverage of: config validation; fault configuration; assertion evaluation; status classification; scoring (incl. 33 and INCONCLUSIVE); artifact serialization; secret redaction; HTML report generation; error handling; baseline gate. No test deleted to force green.

**Validation:** `npm test` green; `npm run build` green.

**Exit Criteria:** all required Spec §25 software-test areas covered and passing.

**Status:** `TODO`

---

## Phase 11 — Real Solari Acceptance

**Goal:** full acceptance run against real Solari: real sandbox, real demo app, real preview URL, real browser, real 500/latency/offline, real screenshot, real recording, real replay retrieval, real logs, real report.

**Files:** acceptance evidence under `examples/chaoslens/artifacts/acceptance/<run-id>/`.

**Implementation:** run `npm run audit -- --config ./chaoslens.config.example.ts`; verify AC-01..AC-26 against real evidence; record per-item PASS/FAIL/NOT VERIFIED.

**Validation:** evidence bundle inspected item-by-item; replay URL + downloaded replay present; score 33/100 reproduced.

**Exit Criteria:** every acceptance line item PASS with real evidence; cleanup confirmed (browser released, sandbox killed).

**Status:** `TODO` (requires Phase 0 PASS)

---

## Phase 12 — README / Release Evidence

**Goal:** README that explains the product in the first screen + implementation report.

**Files:** `examples/chaoslens/README.md`, `docs/CHAOSLENS_IMPLEMENTATION_REPORT.md`.

**Implementation:** README per Spec §28 (headline, demo screenshot, scenario table, score; Why / How / Why Solari / Architecture / Quickstart / Configuration / Evidence / Demo / Limitations / Methodology; real-Solari evidence statement). Report per master prompt §30 structure with honest statuses.

**Validation:** links/paths checked; secret scan clean.

**Exit Criteria:** `READY_FOR_CODE_REVIEW` or explicit `BLOCKED` with reasons.

**Status:** `TODO`

---

## Phase Status Board

| Phase | Status |
| --- | --- |
| Phase 0 — Smoke Gate | BLOCKED (`SOLARI_API_KEY` missing) |
| Phase 1 — Skeleton & Config | TODO |
| Phase 2 — Sandbox Runtime | TODO |
| Phase 3 — Browser Flow Engine | TODO |
| Phase 4 — Fault Injection | TODO |
| Phase 5 — Assertions & Verdict | TODO |
| Phase 6 — Evidence Collection | TODO |
| Phase 7 — Demo Checkout App | TODO |
| Phase 8 — HTML Report | TODO |
| Phase 9 — Error/Security/Cleanup | TODO |
| Phase 10 — Tests | TODO |
| Phase 11 — Real Solari Acceptance | TODO |
| Phase 12 — README / Report | TODO |
