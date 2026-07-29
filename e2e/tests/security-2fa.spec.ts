import { expect, test } from "@playwright/test";
import { createAccount, useSession } from "../helpers/accounts";
import { generateTotpCode, wrongTotpCode } from "../helpers/totp";
import { expectToast, waitForHydration } from "../helpers/ui";

// 2FA TOTP de bout en bout : initialisation depuis /security (le test lit le
// vrai secret base32 affiche et calcule les codes RFC 6238 lui-meme),
// activation, puis re-login en deux etapes avec un code faux puis le bon.

test.describe("securite 2FA", () => {
  test("activer la 2FA puis se reconnecter avec un code TOTP", async ({ page, context }) => {
    const account = await createAccount({ firstname: "Prudent" });
    await useSession(context, account);

    await page.goto("/security");
    await waitForHydration(page);
    await page.getByRole("button", { name: "Initialiser la 2FA" }).click();

    // Le secret manuel est le seul <p> font-mono text-sm (l'otpauth est en xs).
    const secretLocator = page.locator("p.font-mono.text-sm");
    await expect(secretLocator).toBeVisible();
    const secret = (await secretLocator.innerText()).trim();
    expect(secret.length).toBeGreaterThan(10);

    const activationForm = page.locator("form", {
      has: page.getByRole("button", { name: "Activer la 2FA" })
    });
    await activationForm.locator('input[maxlength="6"]').fill(generateTotpCode(secret));
    // Le bouton (pas le lien d'ancre du meme nom) soumet l'activation.
    await activationForm.getByRole("button", { name: "Activer la 2FA" }).click();
    await expectToast(page, "2FA activee");

    // Nouvelle session : le login local passe par l'etape MFA.
    await context.clearCookies();
    await page.goto("/login");
    await waitForHydration(page);
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Mot de passe").fill(account.password);
    await page.getByRole("button", { name: "Se connecter" }).click();

    await expect(page.getByRole("heading", { name: "Entre ton code a 6 chiffres" })).toBeVisible();

    // Un code faux est refuse sans casser le challenge.
    const goodCode = generateTotpCode(secret);
    await page.getByLabel("Code 2FA").fill(wrongTotpCode(goodCode));
    await page.getByRole("button", { name: "Verifier le code" }).click();
    await expectToast(page, "Code 2FA invalide");

    await page.getByLabel("Code 2FA").fill(generateTotpCode(secret));
    await page.getByRole("button", { name: "Verifier le code" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Bonjour Prudent" })).toBeVisible();
  });
});
