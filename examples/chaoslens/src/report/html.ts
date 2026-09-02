import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import type { AuditResult, ScenarioResult } from "../types.js"

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function statusChip(status: string): string {
  const cls = status === "PASS" ? "chip-pass" : status === "FAIL" ? "chip-fail" : "chip-error"
  return `<span class="chip ${cls}">${escapeHtml(status)}</span>`
}

function relativeLink(runDir: string, filePath: string | null): string | null {
  if (!filePath) return null
  const rel = path.relative(runDir, filePath).split(path.sep).join("/")
  return `<a class="evidence-link" href="${escapeHtml(rel)}">${escapeHtml(path.basename(filePath))}</a>`
}

function screenshotEmbed(filePath: string | null): string {
  if (!filePath || !existsSync(filePath)) return `<div class="no-shot">no screenshot</div>`
  const b64 = readFileSync(filePath).toString("base64")
  return `<img class="shot" alt="scenario screenshot" src="data:image/png;base64,${b64}">`
}

function scenarioCard(result: ScenarioResult, runDir: string): string {
  const isBaseline = result.faultType === null
  const faultLine = isBaseline
    ? "No fault — healthy baseline"
    : `Fault: ${escapeHtml(result.faultType ?? "")}${result.faultTarget ? ` on ${escapeHtml(result.faultTarget)}` : ""}`
  const activation = isBaseline
    ? ""
    : `<div class="meta">Fault activated: <strong>${result.faultActivated ? "yes — proven in fault-events.json" : "NO"}</strong></div>`

  const failed = result.assertions.filter((a) => !a.pass)
  const observed =
    result.status === "ERROR"
      ? result.failureReasons
      : failed.map((f) => `${f.expected} — observed: ${f.observed}`)
  const observedBlock =
    observed.length > 0
      ? `<div class="observed"><h4>${result.status === "ERROR" ? "Error" : "Failed assertions"}</h4><ul>${observed
          .map((o) => `<li>${escapeHtml(o)}</li>`)
          .join("")}</ul></div>`
      : `<div class="observed ok"><h4>Observed</h4><p>All resilience assertions passed under the injected fault.</p></div>`

  const assertionRows = result.assertions
    .map(
      (a) =>
        `<li class="${a.pass ? "a-pass" : "a-fail"}">${a.pass ? "&#10003;" : "&#10007;"} ${escapeHtml(a.expected)} <span class="a-observed">${escapeHtml(a.observed)}</span></li>`,
    )
    .join("")

  const evidenceLinks = [
    relativeLink(runDir, result.evidence.screenshotPath),
    relativeLink(runDir, result.evidence.replayUrlPath),
    relativeLink(runDir, result.evidence.replayRawPath),
    relativeLink(runDir, result.evidence.networkEventsPath),
    relativeLink(runDir, result.evidence.faultEventsPath),
    relativeLink(runDir, result.evidence.consoleLogPath),
    relativeLink(runDir, result.evidence.serverLogPath),
  ]
    .filter((l): l is string => l !== null)
    .join(" ")

  const replayLine = result.replayUrl
    ? `<div class="meta">Replay: <a class="evidence-link" href="${escapeHtml(result.replayUrl)}">open Solari replay</a></div>`
    : `<div class="meta replay-missing">Replay: unavailable after polling window (see replay-url.txt)</div>`

  return `
<section class="card card-${result.status.toLowerCase()}">
  <header class="card-head">
    <h3>${escapeHtml(result.scenarioName)}</h3>
    ${statusChip(result.status)}
  </header>
  <div class="meta">${faultLine}</div>
  ${activation}
  ${observedBlock}
  <details><summary>Assertions (${result.assertions.length})</summary><ul class="assertions">${assertionRows}</ul></details>
  <div class="shot-wrap">${screenshotEmbed(result.evidence.screenshotPath)}</div>
  ${replayLine}
  <div class="evidence">${evidenceLinks}</div>
</section>`
}

/** Generate the self-contained HTML reliability report (Spec §15). */
export function generateReport(result: AuditResult, runDir: string): string {
  const baseline = result.scenarios.find((s) => s.faultType === null)
  const chaos = result.scenarios.filter((s) => s.faultType !== null)

  const scoreBlock =
    result.scoreState === "SCORED"
      ? `<div class="score"><span class="score-num">${result.score}</span><span class="score-den">/ 100</span></div>`
      : `<div class="score"><span class="score-num score-na">${escapeHtml(result.scoreState)}</span></div>`

  const banner =
    result.scoreState === "BLOCKED"
      ? `<div class="banner banner-blocked">Baseline workflow failed. Reliability scenarios were not evaluated.</div>`
      : result.scoreState === "INCONCLUSIVE"
        ? `<div class="banner banner-warn">Audit inconclusive: infrastructure error or missing replay evidence. No authoritative score is presented.</div>`
        : ""

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ChaosLens — Reliability Report</title>
<style>
  :root {
    --bg: #0d1117; --panel: #161b22; --panel2: #1c2330; --border: #2d3644;
    --text: #e6edf3; --muted: #9aa7b4; --accent: #58a6ff;
    --green: #3fb950; --red: #f85149; --amber: #d29922;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
         font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 40px 24px 64px; }
  header.hero { border-bottom: 1px solid var(--border); padding-bottom: 24px; margin-bottom: 24px; }
  header.hero h1 { margin: 0 0 6px; font-size: 34px; letter-spacing: -0.5px; }
  header.hero h1 .lens { color: var(--accent); }
  header.hero p.tag { margin: 0; color: var(--muted); font-size: 17px; }
  .run-meta { margin-top: 14px; color: var(--muted); font-size: 12.5px; line-height: 1.7; }
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin: 24px 0; }
  .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; }
  .panel h2 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 1.2px; color: var(--muted); }
  .panel .big { font-size: 22px; font-weight: 650; }
  .score { display: flex; align-items: baseline; gap: 6px; }
  .score-num { font-size: 46px; font-weight: 800; color: var(--accent); }
  .score-den { color: var(--muted); font-size: 18px; }
  .score-na { font-size: 24px; color: var(--amber); }
  .chip { display: inline-block; padding: 3px 12px; border-radius: 999px; font-size: 12.5px; font-weight: 700; }
  .chip-pass { background: rgba(63,185,80,.15); color: var(--green); border: 1px solid rgba(63,185,80,.4); }
  .chip-fail { background: rgba(248,81,73,.15); color: var(--red); border: 1px solid rgba(248,81,73,.4); }
  .chip-error { background: rgba(210,153,34,.15); color: var(--amber); border: 1px solid rgba(210,153,34,.4); }
  .banner { margin: 18px 0; padding: 14px 18px; border-radius: 10px; font-size: 14.5px; }
  .banner-blocked { background: rgba(248,81,73,.1); border: 1px solid rgba(248,81,73,.45); }
  .banner-warn { background: rgba(210,153,34,.1); border: 1px solid rgba(210,153,34,.45); }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 18px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 18px; display: flex; flex-direction: column; gap: 10px; }
  .card-pass { border-top: 3px solid var(--green); }
  .card-fail { border-top: 3px solid var(--red); }
  .card-error { border-top: 3px solid var(--amber); }
  .card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .card-head h3 { margin: 0; font-size: 17px; }
  .meta { color: var(--muted); font-size: 12.5px; }
  .replay-missing { color: var(--amber); }
  .observed h4 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); }
  .observed ul { margin: 0; padding-left: 18px; font-size: 13.5px; color: var(--text); }
  .observed p { margin: 0; font-size: 13.5px; }
  .observed.ok h4 { color: var(--green); }
  details summary { cursor: pointer; color: var(--accent); font-size: 13px; }
  ul.assertions { list-style: none; margin: 8px 0 0; padding: 0; font-size: 12.5px; }
  ul.assertions li { padding: 5px 8px; border-radius: 6px; margin-bottom: 4px; background: var(--panel2); }
  .a-pass { color: var(--green); } .a-fail { color: var(--red); }
  .a-observed { color: var(--muted); display: block; margin-top: 2px; }
  .shot-wrap { background: #000; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .shot { width: 100%; display: block; }
  .no-shot { color: var(--muted); font-size: 12px; padding: 18px; text-align: center; }
  .evidence { display: flex; flex-wrap: wrap; gap: 8px; }
  .evidence-link { font-size: 11.5px; color: var(--accent); text-decoration: none; border: 1px solid var(--border);
                   border-radius: 6px; padding: 3px 8px; background: var(--panel2); }
  footer { margin-top: 36px; color: var(--muted); font-size: 12px; line-height: 1.8; border-top: 1px solid var(--border); padding-top: 18px; }
</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <h1>Chaos<span class="lens">Lens</span></h1>
    <p class="tag">See what your users see when your backend fails.</p>
    <div class="run-meta">
      Browser Reliability Audit &middot; Application: <strong>${escapeHtml(result.applicationName)}</strong>
      &middot; Critical flow: <strong>${escapeHtml(result.flowName)}</strong><br>
      Run ${escapeHtml(result.runId)} &middot; ${escapeHtml(result.startedAt)} &rarr; ${escapeHtml(result.finishedAt)}
    </div>
  </header>

  ${banner}

  <div class="summary">
    <div class="panel"><h2>Baseline</h2><div class="big">${statusChip(result.baseline === "PASS" ? "PASS" : result.baseline)}</div></div>
    <div class="panel"><h2>Reliability Score</h2>${scoreBlock}</div>
    <div class="panel"><h2>Scenarios</h2><div class="big">${chaos.length} chaos${baseline ? " + 1 baseline" : ""}</div></div>
  </div>

  <div class="cards">
    ${baseline ? scenarioCard(baseline, runDir) : ""}
    ${chaos.map((s) => scenarioCard(s, runDir)).join("")}
  </div>

  <footer>
    Verdicts come from deterministic fault injection + assertions — no LLM decides PASS or FAIL.<br>
    Evidence: screenshots, Solari browser replay, network/fault events, browser console, server logs (all secrets redacted).<br>
    Generated by ChaosLens V1.
  </footer>
</div>
</body>
</html>
`
}
