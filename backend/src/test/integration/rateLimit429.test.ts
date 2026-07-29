import request from "supertest";

// Le rate limiter est un singleton construit au chargement du module avec la
// valeur de l'environnement : on la fixe AVANT de charger l'app (registre de
// modules propre a ce fichier), a une valeur basse pour declencher le 429.
process.env.AUTH_RATE_LIMIT_MAX = "3";
process.env.AUTH_RATE_LIMIT_WINDOW_MS = "900000";

/* eslint-disable @typescript-eslint/no-require-imports */
const { createTestApp } = require("./helpers/appFactory") as typeof import("./helpers/appFactory");
const { startDb, stopDb } = require("./helpers/db") as typeof import("./helpers/db");
/* eslint-enable @typescript-eslint/no-require-imports */

const app = createTestApp();

beforeAll(startDb);
afterAll(stopDb);

describe("authRateLimiter", () => {
  it("answers 429 after the configured number of auth attempts", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await request(app).post("/user/auth").send({
        email: "brute@test.local",
        password: "WrongPassword1!"
      });
      expect(res.status).toBe(401);
    }

    const blocked = await request(app).post("/user/auth").send({
      email: "brute@test.local",
      password: "WrongPassword1!"
    });

    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: "Too many attempts, please try again later" });
  });
});
