import {
  buildDishProfitabilitySnapshot,
  convertQuantity,
  normalizeChargeToDaily
} from "../../../services/profitabilityService";
import { BUSINESS_UNITS } from "../../../types/business";
import {
  makeCharge,
  makeDish,
  makeDishLine,
  makeIngredient,
  makeIngredientMap
} from "../helpers/fixtures";

describe("convertQuantity", () => {
  it.each(BUSINESS_UNITS)("returns the quantity unchanged for %s to itself", (unit) => {
    expect(convertQuantity(5, unit, unit)).toBe(5);
  });

  it("converts mass units", () => {
    expect(convertQuantity(2, "kg", "g")).toBe(2000);
    expect(convertQuantity(500, "g", "kg")).toBe(0.5);
    expect(convertQuantity(0.25, "kg", "g")).toBe(250);
  });

  it("converts volume units", () => {
    expect(convertQuantity(1, "l", "ml")).toBe(1000);
    expect(convertQuantity(2, "l", "cl")).toBe(200);
    expect(convertQuantity(3, "cl", "ml")).toBe(30);
    expect(convertQuantity(1500, "ml", "l")).toBe(1.5);
    expect(convertQuantity(25, "ml", "cl")).toBe(2.5);
  });

  it("throws on cross family conversions with an explicit message", () => {
    expect(() => convertQuantity(1, "g", "l")).toThrow("Incompatible unit conversion from g to l");
    expect(() => convertQuantity(1, "kg", "piece")).toThrow("Incompatible unit conversion from kg to piece");
    expect(() => convertQuantity(1, "piece", "g")).toThrow("Incompatible unit conversion from piece to g");
    expect(() => convertQuantity(1, "carton", "sac")).toThrow("Incompatible unit conversion from carton to sac");
    expect(() => convertQuantity(1, "bouteille", "boite")).toThrow("Incompatible unit conversion from bouteille to boite");
    expect(() => convertQuantity(1, "g", "carton")).toThrow("Incompatible unit conversion from g to carton");
  });
});

describe("normalizeChargeToDaily", () => {
  it("keeps daily charges unchanged", () => {
    expect(normalizeChargeToDaily(makeCharge("daily", 42))).toBe(42);
  });

  it("divides monthly charges by 30", () => {
    expect(normalizeChargeToDaily(makeCharge("monthly", 900))).toBe(30);
    expect(normalizeChargeToDaily(makeCharge("monthly", 100))).toBeCloseTo(100 / 30, 10);
  });
});

describe("buildDishProfitabilitySnapshot", () => {
  const accountSettings = {
    targetMarginRate: 0.72,
    marginSource: "account" as const,
    vatRate: 0.1
  };

  function buildReferenceContext() {
    const flour = makeIngredient({ name: "Farine", unit: "kg", purchasePrice: 10 });
    const milk = makeIngredient({ name: "Lait", unit: "l", purchasePrice: 2 });
    const dish = makeDish({
      ingredients: [makeDishLine(flour, 200, "g"), makeDishLine(milk, 50, "cl")]
    });
    return { dish, ingredientMap: makeIngredientMap(flour, milk) };
  }

  it("computes food cost, charge cost and suggested prices on a known recipe", () => {
    const { dish, ingredientMap } = buildReferenceContext();

    const snapshot = buildDishProfitabilitySnapshot(dish, ingredientMap, 0.5, accountSettings);

    // 200 g a 10 EUR/kg = 2 ; 50 cl a 2 EUR/l = 1
    expect(snapshot.foodCost).toBe(3);
    expect(snapshot.chargeCost).toBe(0.5);
    expect(snapshot.totalCost).toBe(3.5);
    // HT = 3.5 / (1 - 0.72) = 12.5
    expect(snapshot.suggestedPriceExcludingTax).toBe(12.5);
    expect(snapshot.suggestedVatAmount).toBe(1.25);
    expect(snapshot.suggestedPriceIncludingTax).toBe(13.75);
    expect(snapshot.suggestedPrice).toBe(13.75);
    expect(snapshot.expectedMarginAmount).toBe(9);
    expect(snapshot.effectiveMarginRate).toBe(0.72);
    expect(snapshot.marginSource).toBe("account");
    expect(snapshot.vatRate).toBe(0.1);
    expect(snapshot.targetMarginRate).toBeNull();

    expect(snapshot.lines).toHaveLength(2);
    expect(snapshot.lines[0]).toEqual(expect.objectContaining({
      ingredientName: "Farine",
      recipeQuantity: 200,
      recipeUnit: "g",
      purchaseUnit: "kg",
      unitCost: 10,
      lineCost: 2
    }));
    expect(snapshot.lines[1]).toEqual(expect.objectContaining({
      ingredientName: "Lait",
      recipeQuantity: 50,
      recipeUnit: "cl",
      purchaseUnit: "l",
      unitCost: 2,
      lineCost: 1
    }));
  });

  it("zeroes the actual price fields when no actual price is set", () => {
    const { dish, ingredientMap } = buildReferenceContext();

    const snapshot = buildDishProfitabilitySnapshot(dish, ingredientMap, 0.5, accountSettings);

    expect(snapshot.actualPriceIncludingTax).toBe(0);
    expect(snapshot.actualPriceExcludingTax).toBe(0);
    expect(snapshot.actualVatAmount).toBe(0);
    expect(snapshot.priceGapIncludingTax).toBe(0);
    expect(snapshot.priceGapRate).toBe(0);
    expect(snapshot.expectedGrossProfit).toBe(snapshot.expectedMarginAmount);
  });

  it("derives the actual price excluding tax with a reverse VAT computation", () => {
    const flour = makeIngredient({ name: "Farine", unit: "kg", purchasePrice: 10 });
    const milk = makeIngredient({ name: "Lait", unit: "l", purchasePrice: 2 });
    const dish = makeDish({
      actualPriceIncludingTax: 16.5,
      ingredients: [makeDishLine(flour, 200, "g"), makeDishLine(milk, 50, "cl")]
    });

    const snapshot = buildDishProfitabilitySnapshot(dish, makeIngredientMap(flour, milk), 0.5, accountSettings);

    // 16.5 TTC a 10% de TVA -> 15 HT
    expect(snapshot.actualPriceExcludingTax).toBe(15);
    expect(snapshot.actualVatAmount).toBe(1.5);
    expect(snapshot.priceGapIncludingTax).toBe(2.75);
    expect(snapshot.priceGapRate).toBe(0.2);
    expect(snapshot.expectedGrossProfit).toBe(11.5);
  });

  it("caps the denominator at 0.05 for margins of 0.95 and above", () => {
    const dish = makeDish();

    const snapshot = buildDishProfitabilitySnapshot(dish, new Map(), 3.5, {
      targetMarginRate: 0.95,
      marginSource: "dish",
      vatRate: 0.1
    });

    expect(snapshot.totalCost).toBe(3.5);
    expect(snapshot.suggestedPriceExcludingTax).toBe(70);
  });

  it("silently skips recipe lines whose ingredient is missing from the map", () => {
    const flour = makeIngredient({ name: "Farine", unit: "kg", purchasePrice: 10 });
    const missing = makeIngredient({ name: "Inconnu", unit: "kg", purchasePrice: 99 });
    const dish = makeDish({
      ingredients: [makeDishLine(flour, 200, "g"), makeDishLine(missing, 1, "kg")]
    });

    const snapshot = buildDishProfitabilitySnapshot(dish, makeIngredientMap(flour), 0, accountSettings);

    expect(snapshot.lines).toHaveLength(1);
    expect(snapshot.foodCost).toBe(2);
  });

  it("propagates the conversion error on incompatible recipe units", () => {
    const oil = makeIngredient({ name: "Huile", unit: "l", purchasePrice: 5 });
    const dish = makeDish({ ingredients: [makeDishLine(oil, 100, "g")] });

    expect(() => buildDishProfitabilitySnapshot(dish, makeIngredientMap(oil), 0, accountSettings))
      .toThrow("Incompatible unit conversion from g to l");
  });

  describe("default pricing settings resolution", () => {
    it("uses the dish margin when defined", () => {
      const dish = makeDish({ targetMarginRate: 0.6 });

      const snapshot = buildDishProfitabilitySnapshot(dish, new Map(), 1);

      expect(snapshot.marginSource).toBe("dish");
      expect(snapshot.effectiveMarginRate).toBe(0.6);
      expect(snapshot.vatRate).toBe(0.1);
      expect(snapshot.targetMarginRate).toBe(0.6);
      // HT = 1 / (1 - 0.6) = 2.5
      expect(snapshot.suggestedPriceExcludingTax).toBe(2.5);
    });

    it("falls back to the system margin of 0.72 without dish or account margin", () => {
      const dish = makeDish({ targetMarginRate: null });

      const snapshot = buildDishProfitabilitySnapshot(dish, new Map(), 1);

      expect(snapshot.marginSource).toBe("system");
      expect(snapshot.effectiveMarginRate).toBe(0.72);
      expect(snapshot.suggestedPriceExcludingTax).toBe(3.57);
    });

    it("clamps the effective margin at 0.95 but reports the raw dish margin", () => {
      const dish = makeDish({ targetMarginRate: 0.99 });

      const snapshot = buildDishProfitabilitySnapshot(dish, new Map(), 1);

      expect(snapshot.effectiveMarginRate).toBe(0.95);
      expect(snapshot.targetMarginRate).toBe(0.99);
      expect(snapshot.suggestedPriceExcludingTax).toBe(20);
    });
  });

  it("prices an empty recipe from the charge cost alone", () => {
    const dish = makeDish();

    const snapshot = buildDishProfitabilitySnapshot(dish, new Map(), 2, accountSettings);

    expect(snapshot.foodCost).toBe(0);
    expect(snapshot.lines).toHaveLength(0);
    expect(snapshot.totalCost).toBe(2);
    // HT = 2 / 0.28 = 7.142857... arrondi a 7.14
    expect(snapshot.suggestedPriceExcludingTax).toBe(7.14);
  });
});
