import { buildOtpAuthUrl, generateTotpSecret, verifyTotp } from "../../../utils/totp";

// Secret des vecteurs officiels : base32 de la chaine ASCII
// "12345678901234567890" (RFC 4226 / RFC 6238, mode SHA-1).
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

// Vecteurs HOTP RFC 4226 (6 chiffres) pour les compteurs 0 a 3.
const HOTP_C0 = "755224";
const HOTP_C1 = "287082";
const HOTP_C2 = "359152";
const HOTP_C3 = "969429";

function atTime(seconds: number) {
  jest.useFakeTimers({ now: seconds * 1000 });
}

afterEach(() => {
  jest.useRealTimers();
});

describe("verifyTotp against RFC 6238 vectors", () => {
  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"]
  ])("accepts the official SHA-1 vector at T=%s", (time, token) => {
    atTime(time);

    expect(verifyTotp({ secret: RFC_SECRET, token, digits: 8, window: 0 })).toBe(true);
  });

  it("rejects a wrong 8 digit code", () => {
    atTime(59);

    expect(verifyTotp({ secret: RFC_SECRET, token: "00000000", digits: 8, window: 0 })).toBe(false);
  });

  it("accepts the 6 digit code with default settings", () => {
    atTime(59);

    expect(verifyTotp({ secret: RFC_SECRET, token: HOTP_C1 })).toBe(true);
  });
});

describe("verification window", () => {
  it("accepts the previous and next period with the default window of 1", () => {
    // T=59 -> compteur 1 : la fenetre par defaut couvre les compteurs 0 a 2.
    atTime(59);

    expect(verifyTotp({ secret: RFC_SECRET, token: HOTP_C0 })).toBe(true);
    expect(verifyTotp({ secret: RFC_SECRET, token: HOTP_C1 })).toBe(true);
    expect(verifyTotp({ secret: RFC_SECRET, token: HOTP_C2 })).toBe(true);
  });

  it("rejects a code two periods ahead", () => {
    atTime(59);

    expect(verifyTotp({ secret: RFC_SECRET, token: HOTP_C3 })).toBe(false);
  });

  it("only accepts the current period with window 0", () => {
    atTime(59);

    expect(verifyTotp({ secret: RFC_SECRET, token: HOTP_C1, window: 0 })).toBe(true);
    expect(verifyTotp({ secret: RFC_SECRET, token: HOTP_C0, window: 0 })).toBe(false);
  });

  it("skips negative counters at T=0 without crashing", () => {
    atTime(0);

    expect(verifyTotp({ secret: RFC_SECRET, token: HOTP_C0 })).toBe(true);
  });
});

describe("token normalization and format", () => {
  it("strips whitespace from the token", () => {
    atTime(59);

    expect(verifyTotp({ secret: RFC_SECRET, token: "287 082" })).toBe(true);
  });

  it("rejects non numeric tokens", () => {
    atTime(59);

    expect(verifyTotp({ secret: RFC_SECRET, token: "28708a" })).toBe(false);
  });

  it("rejects tokens whose length does not match the digits setting", () => {
    atTime(59);

    expect(verifyTotp({ secret: RFC_SECRET, token: "28708" })).toBe(false);
    expect(verifyTotp({ secret: RFC_SECRET, token: HOTP_C1, digits: 8 })).toBe(false);
  });

  it("accepts a lowercase base32 secret", () => {
    atTime(59);

    expect(verifyTotp({ secret: RFC_SECRET.toLowerCase(), token: HOTP_C1 })).toBe(true);
  });
});

describe("generateTotpSecret", () => {
  it("produces 32 base32 characters for the default 20 byte length", () => {
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("scales with the requested byte length", () => {
    // 10 octets = 80 bits -> 16 caracteres base32.
    expect(generateTotpSecret(10)).toMatch(/^[A-Z2-7]{16}$/);
  });

  it("produces a different secret at every call", () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });
});

describe("buildOtpAuthUrl", () => {
  it("builds the exact otpauth url with default digits and period", () => {
    const url = buildOtpAuthUrl({
      secret: "ABC234",
      accountName: "user@example.com",
      issuer: "EatPlanner"
    });

    expect(url).toBe(
      "otpauth://totp/EatPlanner%3Auser%40example.com?secret=ABC234&issuer=EatPlanner&algorithm=SHA1&digits=6&period=30"
    );
  });

  it("reflects custom digits and period", () => {
    const url = buildOtpAuthUrl({
      secret: "ABC234",
      accountName: "chef",
      issuer: "EatPlanner",
      digits: 8,
      period: 60
    });

    expect(url).toContain("digits=8");
    expect(url).toContain("period=60");
  });

  it("encodes spaces in the label and the query", () => {
    const url = buildOtpAuthUrl({
      secret: "ABC234",
      accountName: "chef",
      issuer: "Eat Planner"
    });

    expect(url).toContain("otpauth://totp/Eat%20Planner%3Achef?");
    expect(url).toContain("issuer=Eat+Planner");
  });
});
