/**
 * Secret scrubber. Everything ChaosLens persists — console logs, network
 * events, server logs, reports, JSON artifacts — passes through here first
 * (Spec §21). Covers at minimum Solari API keys and sandbox preview tokens.
 */

const PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /slr_(live|test|dev)_[A-Za-z0-9_-]+/g, replacement: "slr_$1_[REDACTED]" },
  // Preview tokens, including ones embedded in preview URLs (?pt_token=...).
  { pattern: /pt_token=[^\s&"'<>)]+/g, replacement: "pt_token=[REDACTED]" },
  // Authorization headers caught in network evidence.
  {
    pattern: /(authorization["']?\s*[:=]\s*["']?bearer\s+)[^\s"',}]+/gi,
    replacement: "$1[REDACTED]",
  },
]

export function redact(text: string): string {
  let out = text
  for (const { pattern, replacement } of PATTERNS) {
    out = out.replace(pattern, replacement)
  }
  return out
}

/** Recursively redact every string inside a JSON-serializable value. */
export function redactDeep<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return redact(v)
    if (Array.isArray(v)) return v.map(walk)
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(v)) out[key] = walk(item)
      return out
    }
    return v
  }
  return walk(value) as T
}
