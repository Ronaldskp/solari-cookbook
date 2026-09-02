import path from "node:path"
import { pathToFileURL } from "node:url"
import { ChaosLensError } from "./errors.js"
import type {
  AssertionConfig,
  AssertionType,
  ChaosLensConfig,
  FaultConfig,
  FaultType,
  FlowConfig,
  FlowStep,
  ScenarioConfig,
  StepAction,
} from "./types.js"

const STEP_ACTIONS: readonly StepAction[] = ["goto", "click", "fill", "waitForVisible", "waitForHidden", "wait"]
const FAULT_TYPES: readonly FaultType[] = ["http-500", "latency", "offline"]
const ASSERTION_TYPES: readonly AssertionType[] = [
  "visible",
  "hidden",
  "disabled",
  "requestCount",
  "text",
  "baselineSuccess",
]

export class ConfigError extends ChaosLensError {
  constructor(message: string) {
    super("CONFIG", message)
    this.name = "ConfigError"
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}

function requireString(scope: string, value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(`${scope}.${field} must be a non-empty string`)
  }
  return value
}

function optionalString(scope: string, value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  return requireString(scope, value, field)
}

function optionalPositiveInt(scope: string, value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (!isPositiveInt(value)) {
    throw new ConfigError(`${scope}.${field} must be a positive integer`)
  }
  return value
}

/** exactOptionalPropertyTypes-friendly: only set the property when defined. */
function assignDefined<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value
}

function validateStep(scope: string, step: unknown, index: number): FlowStep {
  const s = `${scope}[${index}]`
  if (!isRecord(step)) throw new ConfigError(`${s} must be an object`)
  const action = step["action"]
  if (!STEP_ACTIONS.includes(action as StepAction)) {
    throw new ConfigError(`${s}.action must be one of: ${STEP_ACTIONS.join(", ")}`)
  }
  const out: FlowStep = { action: action as StepAction }
  if (out.action === "goto") {
    out.path = requireString(s, step["path"], "path")
  } else if (out.action === "wait") {
    const pause = step["timeoutMs"]
    if (!isPositiveInt(pause)) {
      throw new ConfigError(`${s}.timeoutMs must be a positive integer for wait steps (pause duration)`)
    }
    out.timeoutMs = pause
  } else {
    out.selector = requireString(s, step["selector"], "selector")
    if (out.action === "fill") {
      const value = step["value"]
      if (typeof value !== "string") {
        throw new ConfigError(`${s}.value must be a string for fill steps`)
      }
      out.value = value
    }
  }
  assignDefined(out, "timeoutMs", optionalPositiveInt(s, step["timeoutMs"], "timeoutMs"))
  return out
}

function validateFault(scope: string, fault: unknown): FaultConfig {
  const s = scope
  if (!isRecord(fault)) throw new ConfigError(`${s} must be an object (or null for baseline)`)
  const type = fault["type"]
  if (!FAULT_TYPES.includes(type as FaultType)) {
    throw new ConfigError(`${s}.type must be one of: ${FAULT_TYPES.join(", ")}`)
  }
  const out: FaultConfig = { type: type as FaultType }
  if (out.type === "http-500" || out.type === "latency") {
    out.target = requireString(s, fault["target"], "target")
  }
  if (out.type === "latency") {
    const delay = fault["delayMs"]
    if (!isPositiveInt(delay)) {
      throw new ConfigError(`${s}.delayMs must be a positive integer for latency faults`)
    }
    out.delayMs = delay
  }
  return out
}

function validateAssertion(scope: string, assertion: unknown, index: number): AssertionConfig {
  const s = `${scope}[${index}]`
  if (!isRecord(assertion)) throw new ConfigError(`${s} must be an object`)
  const type = assertion["type"]
  if (!ASSERTION_TYPES.includes(type as AssertionType)) {
    throw new ConfigError(`${s}.type must be one of: ${ASSERTION_TYPES.join(", ")}`)
  }
  const out: AssertionConfig = { type: type as AssertionType }
  switch (out.type) {
    case "visible":
    case "hidden":
    case "disabled":
      out.selector = requireString(s, assertion["selector"], "selector")
      break
    case "text":
      out.selector = requireString(s, assertion["selector"], "selector")
      out.text = requireString(s, assertion["text"], "text")
      break
    case "requestCount": {
      out.urlPattern = requireString(s, assertion["urlPattern"], "urlPattern")
      const max = assertion["max"]
      if (typeof max !== "number" || !Number.isInteger(max) || max < 0) {
        throw new ConfigError(`${s}.max must be a non-negative integer for requestCount assertions`)
      }
      out.max = max
      break
    }
    case "baselineSuccess":
      // Meta-assertion: the healthy flow itself completed. No extra fields.
      break
  }
  assignDefined(out, "timeoutMs", optionalPositiveInt(s, assertion["timeoutMs"], "timeoutMs"))
  return out
}

function validateScenario(scenario: unknown, index: number): ScenarioConfig {
  const s = `scenarios[${index}]`
  if (!isRecord(scenario)) throw new ConfigError(`${s} must be an object`)
  const id = requireString(s, scenario["id"], "id")
  const name = requireString(s, scenario["name"], "name")
  const faultRaw = scenario["fault"]
  const fault = faultRaw === null ? null : validateFault(`${s}.fault`, faultRaw)
  if (!Array.isArray(scenario["assertions"])) {
    throw new ConfigError(`${s}.assertions must be an array`)
  }
  if (scenario["assertions"].length === 0) {
    throw new ConfigError(`${s}.assertions must not be empty`)
  }
  const assertions = scenario["assertions"].map((a, i) => validateAssertion(`${s}.assertions`, a, i))
  return { id, name, fault, assertions }
}

function validateFlow(flow: unknown): FlowConfig {
  const s = "flow"
  if (!isRecord(flow)) throw new ConfigError(`${s} must be an object`)
  const name = requireString(s, flow["name"], "name")
  if (!Array.isArray(flow["steps"]) || flow["steps"].length === 0) {
    throw new ConfigError(`${s}.steps must be a non-empty array`)
  }
  const steps = flow["steps"].map((step, i) => validateStep(`${s}.steps`, step, i))
  const out: FlowConfig = { name, steps }
  assignDefined(out, "timeoutMs", optionalPositiveInt(s, flow["timeoutMs"], "timeoutMs"))
  assignDefined(out, "faultArmBeforeStep", optionalPositiveInt(s, flow["faultArmBeforeStep"], "faultArmBeforeStep"))
  if (out.faultArmBeforeStep !== undefined && out.faultArmBeforeStep > steps.length) {
    throw new ConfigError(`${s}.faultArmBeforeStep must be <= steps.length (${steps.length})`)
  }
  return out
}

/** Runtime validation — bad configs fail fast with a precise error (Spec §17). */
export function validateConfig(raw: unknown): ChaosLensConfig {
  if (!isRecord(raw)) {
    throw new ConfigError("config must be an object (default export of chaoslens.config.ts)")
  }

  const appRaw = raw["application"]
  if (!isRecord(appRaw)) throw new ConfigError("application must be an object")
  const appScope = "application"
  const repoRaw = appRaw["repository"]
  if (!isRecord(repoRaw)) throw new ConfigError(`${appScope}.repository must be an object`)
  const repoUrl = requireString(`${appScope}.repository`, repoRaw["url"], "url")
  try {
    const parsed = new URL(repoUrl)
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("protocol")
    }
  } catch {
    throw new ConfigError(`${appScope}.repository.url must be an http(s) URL (V1: public Git repositories only)`)
  }
  const repository = { url: repoUrl, ref: requireString(`${appScope}.repository`, repoRaw["ref"], "ref") }

  const port = appRaw["port"]
  if (!isPositiveInt(port) || port > 65535) {
    throw new ConfigError(`${appScope}.port must be an integer between 1 and 65535`)
  }
  const healthPath = requireString(appScope, appRaw["healthPath"], "healthPath")
  if (!healthPath.startsWith("/")) {
    throw new ConfigError(`${appScope}.healthPath must start with "/"`)
  }

  const application: ChaosLensConfig["application"] = {
    name: requireString(appScope, appRaw["name"], "name"),
    repository,
    installCommand: requireString(appScope, appRaw["installCommand"], "installCommand"),
    startCommand: requireString(appScope, appRaw["startCommand"], "startCommand"),
    port,
    healthPath,
  }
  assignDefined(application, "cwd", optionalString(appScope, appRaw["cwd"], "cwd"))
  assignDefined(application, "healthTimeoutMs", optionalPositiveInt(appScope, appRaw["healthTimeoutMs"], "healthTimeoutMs"))

  const flow = validateFlow(raw["flow"])

  if (!Array.isArray(raw["scenarios"]) || raw["scenarios"].length === 0) {
    throw new ConfigError("scenarios must be a non-empty array")
  }
  const scenarios = raw["scenarios"].map((sc, i) => validateScenario(sc, i))
  const ids = new Set<string>()
  for (const sc of scenarios) {
    if (ids.has(sc.id)) throw new ConfigError(`duplicate scenario id: ${sc.id}`)
    ids.add(sc.id)
  }
  if (!scenarios.some((sc) => sc.fault === null)) {
    throw new ConfigError("at least one scenario must be the fault-free baseline (fault: null)")
  }

  const out: ChaosLensConfig = { application, flow, scenarios }
  if (raw["sandbox"] !== undefined) {
    if (!isRecord(raw["sandbox"])) throw new ConfigError("sandbox must be an object")
    const sandbox: NonNullable<ChaosLensConfig["sandbox"]> = {}
    const template = optionalString("sandbox", raw["sandbox"]["template"], "template")
    if (template !== undefined) sandbox.template = template
    const timeoutMs = optionalPositiveInt("sandbox", raw["sandbox"]["timeoutMs"], "timeoutMs")
    if (timeoutMs !== undefined) sandbox.timeoutMs = timeoutMs
    out.sandbox = sandbox
  }
  assignDefined(out, "outputDir", optionalString("", raw["outputDir"], "outputDir"))
  return out
}

/**
 * Load a config module (.ts under tsx, or .js/.mjs) and validate its default
 * export. Missing/invalid configs fail fast — there is no auto-detection.
 */
export async function loadConfig(configPath: string): Promise<ChaosLensConfig> {
  const absolute = path.resolve(configPath)
  let mod: unknown
  try {
    mod = await import(pathToFileURL(absolute).href)
  } catch (error) {
    throw new ConfigError(`failed to load config module ${absolute}: ${(error as Error).message}`)
  }
  const candidate = isRecord(mod) && "default" in mod ? mod["default"] : mod
  return validateConfig(candidate)
}
