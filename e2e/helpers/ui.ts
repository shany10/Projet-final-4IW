import { expect, type Page } from "@playwright/test";

// Les toasts Nuxt UI n'exposent pas de role stable : on cible leur titre
// (textes ASCII uniques dans l'app). Duree 3.8 s (6.5 s pour les erreurs).
export async function expectToast(page: Page, title: string): Promise<void> {
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
}

// En dev, le DOM SSR est interactif avant que Vue soit monte : un clic trop
// tot declenche la soumission native du formulaire au lieu du handler.
// On attend que Nuxt ait hydrate la racine avant d'interagir.
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const root = document.querySelector("#__nuxt") as { __vue_app__?: unknown } | null;
    return Boolean(root && root.__vue_app__);
  });
}

// Les pages a middleware "manager" chargent le profil via un $fetch sans
// cookie pendant le SSR : un acces direct par URL retombe sur /login. On
// atterrit donc sur le dashboard puis on navigue cote client via la sidebar,
// comme un utilisateur reel.
export async function gotoViaSidebar(page: Page, linkName: string): Promise<void> {
  await page.goto("/");
  await waitForHydration(page);
  await page.getByRole("link", { name: linkName }).first().click();
}
