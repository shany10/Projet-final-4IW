import request from "supertest";
import { ForecastModel } from "../../models";
import { buildDailyForecast } from "../../services/forecastService";
import { startOfDay, subDays } from "../../services/serviceUtils";
import { createTestApp } from "./helpers/appFactory";
import { authHeader, createAccount } from "./helpers/auth";
import { startDb, stopDb } from "./helpers/db";
import { seedDish, seedIngredient, seedSale } from "./helpers/seed";

// Historique seede uniformement : toutes les moyennes (jour de semaine,
// 7 jours, 21 jours) valent Q, donc la formule 0.55/0.30/0.15 redonne Q quel
// que soit le fuseau de la machine (assertions TZ-robustes).

const app = createTestApp();

type ForecastDishEntry = {
  dishId: string;
  recommendedQuantity: number;
  initialForecastQuantity: number;
  userCorrectionQuantity: number | null;
  trend: string;
  confidence: string;
  historyDaysUsed: number;
};

async function seedUniformHistory(
  account: Awaited<ReturnType<typeof createAccount>>,
  dish: Awaited<ReturnType<typeof seedDish>>,
  quantity: number,
  days = 42
) {
  const today = startOfDay(new Date());
  for (let offset = 1; offset <= days; offset += 1) {
    await seedSale(account.user, dish, {
      serviceDate: subDays(today, offset),
      quantity,
      unitPrice: 10
    });
  }
}

function findDishEntry(dishes: ForecastDishEntry[], dishId: string): ForecastDishEntry {
  const entry = dishes.find((item) => String(item.dishId) === dishId);
  expect(entry).toBeDefined();
  return entry as ForecastDishEntry;
}

beforeAll(startDb);
afterAll(stopDb);

describe("buildDailyForecast (service, in-memory db)", () => {
  it("returns the uniform quantity with high confidence on 42 days of history", async () => {
    const account = await createAccount();
    const ingredient = await seedIngredient(account.user, { name: "Base" });
    const dish = await seedDish(account.user, ingredient, {
      name: "Plat regulier",
      estimatedDailyServings: 10
    });
    await seedUniformHistory(account, dish, 10);

    const forecast = await buildDailyForecast(undefined, account.user);

    expect(forecast.persisted).toBe(false);
    const entry = findDishEntry(forecast.dishes as ForecastDishEntry[], String(dish._id));
    // weekday*0.55 + recent*0.30 + long*0.15 avec toutes les moyennes a 10.
    expect(entry.recommendedQuantity).toBe(10);
    expect(entry.confidence).toBe("high");
    expect(entry.trend).toBe("steady");
  });

  it("falls back to 75% of the estimated servings without any history", async () => {
    const account = await createAccount();
    const ingredient = await seedIngredient(account.user, { name: "Neuf" });
    const dish = await seedDish(account.user, ingredient, {
      name: "Plat sans historique",
      estimatedDailyServings: 12
    });

    const forecast = await buildDailyForecast(undefined, account.user);

    const entry = findDishEntry(forecast.dishes as ForecastDishEntry[], String(dish._id));
    expect(entry.recommendedQuantity).toBe(9);
    expect(entry.confidence).toBe("low");
    expect(entry.historyDaysUsed).toBe(0);
  });

  it("trends up when the recent sales exceed the baseline", async () => {
    const account = await createAccount();
    const ingredient = await seedIngredient(account.user, { name: "Vedette" });
    const dish = await seedDish(account.user, ingredient, {
      name: "Plat en hausse",
      estimatedDailyServings: 10
    });
    const today = startOfDay(new Date());
    for (let offset = 1; offset <= 42; offset += 1) {
      await seedSale(account.user, dish, {
        serviceDate: subDays(today, offset),
        quantity: offset <= 7 ? 20 : 10,
        unitPrice: 10
      });
    }

    const forecast = await buildDailyForecast(undefined, account.user);

    const entry = findDishEntry(forecast.dishes as ForecastDishEntry[], String(dish._id));
    // 12.5*0.55 + 20*0.30 + 16.67*0.15 = 15.375 -> 15, quel que soit le TZ
    // (une seule occurrence du meme jour de semaine dans les 7 derniers jours).
    expect(entry.recommendedQuantity).toBe(15);
    expect(entry.trend).toBe("up");
    const alerts = forecast.alerts as Array<{ dishId: unknown }>;
    expect(alerts.map((alert) => String(alert.dishId))).toContain(String(dish._id));
  });
});

describe("forecast routes", () => {
  it("serves a volatile forecast then upserts a single persisted document per day", async () => {
    await ForecastModel.init();
    const account = await createAccount();
    const ingredient = await seedIngredient(account.user, { name: "Persist" });
    await seedDish(account.user, ingredient, { name: "Plat persiste", estimatedDailyServings: 8 });

    const volatile = await request(app).get("/forecasts/daily").set(authHeader(account.token));
    expect(volatile.status).toBe(200);
    expect(volatile.body.persisted).toBe(false);
    expect(volatile.body._id).toBeUndefined();

    const firstSave = await request(app)
      .post("/forecasts/daily")
      .set(authHeader(account.token))
      .send({});
    expect(firstSave.status).toBe(201);
    expect(firstSave.body.persisted).toBe(true);
    expect(firstSave.body._id).toBeDefined();

    const secondSave = await request(app)
      .post("/forecasts/daily")
      .set(authHeader(account.token))
      .send({});
    expect(secondSave.status).toBe(201);
    // Upsert sur l'index unique {owner, targetDate} : meme document.
    expect(secondSave.body._id).toBe(firstSave.body._id);
    await expect(ForecastModel.countDocuments({ owner: account.user._id }).exec()).resolves.toBe(1);

    const persisted = await request(app).get("/forecasts/daily").set(authHeader(account.token));
    expect(persisted.body.persisted).toBe(true);
    expect(persisted.body._id).toBe(firstSave.body._id);
  });

  it("applies a correction and preserves it across regenerations", async () => {
    const account = await createAccount();
    const ingredient = await seedIngredient(account.user, { name: "Corrige" });
    const dish = await seedDish(account.user, ingredient, {
      name: "Plat corrige",
      estimatedDailyServings: 10
    });

    const saved = await request(app)
      .post("/forecasts/daily")
      .set(authHeader(account.token))
      .send({});
    const forecastId = saved.body._id as string;
    const before = findDishEntry(saved.body.dishes as ForecastDishEntry[], String(dish._id));

    const corrected = await request(app)
      .patch(`/forecasts/${forecastId}/recommendations/${dish._id}/correction`)
      .set(authHeader(account.token))
      .send({ correctionQuantity: 99, correctionComment: "Grosse reservation" });

    expect(corrected.status).toBe(200);
    const entry = findDishEntry(corrected.body.dishes as ForecastDishEntry[], String(dish._id));
    expect(entry.recommendedQuantity).toBe(99);
    expect(entry.userCorrectionQuantity).toBe(99);
    expect(entry.initialForecastQuantity).toBe(before.initialForecastQuantity);
    expect(entry.initialForecastQuantity).not.toBe(99);

    // Regeneration : la correction utilisateur est preservee.
    const regenerated = await request(app)
      .post("/forecasts/daily")
      .set(authHeader(account.token))
      .send({});
    const preserved = findDishEntry(regenerated.body.dishes as ForecastDishEntry[], String(dish._id));
    expect(preserved.recommendedQuantity).toBe(99);
    expect(preserved.userCorrectionQuantity).toBe(99);
  });

  it("answers 404 for a correction on an unknown dish and 400 on a negative quantity", async () => {
    const account = await createAccount();
    const ingredient = await seedIngredient(account.user, { name: "Inconnu" });
    const dish = await seedDish(account.user, ingredient, { name: "Plat reference" });

    const saved = await request(app)
      .post("/forecasts/daily")
      .set(authHeader(account.token))
      .send({});
    const forecastId = saved.body._id as string;

    const unknownDish = await request(app)
      .patch(`/forecasts/${forecastId}/recommendations/${ingredient._id}/correction`)
      .set(authHeader(account.token))
      .send({ correctionQuantity: 5 });
    expect(unknownDish.status).toBe(404);
    expect(unknownDish.body).toEqual({ error: "Forecast recommendation not found" });

    const negative = await request(app)
      .patch(`/forecasts/${forecastId}/recommendations/${dish._id}/correction`)
      .set(authHeader(account.token))
      .send({ correctionQuantity: -1 });
    expect(negative.status).toBe(400);
    expect(negative.body.error).toBe("Validation failed");
  });
});
