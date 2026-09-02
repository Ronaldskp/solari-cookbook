/**
 * Diagnostic v3 — re-probe previously released recorded sessions.
 * If a replay has appeared minutes later, upload is merely slow and we
 * only need a longer poll window. If still 404, the recording was never
 * generated for these sessions.
 *
 *   npx tsx scripts/diagnose-replay3.ts
 */
import { Solari } from "@solarisdk/browser"
import { requireSolariApiKey } from "../src/env.js"
import { redact } from "../src/redact.js"

const SESSION_IDS = [
  // smoke run 13:18 (recording:true, preview page, click)
  "ip-10-0-11-50:ba73e6b6-aa1a-40fa-b235-6b0c01cdf764:cmtk44h8f00l6o201gok9894v:1788355125758.xqw6HpBsSo2ldtgwlhYrJw",
  // diagnose v1 13:22 (recording:true, example.com)
  "ip-10-0-11-50:1947e43f-4e48-4530-8a5a-e40864b101bf:cmtk44h8f00l6o201gok9894v:1788355323530.zuSS6IWmDHoP7gjd4TZe7A",
  // diagnose v2 13:28 (recording:true, busier example.com session)
  "ip-10-0-10-96:3c68dadd-8ec7-422f-adc3-0905a4f8b938:cmtk44h8f00l6o201gok9894v:1788355691899.UOSg0a6-6afTRRdN9tyUAA",
]

const solari = new Solari({ apiKey: requireSolariApiKey() })
for (const id of SESSION_IDS) {
  const state = await solari.request("GET", `/sessions/${encodeURIComponent(id)}`).catch((e) => e)
  if (!(state instanceof Error)) {
    const body = await state.text().catch(() => "")
    console.log(`session ${id.split(":")[3]?.slice(0, 13)}...: GET /sessions/:id → ${state.status} ${redact(body.slice(0, 160))}`)
  }
  const replay = await solari
    .request("GET", `/sessions/${encodeURIComponent(id)}/replay-url`)
    .catch((e) => e)
  if (replay instanceof Error) {
    console.log(`  replay-url: THREW ${redact(String(replay))}`)
  } else {
    const body = await replay.text().catch(() => "")
    console.log(`  replay-url: ${replay.status} ${redact(body.slice(0, 160))}`)
  }
}
await solari.close()
console.log("done")
