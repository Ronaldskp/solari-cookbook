/**
 * Concise terminal output (Spec §18). Full evidence belongs in artifacts;
 * the terminal shows high-level progress only. `--verbose` adds detail.
 * Every line is secret-redacted before printing (Spec §21).
 */
import { redact } from "./redact.js"

let verboseEnabled = false

export function setVerbose(enabled: boolean): void {
  verboseEnabled = enabled
}

export function verbose(message: string): void {
  if (verboseEnabled) console.log(redact(`  ${message}`))
}

export function heading(text: string): void {
  console.log(redact(`\n${text}`))
}

export function ok(message: string): void {
  console.log(redact(`\u2713 ${message}`))
}

export function fail(message: string): void {
  console.log(redact(`\u2717 ${message}`))
}

export function info(message: string): void {
  console.log(redact(message))
}

export function error(message: string): void {
  console.error(redact(`ERROR: ${message}`))
}
