import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/*.config.js",
      "**/*.config.mjs",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,

  {
    rules: {
      // The typescript rule says: no `any`, no silencing casts, no non-null assertions.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSAsExpression[typeAnnotation.typeName.name!='const']",
          message:
            "Casts hide type errors. Narrow with a runtime check instead; see .claude/rules/typescript.md.",
        },
      ],
    },
  },

  // Workspace boundary: the two apps must not reach into each other.
  // Everything they share travels through packages/shared.
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/apps/api/**", "@data-room/api", "@data-room/api/**"],
              message:
                "apps/web must not import from apps/api. Put shared contract types in packages/shared.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/api/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/apps/web/**", "@data-room/web", "@data-room/web/**"],
              message:
                "apps/api must not import from apps/web. Put shared contract types in packages/shared.",
            },
          ],
        },
      ],
    },
  },

  // Only the storage module may talk to the provider SDK directly.
  {
    files: ["apps/api/src/**/*.ts"],
    ignores: ["apps/api/src/storage/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@supabase/supabase-js",
              message:
                "Only apps/api/src/storage may use the provider SDK; go through StorageService.",
            },
          ],
        },
      ],
    },
  },

  // Build scripts run on Node, outside any workspace's tsconfig.
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly", URL: "readonly", fetch: "readonly" },
    },
  },

  // Tests may be looser about casts, but not about `any`.
  {
    files: ["**/*.spec.ts", "**/*.spec.tsx", "**/*.cy.ts", "**/*.cy.tsx", "**/cypress/**"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
);
