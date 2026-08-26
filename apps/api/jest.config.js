/** @type {import("jest").Config} */
module.exports = {
  testEnvironment: "node",
  rootDir: "src",
  testMatch: ["**/*.spec.ts"],
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/../tsconfig.json" }] },
  moduleNameMapper: {
    // The shared package is resolved from source, and its imports carry .js extensions
    // for NodeNext emit. Jest resolves the TypeScript files, so strip the extension.
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@data-room/shared$": "<rootDir>/../../../packages/shared/src/index.ts",
  },
  collectCoverageFrom: ["**/*.ts", "!**/*.module.ts", "!main.ts", "!**/*.spec.ts"],
  // Deliberately modest while the app is a skeleton. Raised as real logic lands —
  // a threshold nobody can meet gets lowered, which teaches the wrong lesson.
  coverageThreshold: { global: { statements: 60, branches: 50, functions: 60, lines: 60 } },
};
