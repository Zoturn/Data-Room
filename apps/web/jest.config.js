/** @type {import("jest").Config} */
module.exports = {
  testEnvironment: "node",
  rootDir: "src",
  // Jest covers hooks, utilities and pure logic. Components are tested with Cypress
  // Component Testing — see apps/web/.claude/rules/testing.md.
  testMatch: ["**/*.spec.ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: { module: "CommonJS", moduleResolution: "Node" } }],
  },
  moduleNameMapper: {
    // The shared package is resolved from source, and its imports carry .js extensions
    // for NodeNext emit. Jest resolves the TypeScript files, so strip the extension.
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@/(.*)$": "<rootDir>/$1",
    "^@data-room/shared$": "<rootDir>/../../../packages/shared/src/index.ts",
  },
};
