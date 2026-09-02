/**
 * Concise terminal output (Spec §18). Full evidence belongs in artifacts;
 * the terminal shows high-level progress only. `--verbose` adds detail.
 */

let verboseEnabled = false

export function setVerbose(enabled: boolean): void {
  verboseEnabled = enabled
}

export function verbose(message: string): void {
  if (verboseEnabled) console.log(`  ${message}`)
}

export function heading(text: string): void {
  console.log(`\n${text}`)
}

export function ok(message: string): void {
  console.log(`\u2713 ${message}`)
}

export function fail(message: string): void {
  console.log(`\u2717 ${message}`)
}

export function info(message: string): void {
  console.log(message)
}

export function error(message: string): void {
  console.error(`ERROR: ${message}`)
}
