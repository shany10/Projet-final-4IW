import { Types } from "mongoose";
import { buildIngredientNeeds } from "../../../services/purchasePlanningService";
import { makeDish, makeDishLine, makeIngredient, makeIngredientMap } from "../helpers/fixtures";

describe("buildIngredientNeeds", () => {
  it("aggregates one ingredient shared by three dishes with different recipe units", async () => {
    const flour = makeIngredient({ name: "Farine", unit: "kg", purchasePrice: 2 });
    const ingredientMap = makeIngredientMap(flour);

    const needs = await buildIngredientNeeds([
      { dish: makeDish({ ingredients: [makeDishLine(flour, 500, "g")] }), quantity: 2 },
      { dish: makeDish({ ingredients: [makeDishLine(flour, 0.25, "kg")] }), quantity: 1 },
      { dish: makeDish({ ingredients: [makeDishLine(flour, 250, "g")] }), quantity: 4 }
    ], ingredientMap);

    // 0.5 kg x 2 + 0.25 kg + 0.25 kg x 4 = 2.25 kg a 2 EUR/kg
    expect(needs).toEqual([
      {
        ingredientId: String(flour._id),
        ingredientName: "Farine",
        unit: "kg",
        quantity: 2.25,
        estimatedCost: 4.5
      }
    ]);
  });

  it("multiplies the recipe line by the planned dish quantity", async () => {
    const rice = makeIngredient({ name: "Riz", unit: "kg", purchasePrice: 5 });

    const needs = await buildIngredientNeeds([
      { dish: makeDish({ ingredients: [makeDishLine(rice, 2, "kg")] }), quantity: 3 }
    ], makeIngredientMap(rice));

    expect(needs[0]?.quantity).toBe(6);
    expect(needs[0]?.estimatedCost).toBe(30);
  });

  it("rounds at every accumulation step, reusing the already rounded value", async () => {
    const egg = makeIngredient({ name: "Oeuf", unit: "piece", purchasePrice: 1 });
    const plan = { dish: makeDish({ ingredients: [makeDishLine(egg, 0.333, "piece")] }), quantity: 1 };

    const needs = await buildIngredientNeeds([plan, plan, plan], makeIngredientMap(egg));

    // Somme reelle 0.999 mais l'arrondi cumulatif fige 0.33 + 0.333 -> 0.66
    // puis 0.66 + 0.333 -> 0.99 : le drift fait partie du comportement actuel.
    expect(needs[0]?.quantity).toBe(0.99);
    expect(needs[0]?.estimatedCost).toBe(0.99);
  });

  it("silently skips recipe lines whose ingredient is missing from the map", async () => {
    const flour = makeIngredient({ name: "Farine", unit: "kg", purchasePrice: 2 });
    const dish = makeDish({
      ingredients: [
        makeDishLine(flour, 1, "kg"),
        { ingredient: new Types.ObjectId(), quantity: 5, unit: "kg" }
      ]
    });

    const needs = await buildIngredientNeeds([{ dish, quantity: 1 }], makeIngredientMap(flour));

    expect(needs).toHaveLength(1);
    expect(needs[0]?.ingredientName).toBe("Farine");
  });

  it("sorts the result alphabetically by ingredient name", async () => {
    const butter = makeIngredient({ name: "Beurre", unit: "piece", purchasePrice: 1 });
    const apricot = makeIngredient({ name: "Abricot", unit: "piece", purchasePrice: 1 });
    const chocolate = makeIngredient({ name: "Chocolat", unit: "piece", purchasePrice: 1 });
    const dish = makeDish({
      ingredients: [
        makeDishLine(butter, 1, "piece"),
        makeDishLine(apricot, 1, "piece"),
        makeDishLine(chocolate, 1, "piece")
      ]
    });

    const needs = await buildIngredientNeeds(
      [{ dish, quantity: 1 }],
      makeIngredientMap(butter, apricot, chocolate)
    );

    expect(needs.map((need) => need.ingredientName)).toEqual(["Abricot", "Beurre", "Chocolat"]);
  });

  it("returns an empty array for an empty plan list", async () => {
    await expect(buildIngredientNeeds([], new Map())).resolves.toEqual([]);
  });

  it("propagates the conversion error on incompatible units", async () => {
    const oil = makeIngredient({ name: "Huile", unit: "l", purchasePrice: 5 });
    const dish = makeDish({ ingredients: [makeDishLine(oil, 100, "g")] });

    await expect(buildIngredientNeeds([{ dish, quantity: 1 }], makeIngredientMap(oil)))
      .rejects.toThrow("Incompatible unit conversion from g to l");
  });
});
