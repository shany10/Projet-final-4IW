import { expect, test } from "@playwright/test";
import { FRONTEND_URL, uniqueEmail } from "../helpers/accounts";
import { expectToast, waitForHydration } from "../helpers/ui";

// Panel admin : login du compte bootstrap, creation d'un manager, suspension
// (le compte suspendu ne peut plus se connecter), puis reactivation.

const ADMIN_EMAIL = "admin@eatplanner.local";
const ADMIN_PASSWORD = "Admin123!";

test.describe("panel admin", () => {
  test("creer, suspendre puis reactiver un manager", async ({ page, browser }) => {
    await page.goto("/login");
    await waitForHydration(page);
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Mot de passe").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Se connecter" }).click();

    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByRole("heading", { name: "Panel admin" })).toBeVisible();

    const managerEmail = uniqueEmail("manager-admin");
    const managerPassword = "Password123!";
    const createForm = page.locator("#create-manager");
    await createForm.getByPlaceholder("Prenom").fill("Marie");
    await createForm.getByPlaceholder("Nom", { exact: true }).fill("Martin");
    await createForm.getByPlaceholder("email@restaurant.com").fill(managerEmail);
    await createForm.getByPlaceholder("Mot de passe initial").fill(managerPassword);
    await createForm.getByRole("button", { name: "Creer le manager" }).click();
    await expectToast(page, "Manager cree");

    const managerRow = page.locator("tr").filter({ hasText: managerEmail });
    await expect(managerRow).toBeVisible();

    await managerRow.getByRole("button", { name: "Suspendre" }).click();
    await expectToast(page, "Utilisateur desactive");
    await expect(managerRow.getByText("Suspendu")).toBeVisible();

    // Le compte suspendu ne peut plus ouvrir de session.
    const suspendedContext = await browser.newContext();
    const suspendedPage = await suspendedContext.newPage();
    await suspendedPage.goto(`${FRONTEND_URL}/login`);
    await waitForHydration(suspendedPage);
    await suspendedPage.getByLabel("Email").fill(managerEmail);
    await suspendedPage.getByLabel("Mot de passe").fill(managerPassword);
    await suspendedPage.getByRole("button", { name: "Se connecter" }).click();
    await expect(
      suspendedPage.getByText("Account disabled. Contact administrator.").first()
    ).toBeVisible();
    await suspendedContext.close();

    await managerRow.getByRole("button", { name: "Activer" }).click();
    await expectToast(page, "Utilisateur reactive");
    await expect(managerRow.getByText("Actif", { exact: true })).toBeVisible();

    // Reactive : la connexion aboutit au dashboard.
    const restoredContext = await browser.newContext();
    const restoredPage = await restoredContext.newPage();
    await restoredPage.goto(`${FRONTEND_URL}/login`);
    await waitForHydration(restoredPage);
    await restoredPage.getByLabel("Email").fill(managerEmail);
    await restoredPage.getByLabel("Mot de passe").fill(managerPassword);
    await restoredPage.getByRole("button", { name: "Se connecter" }).click();
    await expect(
      restoredPage.getByRole("heading", { level: 1, name: "Bonjour Marie" })
    ).toBeVisible();
    await restoredContext.close();
  });
});
