import { authMiddleware } from "../../../middlewares/authMiddleware";
import { signAccessToken, signMfaToken } from "../../../utils/jwt";
import { makeReq, makeRes } from "../helpers/expressMocks";

// authMiddleware et jwt.ts partagent la meme instance de module dans ce
// fichier : les tokens signes ici sont verifiables avec le meme secret.

describe("authMiddleware", () => {
  describe("missing or malformed authorization header", () => {
    it("rejects a request without authorization header", () => {
      const req = makeReq();
      const res = makeRes();
      const next = jest.fn();

      authMiddleware(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: "No authorization header" });
      expect(next).not.toHaveBeenCalled();
    });

    it("treats an empty header as missing", () => {
      const req = makeReq({ headers: { authorization: "" } });
      const res = makeRes();
      const next = jest.fn();

      authMiddleware(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: "No authorization header" });
    });

    it.each([
      ["Bearer", "scheme seul sans token"],
      ["Bearer a b", "trois segments"],
      ["bearer sometoken", "scheme en minuscules (sensible a la casse)"],
      ["Token sometoken", "mauvais scheme"],
      ["Bearer ", "token vide"],
      ["Bearer  sometoken", "double espace -> trois segments"]
    ])("rejects the malformed header %p (%s)", (header) => {
      const req = makeReq({ headers: { authorization: header } });
      const res = makeRes();
      const next = jest.fn();

      authMiddleware(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: "Malformed authorization header" });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("valid tokens", () => {
    it("fills req.user and calls next on a valid token with role", () => {
      const token = signAccessToken({ sub: "user-1", role: "manager" });
      const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
      const res = makeRes();
      const next = jest.fn();

      authMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toEqual({ id: "user-1", role: "manager" });
      expect(res.statusCode).toBe(0);
    });

    it("leaves role undefined when the token carries none", () => {
      const token = signAccessToken({ sub: "user-2" });
      const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
      const res = makeRes();
      const next = jest.fn();

      authMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user?.id).toBe("user-2");
      expect(req.user?.role).toBeUndefined();
    });
  });

  describe("invalid tokens", () => {
    it.each([
      ["Bearer not-a-jwt", "token illisible"],
      [`Bearer ${signAccessToken({ sub: "u" }, -1)}`, "token expire"]
    ])("rejects %s (%s) with a 401", (header) => {
      const req = makeReq({ headers: { authorization: header } });
      const res = makeRes();
      const next = jest.fn();

      authMiddleware(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: "Invalid or expired token" });
      expect(next).not.toHaveBeenCalled();
    });

    it("rejects an mfa token used as access token", () => {
      const mfaToken = signMfaToken({ sub: "user-1" });
      const req = makeReq({ headers: { authorization: `Bearer ${mfaToken}` } });
      const res = makeRes();
      const next = jest.fn();

      authMiddleware(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: "Invalid or expired token" });
      expect(req.user).toBeUndefined();
      expect(next).not.toHaveBeenCalled();
    });

    it("rejects a tampered token", () => {
      const token = signAccessToken({ sub: "user-1" });
      const tampered = `${token.slice(0, -2)}xx`;
      const req = makeReq({ headers: { authorization: `Bearer ${tampered}` } });
      const res = makeRes();
      const next = jest.fn();

      authMiddleware(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
