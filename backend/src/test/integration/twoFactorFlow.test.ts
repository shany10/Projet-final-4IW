import request from "supertest";
import { UserModel } from "../../models";
import { decryptText } from "../../utils/crypto";
import { createTestApp } from "./helpers/appFactory";
import { authHeader, createAccount } from "./helpers/auth";
import { startDb, stopDb } from "./helpers/db";
import { generateTotpCode, wrongTotpCode } from "./helpers/totpHelper";

// Machine a etats 2FA complete via HTTP, avec de vrais codes TOTP.
// Les its de ce fichier s'executent dans l'ordre et partagent l'etat.

const app = createTestApp();
const PASSWORD = "Password123!";

let account: Awaited<ReturnType<typeof createAccount>>;
let secret: string;
let mfaToken: string;

beforeAll(async () => {
  await startDb();
  account = await createAccount({ email: "twofa@test.local", password: PASSWORD });
});

afterAll(stopDb);

describe("2FA state machine", () => {
  it("setup returns the plaintext secret and stores it encrypted", async () => {
    const res = await request(app).post("/user/2fa/setup").set(authHeader(account.token)).send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(res.body.otpauthUrl).toContain("otpauth://totp/");
    expect(res.body.issuer).toBeDefined();
    secret = res.body.secret;

    const stored = await UserModel.findById(account.user._id).select("+twoFactorTempSecret").exec();
    expect(stored?.twoFactorTempSecret).toBeTruthy();
    expect(stored?.twoFactorTempSecret).not.toBe(secret);
    expect(decryptText(stored?.twoFactorTempSecret)).toBe(secret);
  });

  it("enable rejects a wrong code with a 401", async () => {
    const res = await request(app)
      .post("/user/2fa/enable")
      .set(authHeader(account.token))
      .send({ code: wrongTotpCode(generateTotpCode(secret)) });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid 2FA code" });
  });

  it("enable accepts a valid code and promotes the temp secret", async () => {
    const res = await request(app)
      .post("/user/2fa/enable")
      .set(authHeader(account.token))
      .send({ code: generateTotpCode(secret) });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, message: "2FA enabled" });

    const stored = await UserModel.findById(account.user._id)
      .select("+twoFactorSecret +twoFactorTempSecret")
      .exec();
    expect(stored?.twoFactorEnabled).toBe(true);
    expect(decryptText(stored?.twoFactorSecret)).toBe(secret);
    expect(stored?.twoFactorTempSecret).toBeNull();
  });

  it("setup again answers 409 once 2FA is enabled", async () => {
    const res = await request(app).post("/user/2fa/setup").set(authHeader(account.token)).send({});

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "2FA is already enabled" });
  });

  it("login now returns an mfa challenge without access token", async () => {
    const res = await request(app).post("/user/auth").send({
      email: "twofa@test.local",
      password: PASSWORD
    });

    expect(res.status).toBe(200);
    expect(res.body.requires2fa).toBe(true);
    expect(res.body.mfaToken).toBeDefined();
    expect(res.body.token).toBeUndefined();
    mfaToken = res.body.mfaToken;
  });

  it("rejects the mfa token used as an access token", async () => {
    const res = await request(app).get("/user/me").set(authHeader(mfaToken));

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid or expired token" });
  });

  it("rejects an access token used as an mfa token", async () => {
    const res = await request(app).post("/user/auth/2fa").send({
      mfaToken: account.token,
      code: generateTotpCode(secret)
    });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid or expired MFA token" });
  });

  it("rejects a wrong code on the login challenge", async () => {
    const res = await request(app).post("/user/auth/2fa").send({
      mfaToken,
      code: wrongTotpCode(generateTotpCode(secret))
    });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid 2FA code" });
  });

  it("exchanges a valid code for an access token", async () => {
    const res = await request(app).post("/user/auth/2fa").send({
      mfaToken,
      code: generateTotpCode(secret)
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toBe(String(account.user._id));

    const me = await request(app).get("/user/me").set(authHeader(res.body.token));
    expect(me.status).toBe(200);
  });

  it("disable rejects a wrong code then accepts a valid one", async () => {
    const bad = await request(app)
      .post("/user/2fa/disable")
      .set(authHeader(account.token))
      .send({ code: wrongTotpCode(generateTotpCode(secret)) });
    expect(bad.status).toBe(401);

    const good = await request(app)
      .post("/user/2fa/disable")
      .set(authHeader(account.token))
      .send({ code: generateTotpCode(secret) });
    expect(good.status).toBe(200);
    expect(good.body).toEqual({ ok: true, message: "2FA disabled" });
  });

  it("login goes back to a direct access token after disable", async () => {
    const res = await request(app).post("/user/auth").send({
      email: "twofa@test.local",
      password: PASSWORD
    });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.requires2fa).toBeUndefined();
  });
});
