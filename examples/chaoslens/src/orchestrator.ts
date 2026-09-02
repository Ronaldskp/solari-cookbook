import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { SolariClient } from "@solarisdk/sdk"
import { Solari } from "@solarisdk/browser"
import { evaluateAssertions } from "./assertions/evaluate.js"
import { writeScenarioEvidence } from "./browser/evidence.js"
import { runFlow } from "./browser/flow-runner.js"
import { closeSessionAndCollectReplay, openRecordedSession, type RecordedSession, type ReplayOutcome } from "./browser/session.js"
import { requireSolariApiKey } from "./env.js"
import { ChaosLensError, messageOf, stageOf } from "./errors.js"
import * as log from "./log.js"
import { redact, redactDeep } from "./redact.js"
import { generateReport } from "./report/html.js"
import { classifyScenario, computeScore } from "./report/model.js"
import { createAuditSandbox, cloneRepository } from "./sandbox/create.js"
import { SandboxApplication } from "./sandbox/application.js"
import { restoreCleanState, snapshotReadyState, type RestoredState } from "./sandbox/snapshot.js"
import type {
  AuditResult,
  ChaosLensConfig,
  ScenarioConfig,
  ScenarioResult,
} from "./types.js"

const DEFAULT_ASSERTION_TIMEOUT_MS = 10_000

/**
 * Teardown races: destroying the remote VM can surface async control-channel
 * close errors after our own cleanup already finished. Record them (they go
 * into audit-result.json) instead of letting them crash the process.
 */
const teardownEvents: string[] = []
let teardownGuardInstalled = false
function installTeardownGuard(): void {
  if (teardownGuardInstalled) return
  teardownGuardInstalled = true
  process.on("uncaughtException", (error) => {
    teardownEvents.push(redact(String(error?.stack ?? error)))
    console.error(redact(`[teardown race] uncaught: ${String(error)}`))
  })
  process.on("unhandledRejection", (reason) => {
    teardownEvents.push(redact(String(reason)))
    console.error(redact(`[teardown race] unhandled rejection: ${String(reason)}`))
  })
}

export interface AuditOptions {
  config: ChaosLensConfig
  outputRoot: string
}

interface ScenarioRunOutcome {
  result: ScenarioResult
  replayMissing: boolean
}

async function runScenario(
  solari: Solari,
  app: SandboxApplication,
  config: ChaosLensConfig,
  scenario: ScenarioConfig,
  runDir: string,
  runId: string,
): Promise<ScenarioRunOutcome> {
  const startTime = new Date().toISOString()
  const isBaseline = scenario.fault === null
  let infrastructureError: string | null = null
  let session: RecordedSession | undefined
  let flowRun: Awaited<ReturnType<typeof runFlow>> | undefined
  let screenshot: Buffer | null = null
  let assertionResults: ScenarioResult["assertions"] = []
  let evaluationError: string | null = null
  let replay: ReplayOutcome | undefined

  try {
    session = await openRecordedSession(solari)
    try {
      flowRun = await runFlow(session.page, session.context, app.previewUrl, config.flow, scenario.fault)
      screenshot = await session.page.screenshot().catch(() => null)
      const evaluation = await evaluateAssertions(scenario.assertions, {
        page: session.page,
        flowCompleted: flowRun.completed,
        networkEvents: flowRun.networkEvents,
        defaultTimeoutMs: config.flow.timeoutMs ?? DEFAULT_ASSERTION_TIMEOUT_MS,
      })
      assertionResults = evaluation.results
      evaluationError = evaluation.evaluationError
    } finally {
      if (flowRun?.fault) {
        await flowRun.fault.disarm().catch(() => {})
      }
      replay = await closeSessionAndCollectReplay(solari, session)
    }
  } catch (error) {
    const stage = stageOf(error)
    infrastructureError = `${stage ?? "BROWSER_FLOW"}: ${messageOf(error)}`
    if (session && !replay) {
      replay = await closeSessionAndCollectReplay(solari, session).catch(() => undefined)
    }
  }

  const faultActivated = flowRun?.fault?.activated() ?? false
  const flowFailedBeforeFault =
    !isBaseline && scenario.fault !== null && (flowRun?.failedStepIndex !== null && flowRun?.fault === null)

  const classification = classifyScenario({
    isBaseline,
    fault: scenario.fault,
    faultActivated,
    flowCompleted: flowRun?.completed ?? false,
    flowFailedBeforeFault,
    infrastructureError,
    evaluationError,
    assertionResults,
  })

  const faultEvents = flowRun?.fault?.events ?? []
  const replayUrl = replay?.replayUrl ?? null
  const replayRaw = replay?.replayRaw ?? null

  const result: ScenarioResult = {
    runId,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    startTime,
    endTime: new Date().toISOString(),
    faultType: scenario.fault?.type ?? null,
    faultTarget: scenario.fault?.target ?? null,
    faultActivated,
    assertions: assertionResults,
    status: classification.status,
    failureReasons: classification.failureReasons,
    evidence: {
      screenshotPath: null,
      consoleLogPath: null,
      networkEventsPath: null,
      faultEventsPath: null,
      serverLogPath: null,
      replayUrlPath: null,
      replayRawPath: null,
    },
    replayUrl,
  }

  result.evidence = writeScenarioEvidence({
    runDir,
    scenarioId: scenario.id,
    result,
    screenshot,
    consoleEvents: flowRun?.consoleEvents ?? [],
    networkEvents: flowRun?.networkEvents ?? [],
    faultEvents,
    serverLog: app.serverLog(),
    replayUrl,
    replayRaw,
  })

  return { result, replayMissing: replayUrl === null && replayRaw === null }
}

/** Execute a full ChaosLens audit against real Solari (Spec §6). */
export async function runAudit(options: AuditOptions): Promise<{ result: AuditResult; runDir: string }> {
  installTeardownGuard()
  const { config } = options
  const runId = new Date().toISOString().replace(/[:.]/g, "-")
  const runDir = path.join(options.outputRoot, runId)
  mkdirSync(runDir, { recursive: true })

  const apiKey = requireSolariApiKey()
  const client = new SolariClient({ apiKey })
  const solari = new Solari({ apiKey })

  const startedAt = new Date().toISOString()
  const scenarioResults: ScenarioResult[] = []
  let baselineStatus: AuditResult["baseline"] = "BLOCKED"
  let baselineReason: string | null = null
  let replayMissingForValidScenario = false
  let auditError: string | null = null
  let state: RestoredState | undefined

  try {
    const sandbox = await createAuditSandbox(client, config)
    const appDir = await cloneRepository(sandbox, config)
    const app = new SandboxApplication(sandbox, config, appDir)
    state = { sandbox, app }

    const installLog = await app.install()
    writeFileSync(path.join(runDir, "install.log"), redact(installLog))

    await app.start()
    await app.refreshPreviewUrl()
    await app.waitForHealthy()
    log.ok("Application ready")

    const snapshotId = await snapshotReadyState(sandbox, "chaoslens-ready")

    // ── Baseline gate ──────────────────────────────────────────────────
    const baselineScenario = config.scenarios.find((s) => s.fault === null)
    if (!baselineScenario) {
      throw new ChaosLensError("CONFIG", "no baseline scenario (fault: null) configured")
    }
    log.heading("Baseline")
    const baselineOutcome = await runScenario(solari, app, config, baselineScenario, runDir, runId)
    scenarioResults.push(baselineOutcome.result)
    if (baselineOutcome.result.status === "PASS") {
      baselineStatus = "PASS"
      log.ok("Baseline passed")
    } else {
      baselineStatus = baselineOutcome.result.status === "ERROR" ? "ERROR" : "BLOCKED"
      baselineReason = baselineOutcome.result.failureReasons.join("; ") || "baseline did not pass"
      log.fail(`Baseline ${baselineStatus.toLowerCase()}: ${baselineReason}`)
    }
    if (baselineOutcome.replayMissing && baselineOutcome.result.status !== "ERROR") {
      replayMissingForValidScenario = true
    }

    // ── Chaos scenarios ────────────────────────────────────────────────
    if (baselineStatus === "PASS") {
      log.heading("Reliability scenarios")
      for (const scenario of config.scenarios.filter((s) => s.fault !== null)) {
        state = await restoreCleanState(client, config, state, snapshotId)
        const outcome = await runScenario(solari, state.app, config, scenario, runDir, runId)
        scenarioResults.push(outcome.result)
        if (outcome.replayMissing && outcome.result.status !== "ERROR") {
          replayMissingForValidScenario = true
        }
        const line = `${scenario.name}`
        if (outcome.result.status === "PASS") log.ok(line)
        else if (outcome.result.status === "FAIL") {
          log.fail(line)
          for (const reason of outcome.result.failureReasons) log.info(`  ${reason}`)
        } else {
          log.fail(`${line} (ERROR — infrastructure, not application)`)
          for (const reason of outcome.result.failureReasons) log.info(`  ${reason}`)
        }
      }
    }
  } catch (error) {
    // Infrastructure failure before/during the audit. Never rethrow without
    // producing the ERROR report and evidence; never score a broken audit.
    const stage = stageOf(error) ?? "SANDBOX_CREATE"
    auditError = `${stage}: ${messageOf(error)}`
    baselineReason = baselineReason ?? auditError
    if (baselineStatus === "PASS") baselineStatus = "ERROR"
    log.error(`audit aborted at ${stage}: ${messageOf(error)}`)
  } finally {
    // Stop the streamed application process FIRST so its command handle does
    // not fault when the sandbox control channel closes.
    if (state) {
      await state.app.stop().catch(() => {})
      try {
        await state.sandbox.kill()
        log.verbose("sandbox killed")
      } catch (error) {
        log.verbose(`sandbox kill failed: ${messageOf(error)}`)
      }
    }
    await solari.close().catch(() => {})
  }

  const { score, scoreState } = computeScore(
    baselineStatus === "PASS",
    scenarioResults,
    replayMissingForValidScenario,
  )

  const result: AuditResult = {
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    applicationName: config.application.name,
    flowName: config.flow.name,
    baseline: baselineStatus,
    baselineReason,
    scenarios: scenarioResults,
    score,
    scoreState,
  }

  const resultJson: Record<string, unknown> = { ...(redactDeep(result) as unknown as Record<string, unknown>) }
  if (teardownEvents.length > 0) resultJson["teardownEvents"] = teardownEvents
  writeFileSync(path.join(runDir, "audit-result.json"), JSON.stringify(resultJson, null, 2))
  const reportPath = path.join(runDir, "report.html")
  writeFileSync(reportPath, generateReport(result, runDir))

  if (scoreState === "SCORED") {
    log.heading(`Reliability Score: ${score} / 100`)
  } else if (scoreState === "BLOCKED") {
    log.heading("Baseline workflow failed. Reliability scenarios were not evaluated.")
  } else {
    log.heading("Audit INCONCLUSIVE — infrastructure instability or missing replay evidence.")
  }
  log.info(`\nReport:\n${reportPath}`)

  return { result, runDir }
}
