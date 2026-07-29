import request from "supertest";
import { SaleModel } from "../../models";
import { startOfDay } from "../../services/serviceUtils";
import { createTestApp } from "./helpers/appFactory";
import { authHeader, createAccount } from "./helpers/auth";
import { startDb, stopDb } from "./helpers/db";
import { seedDish, seedIngredient } from "./helpers/seed";

// Les cles de jour repliquent la logique du code (startOfDay local puis
// toISOString) pour rester vertes quel que soit le fuseau de la machine.

const app = createTestApp();

let account: Awaited<ReturnType<typeof createAccount>>;

function dayKeyFromFrenchDate(day: number, month: number, year: number): string {
  return startOfDay(new Date(year, month - 1, day)).toISOString().slice(0, 10);
}

beforeAll(async () => {
  await startDb();
  account = await createAccount();
});

afterAll(stopDb);

describe("POST /sales", () => {
  it("keeps the provided unit price, including an explicit zero", async () => {
    const ingredient = await seedIngredient(account.user, { name: "Pates" });
    const dish = await seedDish(account.user, ingredient, { name: "Bolognaise" });

    const res = await request(app)
      .post("/sales")
      .set(authHeader(account.token))
      .send({
        serviceDate: "2026-06-15",
        items: [
          { dish: String(dish._id), quantity: 2, unitPrice: 9.9 },
          { dish: String(dish._id), quantity: 1, unitPrice: 0 }
        ]
      });

    expect(res.status).toBe(201);
    expect(res.body.items[0].unitPrice).toBe(9.9);
    expect(res.body.items[1].unitPrice).toBe(0);
    expect(res.body.totalAmount).toBe(19.8);
  });

  it("falls back to the actual dish price when the unit price is omitted", async () => {
    const ingredient = await seedIngredient(account.user, { name: "Salade" });
    const dish = await seedDish(account.user, ingredient, {
      name: "Cesar",
      actualPriceIncludingTax: 11
    });

    const res = await request(app)
      .post("/sales")
      .set(authHeader(account.token))
      .send({
        serviceDate: "2026-06-15",
        items: [{ dish: String(dish._id), quantity: 3 }]
      });

    expect(res.status).toBe(201);
    expect(res.body.items[0].unitPrice).toBe(11);
    expect(res.body.totalAmount).toBe(33);
  });

  it("falls back to the suggested price when no actual price is set", async () => {
    // Recette 0.5 kg a 2 EUR/kg = 1 EUR, marge 0.5, aucune charge active :
    // HT = 1 / 0.5 = 2, TVA 10% -> 2.2 TTC.
    const ingredient = await seedIngredient(account.user, { name: "Oeufs", purchasePrice: 2 });
    const dish = await seedDish(account.user, ingredient, {
      name: "Omelette",
      targetMarginRate: 0.5,
      actualPriceIncludingTax: 0
    });

    const res = await request(app)
      .post("/sales")
      .set(authHeader(account.token))
      .send({
        serviceDate: "2026-06-15",
        items: [{ dish: String(dish._id), quantity: 1 }]
      });

    expect(res.status).toBe(201);
    expect(res.body.items[0].unitPrice).toBe(2.2);
  });

  it("rejects a sale referencing an unknown dish", async () => {
    const foreign = await createAccount();
    const ingredient = await seedIngredient(foreign.user, { name: "Secret" });
    const dish = await seedDish(foreign.user, ingredient, { name: "Plat prive" });

    const res = await request(app)
      .post("/sales")
      .set(authHeader(account.token))
      .send({
        serviceDate: "2026-06-15",
        items: [{ dish: String(dish._id), quantity: 1 }]
      });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "One or more dishes were not found" });
  });
});

describe("POST /sales/import-csv", () => {
  it("imports a semicolon CSV with accented headers, groups rows by day", async () => {
    const fresh = await createAccount();
    const ingredient = await seedIngredient(fresh.user, { name: "Boeuf" });
    await seedDish(fresh.user, ingredient, {
      name: "Bourguignon",
      actualPriceIncludingTax: 11
    });

    const csv = [
      "Date;Plat;Quantit\u00e9;Prix",  // header accentue (teste la normalisation NFD)
      "15/06/2026;Bourguignon;2;12,50",
      "15/06/2026;Bourguignon;1;",
      "16/06/2026;Bourguignon;3;9"
    ].join("\n");

    const res = await request(app)
      .post("/sales/import-csv")
      .set(authHeader(fresh.token))
      .send({ csv });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ importedRows: 3, createdSales: 2, skippedRows: 0, errors: [] });

    const sales = await SaleModel.find({ owner: fresh.user._id }).sort({ serviceDate: 1 }).exec();
    expect(sales).toHaveLength(2);

    const firstDayKey = dayKeyFromFrenchDate(15, 6, 2026);
    const firstDay = sales.find(
      (sale) => sale.serviceDate.getTime() === new Date(`${firstDayKey}T00:00:00.000Z`).getTime()
    );
    expect(firstDay).toBeDefined();
    // Pas de cumul : deux lignes du meme jour donnent deux items distincts.
    expect(firstDay?.items).toHaveLength(2);
    expect(firstDay?.items[0]?.quantity).toBe(2);
    expect(firstDay?.items[0]?.unitPrice).toBe(12.5);
    // Prix manquant -> prix reel du plat.
    expect(firstDay?.items[1]?.unitPrice).toBe(11);
    expect(firstDay?.notes).toBe("Import CSV");
    expect(firstDay?.totalAmount).toBe(36);
  });

  it("imports a comma CSV with english headers and ISO dates", async () => {
    const fresh = await createAccount();
    const ingredient = await seedIngredient(fresh.user, { name: "Poulet" });
    await seedDish(fresh.user, ingredient, { name: "Curry", actualPriceIncludingTax: 10 });

    const csv = ["date,dish,quantity,unitprice", "2026-06-20,Curry,4,8.5"].join("\n");

    const res = await request(app)
      .post("/sales/import-csv")
      .set(authHeader(fresh.token))
      .send({ csv });

    expect(res.status).toBe(201);
    expect(res.body.importedRows).toBe(1);
    expect(res.body.createdSales).toBe(1);

    const expectedKey = startOfDay(new Date("2026-06-20")).toISOString().slice(0, 10);
    const sale = await SaleModel.findOne({ owner: fresh.user._id }).exec();
    expect(sale?.serviceDate.getTime()).toBe(new Date(`${expectedKey}T00:00:00.000Z`).getTime());
    expect(sale?.items[0]?.quantity).toBe(4);
    expect(sale?.items[0]?.unitPrice).toBe(8.5);
  });

  it("reports numbered errors per invalid row and still imports the valid ones", async () => {
    const fresh = await createAccount();
    const ingredient = await seedIngredient(fresh.user, { name: "Thon" });
    await seedDish(fresh.user, ingredient, { name: "Tartare", actualPriceIncludingTax: 10 });

    const csv = [
      "Date;Plat;Quantite;Prix",
      "aa/bb/cccc;Tartare;2;10",
      "15/06/2026;;2;10",
      "15/06/2026;Tartare;0;10",
      "15/06/2026;Fantome;1;10",
      "15/06/2026;Tartare;1;10"
    ].join("\n");

    const res = await request(app)
      .post("/sales/import-csv")
      .set(authHeader(fresh.token))
      .send({ csv });

    expect(res.status).toBe(201);
    expect(res.body.importedRows).toBe(1);
    expect(res.body.createdSales).toBe(1);
    expect(res.body.skippedRows).toBe(4);
    expect(res.body.errors).toEqual([
      "Ligne 2: date invalide.",
      "Ligne 3: plat manquant.",
      "Ligne 4: quantite invalide.",
      'Ligne 5: plat "Fantome" introuvable.'
    ]);
  });

  it("rejects a header-only CSV with a single global error", async () => {
    const fresh = await createAccount();

    const res = await request(app)
      .post("/sales/import-csv")
      .set(authHeader(fresh.token))
      .send({ csv: "Date;Plat;Quantite;Prix" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      importedRows: 0,
      createdSales: 0,
      skippedRows: 1,
      errors: ["Le fichier CSV doit contenir un header et au moins une ligne."]
    });
  });

  it("rejects an empty csv body at the validation layer", async () => {
    const res = await request(app)
      .post("/sales/import-csv")
      .set(authHeader(account.token))
      .send({ csv: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });
});
