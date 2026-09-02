import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function parseDotEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === "" || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/**
 * Resolve the Solari API key: `process.env.SOLARI_API_KEY` first, then a
 * `.env` file next to the ChaosLens package. Fails loudly — there is no mock
 * fallback path (Spec §24, AC-02). `dotEnvPath` is injectable for tests.
 */
export function requireSolariApiKey(dotEnvPath?: string): string {
  const fromEnv = process.env["SOLARI_API_KEY"]
  if (fromEnv && fromEnv.trim() !== "") return fromEnv.trim()

  const envPath = dotEnvPath ?? path.join(PACKAGE_ROOT, ".env")
  if (existsSync(envPath)) {
    const fromFile = parseDotEnv(readFileSync(envPath, "utf8"))["SOLARI_API_KEY"]
    if (fromFile && fromFile.trim() !== "") return fromFile.trim()
  }

  console.error(
    [
      "ERROR:",
      "SOLARI_API_KEY is not configured.",
      "",
      "Set the SOLARI_API_KEY environment variable, or create",
      "examples/chaoslens/.env with: SOLARI_API_KEY=slr_live_...",
      "(see .env.example). ChaosLens has no mock fallback.",
    ].join("\n"),
  )
  process.exit(1)
}
