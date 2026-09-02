import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { redact, redactDeep } from "../redact.js"
import type {
  ConsoleEvent,
  FaultEvent,
  NetworkEvent,
  ScenarioEvidence,
  ScenarioResult,
} from "../types.js"

export interface ScenarioArtifactsInput {
  runDir: string
  scenarioId: string
  result: ScenarioResult
  screenshot: Buffer | null
  consoleEvents: ConsoleEvent[]
  networkEvents: NetworkEvent[]
  faultEvents: FaultEvent[]
  serverLog: string
  replayUrl: string | null
  replayRaw: Uint8Array | null
}

/**
 * Persist the per-scenario evidence bundle (Spec §14). Every text payload
 * passes through the secret redactor before touching disk.
 */
export function writeScenarioEvidence(input: ScenarioArtifactsInput): ScenarioEvidence {
  const dir = path.join(input.runDir, input.scenarioId)
  mkdirSync(dir, { recursive: true })

  const writeText = (name: string, content: string): string => {
    const filePath = path.join(dir, name)
    writeFileSync(filePath, redact(content))
    return filePath
  }
  const writeJson = (name: string, value: unknown): string =>
    writeText(name, `${JSON.stringify(redactDeep(value), null, 2)}\n`)

  const scenarioResultPath = writeJson("scenario-result.json", input.result)
  const consoleLogPath = writeText(
    "browser-console.log",
    input.consoleEvents.map((e) => `${e.timestamp} [${e.type}] ${e.text}`).join("\n") + "\n",
  )
  const networkEventsPath = writeJson("network-events.json", input.networkEvents)
  const faultEventsPath = writeJson("fault-events.json", input.faultEvents)
  const serverLogPath = writeText("server.log", input.serverLog || "(no server output captured)\n")

  let screenshotPath: string | null = null
  if (input.screenshot && input.screenshot.length > 0) {
    screenshotPath = path.join(dir, "screenshot.png")
    writeFileSync(screenshotPath, input.screenshot)
  }

  const replayUrlPath = writeText(
    "replay-url.txt",
    input.replayUrl ? `${redact(input.replayUrl)}\n` : "REPLAY UNAVAILABLE after polling window\n",
  )

  let replayRawPath: string | null = null
  if (input.replayRaw && input.replayRaw.length > 0) {
    replayRawPath = path.join(dir, "replay.ndjson")
    writeFileSync(replayRawPath, input.replayRaw)
  }

  void scenarioResultPath
  return {
    screenshotPath,
    consoleLogPath,
    networkEventsPath,
    faultEventsPath,
    serverLogPath,
    replayUrlPath,
    replayRawPath,
  }
}
