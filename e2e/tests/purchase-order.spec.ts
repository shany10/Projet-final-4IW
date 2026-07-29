import { expect, test } from "@playwright/test";
import { createAccount, seedIngredient, seedSupplier, useSession } from "../helpers/accounts";
import { expectToast, gotoViaSidebar } from "../helpers/ui";

// Cycle achat fournisseur complet : prevision de reappro -> panier ->
// validation -> paiement carte (ecrans processing/success) -> commande Payee
// -> reception -> stock mis a jour. L'ingredient est seede en stock bas
// (stock 1 < seuil 2, conso 1/jour) pour declencher la recommandation.

test.describe("cycle achat fournisseur", () => {
  test("commander, payer par carte puis receptionner", async ({ page, context }) => {
    const account = await createAccount();
    const supplier = await seedSupplier(account, {
      name: "Primeur Bio",
      email: "primeur@e2e.local",
      deliveryFee: 10
    });
    await seedIngredient(account, {
      name: "Tomate",
      supplier: supplier._id,
      purchasePrice: 2,
      stockQuantity: 1,
      minimumStock: 2,
      averageDailyUsage: 1,
      minimumOrderQuantity: 1
    });
    await useSession(context, account);

    await gotoViaSidebar(page, "Achats");
    await page.getByRole("link", { name: "Nouvel achat" }).click();

    // Etape prevision : la page n'affiche que des compteurs (pas les noms) ;
    // attendre que la reco de l'ingredient en stock bas soit calculee avant
    // de remplir le panier, sinon 0 ligne est ajoutee.
    await expect(page.getByText("1 sous le seuil")).toBeVisible();
    await page.getByRole("button", { name: "Commander les quantites recommandees" }).click();
    await expectToast(page, "Panier mis a jour");

    await page.getByRole("button", { name: "Passer a la validation" }).click();
    await page.getByRole("button", { name: "Valider la commande" }).click();
    await expectToast(page, "Commande validee");

    // La redirection ?pay=<id> ouvre la modale de paiement automatiquement.
    await expect(page.getByRole("heading", { name: /^Payer / })).toBeVisible();
    await page.getByPlaceholder("Titulaire de la carte").fill("Jean Test");
    await page.getByPlaceholder("Numero de carte").fill("4242 4242 4242 4242");
    await page.getByPlaceholder("MM/AA").fill("12/30");
    await page.getByPlaceholder("CVV").fill("123");
    await page.getByRole("button", { name: /^Payer \d/ }).click();

    await expect(page.getByText("Paiement en cours...")).toBeVisible();
    await expect(page.getByText("Paiement accepte")).toBeVisible();
    await expectToast(page, "Paiement carte accepte");

    // Les libelles de statut existent aussi en <option> cachees du filtre :
    // on assert sur la carte de commande, pas sur la page entiere.
    const orderCard = page.locator("article").filter({ hasText: "Primeur Bio" });
    await expect(orderCard.getByText("Payee", { exact: true })).toBeVisible();

    await orderCard.getByRole("button", { name: "Receptionner" }).click();
    await page.getByRole("button", { name: "Confirmer la reception" }).click();
    await expectToast(page, "Commande receptionnee");
    // La reception passe la commande en "delivered" -> badge Livree.
    await expect(orderCard.getByText("Livree", { exact: true })).toBeVisible();
    await expect(orderCard.getByText(/stock mis a jour/)).toBeVisible();
  });
});
