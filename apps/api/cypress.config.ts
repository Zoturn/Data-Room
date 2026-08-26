import { defineConfig } from "cypress";

/**
 * API end-to-end tests drive the real listening server through cy.request — deliberately
 * not an in-process handler, because guards, filters, pipes and cookies are exactly what a
 * reviewer will exercise. See apps/api/.claude/rules/testing.md.
 */
export default defineConfig({
  e2e: {
    baseUrl: process.env["API_URL"] ?? "http://localhost:3001",
    supportFile: "cypress/support/e2e.ts",
    specPattern: "cypress/e2e/**/*.cy.ts",
    fixturesFolder: "cypress/fixtures",
    video: false,
    screenshotOnRunFailure: false,
    // Long enough to cover a cold Supabase connection, short enough to fail a hung
    // request rather than hang the pipeline.
    defaultCommandTimeout: 10_000,
    retries: { runMode: 1, openMode: 0 },
  },
});
