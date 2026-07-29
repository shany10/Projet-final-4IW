import { expect, test } from "@playwright/test";
import { createAccount, isoDate, seedDish, seedIngredient, seedSale, useSession } from "../helpers/accounts";
import { expectToast, gotoViaSidebar } from "../helpers/ui";

// Previsions de production : calcul depuis l'historique de ventes, validation
// (persistance), puis correction d'une quantite. La colonne Corriger
// n'apparait qu'une fois la prevision sauvegardee.

test.describe("previsions", () => {
  test("calculer, valider puis corriger une prevision", async ({ page, context }) => {
    const account = await createAccount();
    const ingredient = await seedIngredient(account);
    const dish = await seedDish(account, ingredient._id, {
      name: "Curry",
      actualPriceIncludingTax: 10
    });

    // Historique : 3 jours recents a 4 couverts pour nourrir la formule.
    for (let daysAgo = 1; daysAgo <= 3; daysAgo += 1) {
      const day = new Date();
      day.setDate(day.getDate() - daysAgo);
      await seedSale(account, dish._id, { serviceDate: isoDate(day), quantity: 4 });
    }

    await useSession(context, account);
    await gotoViaSidebar(page, "Previsions");

    await page.getByRole("button", { name: "Calculer" }).click();
    await expectToast(page, "Prevision calculee");
    await expect(page.getByText("Quantites a preparer")).toBeVisible();

    const row = page.getByRole("row", { name: /Curry/ });
    await expect(row).toBeVisible();

    await page.getByRole("button", { name: "Valider" }).click();
    await expectToast(page, "Prevision sauvegardee");

    await row.getByLabel("Quantite corrigee").fill("42");
    await row.getByLabel("Sauvegarder la correction").click();
    await expectToast(page, "Correction sauvegardee");
    await expect(row.getByLabel("Quantite corrigee")).toHaveValue("42");
  });
});
