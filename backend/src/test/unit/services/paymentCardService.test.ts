import {
  detectCardBrand,
  getCardLast4,
  isCardExpired,
  isValidCardNumber,
  normalizeCardNumber
} from "../../../services/paymentCardService";

describe("normalizeCardNumber", () => {
  it("strips spaces and dashes", () => {
    expect(normalizeCardNumber("4242 4242-4242 4242")).toBe("4242424242424242");
  });

  it("returns an empty string unchanged", () => {
    expect(normalizeCardNumber("")).toBe("");
  });
});

describe("isValidCardNumber", () => {
  it.each([
    ["4242424242424242"],
    ["4111111111111111"],
    ["5555555555554444"],
    ["378282246310005"],
    ["424242424242"]
  ])("accepts the Luhn valid number %s", (value) => {
    expect(isValidCardNumber(value)).toBe(true);
  });

  it("accepts numbers formatted with spaces and dashes", () => {
    expect(isValidCardNumber("4242 4242-4242 4242")).toBe(true);
  });

  it.each([
    ["4242424242424241", "checksum invalide"],
    ["42424242424", "11 chiffres, sous la garde de longueur"],
    ["42424242424242424242", "20 chiffres, au dela de la garde"],
    ["4242abcd42424242", "caracteres non numeriques"],
    ["", "chaine vide"]
  ])("rejects %s (%s)", (value) => {
    expect(isValidCardNumber(value)).toBe(false);
  });
});

describe("detectCardBrand", () => {
  it.each([
    ["4242424242424242", "visa"],
    ["4000000000000000", "visa"],
    ["5155551234567890", "mastercard"],
    ["5555555555554444", "mastercard"],
    ["5055551234567890", "cb"],
    ["5655551234567890", "cb"],
    ["2221000000000009", "mastercard"],
    ["2320000000000000", "mastercard"],
    ["2650000000000000", "mastercard"],
    ["2720000000000000", "mastercard"],
    ["2210000000000000", "cb"],
    ["2121000000000000", "cb"],
    ["2730000000000000", "cb"],
    ["2800000000000000", "cb"],
    ["340000000000000", "amex"],
    ["370000000000000", "amex"],
    ["360000000000000", "cb"],
    ["6011000000000000", "cb"],
    ["", "cb"]
  ] as const)("detects %s as %s", (value, brand) => {
    expect(detectCardBrand(value)).toBe(brand);
  });

  it("matches the 222x prefix as mastercard even for 2220 (current regex behavior)", () => {
    // La plage ISO commence a 2221 mais la regex du code accepte tout prefixe
    // 222x : ce test fige le comportement actuel.
    expect(detectCardBrand("2220000000000000")).toBe("mastercard");
  });

  it("detects the brand on formatted input", () => {
    expect(detectCardBrand("4242 4242 4242 4242")).toBe("visa");
  });
});

describe("getCardLast4", () => {
  it("returns the last four digits of a formatted number", () => {
    expect(getCardLast4("4242 4242 4242 1234")).toBe("1234");
  });

  it("returns the whole string when shorter than four digits", () => {
    expect(getCardLast4("12")).toBe("12");
  });
});

describe("isCardExpired", () => {
  it("keeps a card valid until the last instant of its expiry month", () => {
    expect(isCardExpired(12, 2025, new Date(2025, 11, 31, 23, 59, 59))).toBe(false);
  });

  it("expires the card exactly at midnight on the first day of the next month", () => {
    expect(isCardExpired(12, 2025, new Date(2026, 0, 1, 0, 0, 0))).toBe(true);
  });

  it("handles mid-year expiries", () => {
    expect(isCardExpired(6, 2025, new Date(2025, 5, 30, 12))).toBe(false);
    expect(isCardExpired(6, 2025, new Date(2025, 6, 1))).toBe(true);
  });

  it("handles january expiries without an off-by-one on the year", () => {
    expect(isCardExpired(1, 2026, new Date(2026, 0, 15))).toBe(false);
    expect(isCardExpired(1, 2026, new Date(2026, 1, 1))).toBe(true);
  });

  it("flags a long expired card", () => {
    expect(isCardExpired(3, 2020, new Date(2026, 0, 1))).toBe(true);
  });
});
