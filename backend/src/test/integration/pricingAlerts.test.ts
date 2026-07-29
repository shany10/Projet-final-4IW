import { buildPricingAlertsReport } from "../../services/pricingAlertsService";
import { createAccount } from "./helpers/auth";
import { clearDb, startDb, stopDb } from "./helpers/db";
import { seedDish, seedIngredient, seedSale } from "./helpers/seed";

// Moteur a 5 regles mutuellement exclusives, teste sur donnees seedees.
// Aucune charge active : chargePerServing = 0, les couts sont exactement les
// couts matiere des recettes.

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

describe("buildPricingAlertsReport", () => {
  it("raises one alert per rule, mutually exclusive, sorted by severity then name", async () => {
    const account = await createAccount();
    const ingredient = await seedIngredient(account.user, { name: "Base", purchasePrice: 2 });

    // Cout matiere 1 EUR (0.5 kg x 2), marge cible 0.5 -> conseille 2 HT / 2.2 TTC.
    const missingPrice = await seedDish(account.user, ingredient, {
      name: "Aucun prix",
      targetMarginRate: 0.5,
      actualPriceIncludingTax: 0
    });
    // Cout 10 EUR (5 kg), vendu 5.5 TTC -> 5 HT <= 10 : vente a perte.
    const sellingAtLoss = await seedDish(account.user, ingredient, {
      name: "Perte",
      targetMarginRate: 0.5,
      actualPriceIncludingTax: 5.5,
      ingredients: [{ ingredient: ingredient._id, quantity: 5, unit: "kg" }]
    });
    // Cout 1, marge cible 0.7 ; vendu 2.2 TTC -> 2 HT, marge reelle 0.5 < 0.65.
    const lowMargin = await seedDish(account.user, ingredient, {
      name: "Marge basse",
      targetMarginRate: 0.7,
      actualPriceIncludingTax: 2.2
    });
    // Vendu 2.09 TTC < conseille 2.2 (gap negatif), marge reelle 0.47 >= 0.45,
    // 6 ventes >= max(26 x 0.1, 5) : best-seller a repositionner.
    const starReprice = await seedDish(account.user, ingredient, {
      name: "Etoile",
      targetMarginRate: 0.5,
      actualPriceIncludingTax: 2.09
    });
    // Prix aligne (2.2 = conseille), zero vente sur 30 jours, total >= 20.
    const slowMover = await seedDish(account.user, ingredient, {
      name: "Dormeur",
      targetMarginRate: 0.5,
      actualPriceIncludingTax: 2.2
    });
    // Recette vide : ignore par le moteur meme sans prix.
    await seedDish(account.user, ingredient, {
      name: "Sans recette",
      actualPriceIncludingTax: 0,
      ingredients: []
    });

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await seedSale(account.user, starReprice, { serviceDate: yesterday, quantity: 6 });
    await seedSale(account.user, sellingAtLoss, { serviceDate: yesterday, quantity: 20 });

    const report = await buildPricingAlertsReport(account.user);

    expect(report.periodDays).toBe(30);
    expect(report.totalSoldQuantity).toBe(26);
    expect(report.counts).toEqual({ critical: 1, warning: 2, info: 2 });

    // Tri : critical d'abord, puis warnings et infos par nom.
    expect(
      report.alerts.map((alert) => ({ dishName: alert.dishName, type: alert.type, severity: alert.severity }))
    ).toEqual([
      { dishName: "Perte", type: "selling_at_loss", severity: "critical" },
      { dishName: "Aucun prix", type: "missing_price", severity: "warning" },
      { dishName: "Marge basse", type: "low_margin", severity: "warning" },
      { dishName: "Dormeur", type: "slow_mover", severity: "info" },
      { dishName: "Etoile", type: "star_reprice", severity: "info" }
    ]);

    // Exclusivite : la vente a perte n'apparait pas aussi en low_margin,
    // et chaque plat n'a qu'une seule alerte.
    const lossAlerts = report.alerts.filter((alert) => alert.dishId === String(sellingAtLoss._id));
    expect(lossAlerts).toHaveLength(1);
    expect(lossAlerts[0]?.type).toBe("selling_at_loss");

    const alertedDishIds = report.alerts.map((alert) => alert.dishId);
    expect(new Set(alertedDishIds).size).toBe(alertedDishIds.length);
    expect(alertedDishIds).toContain(String(missingPrice._id));
    expect(alertedDishIds).toContain(String(lowMargin._id));
    expect(alertedDishIds).toContain(String(slowMover._id));
  });

  it("returns an empty report for an account without dishes", async () => {
    const account = await createAccount();

    const report = await buildPricingAlertsReport(account.user);

    expect(report.alerts).toEqual([]);
    expect(report.counts).toEqual({ critical: 0, warning: 0, info: 0 });
    expect(report.totalSoldQuantity).toBe(0);
    expect(typeof report.generatedAt).toBe("string");
  });

  it("does not alert on a well priced dish", async () => {
    const account = await createAccount();
    const ingredient = await seedIngredient(account.user, { name: "Saine", purchasePrice: 2 });
    // Vendu 3.3 TTC -> 3 HT, cout 1 : marge reelle 0.667 >= 0.45, gap positif.
    const healthy = await seedDish(account.user, ingredient, {
      name: "Plat sain",
      targetMarginRate: 0.5,
      actualPriceIncludingTax: 3.3
    });
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await seedSale(account.user, healthy, { serviceDate: yesterday, quantity: 10 });

    const report = await buildPricingAlertsReport(account.user);

    expect(report.alerts.map((alert) => alert.dishId)).not.toContain(String(healthy._id));
  });
});
