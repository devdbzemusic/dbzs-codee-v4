// ESLint flat config for the pnpm workspace (apps/desktop + packages/shared).
//
// Primary motivation (2026-08-04): a missing `await` on an async function
// call went undetected for days, silently breaking a production feature
// (visionContextPackService.ts). @typescript-eslint/no-floating-promises
// would have flagged that at write-time. This config exists to catch that
// class of bug, not to enforce a large stylistic ruleset -- kept
// deliberately small so it stays useful rather than becoming noise.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-electron/**",
      "**/out/**",
      "**/build/**",
      "**/.cache/**",
      "**/coverage/**",
      "**/*.d.ts",
      "apps/desktop/electron-data/**",
      "test-fixtures/**",
      // vendored/bundled skill package content, not maintained here
      "**/.system/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // apps/desktop/tsconfig.json only extends tsconfig.web.json -- it
        // does not reference tsconfig.node.json (electron/**), so
        // projectService's default-project auto-discovery never finds the
        // latter (mirrors the project's own `typecheck` script, which
        // invokes tsc against both explicitly rather than relying on
        // TS project references). List every project explicitly instead.
        project: [
          "./apps/desktop/tsconfig.web.json",
          "./apps/desktop/tsconfig.node.json",
          "./packages/shared/tsconfig.json"
        ],
        tsconfigRootDir: import.meta.dirname
      },
      globals: { ...globals.browser, ...globals.node }
    },
    plugins: {
      "react-hooks": reactHooks
    },
    rules: {
      // The rules this config exists for (2026-08-04: a missing `await`
      // went unnoticed for days and broke a production feature). Currently
      // "warn", not "error": a first full-codebase run found 48 pre-existing
      // instances. Spot-checking several (e.g. observabilityService.ts's
      // persistTrace() calls) showed the flagged function has its own
      // complete try/catch and can never actually reject -- a real but
      // low-severity finding, not a repeat of the approve_patch-class bug.
      // Triaging all 48 individually was out of scope for introducing this
      // config; downgrade to "error" once that backlog is swept (or as each
      // file is touched). New violations are still visible in `pnpm lint`
      // and ci-local's non-blocking lint step.
      "@typescript-eslint/no-floating-promises": ["warn", { ignoreVoid: true }],
      "@typescript-eslint/no-misused-promises": "warn",

      // typescript-eslint's type-checked recommended preset is broad and
      // would surface a large volume of pre-existing, low-severity findings
      // (unused vars already caught by tsc, `any` usage, non-null assertions)
      // unrelated to the bug class above. Downgraded to warn (visible, not
      // blocking) rather than silently disabled, so they're not invisible --
      // just not a merge-blocking gate on day one.
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/require-await": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/restrict-template-expressions": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/no-base-to-string": "warn",
      "@typescript-eslint/no-redundant-type-constituents": "warn",
      "@typescript-eslint/no-duplicate-type-constituents": "warn",
      "@typescript-eslint/unbound-method": "warn",
      "@typescript-eslint/prefer-promise-reject-errors": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",

      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn"
    }
  },
  {
    // Test files: relax the noisier type-safety rules -- mocks and fixtures
    // routinely need loose typing. Promise rules stay at their default
    // (currently warn) since an unhandled rejection in a test is exactly
    // the shape of bug that hid the approve_patch regression for two days.
    files: ["**/*.test.ts", "**/*.test.tsx", "**/testing/**", "**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off"
    }
  },
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    ...tseslint.configs.disableTypeChecked
  },
  {
    // Excluded from every production tsconfig by the project's own design
    // (apps/desktop/tsconfig.web.json excludes src/testing; packages/shared/
    // tsconfig.json excludes *.test.ts -- vitest handles these, not tsc).
    // No type info available, so type-aware rules can't run here; fall back
    // to syntax-only linting instead of a parsing error.
    files: ["apps/desktop/src/testing/**", "packages/shared/src/**/*.test.ts"],
    ...tseslint.configs.disableTypeChecked
  }
);
