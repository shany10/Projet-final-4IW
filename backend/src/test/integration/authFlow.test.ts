import request from "supertest";
import { UserModel } from "../../models";
import { verifyAccessToken } from "../../utils/jwt";
import { createTestApp } from "./helpers/appFactory";
import { authHeader, createAccount } from "./helpers/auth";
import { startDb, stopDb } from "./helpers/db";

const app = createTestApp();

const SENSITIVE_FIELDS = [
  "password",
  "twoFactorSecret",
  "twoFactorTempSecret",
  "passwordResetTokenHash",
  "passwordResetTokenExpiresAt"
];

function expectNoSensitiveFields(payload: Record<string, unknown>) {
  for (const field of SENSITIVE_FIELDS) {
    expect(payload).not.toHaveProperty(field);
  }
}

beforeAll(startDb);
afterAll(stopDb);

describe("POST /user/register", () => {
  it("registers a manager and returns only ok and id", async () => {
    const res = await request(app).post("/user/register").send({
      firstname: "Marie",
      lastname: "Durand",
      email: "marie@test.local",
      password: "Password123!"
    });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.id).toBe("string");
    expect(res.body.token).toBeUndefined();

    const stored = await UserModel.findById(res.body.id).select("+password").exec();
    expect(stored?.role).toBe("manager");
    expect(stored?.active).toBe(true);
    expect(stored?.password.startsWith("$argon2")).toBe(true);
    await expect(stored?.verifyPassword("Password123!")).resolves.toBe(true);
  });

  it("rejects a duplicate email with a 409", async () => {
    await createAccount({ email: "taken@test.local" });

    const res = await request(app).post("/user/register").send({
      firstname: "Paul",
      lastname: "Martin",
      email: "taken@test.local",
      password: "Password123!"
    });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Email already in use" });
  });
});

describe("POST /user/auth", () => {
  it("returns ok, token and id on success, role only inside the JWT", async () => {
    const { user } = await createAccount({ email: "login@test.local", password: "Password123!" });

    const res = await request(app).post("/user/auth").send({
      email: "login@test.local",
      password: "Password123!"
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toBe(String(user._id));
    expect(res.body.role).toBeUndefined();
    expect(verifyAccessToken(res.body.token)).toEqual({
      sub: String(user._id),
      role: "manager",
      typ: "access"
    });
  });

  it("answers 401 with the same generic message for wrong password and unknown email", async () => {
    await createAccount({ email: "generic@test.local", password: "Password123!" });

    const wrongPassword = await request(app).post("/user/auth").send({
      email: "generic@test.local",
      password: "WrongPassword1!"
    });
    const unknownEmail = await request(app).post("/user/auth").send({
      email: "nobody@test.local",
      password: "Password123!"
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual({ error: "Invalid email or password" });
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  it("rejects a disabled account with a 403, checked before the password", async () => {
    await createAccount({ email: "inactive@test.local", password: "Password123!", active: false });

    const rightPassword = await request(app).post("/user/auth").send({
      email: "inactive@test.local",
      password: "Password123!"
    });
    const wrongPassword = await request(app).post("/user/auth").send({
      email: "inactive@test.local",
      password: "WrongPassword1!"
    });

    expect(rightPassword.status).toBe(403);
    expect(rightPassword.body).toEqual({ error: "Account disabled. Contact administrator." });
    // Le controle actif intervient avant la verification du mot de passe.
    expect(wrongPassword.status).toBe(403);
  });
});

describe("sensitive fields never leave the API", () => {
  it("GET /user/me exposes only public fields", async () => {
    const { token } = await createAccount();

    const res = await request(app).get("/user/me").set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.email).toBeDefined();
    expect(res.body.restaurantName).toBeDefined();
    expectNoSensitiveFields(res.body);
  });

  it("GET /user/getAll and /user/get/:id expose only public fields", async () => {
    const admin = await createAccount({ role: "admin" });
    const { user } = await createAccount();

    const list = await request(app).get("/user/getAll").set(authHeader(admin.token));
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    for (const item of list.body) {
      expectNoSensitiveFields(item);
    }

    const single = await request(app).get(`/user/get/${user._id}`).set(authHeader(admin.token));
    expect(single.status).toBe(200);
    expectNoSensitiveFields(single.body);
  });
});
