import { defineConfig, devices } from "@playwright/test";

// Suite E2E autonome : la config demarre elle-meme le backend Express et le
// frontend Nuxt. Seul prerequis externe : le conteneur Mongo du compose
// (docker compose up -d mongo). La base eatplanner_e2e est dediee aux tests.

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run dev",
      cwd: "../backend",
      url: "http://localhost:3000/",
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        MONGODB_URI: "mongodb://root:example@localhost:27017/eatplanner_e2e?authSource=admin",
        // Le limiteur auth (20 req / 15 min) tuerait la suite.
        AUTH_RATE_LIMIT_MAX: "100000",
        MAIL_MODE: "log"
      }
    },
    {
      command: "npm run dev",
      cwd: "../frontend",
      url: "http://localhost:3001/",
      reuseExistingServer: true,
      // Cold start Nuxt (prepare + vite) : large marge.
      timeout: 180_000,
      env: {
        // Le defaut http://backend:3000 ne resout qu'en Docker.
        NUXT_BACKEND_BASE_URL: "http://localhost:3000"
      }
    }
  ]
});
