import request from "supertest";
import { createTestApp } from "./helpers/appFactory";
import { authHeader, createAccount } from "./helpers/auth";
import { startDb, stopDb } from "./helpers/db";
import { seedDish, seedIngredient } from "./helpers/seed";

const app = createTestApp();

let account: Awaited<ReturnType<typeof createAccount>>;

beforeAll(async () => {
  await startDb();
  account = await createAccount();
});

afterAll(stopDb);

describe("validateMiddleware on real routes", () => {
  it("answers 400 with issues on an invalid dish body", async () => {
    const res = await request(app)
      .post("/dishes")
      .set(authHeader(account.token))
      .send({ name: "X", category: "Plat", ingredients: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  it("rejects a margin above 0.95", async () => {
    const ingredient = await seedIngredient(account.user, { name: "Or" });

    const res = await request(app)
      .post("/dishes")
      .set(authHeader(account.token))
      .send({
        name: "Plat en or",
        category: "Plat",
        targetMarginRate: 0.96,
        ingredients: [{ ingredient: String(ingredient._id), quantity: 1, unit: "kg" }]
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("rejects an unknown charge category", async () => {
    const res = await request(app)
      .post("/charges")
      .set(authHeader(account.token))
      .send({ name: "Mystere", category: "inconnue", amount: 10, period: "monthly" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("treats a missing body as a validation failure (Express 5)", async () => {
    const res = await request(app).post("/dishes").set(authHeader(account.token));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("persists the Zod defaults", async () => {
    const ingredient = await seedIngredient(account.user, { name: "Ble" });

    const res = await request(app)
      .post("/dishes")
      .set(authHeader(account.token))
      .send({
        name: "Plat par defaut",
        category: "Plat",
        ingredients: [{ ingredient: String(ingredient._id), quantity: 1, unit: "kg" }]
      });

    expect(res.status).toBe(201);
    expect(res.body.estimatedDailyServings).toBe(15);
    expect(res.body.active).toBe(true);
  });
});

describe("malformed ObjectId in :id (current behavior, documented)", () => {
  it("answers a raw 500 on a CastError instead of a 404", async () => {
    // Aucune validation de params : le CastError Mongoose remonte au handler
    // d'erreurs par defaut d'Express (corps HTML, pas de JSON).
    const res = await request(app).get("/dishes/not-an-objectid").set(authHeader(account.token));

    expect(res.status).toBe(500);
  });

  it("answers a muted 500 on the forecast correction route", async () => {
    const ingredient = await seedIngredient(account.user, { name: "Muette" });
    const dish = await seedDish(account.user, ingredient, { name: "Plat muet" });

    const res = await request(app)
      .patch(`/forecasts/not-an-id/recommendations/${dish._id}/correction`)
      .set(authHeader(account.token))
      .send({ correctionQuantity: 1 });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Unable to update forecast correction" });
  });
});
