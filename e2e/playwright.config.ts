import { defineConfig, devices } from "@playwright/test";

// Suite E2E 100% autonome : la config demarre elle-meme un MongoDB embarque
// (mongodb-memory-server, aucun Docker requis), le backend Express et le
// frontend Nuxt. Seuls prerequis machine : Node + npm install + chromium.

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
      // Le wrapper demarre le Mongo embarque puis le backend (l'URI est
      // injectee par le script). 240s : 1er run = telechargement de mongod.
      command: "node scripts/backend-with-embedded-mongo.mjs",
      url: "http://localhost:3000/",
      reuseExistingServer: true,
      timeout: 240_000,
      env: {
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
