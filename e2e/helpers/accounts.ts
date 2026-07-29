import { request, type BrowserContext } from "@playwright/test";

export const BACKEND_URL = "http://localhost:3000";
export const FRONTEND_URL = "http://localhost:3001";

export type Account = {
  id: string;
  token: string;
  email: string;
  password: string;
  firstname: string;
  lastname: string;
};

let counter = 0;

// Email unique par process worker : les specs tournent en parallele.
export function uniqueEmail(prefix: string): string {
  counter += 1;
  return `${prefix}-${process.pid}-${Date.now()}-${counter}@e2e.local`;
}

type AccountOptions = {
  firstname?: string;
  lastname?: string;
  email?: string;
  password?: string;
};

// Compte manager frais cree via l'API backend (register puis auth) : chaque
// spec isole ses donnees par owner, sans dependre d'un seed prealable.
export async function createAccount(options: AccountOptions = {}): Promise<Account> {
  const firstname = options.firstname ?? "Test";
  const lastname = options.lastname ?? "User";
  const email = options.email ?? uniqueEmail("manager");
  const password = options.password ?? "Password123!";

  const api = await request.newContext({ baseURL: BACKEND_URL });
  try {
    const registerRes = await api.post("/user/register", {
      data: { firstname, lastname, email, password }
    });
    if (!registerRes.ok()) {
      throw new Error(`register failed: ${registerRes.status()} ${await registerRes.text()}`);
    }

    const authRes = await api.post("/user/auth", { data: { email, password } });
    if (!authRes.ok()) {
      throw new Error(`auth failed: ${authRes.status()} ${await authRes.text()}`);
    }
    const auth = (await authRes.json()) as { token: string; id: string };
    return { id: auth.id, token: auth.token, email, password, firstname, lastname };
  } finally {
    await api.dispose();
  }
}

// Le cookie auth_token n'est pas httpOnly : on ouvre une session navigateur
// sans repasser par le formulaire de login (les specs auth le testent, elles).
export async function useSession(context: BrowserContext, account: Account): Promise<void> {
  await context.addCookies([{ name: "auth_token", value: account.token, url: FRONTEND_URL }]);
}

type Json = Record<string, unknown>;

async function backendPost<T>(token: string, path: string, data: Json): Promise<T> {
  const api = await request.newContext({
    baseURL: BACKEND_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` }
  });
  try {
    const res = await api.post(path, { data });
    if (!res.ok()) {
      throw new Error(`POST ${path} failed: ${res.status()} ${await res.text()}`);
    }
    return (await res.json()) as T;
  } finally {
    await api.dispose();
  }
}

export type SeededDoc = { _id: string; name: string };

export async function seedSupplier(account: Account, overrides: Json = {}): Promise<SeededDoc> {
  return backendPost(account.token, "/suppliers", {
    name: "Fournisseur Test",
    email: "supplier@e2e.local",
    contactName: "Contact Test",
    deliveryLeadTimeDays: 2,
    deliveryFee: 10,
    ...overrides
  });
}

export async function seedIngredient(account: Account, overrides: Json = {}): Promise<SeededDoc> {
  return backendPost(account.token, "/ingredients", {
    name: "Farine",
    unit: "kg",
    purchasePrice: 2,
    stockQuantity: 10,
    minimumStock: 2,
    averageDailyUsage: 1,
    minimumOrderQuantity: 1,
    ...overrides
  });
}

export async function seedDish(account: Account, ingredientId: string, overrides: Json = {}): Promise<SeededDoc> {
  return backendPost(account.token, "/dishes", {
    name: "Plat Test",
    category: "Plat",
    ingredients: [{ ingredient: ingredientId, quantity: 0.5, unit: "kg" }],
    targetMarginRate: 0.5,
    actualPriceIncludingTax: 11,
    ...overrides
  });
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function seedSale(
  account: Account,
  dishId: string,
  options: { serviceDate?: string; quantity?: number; unitPrice?: number } = {}
): Promise<{ _id: string }> {
  const item: Json = { dish: dishId, quantity: options.quantity ?? 2 };
  if (options.unitPrice !== undefined) item.unitPrice = options.unitPrice;
  return backendPost(account.token, "/sales", {
    serviceDate: options.serviceDate ?? isoDate(new Date()),
    items: [item]
  });
}
