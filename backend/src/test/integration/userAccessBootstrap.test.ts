import { SupplierModel, UserModel } from "../../models";
import { ensureUserAccessBootstrap } from "../../services/userAccessBootstrap";
import { createAccount } from "./helpers/auth";
import { clearDb, startDb, stopDb } from "./helpers/db";

// Service execute au demarrage du serveur : mutations de masse sur les roles,
// creation de l'admin et du compte portail fournisseur.
// Defauts (env non posee) : admin@eatplanner.local / tovincentngo@gmail.com.

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

describe("ensureUserAccessBootstrap", () => {
  it("creates the default admin and supplier portal account on an empty database", async () => {
    const result = await ensureUserAccessBootstrap();

    expect(result).toEqual({
      createdAdminEmail: "admin@eatplanner.local",
      createdSupplierEmail: "tovincentngo@gmail.com",
      normalizedLegacyUsers: 0,
      demotedExtraAdmins: 0
    });

    const admin = await UserModel.findOne({ email: "admin@eatplanner.local" }).exec();
    expect(admin?.role).toBe("admin");
    expect(admin?.active).toBe(true);

    const supplierUser = await UserModel.findOne({ email: "tovincentngo@gmail.com" }).exec();
    expect(supplierUser?.role).toBe("supplier");

    const supplierSheet = await SupplierModel.findOne({ email: "tovincentngo@gmail.com" }).exec();
    expect(String(supplierSheet?.portalUser)).toBe(String(supplierUser?._id));
    expect(String(supplierSheet?.owner)).toBe(String(admin?._id));
  });

  it("normalizes legacy roles, including employee (documented behavior)", async () => {
    // Insertion brute pour contourner l'enum du modele.
    await UserModel.collection.insertOne({
      firstname: "Vieux",
      lastname: "Compte",
      email: "legacy@test.local",
      password: "not-a-hash",
      role: "chef",
      active: false,
      authProvider: "local"
    });
    // "employee" est une valeur valide de l'enum mais absente du $nin du
    // bootstrap : le compte est converti en manager et reactive.
    await createAccount({ role: "employee", email: "employee@test.local", active: false });

    const result = await ensureUserAccessBootstrap();

    expect(result.normalizedLegacyUsers).toBe(2);

    const legacy = await UserModel.findOne({ email: "legacy@test.local" }).exec();
    expect(legacy?.role).toBe("manager");
    expect(legacy?.active).toBe(true);

    const employee = await UserModel.findOne({ email: "employee@test.local" }).exec();
    expect(employee?.role).toBe("manager");
    expect(employee?.active).toBe(true);
  });

  it("demotes every admin except the oldest one", async () => {
    const first = await createAccount({ role: "admin", email: "admin1@test.local" });
    const second = await createAccount({ role: "admin", email: "admin2@test.local" });
    const third = await createAccount({ role: "admin", email: "admin3@test.local" });

    const result = await ensureUserAccessBootstrap();

    expect(result.createdAdminEmail).toBeNull();
    expect(result.demotedExtraAdmins).toBe(2);

    const kept = await UserModel.findById(first.user._id).exec();
    const demotedSecond = await UserModel.findById(second.user._id).exec();
    const demotedThird = await UserModel.findById(third.user._id).exec();
    expect(kept?.role).toBe("admin");
    expect(demotedSecond?.role).toBe("manager");
    expect(demotedThird?.role).toBe("manager");
  });

  it("is idempotent: a second run reports zero everywhere", async () => {
    await ensureUserAccessBootstrap();

    const second = await ensureUserAccessBootstrap();

    expect(second).toEqual({
      createdAdminEmail: null,
      createdSupplierEmail: null,
      normalizedLegacyUsers: 0,
      demotedExtraAdmins: 0
    });
  });

  it("unconditionally resets the supplier portal password on every run (documented)", async () => {
    await ensureUserAccessBootstrap();

    const supplierUser = await UserModel.findOne({ email: "tovincentngo@gmail.com" })
      .select("+password")
      .exec();
    expect(supplierUser).not.toBeNull();
    supplierUser!.password = "MotDePasseChange123!";
    await supplierUser!.save();
    await expect(supplierUser!.verifyPassword("Fournisseur123!")).resolves.toBe(false);

    await ensureUserAccessBootstrap();

    const reset = await UserModel.findOne({ email: "tovincentngo@gmail.com" })
      .select("+password")
      .exec();
    await expect(reset!.verifyPassword("Fournisseur123!")).resolves.toBe(true);
  });
});
