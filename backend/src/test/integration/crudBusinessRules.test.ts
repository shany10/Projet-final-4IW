import request from "supertest";
import { SupplierMessageModel } from "../../models";
import { sendSupplierMessageEmail } from "../../utils/email";
import { createTestApp } from "./helpers/appFactory";
import { authHeader, createAccount } from "./helpers/auth";
import { startDb, stopDb } from "./helpers/db";
import { seedDish, seedIngredient, seedSale, seedSupplier } from "./helpers/seed";

// Le module email est mocke : sans SMTP le code reel ne leve jamais, donc le
// chemin 502 (message persiste en "failed") serait inatteignable.
jest.mock("../../utils/email", () => ({
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  sendSupplierOrderEmail: jest.fn().mockResolvedValue({ mode: "log" }),
  sendSupplierPaymentConfirmationEmail: jest.fn().mockResolvedValue({ mode: "log" }),
  sendSupplierMessageEmail: jest.fn().mockResolvedValue({ mode: "log" })
}));

const sendMessageMock = sendSupplierMessageEmail as jest.Mock;

const app = createTestApp();

let account: Awaited<ReturnType<typeof createAccount>>;

beforeAll(async () => {
  await startDb();
  account = await createAccount();
});

afterAll(stopDb);

beforeEach(() => {
  sendMessageMock.mockClear();
  sendMessageMock.mockResolvedValue({ mode: "log" });
});

describe("protected deletions", () => {
  it("refuses to delete a dish present in the sales history", async () => {
    const ingredient = await seedIngredient(account.user, { name: "Canard" });
    const dish = await seedDish(account.user, ingredient, { name: "Confit" });
    await seedSale(account.user, dish);

    const res = await request(app).delete(`/dishes/${dish._id}`).set(authHeader(account.token));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Dish cannot be deleted because it exists in sales history" });
  });

  it("refuses to delete an ingredient still used by a dish, then allows it", async () => {
    const ingredient = await seedIngredient(account.user, { name: "Basilic" });
    const dish = await seedDish(account.user, ingredient, { name: "Pesto" });

    const blocked = await request(app)
      .delete(`/ingredients/${ingredient._id}`)
      .set(authHeader(account.token));
    expect(blocked.status).toBe(409);
    expect(blocked.body).toEqual({ error: "Ingredient is still used by a dish" });

    await request(app).delete(`/dishes/${dish._id}`).set(authHeader(account.token));
    const allowed = await request(app)
      .delete(`/ingredients/${ingredient._id}`)
      .set(authHeader(account.token));
    expect(allowed.status).toBe(204);
  });

  it("refuses to delete a supplier still linked to ingredients", async () => {
    const supplier = await seedSupplier(account.user, { name: "Primeur" });
    await seedIngredient(account.user, { name: "Carotte", supplier: supplier._id });

    const res = await request(app)
      .delete(`/suppliers/${supplier._id}`)
      .set(authHeader(account.token));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Supplier is still linked to ingredients" });
  });
});

describe("ingredient orderUnit defaults", () => {
  it("defaults orderUnit to the unit at creation", async () => {
    const res = await request(app)
      .post("/ingredients")
      .set(authHeader(account.token))
      .send({ name: "Lait cru", unit: "l", purchasePrice: 1.2 });

    expect(res.status).toBe(201);
    expect(res.body.orderUnit).toBe("l");
  });

  it("follows the unit on update when orderUnit is not provided", async () => {
    const created = await request(app)
      .post("/ingredients")
      .set(authHeader(account.token))
      .send({ name: "Creme", unit: "l", purchasePrice: 2 });

    const updated = await request(app)
      .patch(`/ingredients/${created.body._id}`)
      .set(authHeader(account.token))
      .send({ unit: "cl" });

    expect(updated.status).toBe(200);
    expect(updated.body.unit).toBe("cl");
    expect(updated.body.orderUnit).toBe("cl");
  });
});

describe("supplier portal branch", () => {
  it("shows a supplier role user only the sheets linked to him, across restaurants", async () => {
    const portal = await createAccount({ role: "supplier" });
    const restaurantA = await createAccount();
    const restaurantB = await createAccount();

    const sheetA = await seedSupplier(restaurantA.user, {
      name: "Fiche A",
      portalUser: portal.user._id
    });
    const sheetB = await seedSupplier(restaurantB.user, {
      name: "Fiche B",
      portalUser: portal.user._id
    });
    const unlinked = await seedSupplier(restaurantA.user, { name: "Fiche sans portail" });

    const res = await request(app).get("/suppliers").set(authHeader(portal.token));

    expect(res.status).toBe(200);
    const ids = res.body.map((item: { _id: string }) => item._id);
    // Cross-tenant par conception : le portail voit ses fiches de tous les comptes.
    expect(ids).toContain(String(sheetA._id));
    expect(ids).toContain(String(sheetB._id));
    expect(ids).not.toContain(String(unlinked._id));
  });

  it("answers 404 on messages for an unlinked supplier account", async () => {
    const portal = await createAccount({ role: "supplier" });

    const res = await request(app).get("/suppliers/messages").set(authHeader(portal.token));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Supplier account is not linked" });
  });

  it("GET /suppliers as manager creates the demo portal supplier (documented side effect)", async () => {
    const fresh = await createAccount();

    const res = await request(app).get("/suppliers").set(authHeader(fresh.token));

    expect(res.status).toBe(200);
    // ensureSupplierPortalAccount upsert un fournisseur demo owne par
    // l'appelant : la liste d'un compte vierge n'est pas vide.
    const names = res.body.map((item: { name: string }) => item.name);
    expect(names).toContain("Fournisseur demo Vincent");
  });
});

describe("supplier messages", () => {
  it("sends a message and persists it with status sent", async () => {
    const supplier = await seedSupplier(account.user, { name: "Messager", email: "msg@test.local" });

    const res = await request(app)
      .post("/suppliers/messages")
      .set(authHeader(account.token))
      .send({ supplier: String(supplier._id), subject: "Commande", body: "Bonjour fournisseur" });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("sent");
    expect(res.body.direction).toBe("outbound");
    expect(res.body.sentAt).toBeTruthy();
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });

  it("answers 502 and persists a failed message when the email cannot be sent", async () => {
    const supplier = await seedSupplier(account.user, { name: "Injoignable", email: "ko@test.local" });
    sendMessageMock.mockRejectedValueOnce(new Error("SMTP down"));

    const res = await request(app)
      .post("/suppliers/messages")
      .set(authHeader(account.token))
      .send({ supplier: String(supplier._id), subject: "Echec", body: "Message perdu" });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Supplier email could not be sent");

    const failed = await SupplierMessageModel.findOne({
      supplier: supplier._id,
      status: "failed"
    }).exec();
    expect(failed).not.toBeNull();
    expect(failed?.errorMessage).toBe("SMTP down");
    expect(failed?.sentAt).toBeNull();
  });

  it("rejects a message to a supplier without email", async () => {
    const supplier = await seedSupplier(account.user, { name: "Muet", email: "" });

    const res = await request(app)
      .post("/suppliers/messages")
      .set(authHeader(account.token))
      .send({ supplier: String(supplier._id), subject: "Test", body: "Sans destinataire" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Supplier has no email configured" });
  });

  it("lets a linked supplier reply with an inbound message", async () => {
    const portal = await createAccount({ role: "supplier" });
    await seedSupplier(account.user, {
      name: "Fiche liee",
      email: "linked@test.local",
      portalUser: portal.user._id
    });

    const res = await request(app)
      .post("/suppliers/messages/reply")
      .set(authHeader(portal.token))
      .send({ body: "Bien recu, livraison demain" });

    expect(res.status).toBe(201);
    expect(res.body.direction).toBe("inbound");
    expect(res.body.status).toBe("sent");
  });
});
