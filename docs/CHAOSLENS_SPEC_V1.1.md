# ChaosLens — Browser Reliability Auditor
## Product & Engineering Specification

**Version:** 1.1  
**Status:** FROZEN — Ready for Implementation  
**Target:** Pinetree Research / Solari SWE Intern Challenge  
**Primary implementation:** TypeScript / Node.js  
**Development model:** Spec-driven, AI-assisted implementation, independent review, real-environment validation

---

# 1. Executive Summary

ChaosLens is a small developer tool for testing how a real web application behaves when backend and network failures occur.

Instead of testing only the successful path, ChaosLens deliberately injects controlled failures such as:

- HTTP 500
- network latency / timeout
- offline connectivity

It then executes a real critical user flow in a Solari cloud browser and records what the user actually experiences.

For every failure scenario ChaosLens produces:

- deterministic PASS / FAIL result;
- screenshot evidence;
- Solari browser replay;
- browser console logs;
- network / request evidence;
- server logs;
- a final HTML reliability report.

Core positioning:

> **See what your users see when your backend fails.**

ChaosLens is not an autonomous code repair agent.

ChaosLens is a deterministic reliability auditing tool.

Its purpose is to answer:

> When the system underneath the UI fails, does the application fail gracefully for the human using it?

---

# 2. Problem

Modern web applications are normally tested heavily on their happy paths.

Typical automated tests verify:

- page loads;
- buttons work;
- forms submit;
- APIs return expected responses;
- successful workflows complete.

But production users frequently encounter failure conditions:

- API returns 500;
- API responds slowly;
- network disappears;
- request never finishes;
- backend is temporarily unavailable.

These states often receive substantially less testing.

The result can be technically functional software that presents poor failure behavior to the user:

- infinite loading spinner;
- duplicate submission;
- button remains clickable during a pending operation;
- blank page;
- no error feedback;
- silently lost action;
- unrecoverable workflow.

Traditional infrastructure chaos testing generally focuses on service reliability.

ChaosLens focuses on:

> **user-visible reliability.**

---

# 3. Product Goal

V1 must demonstrate one complete and trustworthy workflow:

```text
Repository
   ↓
Solari Sandbox
   ↓
Install + Run Application
   ↓
Create Clean Baseline
   ↓
Solari Browser
   ↓
Execute Healthy Flow
   ↓
Inject Controlled Failure
   ↓
Execute Same Flow
   ↓
Collect Real Evidence
   ↓
Evaluate Assertions
   ↓
Generate Reliability Report
```

The project should feel like a small but legitimate developer tool rather than an SDK demonstration.

---

# 4. Success Criteria

ChaosLens V1 is successful if a user can run one command against a supported web application configuration and obtain a reproducible reliability report showing how the application behaves under controlled failures.

The final challenge demonstration must use:

- a real Solari Sandbox;
- a real Solari Browser;
- real browser actions;
- real fault injection;
- real screenshots;
- real browser recordings;
- real logs;
- real PASS / FAIL decisions.

No production/demo result may be fabricated.

Mocks are allowed only in automated unit tests.

There must be no silent fallback from Solari execution to simulated execution.

---

# 5. Primary User

Primary user:

**Frontend / full-stack engineer maintaining a web application.**

Typical scenario:

> “Our checkout works when everything is healthy. I want to know what a user experiences when the checkout API returns 500, takes eight seconds to respond, or disappears completely.”

Secondary users:

- QA engineers;
- reliability engineers;
- startup engineering teams;
- maintainers of user-critical SaaS workflows.

---

# 6. Core User Story

Given:

- a Git repository;
- commands required to install and start the application;
- an application port;
- a critical browser flow;
- a set of resilience assertions;

the user runs:

```bash
npm run audit -- --config ./chaoslens.config.ts
```

ChaosLens:

1. creates a Solari Sandbox;
2. clones the repository;
3. installs dependencies;
4. starts the application;
5. obtains the public Sandbox preview URL;
6. validates that the application is healthy;
7. creates a clean application checkpoint;
8. launches a recording-enabled Solari Browser;
9. executes the healthy baseline;
10. verifies that the normal workflow passes;
11. restores clean application state and re-verifies application health;
12. executes the configured HTTP 500 scenario and persists its evidence;
13. restores clean application state and re-verifies application health;
14. executes the configured latency scenario and persists its evidence;
15. restores clean application state and re-verifies application health;
16. executes the configured offline scenario and persists its evidence;
17. evaluates deterministic assertions and generates machine-readable results;
18. generates a polished HTML report;
19. closes/releases all remaining Browser resources;
20. destroys the Sandbox.

Each baseline or chaos run owns its Browser session lifecycle. For each run, the required ordering is:

```text
create Browser session
→ execute flow
→ collect in-session evidence
→ close/release session
→ wait for replay processing
→ retrieve replay evidence
→ only then restore/revert Sandbox state for the next run
```

The Sandbox must not be destroyed before required replay evidence has been retrieved or declared unavailable according to Section 24.

---

# 7. Solari Responsibilities

## 7.1 Solari Sandbox

The Sandbox is responsible for the application execution environment.

It must provide:

- isolated Linux environment;
- Git clone;
- dependency installation;
- build/start commands;
- application process execution;
- application stdout/stderr;
- preview URL;
- snapshot;
- revert to clean state;
- final cleanup.

The target web application must execute inside Solari rather than on the developer's local machine.

Sandbox snapshots are used to give each failure scenario a reproducible starting state.

After the application is installed, started and verified healthy:

```text
READY STATE
    ↓
SNAPSHOT
    ↓
Scenario A
    ↓
REVERT
    ↓
Scenario B
    ↓
REVERT
    ↓
Scenario C
```

After every `REVERT`, ChaosLens must re-fetch the preview URL and re-run the application health check before the next Browser session starts.

If the restored application is not healthy, the next chaos scenario must not run. The condition is classified as an infrastructure `ERROR`, not an application `FAIL`.

---

## 7.2 Solari Browser

The Browser is responsible for the human-visible execution path.

It must provide:

- real Chrome browser;
- Playwright-compatible interaction;
- navigation;
- click/fill actions;
- browser event observation;
- request/response observation;
- console capture;
- screenshots;
- session recording;
- replay URL.

Fault injection is implemented through supported Playwright browser capabilities.

No custom mitmproxy architecture is required in V1.

Browser sessions used for evidence runs must enable:

```text
recording = true
```

The replay URL must be collected after the session has been correctly closed/released.

Replay processing is asynchronous. ChaosLens must use the SDK's release/wait lifecycle where available, then poll replay retrieval for at least 30 seconds with bounded backoff before declaring replay evidence unavailable. An HTTP 404 during this polling window means "not uploaded yet" and must not be treated as an immediate infrastructure failure.

---

# 8. V1 Supported Faults

Exactly three fault classes are required.

## F1 — HTTP Server Error

Intercept a configured request pattern and return a controlled HTTP error.

Reference scenario:

```text
POST /api/checkout
        ↓
HTTP 500
```

Expected questions:

- Does loading terminate?
- Does the user see an error?
- Can the user recover?
- Is the UI left in an invalid state?

---

## F2 — Artificial Network Latency

Intercept a configured request and deliberately delay it.

Reference scenario:

```text
POST /api/checkout
        ↓
8 second delay
```

Expected questions:

- Is the submit button disabled?
- Can repeated clicking create duplicate requests?
- Is pending state visible?
- Does the application recover after completion?

---

## F3 — Offline

Switch the BrowserContext into an offline state immediately before the configured critical network action.

Expected questions:

- Does the user see meaningful feedback?
- Does the loading state terminate?
- Is user-entered state preserved?
- Can the flow be retried?

No additional fault types are required for V1.

---

# 9. Critical Flow Definition

V1 does not use an autonomous LLM browser agent.

Browser execution must be deterministic.

A configuration file defines the user flow.

Minimum supported step types:

```text
goto
click
fill
waitForVisible
waitForHidden
```

A flow must also support fault activation immediately before a specified step.

Example conceptual configuration:

```text
Flow: Checkout

1. goto /
2. click Add to Cart
3. click Checkout
4. fill Email
5. fill Address
6. [FAULT ARMED]
7. click Place Order
8. evaluate resilience assertions
```

Selectors for the controlled demo application should prefer:

```text
data-testid
```

over fragile CSS structure selectors.

---

# 10. Assertions

ChaosLens does not allow an LLM to decide PASS or FAIL in V1.

Verdicts must come from explicit, machine-verifiable assertions.

Minimum assertion types:

### Visible

A configured UI element must become visible before timeout.

Example:

```text
error message visible within 3000 ms
```

### Hidden

An element must disappear before timeout.

Example:

```text
loading spinner hidden within 3000 ms
```

### Disabled

A configured interaction element must be disabled during an operation.

Example:

```text
Place Order button disabled while request pending
```

### Request Count

Number of requests matching a route must remain within a configured limit.

Example:

```text
POST /api/checkout <= 1
```

### Text

Expected user-facing text is displayed.

### Baseline Success

The healthy version of the critical flow must complete successfully.

If the baseline does not pass, ChaosLens must not claim anything about resilience.

---

# 11. Result Classification

Every scenario has exactly one execution state:

```text
PASS
FAIL
ERROR
```

### PASS

The injected failure occurred and all configured resilience assertions passed.

### FAIL

The injected failure occurred successfully, but one or more application-level assertions failed.

### ERROR

ChaosLens could not produce a valid test because of infrastructure or harness failure.

Examples:

- Sandbox unavailable;
- application failed to start;
- Solari Browser unavailable;
- recording failed;
- snapshot/revert failed;
- configured selector invalid;
- application preview inaccessible.

Infrastructure failures must never be reported as application FAIL results.

---

# 12. Baseline Gate

Before chaos scenarios run, ChaosLens must execute the same critical flow without fault injection.

Possible baseline result:

```text
BASELINE_PASS
BASELINE_BLOCKED
```

If baseline does not pass:

```text
Audit Status = BLOCKED
```

Failure scenarios must not be scored.

The report should explicitly state:

> Baseline workflow failed. Reliability scenarios were not evaluated.

This prevents ChaosLens from confusing an already-broken application with failure-handling problems.

---

# 13. Reliability Score

Only a complete valid audit receives a numeric score.

Formula:

```text
Reliability Score =
PASS scenarios
─────────────── × 100
PASS + FAIL
```

For the V1 demo:

```text
3 scenarios

1 PASS   (Offline)
2 FAIL   (HTTP 500, Slow response)

Reliability Score = 33
```

If any required scenario ends in infrastructure `ERROR`, overall status becomes:

```text
INCONCLUSIVE
```

No final numeric score should be presented as authoritative.

This prevents infrastructure instability from contaminating the product verdict.

---

# 14. Evidence Model

Every scenario must persist an evidence bundle.

Required artifacts:

```text
scenario-result.json
screenshot.png
browser-console.log
network-events.json
fault-events.json
server.log
replay-url.txt
```

`replay-url.txt` is the required replay reference. Because replay URLs may expire, ChaosLens should also download and persist the raw replay artifact when the current SDK exposes a supported download path. Embedding an rrweb player inside the HTML report is optional stretch work and is not a V1 acceptance requirement.

A Solari browser replay is session replay data, not an MP4 video. Public README/demo media must therefore not depend on a replay URL remaining valid indefinitely.

Each evidence record must contain timestamps.

The scenario JSON must include:

```text
runId
scenarioId
scenarioName
startTime
endTime
faultType
faultTarget
faultActivated
assertions[]
status
failureReasons[]
screenshotPath
replayUrl
```

Network evidence should include at minimum:

```text
timestamp
method
url
status
duration
```

Fault evidence must explicitly record when ChaosLens injected the failure.

This ensures the report can prove:

> the fault actually happened.

---

# 15. Final HTML Report

ChaosLens must generate:

```text
artifacts/<run-id>/report.html
```

The report is the main visual product surface.

A separate dashboard application is NOT required for V1.

The HTML report should contain:

## Header

```text
ChaosLens

Browser Reliability Audit
```

## Summary

```text
Application: Demo Checkout
Critical Flow: Checkout
Baseline: PASS

Reliability Score
33 / 100
```

## Scenario Cards

Example:

```text
HTTP 500
FAIL

Observed:
Checkout remains in loading state.

Failed assertion:
spinner hidden within 3s

Evidence:
Screenshot
Replay
Network
Logs
```

```text
Slow Network
FAIL

Observed:
Two checkout requests were sent.

Failed assertion:
request count <= 1

Evidence:
Screenshot
Replay
Network
Logs
```

```text
Offline
PASS

Observed:
Offline message displayed and form state preserved.

Evidence:
Screenshot
Replay
Network
Logs
```

The report must clearly distinguish:

```text
application failure
```

from:

```text
ChaosLens / infrastructure error
```

---

# 16. Demo Application

The repository must include or reference one deterministic demonstration application.

V1 demo application:

## Demo Checkout

Minimal SaaS-style checkout flow:

```text
Product
↓
Add to Cart
↓
Checkout
↓
Customer Details
↓
Place Order
↓
POST /api/checkout
```

The application should deliberately contain realistic resilience behavior suitable for demonstrating ChaosLens.

Desired final audit outcome:

```text
Healthy baseline
PASS

HTTP 500
FAIL

Slow response
FAIL

Offline
PASS
```

The exact vulnerabilities can be engineered intentionally, but ChaosLens must not fabricate their results.

The application must actually execute inside the real Solari Sandbox and all Browser evidence must come from real Solari sessions.

---

# 17. Supported Target Contract

ChaosLens V1 is not required to automatically support arbitrary repositories.

A supported target must provide explicit configuration:

```text
repository URL
git ref
install command
start command
port
health path
critical flow
fault configuration
assertions
```

Initial support target:

```text
Node.js / TypeScript web applications
```

The system must not attempt framework auto-detection in V1.

Explicit configuration is preferred over unreliable “AI magic”.

---

# 18. Execution Interface

Primary interface:

```bash
npm run audit -- --config <path>
```

Optional useful flags:

```text
--output <directory>
--verbose
```

No interactive dashboard is required.

No cloud SaaS deployment is required.

No account system is required.

No database is required.

The command should print useful high-level progress:

```text
ChaosLens

✓ Solari Sandbox created
✓ Repository cloned
✓ Dependencies installed
✓ Application ready
✓ Baseline passed

Running reliability scenarios...

✗ HTTP 500
  Infinite loading state detected

✗ Slow Network
  Duplicate checkout request detected

✓ Offline
  Graceful error state detected

Reliability Score: 33 / 100

Report:
artifacts/<run-id>/report.html
```

The terminal output must remain concise.

Full evidence belongs in artifacts.

---

# 19. Repository Layout

Preferred implementation structure:

```text
examples/
└── chaoslens/
    ├── README.md
    ├── package.json
    ├── tsconfig.json
    ├── chaoslens.config.example.ts
    │
    ├── src/
    │   ├── cli.ts
    │   ├── config.ts
    │   │
    │   ├── sandbox/
    │   │   ├── create.ts
    │   │   ├── application.ts
    │   │   └── snapshot.ts
    │   │
    │   ├── browser/
    │   │   ├── session.ts
    │   │   ├── flow-runner.ts
    │   │   └── evidence.ts
    │   │
    │   ├── faults/
    │   │   ├── http-error.ts
    │   │   ├── latency.ts
    │   │   └── offline.ts
    │   │
    │   ├── assertions/
    │   │   └── evaluate.ts
    │   │
    │   ├── report/
    │   │   ├── model.ts
    │   │   └── html.ts
    │   │
    │   └── orchestrator.ts
    │
    ├── demo/
    │   └── checkout-app/
    │
    ├── tests/
    │
    ├── docs/
    │   └── SPEC.md
    │
    └── artifacts/
        └── .gitkeep
```

Implementation may make minor naming changes but must preserve architectural responsibilities.

---

# 20. Runtime AI Decision

ChaosLens V1 intentionally does **not** require an LLM at runtime.

This is a deliberate product decision.

The Challenge explicitly encourages AI-assisted development, but deterministic reliability evaluation is better served by explicit fault injection and assertions.

The engineering workflow will document:

```text
Specification
↓
AI-assisted implementation
↓
Independent AI review
↓
Human validation
↓
Real Solari evidence
```

Runtime AI may be considered later for:

- explaining failures;
- suggesting assertions;
- generating configurations;
- summarizing evidence.

It must not be added to V1 solely to make the project look more “AI”.

---

# 21. Security Requirements

`SOLARI_API_KEY` must only come from environment variables.

It must never appear in:

- source code;
- committed configuration;
- screenshots;
- generated HTML;
- logs;
- artifacts.

Required:

```text
.env
```

must be gitignored.

Example configuration must use:

```text
SOLARI_API_KEY
```

only by reference.

V1 only needs to support public Git repositories.

Private GitHub credential management is out of scope.

Logs and generated evidence must perform basic secret/token redaction before being persisted.

Redaction must cover at least:

- `slr_live_...` Solari API keys;
- `pt_token=...` Sandbox preview tokens, including preview URLs captured in network evidence.

The bundled demo application must use synthetic-only form data. Browser session replays may capture form input values, so no real personal, credential, payment, or other sensitive data may be entered during public challenge evidence runs.

The local CLI must never silently upload collected evidence to another service.

---

# 22. Resource Lifecycle

Every resource must have explicit lifecycle ownership.

Browser sessions:

```text
create
→ execute
→ collect evidence
→ close
→ retrieve replay
```

Sandbox:

```text
create
→ connect
→ prepare
→ execute scenarios
→ kill
```

All resources must be cleaned in `finally`-style failure paths where practical.

An application or scenario exception must not intentionally leave billable Solari resources running.

---

# 23. Free-Tier Constraint

V1 architecture must work without requiring:

- stealth mode;
- residential proxies;
- CAPTCHA solving;
- Desktop VM;
- parallel Sandboxes.

Those features are deliberately excluded.

Therefore V1 uses:

```text
1 Sandbox
+
sequential scenarios
+
fresh Browser session per scenario
```

This is an intentional architecture decision.

Parallel execution is not required.

---

# 24. Failure Handling

ChaosLens must fail loudly rather than silently degrade.

Examples:

### Missing API key

```text
ERROR:
SOLARI_API_KEY is not configured.
```

No mock fallback.

### Sandbox creation failure

```text
Audit Status: ERROR
Stage: SANDBOX_CREATE
```

### Application start failure

Persist relevant stdout/stderr.

Do not launch Browser scenarios.

### Preview health check failure

Mark audit blocked/error and clean resources.

### Browser creation failure

Mark infrastructure ERROR.

### Fault was not activated

Scenario result:

```text
ERROR
```

not PASS.

A test cannot evaluate resilience unless ChaosLens can prove the configured fault occurred.

### Replay unavailable

Replay unavailability must only be declared after the Browser session has been correctly closed/released and ChaosLens has polled replay retrieval for at least 30 seconds with bounded backoff.

A 404 during the polling window is treated as replay processing still in progress.

If browser execution itself succeeded but required recording evidence remains unavailable after the polling window, the V1 challenge run must be considered incomplete.

---

# 25. Testing Strategy

Before implementing the ChaosLens orchestrator, implementation must complete a one-time real-Solari capability smoke gate.

## Implementation Task 0 — Solari Capability Smoke Gate

The smoke gate must verify against the actual challenge account and current SDK:

```text
[ ] create a real Solari Sandbox
[ ] run `node --version` inside the intended Sandbox template
[ ] start a minimal HTTP server inside the Sandbox
[ ] obtain a preview URL and pass a health check
[ ] create a real Solari Browser session
[ ] open the Sandbox preview URL from that Browser
[ ] capture a screenshot
[ ] enable session recording
[ ] close/release the Browser correctly
[ ] retrieve replay evidence using the required wait/poll lifecycle
[ ] clean up Browser and Sandbox resources
```

If Node.js is unavailable in the intended Sandbox template, recording is unavailable on the active plan, or Browser-to-preview connectivity fails, implementation must stop the affected feature and propose the smallest Spec amendment. It must not silently introduce a different runtime, mock path, or fallback implementation.

Automated tests are divided into two categories.

## Software Tests

May mock Solari SDK boundaries.

Required areas:

- config validation;
- fault configuration;
- assertion evaluation;
- status classification;
- scoring;
- artifact serialization;
- secret redaction;
- HTML generation;
- error handling.

## Integration / Acceptance Tests

Must use real Solari.

At least one full acceptance run must demonstrate:

```text
real Sandbox
real preview URL
real Browser
real fault
real screenshot
real recording
real replay URL
real report
```

A mocked integration test cannot substitute for this acceptance run.

---

# 26. Mandatory Acceptance Criteria

The implementation is considered V1 complete only when all following conditions pass:

### AC-01
A new user can install the ChaosLens example following README instructions.

### AC-02
Missing `SOLARI_API_KEY` causes an explicit startup failure.

### AC-03
ChaosLens creates a real Solari Sandbox.

### AC-04
The demo application is executed inside that Sandbox.

### AC-05
The healthy baseline successfully opens the Sandbox preview URL and completes the checkout flow.

### AC-06
ChaosLens restores a clean application state between scenarios and re-verifies application health after every restore.

### AC-07
A real Solari Browser executes every baseline/chaos run.

### AC-08
HTTP 500 injection is proven in evidence.

### AC-09
Latency injection is proven in evidence.

### AC-10
Offline injection is proven in evidence.

### AC-11
All application verdicts are generated from deterministic assertions.

### AC-12
The demo produces at least one application `FAIL` and at least one application `PASS`.

### AC-13
Every scenario produces a screenshot.

### AC-14
Every valid scenario produces Solari browser replay evidence after the required release/wait/poll lifecycle.

### AC-15
Browser console, network/fault, and Sandbox server logs are persisted for every scenario.

### AC-16
A complete HTML report is generated.

### AC-17
The HTML report differentiates PASS / FAIL / ERROR.

### AC-18
The reliability score follows the specified formula.

### AC-19
Baseline failure blocks reliability scoring.

### AC-20
Infrastructure errors never become application FAIL verdicts.

### AC-21
Solari API keys and Sandbox preview tokens do not appear in committed or generated artifacts.

### AC-22
All created Browser sessions are released.

### AC-23
The Sandbox is destroyed after normal completion.

### AC-24
The Sandbox is also cleaned after execution failure where API availability allows cleanup.

### AC-25
Final demonstration evidence is generated from real Solari execution.

### AC-26
There is no simulated/demo fallback path used by the public Challenge demo.

---

# 27. Non-Goals — FROZEN

The following are explicitly outside V1:

- automatic code repair;
- automatic Pull Requests;
- automatic commits;
- autonomous SWE agent;
- autonomous browser exploration;
- LLM-generated PASS/FAIL decisions;
- LLM root-cause diagnosis;
- multi-agent architecture;
- arbitrary framework detection;
- universal GitHub repository support;
- Cypress;
- Selenium;
- mobile browsers;
- cross-browser matrix;
- geographical proxy testing;
- stealth mode;
- CAPTCHA handling;
- OAuth monitoring;
- production monitoring;
- scheduled recurring audits;
- multi-user SaaS;
- authentication system;
- billing system;
- database;
- Desktop VM;
- custom mitmproxy infrastructure;
- parallel Sandbox execution;
- automatic application fixes.

These may not be added during implementation unless the frozen Spec is explicitly revised.

---

# 28. README Requirements

README must make the product understandable within the first screen.

Required opening structure:

```text
ChaosLens

See what your users see when your backend fails.

[demo gif / screenshot]

HTTP 500     FAIL
Slow API     FAIL
Offline      PASS

Reliability Score: 33/100
```

README must then explain:

- the problem;
- why ChaosLens exists;
- why Solari is used;
- architecture;
- quickstart;
- configuration;
- evidence model;
- demo;
- limitations;
- development methodology.

It should explicitly state:

> Core demonstration results come from real Solari sessions. No mocked Solari execution is used for published evidence.

---

# 29. Architecture Story for Public Presentation

Public architecture should remain simple:

```text
              ChaosLens
                  │
                  ▼
          ┌──────────────┐
          │Solari Sandbox│
          │              │
          │ clone        │
          │ install      │
          │ run app      │
          │ snapshot     │
          └──────┬───────┘
                 │
            Preview URL
                 │
                 ▼
          ┌──────────────┐
          │Solari Browser│
          │              │
          │ execute flow │
          │ inject fault │
          │ record       │
          └──────┬───────┘
                 │
                 ▼
        ┌─────────────────┐
        │Evidence & Verdict│
        │                  │
        │ screenshots      │
        │ replay           │
        │ network          │
        │ console          │
        │ server logs      │
        └────────┬────────┘
                 │
                 ▼
        Reliability Report
```

The architecture should communicate:

> Sandbox creates the controlled system environment.

> Browser creates the controlled human experience.

> ChaosLens connects the two and turns failure behavior into evidence.

---

# 30. Demo Requirements

Final public demo should be approximately 30–60 seconds.

Recommended sequence:

```text
0–5s
Show ChaosLens headline.

5–10s
Start audit.

10–18s
Sandbox/application ready.
Baseline PASS.

18–28s
HTTP 500 scenario → FAIL.
Show infinite spinner/error evidence.

28–38s
Slow network scenario → FAIL.
Show duplicate request evidence.

38–45s
Offline scenario → PASS.

45–55s
Open HTML report.

55–60s
Show Solari session replay evidence.
```

The demo should focus on the visible product result rather than terminal setup details.

---

# 31. Engineering Quality Gate

Before public release:

```text
SPEC
PASS

Implementation
PASS

Software Tests
PASS

Independent Code Review
PASS

Review Fixes
PASS

Real Solari Acceptance
PASS

Secret Scan
PASS

README Review
PASS

Demo Evidence
PASS
```

Only after all gates pass should the repository be published/tagged as the Challenge submission.

---

# 32. Definition of Done

ChaosLens V1 is DONE when a reviewer can:

1. understand the problem from the README;
2. see why Solari Sandbox and Browser are used;
3. run the documented setup;
4. execute the bundled reliability audit;
5. observe real injected failures;
6. inspect deterministic verdicts;
7. inspect screenshots and logs;
8. open Solari browser replay evidence;
9. read a polished HTML report;
10. understand the engineering decisions without reading the entire source tree.

The desired reaction is:

> “This is small, but it solves a real reliability problem, uses Solari naturally, produces trustworthy evidence, and is actually finished.”

---

# 33. Frozen Product Boundary

The implementation AI is authorized to:

- choose reasonable internal abstractions;
- choose testing libraries;
- improve types;
- improve error handling;
- improve report styling;
- refactor internal structure;
- add tests required to satisfy acceptance criteria.

The implementation AI is NOT authorized to:

- change the core product;
- add autonomous repair;
- add runtime LLM dependency;
- add unrelated Solari features;
- replace real Solari execution with simulation;
- weaken evidence requirements;
- weaken acceptance criteria;
- enlarge V1 scope.

If a Solari SDK limitation makes one frozen requirement technically impossible, implementation must stop that feature, document the exact blocker and propose the smallest Spec amendment rather than silently implementing a substitute.

---

# 34. V1.1 Implementation-Readiness Decisions

V1.1 incorporates the final implementation-readiness review while preserving the frozen product boundary.

Applied decisions:

- corrected the frozen demo score to `33 / 100`;
- made replay release/wait/poll behavior explicit;
- added post-revert preview/health re-verification;
- added a real-Solari capability smoke gate before orchestrator implementation;
- expanded secret redaction to include Sandbox preview tokens;
- required synthetic-only demo form data;
- consolidated redundant acceptance criteria from 30 to 26;
- clarified that embedded replay playback is optional stretch work.

Explicitly not added:

- local-directory/tarball source delivery;
- automatic Python runtime fallback;
- any new product feature or runtime AI behavior.

The final Challenge evidence path remains a public Git repository cloned and executed inside a real Solari Sandbox.

---

# 35. Final Product Statement

**ChaosLens is a Solari-powered browser reliability auditor that deliberately breaks backend and network conditions, observes the resulting real user experience, and turns that behavior into reproducible evidence.**

V1 optimizes for:

**determinism over autonomy;**

**evidence over AI speculation;**

**reliability over feature count;**

**shipping over scope.**
