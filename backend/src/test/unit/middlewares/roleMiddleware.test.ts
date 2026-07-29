import { ownerOrRole, roleMiddleware } from "../../../middlewares/roleMiddleware";
import { makeReq, makeRes } from "../helpers/expressMocks";

describe("roleMiddleware", () => {
  it("rejects an unauthenticated request with a 401", () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    roleMiddleware(["admin"])(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "User not authenticated or missing role" });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a user without role with a 401", () => {
    const req = makeReq({ user: { id: "u1" } });
    const res = makeRes();
    const next = jest.fn();

    roleMiddleware(["admin"])(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a role outside the allowed list with a 403", () => {
    const req = makeReq({ user: { id: "u1", role: "employee" } });
    const res = makeRes();
    const next = jest.fn();

    roleMiddleware(["admin", "manager"])(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Access denied" });
    expect(next).not.toHaveBeenCalled();
  });

  it.each(["admin", "manager"] as const)("lets an allowed role pass (%s)", (role) => {
    const req = makeReq({ user: { id: "u1", role } });
    const res = makeRes();
    const next = jest.fn();

    roleMiddleware(["admin", "manager"])(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(0);
  });

  it("rejects every role when the allowed list is empty", () => {
    const req = makeReq({ user: { id: "u1", role: "admin" } });
    const res = makeRes();
    const next = jest.fn();

    roleMiddleware([])(req, res, next);

    expect(res.statusCode).toBe(403);
  });
});

// ownerOrRole est exporte mais n'est branche sur aucune route a ce jour :
// ces tests figent son contrat au cas ou il serait utilise.
describe("ownerOrRole", () => {
  it("rejects an unauthenticated request with a 401", () => {
    const req = makeReq({ params: { id: "u1" } });
    const res = makeRes();
    const next = jest.fn();

    ownerOrRole(["admin"])(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "User not authenticated" });
    expect(next).not.toHaveBeenCalled();
  });

  it("lets the owner pass even without any role (owner bypass)", () => {
    const req = makeReq({ user: { id: "u1" }, params: { id: "u1" } });
    const res = makeRes();
    const next = jest.fn();

    ownerOrRole(["admin"])(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(0);
  });

  it("lets a non-owner with an allowed role pass", () => {
    const req = makeReq({ user: { id: "u2", role: "admin" }, params: { id: "u1" } });
    const res = makeRes();
    const next = jest.fn();

    ownerOrRole(["admin"])(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-owner whose role is not allowed", () => {
    const req = makeReq({ user: { id: "u2", role: "employee" }, params: { id: "u1" } });
    const res = makeRes();
    const next = jest.fn();

    ownerOrRole(["admin"])(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Access denied" });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a non-owner without role", () => {
    const req = makeReq({ user: { id: "u2" }, params: { id: "u1" } });
    const res = makeRes();
    const next = jest.fn();

    ownerOrRole(["admin"])(req, res, next);

    expect(res.statusCode).toBe(403);
  });

  it("falls back to the role check when params.id is absent", () => {
    const req = makeReq({ user: { id: "u1", role: "admin" }, params: {} });
    const res = makeRes();
    const next = jest.fn();

    ownerOrRole(["admin"])(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("lets a user who is both owner and allowed role pass", () => {
    const req = makeReq({ user: { id: "u1", role: "admin" }, params: { id: "u1" } });
    const res = makeRes();
    const next = jest.fn();

    ownerOrRole(["admin"])(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
