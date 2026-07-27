// La cle de chiffrement est derivee de l'environnement au chargement du
// module : les tests de cascade rechargent le module avec des valeurs
// controlees. Les autres tests utilisent une instance de base chargee une fois.

type CryptoModule = typeof import("../../../utils/crypto");

const ORIGINAL_ENV = {
  TOTP_ENCRYPTION_KEY: process.env.TOTP_ENCRYPTION_KEY,
  JWT_SECRET: process.env.JWT_SECRET
};

function loadCryptoModule(env: { TOTP_ENCRYPTION_KEY?: string; JWT_SECRET?: string }): CryptoModule {
  jest.resetModules();
  for (const key of ["TOTP_ENCRYPTION_KEY", "JWT_SECRET"] as const) {
    const value = env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../../../utils/crypto") as CryptoModule;
}

let baseCrypto: CryptoModule;

beforeAll(() => {
  baseCrypto = loadCryptoModule({ TOTP_ENCRYPTION_KEY: "unit-test-key" });
});

afterAll(() => {
  for (const key of ["TOTP_ENCRYPTION_KEY", "JWT_SECRET"] as const) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("encryptText / decryptText roundtrip", () => {
  it("decrypts what it encrypted", () => {
    expect(baseCrypto.decryptText(baseCrypto.encryptText("hello"))).toBe("hello");
  });

  it("handles unicode content", () => {
    // "hello" accentue + coeur + cadenas, en echappements pour rester ASCII.
    const value = "h\u00e9llo c\u0153ur \ud83d\udd10";

    expect(baseCrypto.decryptText(baseCrypto.encryptText(value))).toBe(value);
  });

  it("handles long payloads", () => {
    const value = "a".repeat(10000);

    expect(baseCrypto.decryptText(baseCrypto.encryptText(value))).toBe(value);
  });

  it("produces the iv.authTag.ciphertext hex format", () => {
    const payload = baseCrypto.encryptText("secret");

    // IV de 12 octets = 24 hex, authTag de 16 octets = 32 hex.
    expect(payload).toMatch(/^[0-9a-f]{24}\.[0-9a-f]{32}\.[0-9a-f]+$/);
  });

  it("produces a different payload at every call thanks to the random iv", () => {
    const first = baseCrypto.encryptText("same value");
    const second = baseCrypto.encryptText("same value");

    expect(first).not.toBe(second);
    expect(baseCrypto.decryptText(first)).toBe("same value");
    expect(baseCrypto.decryptText(second)).toBe("same value");
  });

  it("cannot decrypt an encrypted empty string (empty third segment, documented)", () => {
    // encryptText("") produit un troisieme segment vide que decryptText
    // rejette : l'aller-retour de la chaine vide retourne null.
    const payload = baseCrypto.encryptText("");

    expect(payload.endsWith(".")).toBe(true);
    expect(baseCrypto.decryptText(payload)).toBeNull();
  });
});

describe("decryptText failure paths", () => {
  function validParts(): [string, string, string] {
    return baseCrypto.encryptText("secret").split(".") as [string, string, string];
  }

  it("returns null for null, undefined and empty input", () => {
    expect(baseCrypto.decryptText(null)).toBeNull();
    expect(baseCrypto.decryptText(undefined)).toBeNull();
    expect(baseCrypto.decryptText("")).toBeNull();
  });

  it("returns null when the payload does not have exactly three parts", () => {
    const [iv, tag, data] = validParts();

    expect(baseCrypto.decryptText("abcdef")).toBeNull();
    expect(baseCrypto.decryptText(`${iv}.${tag}`)).toBeNull();
    expect(baseCrypto.decryptText(`${iv}.${tag}.${data}.extra`)).toBeNull();
  });

  it("returns null when a part is empty", () => {
    const [iv, tag, data] = validParts();

    expect(baseCrypto.decryptText(`.${tag}.${data}`)).toBeNull();
    expect(baseCrypto.decryptText(`${iv}..${data}`)).toBeNull();
  });

  it("returns null on a wrong iv length", () => {
    const [, tag, data] = validParts();

    expect(baseCrypto.decryptText(`aabb.${tag}.${data}`)).toBeNull();
  });

  it("returns null on a wrong auth tag length", () => {
    const [iv, , data] = validParts();

    expect(baseCrypto.decryptText(`${iv}.aabb.${data}`)).toBeNull();
  });

  it("returns null on non-hex iv content", () => {
    const [, tag, data] = validParts();

    expect(baseCrypto.decryptText(`${"z".repeat(24)}.${tag}.${data}`)).toBeNull();
  });

  it("returns null when the ciphertext is tampered", () => {
    const [iv, tag, data] = validParts();
    const flipped = data.slice(0, -1) + (data.endsWith("0") ? "1" : "0");

    expect(baseCrypto.decryptText(`${iv}.${tag}.${flipped}`)).toBeNull();
  });

  it("returns null when the auth tag is replaced by another well formed tag", () => {
    const [iv, , data] = validParts();

    expect(baseCrypto.decryptText(`${iv}.${"0".repeat(32)}.${data}`)).toBeNull();
  });
});

describe("encryption key cascade", () => {
  it("prefers TOTP_ENCRYPTION_KEY over JWT_SECRET", () => {
    const writer = loadCryptoModule({ TOTP_ENCRYPTION_KEY: "alpha", JWT_SECRET: "beta" });
    const payload = writer.encryptText("cascade");

    // Meme secret resolu ("alpha") via JWT_SECRET seul -> dechiffrable :
    // preuve que TOTP_ENCRYPTION_KEY prime sur JWT_SECRET.
    const readerAlpha = loadCryptoModule({ JWT_SECRET: "alpha" });
    expect(readerAlpha.decryptText(payload)).toBe("cascade");

    const readerBeta = loadCryptoModule({ JWT_SECRET: "beta" });
    expect(readerBeta.decryptText(payload)).toBeNull();
  });

  it("falls back to the literal dev-secret without any env variable (documented)", () => {
    const bare = loadCryptoModule({});
    const payload = bare.encryptText("fallback");

    const devReader = loadCryptoModule({ TOTP_ENCRYPTION_KEY: "dev-secret" });
    expect(devReader.decryptText(payload)).toBe("fallback");
  });
});
