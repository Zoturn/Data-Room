/** @type {import("jest").Config} */
export default {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.spec.ts"],
  // The package ships ESM, but tests compile to CJS so Jest needs no experimental
  // VM flag — which is not portable across the shells this runs in.
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      { tsconfig: { module: "CommonJS", moduleResolution: "Node", verbatimModuleSyntax: false } },
    ],
  },
};
