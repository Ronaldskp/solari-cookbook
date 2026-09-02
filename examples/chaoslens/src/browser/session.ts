import type { BrowserSession } from "@solarisdk/browser"
import { Solari, SolariError } from "@solarisdk/browser"
import type { BrowserContext, Page } from "patchright-core"
import { ChaosLensError } from "../errors.js"
import * as log from "../log.js"

export interface RecordedSession {
  browser: BrowserSession
  sessionId: string
  context: BrowserContext
  page: Page
}

export interface ReplayOutcome {
  replayUrl: string | null
  replayRaw: Uint8Array | null
  attempts: string[]
  windowMs: number
}

export const REPLAY_POLL_INTERVAL_MS = 3000
/**
 * Spec §24: poll replay retrieval for AT LEAST 30 seconds. The window can be
 * widened via CHAOSLENS_REPLAY_POLL_WINDOW_MS (ms) when the upload pipeline
 * is slow; values below 30s are rejected.
 */
export const REPLAY_POLL_WINDOW_MS = (() => {
  const fromEnv = Number(process.env["CHAOSLENS_REPLAY_POLL_WINDOW_MS"])
  return Number.isInteger(fromEnv) && fromEnv >= 30_000 ? fromEnv : 36_000
})()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Open a fresh recording-enabled browser session. Every baseline/chaos run
 * owns its own session (Spec §6, §23).
 */
export async function openRecordedSession(solari: Solari): Promise<RecordedSession> {
  let browser: BrowserSession
  try {
    browser = await solari.launch({ recording: true })
  } catch (error) {
    throw new ChaosLensError("BROWSER_CREATE", `failed to launch Solari browser: ${String(error)}`, error)
  }
  let page
  try {
    // newPage() is the reliable path (verified in the Phase-0 smoke gate):
    // sessions do not always expose a default context immediately.
    page = await browser.newPage()
  } catch (error) {
    await browser.close().catch(() => {})
    throw new ChaosLensError("BROWSER_CREATE", `failed to open page: ${String(error)}`, error)
  }
  const context = page.context()
  log.verbose(`browser session ${browser.id} (recording: true)`)
  return { browser, sessionId: browser.id, context, page }
}

/**
 * Deterministic teardown order (Spec §6): close/release → releaseAndWait →
 * poll replay retrieval for at least the required window with bounded
 * backoff. A 404 inside the window means "not uploaded yet", never an
 * immediate infrastructure failure.
 */
export async function closeSessionAndCollectReplay(
  solari: Solari,
  session: RecordedSession,
): Promise<ReplayOutcome> {
  try {
    await session.browser.close()
  } catch (error) {
    log.verbose(`browser close reported: ${String(error)}`)
  }
  try {
    await solari.sessions.releaseAndWait(session.sessionId)
  } catch {
    // browser.close() already releases; releaseAndWait is confirmation only
  }

  const attempts: string[] = []
  const startedAt = Date.now()
  const deadline = startedAt + REPLAY_POLL_WINDOW_MS
  let attempt = 0
  while (Date.now() < deadline) {
    attempt += 1
    await sleep(REPLAY_POLL_INTERVAL_MS)
    try {
      const blob = await solari.sessions.downloadReplay(session.sessionId)
      let replayUrl: string | null = null
      try {
        const meta = await solari.sessions.getReplayUrl(session.sessionId)
        replayUrl = meta.url
      } catch {
        // bytes are the required evidence; the presigned URL is best-effort
      }
      attempts.push(`attempt ${attempt}: OK (${blob.length} bytes)`)
      return { replayUrl, replayRaw: blob, attempts, windowMs: Date.now() - startedAt }
    } catch (error) {
      if (error instanceof SolariError && error.status === 404) {
        attempts.push(`attempt ${attempt}: 404 (PROCESSING)`)
        continue
      }
      attempts.push(`attempt ${attempt}: ${String(error)}`)
      break
    }
  }
  return { replayUrl: null, replayRaw: null, attempts, windowMs: Date.now() - startedAt }
}
