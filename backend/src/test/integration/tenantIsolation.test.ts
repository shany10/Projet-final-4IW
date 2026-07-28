import request from "supertest";
import { IngredientModel } from "../../models";
import { createTestApp } from "./helpers/appFactory";
import { authHeader, createAccount } from "./helpers/auth";
import { startDb, stopDb } from "./helpers/db";
import { seedCharge, seedDish, seedIngredient, seedSale, seedSupplier } from "./helpers/seed";

// Le test le plus important du backend : deux comptes ne doivent jamais voir
// ni modifier les donnees l'un de l'autre, admin compris (le scoping owner ne
// fait aucun bypass de role).

const app = createTestApp();

let accountA: Awaited<ReturnType<typeof createAccount>>;
let accountB: Awaited<ReturnType<typeof createAccount>>;
let admin: Awaited<ReturnType<typeof createAccount>>;

beforeAll(async () => {
  await startDb();
  accountA = await createAccount();
  accountB = await createAccount();
  admin = await createAccount({ role: "admin" });
});

afterAll(stopDb);

describe("ingredients", () => {
  it("hides account A ingredients from B and from an admin", async () => {
    const ingredient = await seedIngredient(accountA.user, { name: "Sucre" });

    const listA = await request(app).get("/ingredients").set(authHeader(accountA.token));
    const listB = await request(app).get("/ingredients").set(authHeader(accountB.token));
    const listAdmin = await request(app).get("/ingredients").set(authHeader(admin.token));

    expect(listA.status).toBe(200);
    expect(listA.body.map((item: { _id: string }) => item._id)).toContain(String(ingredient._id));
    expect(listB.body.map((item: { _id: string }) => item._id)).not.toContain(String(ingredient._id));
    expect(listAdmin.body.map((item: { _id: string }) => item._id)).not.toContain(String(ingredient._id));
  });

  it("rejects patch and delete of a foreign ingredient with a 404", async () => {
    const ingredient = await seedIngredient(accountA.user, { name: "Beurre" });

    const patch = await request(app)
      .patch(`/ingredients/${ingredient._id}`)
      .set(authHeader(accountB.token))
      .send({ name: "Pirate" });
    const del = await request(app)
      .delete(`/ingredients/${ingredient._id}`)
      .set(authHeader(accountB.token));

    expect(patch.status).toBe(404);
    expect(del.status).toBe(404);

    const untouched = await IngredientModel.findById(ingredient._id).exec();
    expect(untouched?.name).toBe("Beurre");
  });
});

describe("dishes", () => {
  it("hides and protects account A dishes", async () => {
    const ingredient = await seedIngredient(accountA.user, { name: "Tomate" });
    const dish = await seedDish(accountA.user, ingredient, { name: "Salade A" });

    const listB = await request(app).get("/dishes").set(authHeader(accountB.token));
    expect(listB.body.map((item: { _id: string }) => item._id)).not.toContain(String(dish._id));

    const getB = await request(app).get(`/dishes/${dish._id}`).set(authHeader(accountB.token));
    expect(getB.status).toBe(404);

    const patchB = await request(app)
      .patch(`/dishes/${dish._id}`)
      .set(authHeader(accountB.token))
      .send({ name: "Pirate" });
    expect(patchB.status).toBe(404);

    const deleteB = await request(app).delete(`/dishes/${dish._id}`).set(authHeader(accountB.token));
    expect(deleteB.status).toBe(404);
  });

  it("rejects a dish creation referencing a foreign ingredient", async () => {
    const foreignIngredient = await seedIngredient(accountA.user, { name: "Truffe" });

    const res = await request(app)
      .post("/dishes")
      .set(authHeader(accountB.token))
      .send({
        name: "Plat pirate",
        category: "Plat",
        ingredients: [{ ingredient: String(foreignIngredient._id), quantity: 1, unit: "kg" }]
      });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "One or more ingredients were not found" });
  });
});

describe("charges and sales", () => {
  it("hides and protects account A charges", async () => {
    const charge = await seedCharge(accountA.user, { name: "Assurance A" });

    const listB = await request(app).get("/charges").set(authHeader(accountB.token));
    expect(listB.body.map((item: { _id: string }) => item._id)).not.toContain(String(charge._id));

    const patchB = await request(app)
      .patch(`/charges/${charge._id}`)
      .set(authHeader(accountB.token))
      .send({ amount: 1 });
    expect(patchB.status).toBe(404);

    const deleteB = await request(app).delete(`/charges/${charge._id}`).set(authHeader(accountB.token));
    expect(deleteB.status).toBe(404);
  });

  it("hides and protects account A sales", async () => {
    const ingredient = await seedIngredient(accountA.user, { name: "Riz" });
    const dish = await seedDish(accountA.user, ingredient, { name: "Riz saute" });
    const sale = await seedSale(accountA.user, dish);

    const listB = await request(app).get("/sales").set(authHeader(accountB.token));
    expect(listB.body.map((item: { _id: string }) => item._id)).not.toContain(String(sale._id));

    const deleteB = await request(app).delete(`/sales/${sale._id}`).set(authHeader(accountB.token));
    expect(deleteB.status).toBe(404);
  });
});

describe("purchase orders", () => {
  it("hides and protects account A purchase orders", async () => {
    const supplier = await seedSupplier(accountA.user, { name: "Fournisseur A" });
    const ingredient = await seedIngredient(accountA.user, { name: "Huile", supplier: supplier._id });

    const created = await request(app)
      .post("/purchase-orders")
      .set(authHeader(accountA.token))
      .send({
        supplier: String(supplier._id),
        items: [{ ingredient: String(ingredient._id), quantity: 5, unit: "kg", unitPrice: 2 }]
      });
    expect(created.status).toBe(201);
    const orderId = created.body._id as string;

    const listB = await request(app).get("/purchase-orders").set(authHeader(accountB.token));
    expect(listB.body.map((item: { _id: string }) => item._id)).not.toContain(orderId);

    const getB = await request(app).get(`/purchase-orders/${orderId}`).set(authHeader(accountB.token));
    expect(getB.status).toBe(404);

    const statusB = await request(app)
      .patch(`/purchase-orders/${orderId}/status`)
      .set(authHeader(accountB.token))
      .send({ status: "cancelled" });
    expect(statusB.status).toBe(404);

    const deleteB = await request(app).delete(`/purchase-orders/${orderId}`).set(authHeader(accountB.token));
    expect(deleteB.status).toBe(404);
  });

  it("rejects an order creation referencing a foreign supplier", async () => {
    const foreignSupplier = await seedSupplier(accountA.user, { name: "Fournisseur prive A" });
    const ownIngredient = await seedIngredient(accountB.user, { name: "Sel B" });

    const res = await request(app)
      .post("/purchase-orders")
      .set(authHeader(accountB.token))
      .send({
        supplier: String(foreignSupplier._id),
        items: [{ ingredient: String(ownIngredient._id), quantity: 1, unit: "kg", unitPrice: 1 }]
      });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Supplier not found" });
  });
});

describe("payment cards", () => {
  it("hides and protects account A cards", async () => {
    const created = await request(app)
      .post("/payment-cards")
      .set(authHeader(accountA.token))
      .send({
        holder: "Jean Dupont",
        cardNumber: "4242 4242 4242 4242",
        expiryMonth: 12,
        expiryYear: new Date().getFullYear() + 2
      });
    expect(created.status).toBe(201);
    const cardId = created.body._id as string;

    const listB = await request(app).get("/payment-cards").set(authHeader(accountB.token));
    expect(listB.body.map((item: { _id: string }) => item._id)).not.toContain(cardId);

    const deleteB = await request(app).delete(`/payment-cards/${cardId}`).set(authHeader(accountB.token));
    expect(deleteB.status).toBe(404);
  });
});
