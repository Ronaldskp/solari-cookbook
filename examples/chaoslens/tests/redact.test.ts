import { describe, expect, it } from "vitest"
import { redact, redactDeep } from "../src/redact.js"

describe("secret redaction", () => {
  it("redacts Solari API keys", () => {
    expect(redact("key=slr_live_abcDEF123_-x")).toBe("key=slr_live_[REDACTED]")
  })

  it("redacts preview tokens inside URLs", () => {
    const url = "https://abc.preview.getsolari.com/?pt_token=eyJhbGciOi.secret-thing&x=1"
    const out = redact(url)
    expect(out).toContain("pt_token=[REDACTED]")
    expect(out).not.toContain("eyJhbGciOi")
  })

  it("redacts Authorization bearer headers", () => {
    const out = redact('authorization: Bearer slr_live_supersecret123')
    expect(out).not.toContain("supersecret123")
  })

  it("leaves clean text untouched", () => {
    expect(redact("all good here")).toBe("all good here")
  })

  it("redacts recursively through JSON structures", () => {
    const input = {
      url: "https://x.preview.getsolari.com/?pt_token=zzz",
      nested: [{ header: "authorization: Bearer slr_live_k3y" }, 42, null],
    }
    const out = redactDeep(input)
    expect(JSON.stringify(out)).not.toContain("pt_token=zzz")
    expect(JSON.stringify(out)).not.toContain("k3y")
    expect(out.nested[1]).toBe(42)
  })
})
