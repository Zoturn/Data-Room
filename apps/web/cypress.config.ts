import { defineConfig } from "cypress";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

/**
 * Cypress covers everything with a DOM: components through Component Testing, and the
 * graded user flows through e2e. Jest stays on pure logic. Testing Library and Playwright
 * are not permitted — see apps/web/.claude/rules/testing.md.
 *
 * Components are bundled with Vite rather than Next's webpack. Next 15's style loader
 * cannot find an insertion point inside Cypress's harness and hangs the run; Vite serves
 * the same components with real Tailwind styles in a fraction of the time. The bundler is
 * an implementation detail of the harness — the runner is still Cypress, and the ban in the
 * testing rules is on Vitest, which is a runner, not on Vite, which is not.
 */
export default defineConfig({
  component: {
    devServer: {
      framework: "react",
      bundler: "vite",
      viteConfig: {
        plugins: [react(), tailwindcss()],
        resolve: { alias: { "@": path.resolve(__dirname, "src") } },
      },
    },
    supportFile: "cypress/support/component.tsx",
    specPattern: "cypress/component/**/*.cy.tsx",
    video: false,
    // The Electron renderer crashes without these on this workload. Cypress keeps every
    // test's DOM snapshot in memory by default, which the bundled renderer cannot hold.
    experimentalMemoryManagement: true,
    numTestsKeptInMemory: 0,
  },
  e2e: {
    baseUrl: process.env["WEB_URL"] ?? "http://localhost:3000",
    supportFile: "cypress/support/e2e.ts",
    specPattern: "cypress/e2e/**/*.cy.ts",
    video: false,
    defaultCommandTimeout: 10_000,
    retries: { runMode: 1, openMode: 0 },
  },
});
