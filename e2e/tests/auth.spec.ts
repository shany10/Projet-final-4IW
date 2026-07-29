import { expect, test } from "@playwright/test";
import { createAccount, uniqueEmail, useSession } from "../helpers/accounts";
import { expectToast, waitForHydration } from "../helpers/ui";

// Parcours authentification complet : UI -> BFF Nuxt -> Express -> argon2/JWT
// -> cookie auth_token. Les guards de navigation sont testes sans session.

test.describe("authentification", () => {
  test("inscription puis connexion jusqu'au dashboard", async ({ page }) => {
    const email = uniqueEmail("register");
    const password = "Password123!";

    await page.goto("/register");
    await waitForHydration(page);
    await page.getByLabel("Prenom").fill("Jean");
    await page.getByLabel("Nom", { exact: true }).fill("Dupont");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Mot de passe").fill(password);
    await page.getByRole("button", { name: "Creer le compte" }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expectToast(page, "Compte cree");

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Mot de passe").fill(password);
    await page.getByRole("button", { name: "Se connecter" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Bonjour Jean" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Plats" }).first()).toBeVisible();
  });

  test("mot de passe errone : erreur generique sans session", async ({ page }) => {
    const account = await createAccount();

    await page.goto("/login");
    await waitForHydration(page);
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Mot de passe").fill("MauvaisMdp123!");
    await page.getByRole("button", { name: "Se connecter" }).click();

    await expect(page.getByText("Invalid email or password").first()).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("guard : une page metier sans session redirige vers /login", async ({ page }) => {
    await page.goto("/dishes");

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Connexion a ton compte" })).toBeVisible();
  });

  test("deconnexion depuis la page compte", async ({ page, context }) => {
    const account = await createAccount({ firstname: "Sortant" });
    await useSession(context, account);

    await page.goto("/account");
    await waitForHydration(page);
    await page.getByRole("button", { name: "Se deconnecter" }).click();

    await expect(page).toHaveURL(/\/login/);
    await expectToast(page, "Session fermee");
  });
});
