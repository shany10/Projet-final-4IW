/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src/test"],
  setupFiles: ["<rootDir>/src/test/setupEnv.ts"],
  testTimeout: 30000,
  // Mesure honnete : sans collectCoverageFrom, les fichiers jamais importes
  // par les tests n'apparaissent pas dans le rapport.
  collectCoverageFrom: [
    "src/**/*.ts",
    "index.ts",
    "instrument.ts",
    "!src/test/**",
    "!src/types/**"
  ],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/src/test/tsconfig.json" }]
  }
};
