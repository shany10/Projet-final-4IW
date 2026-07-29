import { createHash } from "crypto";
import request from "supertest";
import { UserModel } from "../../models";
import { sendPasswordResetEmail } from "../../utils/email";
import { createTestApp } from "./helpers/appFactory";
import { createAccount } from "./helpers/auth";
import { startDb, stopDb } from "./helpers/db";

// Sans config SMTP, sendAppEmail ne leve jamais : mocker le module email est
// le seul moyen d'atteindre le chemin d'echec d'envoi (rollback du token).
jest.mock("../../utils/email", () => ({
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  sendSupplierOrderEmail: jest.fn().mockResolvedValue({ mode: "log" }),
  sendSupplierPaymentConfirmationEmail: jest.fn().mockResolvedValue({ mode: "log" }),
  sendSupplierMessageEmail: jest.fn().mockResolvedValue({ mode: "log" })
}));

const sendMock = sendPasswordResetEmail as jest.Mock;

const app = createTestApp();
const GENERIC_MESSAGE = "Si un compte existe pour cet email, un lien de reinitialisation a ete envoye.";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function requestResetToken(email: string): Promise<string> {
  const res = await request(app).post("/user/password/forgot").send({ email });
  expect(res.status).toBe(200);
  const call = sendMock.mock.calls.at(-1)?.[0] as { resetUrl: string };
  const token = new URL(call.resetUrl).searchParams.get("token");
  expect(token).toMatch(/^[0-9a-f]{64}$/);
  return token as string;
}

beforeAll(startDb);
afterAll(stopDb);
beforeEach(() => {
  sendMock.mockClear();
  sendMock.mockResolvedValue(undefined);
});

describe("POST /user/password/forgot", () => {
  it("answers the exact generic message for an unknown email without sending anything", async () => {
    const res = await request(app).post("/user/password/forgot").send({ email: "ghost@test.local" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, message: GENERIC_MESSAGE });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("stores only the sha256 of the token and mails the plaintext link", async () => {
    const { user } = await createAccount({ email: "reset1@test.local" });

    const token = await requestResetToken("reset1@test.local");

    expect(sendMock).toHaveBeenCalledTimes(1);
    const stored = await UserModel.findById(user._id)
      .select("+passwordResetTokenHash +passwordResetTokenExpiresAt")
      .exec();
    expect(stored?.passwordResetTokenHash).toBe(sha256(token));
    expect(stored?.passwordResetTokenHash).not.toBe(token);
    expect(stored?.passwordResetTokenExpiresAt?.getTime()).toBeGreaterThan(Date.now());
  });

  it("rolls the token back when the email sending fails", async () => {
    const { user } = await createAccount({ email: "rollback@test.local" });
    sendMock.mockRejectedValueOnce(new Error("SMTP down"));

    const res = await request(app).post("/user/password/forgot").send({ email: "rollback@test.local" });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Unable to send password reset email" });

    const stored = await UserModel.findById(user._id)
      .select("+passwordResetTokenHash +passwordResetTokenExpiresAt")
      .exec();
    expect(stored?.passwordResetTokenHash).toBeNull();
    expect(stored?.passwordResetTokenExpiresAt).toBeNull();
  });

  it("treats a disabled account like an unknown email", async () => {
    await createAccount({ email: "disabled-forgot@test.local", active: false });

    const res = await request(app)
      .post("/user/password/forgot")
      .send({ email: "disabled-forgot@test.local" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, message: GENERIC_MESSAGE });
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("POST /user/password/reset", () => {
  it("resets the password once, then rejects the same token", async () => {
    await createAccount({ email: "reset2@test.local", password: "OldPassword123!" });
    const token = await requestResetToken("reset2@test.local");

    const reset = await request(app)
      .post("/user/password/reset")
      .send({ token, password: "NewPassword123!" });
    expect(reset.status).toBe(200);
    expect(reset.body).toEqual({ ok: true, message: "Password updated" });

    const oldLogin = await request(app).post("/user/auth").send({
      email: "reset2@test.local",
      password: "OldPassword123!"
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app).post("/user/auth").send({
      email: "reset2@test.local",
      password: "NewPassword123!"
    });
    expect(newLogin.status).toBe(200);

    // Usage unique : le meme token est refuse au 2e essai.
    const replay = await request(app)
      .post("/user/password/reset")
      .send({ token, password: "AnotherPassword123!" });
    expect(replay.status).toBe(400);
    expect(replay.body).toEqual({ error: "Invalid or expired password reset token" });
  });

  it("rejects an expired token", async () => {
    const { user } = await createAccount({ email: "expired@test.local" });
    const token = await requestResetToken("expired@test.local");

    await UserModel.updateOne(
      { _id: user._id },
      { passwordResetTokenExpiresAt: new Date(Date.now() - 1000) }
    ).exec();

    const res = await request(app)
      .post("/user/password/reset")
      .send({ token, password: "NewPassword123!" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid or expired password reset token" });
  });

  it("rejects a valid token on a disabled account", async () => {
    const { user } = await createAccount({ email: "disabled-reset@test.local" });
    const token = await requestResetToken("disabled-reset@test.local");

    await UserModel.updateOne({ _id: user._id }, { active: false }).exec();

    const res = await request(app)
      .post("/user/password/reset")
      .send({ token, password: "NewPassword123!" });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Account disabled. Contact administrator." });
  });

  it("rejects an unknown token", async () => {
    const res = await request(app)
      .post("/user/password/reset")
      .send({ token: "0".repeat(64), password: "NewPassword123!" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid or expired password reset token" });
  });
});
