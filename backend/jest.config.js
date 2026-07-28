/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src/test"],
  setupFiles: ["<rootDir>/src/test/setupEnv.ts"],
  testTimeout: 30000,
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/src/test/tsconfig.json" }]
  }
};
