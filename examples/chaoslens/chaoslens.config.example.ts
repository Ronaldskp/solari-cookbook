import type { ChaosLensConfig } from "./src/types.js"

/**
 * ChaosLens demo configuration — audits the bundled Demo Checkout app.
 *
 * Point `repository` at a PUBLIC Git repository that contains this example
 * (e.g. your fork of solari-cookbook with examples/chaoslens pushed), because
 * the Solari Sandbox clones the target application from the network.
 *
 * All form data below is synthetic (Spec §21).
 */
const config: ChaosLensConfig = {
  application: {
    name: "Demo Checkout",
    repository: {
      // Replace with your public fork containing examples/chaoslens.
      url: "https://github.com/solari-sdk/solari-cookbook.git",
      ref: "main",
    },
    installCommand: "npm install --no-audit --no-fund",
    startCommand: "node server.js",
    cwd: "examples/chaoslens/demo/checkout-app",
    port: 3000,
    healthPath: "/health",
    healthTimeoutMs: 60_000,
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
      // Deterministic second programmatic click: with no latency the first
      // request already settled; under the 8s latency fault it must NOT be
      // possible to submit twice.
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
