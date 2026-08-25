#!/usr/bin/env node
// The testing rules permit Jest and Cypress and nothing else. This makes that mechanical:
// any other runner or assertion library appearing in a workspace manifest fails `pnpm lint`.
import { readFileSync, globSync } from "node:fs";
import path from "node:path";

const FORBIDDEN = [
  "vitest",
  "@vitest/ui",
  "mocha",
  "chai",
  "jasmine",
  "ava",
  "tape",
  "supertest",
  "@playwright/test",
  "playwright",
  "puppeteer",
  "@testing-library/react",
  "@testing-library/dom",
  "@testing-library/user-event",
  "@testing-library/jest-dom",
  "enzyme",
  "node-mocks-http",
];

const manifests = globSync(["package.json", "apps/*/package.json", "packages/*/package.json"], {
  exclude: (p) => p.includes("node_modules"),
});

const violations = [];

for (const file of manifests) {
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  for (const name of Object.keys(deps)) {
    if (FORBIDDEN.includes(name)) {
      violations.push(`${path.normalize(file)} depends on "${name}"`);
    }
  }
}

if (violations.length > 0) {
  console.error("Forbidden test dependency found. This repository uses Jest and Cypress only.\n");
  for (const v of violations) console.error(`  - ${v}`);
  console.error(
    "\nUse Jest for units and logic, Cypress for HTTP, components and user flows.\n" +
      "See apps/api/.claude/rules/testing.md and apps/web/.claude/rules/testing.md.",
  );
  process.exit(1);
}

console.log(`check:test-runners — ${manifests.length} manifests clean (Jest and Cypress only)`);
