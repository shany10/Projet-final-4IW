import { expect, test } from "@playwright/test";
import { createAccount, isoDate, seedDish, seedIngredient, useSession } from "../helpers/accounts";
import { expectToast, gotoViaSidebar } from "../helpers/ui";

// Ventes : saisie d'un ticket via la modale, puis import d'un vrai fichier
// CSV (input file) qui traverse le parseur backend. Le plat seed vaut 11 EUR.

test.describe("ventes", () => {
  test("enregistrer un ticket puis importer un CSV", async ({ page, context }) => {
    const account = await createAccount();
    const ingredient = await seedIngredient(account);
    const dish = await seedDish(account, ingredient._id, {
      name: "Bourguignon",
      actualPriceIncludingTax: 11
    });
    await useSession(context, account);

    await gotoViaSidebar(page, "Ventes");
    await page.getByRole("button", { name: "Ajouter une vente" }).click();

    const saleDialog = page.getByRole("dialog", { name: "Nouveau ticket" });
    await expect(saleDialog).toBeVisible();
    await saleDialog.locator("select").selectOption(dish._id);
    // Le champ quantite est le seul number sans placeholder (le prix en a un).
    await saleDialog.locator('input[type="number"]:not([placeholder])').fill("3");
    await saleDialog.getByRole("button", { name: "Enregistrer la vente" }).click();

    await expectToast(page, "Vente enregistree");
    await expect(page.getByText("33.00 \u20ac").first()).toBeVisible();
    await expect(page.getByText("CA cumule")).toBeVisible();

    // Import CSV : header anglais + date ISO du jour, prix explicite 12.5.
    const csv = `date,dish,quantity,unitprice\n${isoDate(new Date())},Bourguignon,2,12.5`;

    await page.getByRole("button", { name: "Import CSV" }).click();
    const importDialog = page.getByRole("dialog", { name: "Importer des ventes" });
    await expect(importDialog).toBeVisible();
    await importDialog.locator('input[type="file"]').setInputFiles({
      name: "ventes.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf-8")
    });
    await expect(importDialog.getByText(/Fichier pret : ventes.csv/)).toBeVisible();
    await importDialog.getByRole("button", { name: "Importer CSV" }).click();

    await expectToast(page, "Import CSV termine");
    await expect(page.getByText("25.00 \u20ac").first()).toBeVisible();
  });
});
