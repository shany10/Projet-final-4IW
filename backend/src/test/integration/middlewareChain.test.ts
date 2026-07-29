import { Types } from "mongoose";
import request from "supertest";
import { signAccessToken } from "../../utils/jwt";
import { createTestApp } from "./helpers/appFactory";
import { authHeader, createAccount } from "./helpers/auth";
import { startDb, stopDb } from "./helpers/db";

// Chaine auth + role en situation reelle sur les vraies routes.

const app = createTestApp();

beforeAll(startDb);
afterAll(stopDb);

describe("authMiddleware on real routes", () => {
  it("rejects a request without token", async () => {
    const res = await request(app).get("/dishes");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "No authorization header" });
  });

  it("rejects a garbage token", async () => {
    const res = await request(app).get("/dishes").set(authHeader("not-a-jwt"));

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid or expired token" });
  });

  it("rejects an expired token", async () => {
    const expired = signAccessToken({ sub: String(new Types.ObjectId()), role: "manager" }, -1);

    const res = await request(app).get("/dishes").set(authHeader(expired));

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid or expired token" });
  });

  it("answers 404 User not found for a valid token whose user does not exist", async () => {
    const orphan = signAccessToken({ sub: String(new Types.ObjectId()), role: "manager" });

    const res = await request(app).get("/dishes").set(authHeader(orphan));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "User not found" });
  });
});

describe("roleMiddleware on real routes", () => {
  it("lets an employee read but not write dishes", async () => {
    const employee = await createAccount({ role: "employee" });

    const read = await request(app).get("/dishes").set(authHeader(employee.token));
    expect(read.status).toBe(200);

    const write = await request(app)
      .post("/dishes")
      .set(authHeader(employee.token))
      .send({ name: "Interdit", category: "Plat", ingredients: [] });
    expect(write.status).toBe(403);
    expect(write.body).toEqual({ error: "Access denied" });
  });

  it("trusts the JWT role without re-checking the database (documented security gap)", async () => {
    // Un user employee en base, mais un token forge role admin : les routes
    // admin passent car le role n'est jamais revalide en base.
    const employee = await createAccount({ role: "employee" });
    const forgedAdminToken = signAccessToken({ sub: String(employee.user._id), role: "admin" });

    const res = await request(app).get("/user/getAll").set(authHeader(forgedAdminToken));

    expect(res.status).toBe(200);
  });
});
