/**
 * Demo Checkout — the application ChaosLens audits (zero dependencies).
 *
 * Endpoints:
 *   GET  /health        → 200 {"ok":true}
 *   GET  /              → checkout single-page app
 *   POST /api/checkout  → 200 {"ok":true,"orderId":...} after ~300ms
 *
 * The frontend intentionally engineers a realistic resilience profile for
 * the frozen demo outcome (see public/index.html):
 *   healthy  → PASS,  HTTP 500 → FAIL,  latency → FAIL,  offline → PASS
 */
const http = require("node:http")
const fs = require("node:fs")
const path = require("node:path")

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000
const PAGE = fs.readFileSync(path.join(__dirname, "public", "index.html"))

let orderCounter = 0

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ ok: true, service: "demo-checkout" }))
    return
  }

  if (req.method === "POST" && req.url === "/api/checkout") {
    let body = ""
    req.on("data", (chunk) => {
      body += chunk
    })
    req.on("end", () => {
      // Simulate a small backend round-trip so the healthy flow is realistic.
      setTimeout(() => {
        orderCounter += 1
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ ok: true, orderId: `demo-${orderCounter}`, receivedBytes: body.length }))
      }, 300)
    })
    return
  }

  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(PAGE)
    return
  }

  res.writeHead(404, { "content-type": "application/json" })
  res.end(JSON.stringify({ error: "not found" }))
})

server.listen(PORT, "0.0.0.0", () => {
  console.log(`demo-checkout listening on ${PORT}`)
})
