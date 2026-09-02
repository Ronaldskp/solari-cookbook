import type { ChaosLensConfig } from "./src/types.js"

/**
 * Acceptance config — identical to the bundled example, but pointed at the
 * public fork + feature branch so the Solari Sandbox can clone the demo.
 */
const config: ChaosLensConfig = {
  application: {
    name: "Demo Checkout",
    repository: {
      url: "https://github.com/Ronaldskp/solari-cookbook.git",
      ref: "feat/chaoslens-v1",
    },
    installCommand: "npm install --no-audit --no-fund",
    startCommand: "node server.js",
    cwd: "examples/chaoslens/demo/checkout-app",
    port: 3000,
    healthPath: "/health",
    healthTimeoutMs: 90_000,
  },
  flow: {
    name: "Checkout",
    faultArmBeforeStep: 6,
    timeoutMs: 15_000,
    steps: [
      { action: "goto", path: "/" },
      { action: "click", selector: '[data-testid="add-to-cart"]' },
      { action: "click", selector: '[data-testid="go-checkout"]' },
      { action: "fill", selector: '[data-testid="email"]', value: "demo@example.com" },
      { action: "fill", selector: '[data-testid="address"]', value: "123 Test Street" },
      { action: "click", selector: '[data-testid="place-order"]' },
      { action: "wait", timeoutMs: 1500 },
      { action: "click", selector: '[data-testid="place-order"]' },
    ],
  },
  scenarios: [
    {
      id: "baseline",
      name: "Healthy Checkout",
      fault: null,
      assertions: [
        { type: "baselineSuccess" },
        { type: "text", selector: '[data-testid="order-success"]', text: "Thank you", timeoutMs: 5000 },
      ],
    },
    {
      id: "http-500",
      name: "HTTP 500",
      fault: { type: "http-500", target: "/api/checkout" },
      assertions: [
        { type: "hidden", selector: '[data-testid="order-spinner"]', timeoutMs: 3000 },
        { type: "visible", selector: '[data-testid="order-error"]', timeoutMs: 3000 },
      ],
    },
    {
      id: "slow-api",
      name: "Slow API",
      fault: { type: "latency", target: "/api/checkout", delayMs: 8000 },
      assertions: [
        { type: "requestCount", urlPattern: "/api/checkout", max: 1 },
        { type: "disabled", selector: '[data-testid="place-order"]', timeoutMs: 1500 },
      ],
    },
    {
      id: "offline",
      name: "Offline",
      fault: { type: "offline" },
      assertions: [
        { type: "visible", selector: '[data-testid="offline-error"]', timeoutMs: 3000 },
        { type: "text", selector: '[data-testid="email"]', text: "demo@example.com", timeoutMs: 2000 },
      ],
    },
  ],
  sandbox: {
    template: "base",
    timeoutMs: 30 * 60_000,
  },
}

export default config
