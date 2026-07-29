import { expect, test } from "@playwright/test";
import { createAccount, useSession } from "../helpers/accounts";
import { expectToast, gotoViaSidebar } from "../helpers/ui";

// Coeur metier : creation d'un ingredient puis d'un plat via les modales UI,
// et verification du calcul de rentabilite affiche. Cas maitrise :
// 0.5 kg de Farine a 2 EUR/kg = 1 EUR de cout, marge 0.5 -> HT 2,
// TVA 10% -> prix conseille TTC 2.20 EUR.

test.describe("ingredients et plats", () => {
  test("creer un ingredient, un plat, et lire le prix conseille", async ({ page, context }) => {
    const account = await createAccount();
    await useSession(context, account);

    await gotoViaSidebar(page, "Ingredients");
    await page.getByRole("button", { name: /Ajouter un ingr/ }).click();

    const ingredientDialog = page.getByRole("dialog", { name: "Nouvel ingredient" });
    await expect(ingredientDialog).toBeVisible();
    await ingredientDialog.getByPlaceholder("Nom de l ingredient").fill("Farine");
    await ingredientDialog.getByPlaceholder("Prix achat unitaire").fill("2");
    await ingredientDialog.getByRole("button", { name: "Ajouter l ingredient" }).click();

    await expectToast(page, "Ingredient ajoute");
    await expect(page.getByRole("row", { name: /Farine/ })).toBeVisible();

    await page.getByRole("link", { name: "Plats" }).first().click();
    await page.getByRole("button", { name: "Ajouter un plat" }).click();

    const dishDialog = page.getByRole("dialog", { name: "Nouveau plat" });
    await expect(dishDialog).toBeVisible();
    await dishDialog.getByLabel("Nom du plat").fill("Omelette");
    await dishDialog.getByLabel("Cat\u00e9gorie").fill("Plat");
    // Marge en fraction (0.5 = 50%), pas en pourcentage.
    await dishDialog.getByLabel("Marge en %").fill("0.5");

    // Ligne de recette : l'ingredient Farine est deja preselectionne,
    // le champ quantite est le seul number sans id du formulaire.
    await dishDialog.locator("select").nth(0).selectOption({ label: "Farine" });
    await dishDialog.locator('input[type="number"]:not([id])').fill("0.5");
    await dishDialog.locator("select").nth(1).selectOption("kg");

    await dishDialog.getByRole("button", { name: "Ajouter le plat" }).click();

    await expectToast(page, "Plat ajoute");
    const dishRow = page.getByRole("row", { name: /Omelette/ });
    await expect(dishRow).toBeVisible();
    await expect(dishRow.getByText("2.20 \u20ac")).toBeVisible();
  });
});
