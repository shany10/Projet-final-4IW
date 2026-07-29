import jwt from "jsonwebtoken";

// Le secret est lu au chargement du module : chaque test recharge le module
// avec une valeur d'environnement controlee via jest.resetModules().

type JwtModule = typeof import("../../../utils/jwt");

const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;

function loadJwtModule(secret: string | undefined): JwtModule {
  jest.resetModules();
  if (secret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = secret;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../../../utils/jwt") as JwtModule;
}

afterAll(() => {
  if (ORIGINAL_JWT_SECRET === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
  }
});

describe("access token roundtrip", () => {
  it("signs and verifies an access token carrying a role", () => {
    const mod = loadJwtModule("test-secret");

    const token = mod.signAccessToken({ sub: "user-1", role: "manager" });

    expect(mod.verifyAccessToken(token)).toEqual({
      sub: "user-1",
      role: "manager",
      typ: "access"
    });
  });

  it("omits the role key entirely when the token has none", () => {
    const mod = loadJwtModule("test-secret");

    const payload = mod.verifyAccessToken(mod.signAccessToken({ sub: "user-1" }));

    expect(payload.sub).toBe("user-1");
    expect(payload.typ).toBe("access");
    expect("role" in payload).toBe(false);
  });

  it("uses a one hour expiry by default and honors a custom duration", () => {
    const mod = loadJwtModule("test-secret");

    const decodedDefault = jwt.decode(mod.signAccessToken({ sub: "u" })) as { iat: number; exp: number };
    const decodedCustom = jwt.decode(mod.signAccessToken({ sub: "u" }, 2)) as { iat: number; exp: number };

    expect(decodedDefault.exp - decodedDefault.iat).toBe(3600);
    expect(decodedCustom.exp - decodedCustom.iat).toBe(7200);
  });
});

describe("mfa token roundtrip", () => {
  it("signs and verifies an mfa token", () => {
    const mod = loadJwtModule("test-secret");

    const token = mod.signMfaToken({ sub: "user-1" });

    expect(mod.verifyMfaToken(token)).toEqual({ sub: "user-1", typ: "mfa" });
  });

  it("uses a ten minute expiry by default and honors a custom duration", () => {
    const mod = loadJwtModule("test-secret");

    const decodedDefault = jwt.decode(mod.signMfaToken({ sub: "u" })) as { iat: number; exp: number };
    const decodedCustom = jwt.decode(mod.signMfaToken({ sub: "u" }, 5)) as { iat: number; exp: number };

    expect(decodedDefault.exp - decodedDefault.iat).toBe(600);
    expect(decodedCustom.exp - decodedCustom.iat).toBe(300);
  });
});

describe("token family separation", () => {
  it("rejects an mfa token passed to verifyAccessToken", () => {
    const mod = loadJwtModule("test-secret");

    const mfaToken = mod.signMfaToken({ sub: "user-1" });

    expect(() => mod.verifyAccessToken(mfaToken)).toThrow("Invalid token type");
  });

  it("rejects an access token passed to verifyMfaToken", () => {
    const mod = loadJwtModule("test-secret");

    const accessToken = mod.signAccessToken({ sub: "user-1" });

    expect(() => mod.verifyMfaToken(accessToken)).toThrow("Invalid token type");
  });

  it("accepts a token without typ claim as access token (permissive guard, documented)", () => {
    // La garde `if (payload.typ && ...)` laisse passer un token sans champ
    // typ : ce test fige la faille identifiee lors de l'analyse.
    const mod = loadJwtModule("test-secret");
    const forged = jwt.sign({ sub: "user-1" }, "test-secret", { expiresIn: "1h" });

    expect(mod.verifyAccessToken(forged)).toEqual({ sub: "user-1", typ: "access" });
  });
});

describe("verification failures", () => {
  it("rejects a token without sub", () => {
    const mod = loadJwtModule("test-secret");
    const forged = jwt.sign({ typ: "access" }, "test-secret", { expiresIn: "1h" });

    expect(() => mod.verifyAccessToken(forged)).toThrow("Invalid token payload");
  });

  it("rejects a token signed with another secret", () => {
    const mod = loadJwtModule("test-secret");
    const forged = jwt.sign({ sub: "u", typ: "access" }, "other-secret", { expiresIn: "1h" });

    expect(() => mod.verifyAccessToken(forged)).toThrow("invalid signature");
  });

  it("rejects an expired access token", () => {
    const mod = loadJwtModule("test-secret");

    const expired = mod.signAccessToken({ sub: "u" }, -1);

    expect(() => mod.verifyAccessToken(expired)).toThrow("jwt expired");
  });

  it("rejects garbage input", () => {
    const mod = loadJwtModule("test-secret");

    expect(() => mod.verifyAccessToken("not-a-jwt")).toThrow();
  });
});

describe("dev-secret fallback", () => {
  it("accepts tokens signed with the literal dev-secret when JWT_SECRET is unset (documented)", () => {
    // Sans variable d'environnement, l'API signe et verifie avec le secret
    // public "dev-secret" : ce test documente le risque.
    const mod = loadJwtModule(undefined);
    const forged = jwt.sign({ sub: "user-1", typ: "access" }, "dev-secret", { expiresIn: "1h" });

    expect(mod.verifyAccessToken(forged).sub).toBe("user-1");
  });
});
