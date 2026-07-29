// express-rate-limit est mocke pour capturer l'objet d'options construit par
// le module (lu depuis l'environnement au chargement), sans dependre des
// internals de la librairie.

jest.mock("express-rate-limit", () => ({
  __esModule: true,
  default: jest.fn(() => jest.fn())
}));

type LimiterOptions = {
  windowMs: number;
  limit: number;
  standardHeaders: string;
  legacyHeaders: boolean;
  message: { error: string };
};

const ORIGINAL_ENV = {
  AUTH_RATE_LIMIT_WINDOW_MS: process.env.AUTH_RATE_LIMIT_WINDOW_MS,
  AUTH_RATE_LIMIT_MAX: process.env.AUTH_RATE_LIMIT_MAX
};

function loadLimiterOptions(env: { windowMs?: string; max?: string }): LimiterOptions {
  jest.resetModules();

  if (env.windowMs === undefined) {
    delete process.env.AUTH_RATE_LIMIT_WINDOW_MS;
  } else {
    process.env.AUTH_RATE_LIMIT_WINDOW_MS = env.windowMs;
  }
  if (env.max === undefined) {
    delete process.env.AUTH_RATE_LIMIT_MAX;
  } else {
    process.env.AUTH_RATE_LIMIT_MAX = env.max;
  }

  // Charger d'abord le mock dans le registre courant, puis le module teste.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mocked = require("express-rate-limit") as { default: jest.Mock };
  mocked.default.mockClear();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("../../../middlewares/rateLimitMiddleware");

  expect(mocked.default).toHaveBeenCalledTimes(1);
  return mocked.default.mock.calls[0]?.[0] as LimiterOptions;
}

afterAll(() => {
  for (const key of ["AUTH_RATE_LIMIT_WINDOW_MS", "AUTH_RATE_LIMIT_MAX"] as const) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("authRateLimiter configuration", () => {
  it("defaults to a 15 minute window and 20 attempts", () => {
    const options = loadLimiterOptions({});

    expect(options.windowMs).toBe(15 * 60 * 1000);
    expect(options.limit).toBe(20);
  });

  it("reads the window and the limit from the environment", () => {
    const options = loadLimiterOptions({ windowMs: "60000", max: "5" });

    expect(options.windowMs).toBe(60000);
    expect(options.limit).toBe(5);
  });

  it("silently produces NaN on malformed environment values (documented)", () => {
    // Number("abc") vaut NaN : le limiteur est alors construit avec des
    // options invalides sans aucune erreur. Ce test fige ce comportement.
    const options = loadLimiterOptions({ windowMs: "abc", max: "not-a-number" });

    expect(Number.isNaN(options.windowMs)).toBe(true);
    expect(Number.isNaN(options.limit)).toBe(true);
  });

  it("pins the fixed options: draft-7 headers, no legacy headers, error message", () => {
    const options = loadLimiterOptions({});

    expect(options.standardHeaders).toBe("draft-7");
    expect(options.legacyHeaders).toBe(false);
    expect(options.message).toEqual({ error: "Too many attempts, please try again later" });
  });
});
