/**
 * ChaosLens CLI — deterministic browser reliability auditing on Solari.
 *
 *   npm run audit -- --config ./chaoslens.config.example.ts [--output <dir>] [--verbose]
 *
 * Exit codes: 0 = audit scored, 1 = BLOCKED/INCONCLUSIVE/ERROR audit,
 * 2 = configuration/startup failure.
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ConfigError, loadConfig } from "./config.js"
import { messageOf } from "./errors.js"
import * as log from "./log.js"
import { runAudit } from "./orchestrator.js"

interface CliOptions {
  configPath: string | null
  outputRoot: string
  verbose: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = {
    configPath: null,
    outputRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "artifacts"),
    verbose: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--config") {
      out.configPath = argv[++i] ?? null
    } else if (arg === "--output") {
      out.outputRoot = argv[++i] ?? out.outputRoot
    } else if (arg === "--verbose") {
      out.verbose = true
    } else if (arg === "--help" || arg === "-h") {
      printUsage()
      process.exit(0)
    } else {
      log.error(`unknown argument: ${arg}`)
      printUsage()
      process.exit(2)
    }
  }
  return out
}

function printUsage(): void {
  console.log(
    [
      "ChaosLens — See what your users see when your backend fails.",
      "",
      "Usage:",
      "  npm run audit -- --config ./chaoslens.config.example.ts [--output <dir>] [--verbose]",
      "",
      "Requires SOLARI_API_KEY (environment variable or .env). No mock fallback.",
    ].join("\n"),
  )
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  if (!options.configPath) {
    log.error("--config <path> is required")
    printUsage()
    process.exit(2)
  }
  log.setVerbose(options.verbose)

  let config
  try {
    config = await loadConfig(options.configPath)
  } catch (error) {
    if (error instanceof ConfigError) {
      log.error(`invalid config: ${messageOf(error)}`)
      process.exit(2)
    }
    throw error
  }

  console.log("ChaosLens")
  const { result } = await runAudit({ config, outputRoot: path.resolve(options.outputRoot) })
  process.exit(result.scoreState === "SCORED" ? 0 : 1)
}

await main()
