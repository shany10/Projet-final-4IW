/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src/test"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/src/test/tsconfig.json" }]
  }
};
