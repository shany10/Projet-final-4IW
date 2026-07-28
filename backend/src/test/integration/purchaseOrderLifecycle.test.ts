import request from "supertest";
import { IngredientModel, PaymentCardModel } from "../../models";
import { createTestApp } from "./helpers/appFactory";
import { authHeader, createAccount } from "./helpers/auth";
import { startDb, stopDb } from "./helpers/db";
import { seedIngredient, seedSupplier } from "./helpers/seed";

// Cycle de vie complet des commandes fournisseur : couvre la logique inline
// non exportee du router (totaux, score, reception, paiements).

const app = createTestApp();
const FUTURE_YEAR = new Date().getFullYear() + 2;

let account: Awaited<ReturnType<typeof createAccount>>;

// Fournisseur sans email : les notifications sont ignorees (sent/failed vides),
// les assertions restent deterministes.
async function seedOrderContext(ingredientOverrides: Record<string, unknown> = {}) {
  const supplier = await seedSupplier(account.user, { name: `Fournisseur ${Date.now()}`, email: "" });
  const ingredient = await seedIngredient(account.user, {
    name: `Ingredient ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    supplier: supplier._id,
    ...ingredientOverrides
  });
  return { supplier, ingredient };
}

type OrderResponse = {
  _id: string;
  status: string;
  validatedAt: string | null;
  orderNumber: string;
  deliveryFee: number;
  totalExclTax: number;
  vatAmount: number;
  totalInclTax: number;
  totalAmount: number;
  managementScoreDelta: number;
  badges: string[];
  vatRate: number;
  notes: string;
  items: Array<Record<string, unknown>>;
};

async function createOrder(payload: Record<string, unknown>): Promise<OrderResponse> {
  const res = await request(app)
    .post("/purchase-orders")
    .set(authHeader(account.token))
    .send(payload);
  expect(res.status).toBe(201);
  return res.body as OrderResponse;
}

beforeAll(async () => {
  await startDb();
  account = await createAccount();
});

afterAll(stopDb);

describe("POST /purchase-orders", () => {
  it("computes totals, remaps validated to pending_payment and scores a perfect cart at 110", async () => {
    // Ingredient critique : stock 1 <= seuil 2, reco = ceil(1*7 + 2 - 1) = 8.
    const { supplier, ingredient } = await seedOrderContext({
      stockQuantity: 1,
      minimumStock: 2,
      averageDailyUsage: 1,
      minimumOrderQuantity: 1
    });

    const order = await createOrder({
      supplier: String(supplier._id),
      status: "validated",
      items: [{ ingredient: String(ingredient._id), quantity: 8, unit: "kg", unitPrice: 1 }]
    });

    expect(order.status).toBe("pending_payment");
    expect(order.validatedAt).toBeTruthy();
    expect(order.orderNumber).toMatch(/^CMD-\d{8}-[A-Z0-9]{5}$/);

    // itemsTotal 8 -> +livraison 10 = 18 HT -> TVA 10% = 1.8 -> 19.8 TTC.
    expect(order.deliveryFee).toBe(10);
    expect(order.totalExclTax).toBe(18);
    expect(order.vatAmount).toBe(1.8);
    expect(order.totalInclTax).toBe(19.8);
    expect(order.totalAmount).toBe(19.8);

    // Reco suivie (+10), stock critique couvert (+50), budget respecte
    // (19.8 <= (8*1+10)*1.15) (+30), pas de surcommande (+20) = 110.
    expect(order.managementScoreDelta).toBe(110);
    expect(order.badges).toEqual([
      "Prevision 7 jours utilisee",
      "Zero rupture",
      "Budget respecte",
      "Stock maitrise"
    ]);

    expect(order.items[0]?.recommendedQuantity).toBe(8);
    expect(order.items[0]?.lineTotal).toBe(8);
  });

  it("penalizes an oversized cart (-10 instead of +20)", async () => {
    const { supplier, ingredient } = await seedOrderContext({
      stockQuantity: 1,
      minimumStock: 2,
      averageDailyUsage: 1,
      minimumOrderQuantity: 1
    });

    // 15 > reco 8 * 1.75 : surcommande. Reco non suivie, budget depasse.
    const order = await createOrder({
      supplier: String(supplier._id),
      items: [{ ingredient: String(ingredient._id), quantity: 15, unit: "kg", unitPrice: 1 }]
    });

    // coversCriticalStock (+50) puis exceedsNeeds (-10) = 40.
    expect(order.managementScoreDelta).toBe(40);
    expect(order.badges).toEqual(["Zero rupture"]);
  });
});

describe("PATCH /purchase-orders/:id/status", () => {
  it("never persists validated: it becomes pending_payment with validatedAt", async () => {
    const { supplier, ingredient } = await seedOrderContext();
    const order = await createOrder({
      supplier: String(supplier._id),
      items: [{ ingredient: String(ingredient._id), quantity: 2, unit: "kg", unitPrice: 3 }]
    });

    const res = await request(app)
      .patch(`/purchase-orders/${order._id}/status`)
      .set(authHeader(account.token))
      .send({ status: "validated" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending_payment");
    expect(res.body.validatedAt).toBeTruthy();
  });

  it("has no transition guard: cancelled can go back to draft (documented)", async () => {
    const { supplier, ingredient } = await seedOrderContext();
    const order = await createOrder({
      supplier: String(supplier._id),
      items: [{ ingredient: String(ingredient._id), quantity: 2, unit: "kg", unitPrice: 3 }]
    });

    await request(app)
      .patch(`/purchase-orders/${order._id}/status`)
      .set(authHeader(account.token))
      .send({ status: "cancelled" });
    const revived = await request(app)
      .patch(`/purchase-orders/${order._id}/status`)
      .set(authHeader(account.token))
      .send({ status: "draft" });

    expect(revived.status).toBe(200);
    expect(revived.body.status).toBe("draft");
  });
});

describe("POST /purchase-orders/:id/receive", () => {
  it("increments the stock, marks delivered, and is idempotent (400 on replay)", async () => {
    const { supplier, ingredient } = await seedOrderContext({ stockQuantity: 1 });
    const order = await createOrder({
      supplier: String(supplier._id),
      items: [{ ingredient: String(ingredient._id), quantity: 8, unit: "kg", unitPrice: 1 }]
    });

    // Express 5 : body absent -> 400 Zod, le corps {} est obligatoire.
    const received = await request(app)
      .post(`/purchase-orders/${order._id}/receive`)
      .set(authHeader(account.token))
      .send({});

    expect(received.status).toBe(200);
    expect(received.body.ok).toBe(true);
    expect(received.body.updatedIngredients).toBe(1);
    expect(received.body.order.status).toBe("delivered");
    expect(received.body.order.receivedAt).toBeTruthy();

    const stock = await IngredientModel.findById(ingredient._id).exec();
    expect(stock?.stockQuantity).toBe(9);

    const replay = await request(app)
      .post(`/purchase-orders/${order._id}/receive`)
      .set(authHeader(account.token))
      .send({});
    expect(replay.status).toBe(400);
    expect(replay.body).toEqual({ error: "Commande deja receptionnee" });

    const stockAfterReplay = await IngredientModel.findById(ingredient._id).exec();
    expect(stockAfterReplay?.stockQuantity).toBe(9);
  });

  it("honors a partial receivedQuantity adjustment", async () => {
    const { supplier, ingredient } = await seedOrderContext({ stockQuantity: 1 });
    const order = await createOrder({
      supplier: String(supplier._id),
      items: [{ ingredient: String(ingredient._id), quantity: 8, unit: "kg", unitPrice: 1 }]
    });

    const received = await request(app)
      .post(`/purchase-orders/${order._id}/receive`)
      .set(authHeader(account.token))
      .send({ items: [{ ingredient: String(ingredient._id), receivedQuantity: 3 }] });

    expect(received.status).toBe(200);
    const stock = await IngredientModel.findById(ingredient._id).exec();
    expect(stock?.stockQuantity).toBe(4);
  });

  it("refuses to receive a cancelled order", async () => {
    const { supplier, ingredient } = await seedOrderContext();
    const order = await createOrder({
      supplier: String(supplier._id),
      items: [{ ingredient: String(ingredient._id), quantity: 2, unit: "kg", unitPrice: 3 }]
    });
    await request(app)
      .patch(`/purchase-orders/${order._id}/status`)
      .set(authHeader(account.token))
      .send({ status: "cancelled" });

    const res = await request(app)
      .post(`/purchase-orders/${order._id}/receive`)
      .set(authHeader(account.token))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Commande annulee, reception impossible" });
  });
});

describe("POST /purchase-orders/:id/payments/card", () => {
  async function createPayableOrder() {
    const { supplier, ingredient } = await seedOrderContext();
    return createOrder({
      supplier: String(supplier._id),
      status: "validated",
      items: [{ ingredient: String(ingredient._id), quantity: 2, unit: "kg", unitPrice: 5 }]
    });
  }

  it("rejects a missing card, a bad Luhn and an expired card", async () => {
    const order = await createPayableOrder();

    const missing = await request(app)
      .post(`/purchase-orders/${order._id}/payments/card`)
      .set(authHeader(account.token))
      .send({});
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("Validation failed");

    const badLuhn = await request(app)
      .post(`/purchase-orders/${order._id}/payments/card`)
      .set(authHeader(account.token))
      .send({
        card: {
          holder: "Jean Dupont",
          cardNumber: "4242424242424241",
          expiryMonth: 12,
          expiryYear: FUTURE_YEAR,
          cvv: "123"
        }
      });
    expect(badLuhn.status).toBe(400);
    expect(badLuhn.body).toEqual({ error: "Numero de carte invalide" });

    const expired = await request(app)
      .post(`/purchase-orders/${order._id}/payments/card`)
      .set(authHeader(account.token))
      .send({
        card: {
          holder: "Jean Dupont",
          cardNumber: "4242424242424242",
          expiryMonth: 1,
          expiryYear: new Date().getFullYear() - 1,
          cvv: "123"
        }
      });
    expect(expired.status).toBe(400);
    expect(expired.body).toEqual({ error: "Carte expiree" });
  });

  it("pays with a valid card and saves it once (dedup)", async () => {
    const order = await createPayableOrder();

    const res = await request(app)
      .post(`/purchase-orders/${order._id}/payments/card`)
      .set(authHeader(account.token))
      .send({
        card: {
          holder: "Jean Dupont",
          cardNumber: "4242 4242 4242 4242",
          expiryMonth: 12,
          expiryYear: FUTURE_YEAR,
          cvv: "123"
        },
        saveCard: true
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.sent).toEqual([]);
    expect(res.body.failed).toEqual([]);
    expect(res.body.order.status).toBe("paid");
    expect(res.body.order.paymentMethod).toBe("card");
    expect(res.body.order.paymentReference).toBe(`CB-${res.body.order.orderNumber}`);
    expect(res.body.order.paymentCardBrand).toBe("visa");
    expect(res.body.order.paymentCardLast4).toBe("4242");
    expect(res.body.order.paidAt).toBeTruthy();

    // saveCard une 2e fois avec la meme carte -> pas de doublon.
    const secondOrder = await createPayableOrder();
    await request(app)
      .post(`/purchase-orders/${secondOrder._id}/payments/card`)
      .set(authHeader(account.token))
      .send({
        card: {
          holder: "Jean Dupont",
          cardNumber: "4242424242424242",
          expiryMonth: 12,
          expiryYear: FUTURE_YEAR,
          cvv: "123"
        },
        saveCard: true
      });

    const cards = await PaymentCardModel.find({ owner: account.user._id }).exec();
    expect(cards).toHaveLength(1);
  });

  it("refuses to pay a cancelled order with a 409", async () => {
    const order = await createPayableOrder();
    await request(app)
      .patch(`/purchase-orders/${order._id}/status`)
      .set(authHeader(account.token))
      .send({ status: "cancelled" });

    const res = await request(app)
      .post(`/purchase-orders/${order._id}/payments/card`)
      .set(authHeader(account.token))
      .send({
        card: {
          holder: "Jean Dupont",
          cardNumber: "4242424242424242",
          expiryMonth: 12,
          expiryYear: FUTURE_YEAR,
          cvv: "123"
        }
      });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Cancelled order cannot be paid" });
  });
});

describe("POST /purchase-orders/:id/payments/bank-transfer", () => {
  async function createPayableOrder() {
    const { supplier, ingredient } = await seedOrderContext();
    return createOrder({
      supplier: String(supplier._id),
      items: [{ ingredient: String(ingredient._id), quantity: 2, unit: "kg", unitPrice: 5 }]
    });
  }

  it("validates the iban and the bic at the schema level", async () => {
    const order = await createPayableOrder();

    const badIban = await request(app)
      .post(`/purchase-orders/${order._id}/payments/bank-transfer`)
      .set(authHeader(account.token))
      .send({ accountHolder: "Jean Dupont", iban: "XX123" });
    expect(badIban.status).toBe(400);
    expect(badIban.body.error).toBe("Validation failed");

    const badBic = await request(app)
      .post(`/purchase-orders/${order._id}/payments/bank-transfer`)
      .set(authHeader(account.token))
      .send({ accountHolder: "Jean Dupont", iban: "FR7630006000011234567890189", bic: "ABC" });
    expect(badBic.status).toBe(400);
  });

  it("pays with a valid iban and falls back to a VIR- reference", async () => {
    const order = await createPayableOrder();

    const res = await request(app)
      .post(`/purchase-orders/${order._id}/payments/bank-transfer`)
      .set(authHeader(account.token))
      .send({
        accountHolder: "Jean Dupont",
        iban: "FR76 3000 6000 0112 3456 7890 189",
        reference: "  "
      });

    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe("paid");
    expect(res.body.order.paymentMethod).toBe("bank_transfer");
    expect(res.body.order.paymentReference).toBe(`VIR-${res.body.order.orderNumber}`);
    expect(res.body.order.paymentIbanLast4).toBe("0189");
  });
});

describe("GET /purchase-orders/rewards", () => {
  it("returns the empty defaults on a fresh account", async () => {
    const fresh = await createAccount();

    const res = await request(app).get("/purchase-orders/rewards").set(authHeader(fresh.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      score: 0,
      level: "Gestion debutante",
      levelProgress: 0,
      badges: [],
      tips: [
        "Les seuils de stock sont bien couverts.",
        "Valide une premiere commande fournisseur pour debloquer les badges achats."
      ],
      lowStockCount: 0,
      paidOrderCount: 0
    });
  });

  it("aggregates score deltas and account badges after a perfect order", async () => {
    const fresh = await createAccount();
    const supplier = await seedSupplier(fresh.user, { email: "" });
    const ingredient = await seedIngredient(fresh.user, {
      name: "Critique",
      supplier: supplier._id,
      stockQuantity: 1,
      minimumStock: 2,
      averageDailyUsage: 1,
      minimumOrderQuantity: 1
    });

    const created = await request(app)
      .post("/purchase-orders")
      .set(authHeader(fresh.token))
      .send({
        supplier: String(supplier._id),
        items: [{ ingredient: String(ingredient._id), quantity: 8, unit: "kg", unitPrice: 1 }]
      });
    expect(created.status).toBe(201);

    const res = await request(app).get("/purchase-orders/rewards").set(authHeader(fresh.token));

    // Delta 110 + 2 badges de compte ("Premier reapprovisionnement",
    // "Prevision 7 jours utilisee") x 25 = 160 -> palier "Gestion maitrisee".
    expect(res.body.score).toBe(160);
    expect(res.body.level).toBe("Gestion maitrisee");
    expect(res.body.levelProgress).toBe(60);
    expect([...res.body.badges].sort()).toEqual([
      "Premier reapprovisionnement",
      "Prevision 7 jours utilisee"
    ]);
    expect(res.body.lowStockCount).toBe(1);
    expect(res.body.paidOrderCount).toBe(0);
  });
});

describe("PATCH /purchase-orders/:id with an empty body (documented Zod v4 behavior)", () => {
  it("re-injects the schema defaults and silently resets the order", async () => {
    const { supplier, ingredient } = await seedOrderContext();
    const order = await createOrder({
      supplier: String(supplier._id),
      status: "validated",
      notes: "Note importante",
      items: [{ ingredient: String(ingredient._id), quantity: 2, unit: "kg", unitPrice: 3 }]
    });
    expect(order.status).toBe("pending_payment");

    // .partial() conserve les .default() en Zod v4 : un PATCH {} ecrase
    // status, vatRate et les champs texte avec leurs valeurs par defaut.
    const res = await request(app)
      .patch(`/purchase-orders/${order._id}`)
      .set(authHeader(account.token))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("draft");
    expect(res.body.vatRate).toBe(0.1);
    expect(res.body.notes).toBe("");
  });
});
