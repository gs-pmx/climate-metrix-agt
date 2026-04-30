// Flat config for ESLint 9. Pre-this-file, ``npm run lint`` failed with
// the "default configuration file is now eslint.config.js" migration
// warning since the project shipped without any eslint config at all.
//
// Scope: cover the React + Vite + plain-JS code under ``src``, plus the
// node-based test files. We pull in eslint:recommended, the react-hooks
// recommended ruleset, and react-refresh's only-export-components rule
// so Vite hot-module reload stays well-formed. ``no-unused-vars`` is
// downgraded to warn and respects an underscore prefix to match the
// codebase's existing convention.

import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default [
  {
    // Don't lint the build output, vendored deps, or coverage artifacts.
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...(reactHooks.configs?.["recommended-latest"]?.rules
        ?? reactHooks.configs?.recommended?.rules
        ?? {}),
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      // Keep ``_unused`` variables and arguments quiet — common idiom in
      // this codebase for "I'm receiving this, but the body doesn't use
      // it" (e.g. event handler signatures).
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // ``react-hooks/refs`` (added in eslint-plugin-react-hooks v7) flags
      // ``ref.current = X`` assignments during render as errors. The
      // codebase uses that pattern in a handful of places — most notably
      // the activitiesRef / facilitiesRef "snap latest state for
      // event-handler reads" pattern that the F1.5 calc-staleness fix
      // depends on. Migrating those to ``useEffect`` is a real change
      // with timing implications (the ref would lag one commit), so we
      // keep the rule active but at warn level for visibility while
      // deferring the case-by-case migration to a follow-up. The
      // existing call sites are documented in the PR description.
      "react-hooks/refs": "warn",
    },
  },
  {
    // Test files run under ``node --test`` (ESM); make sure node globals
    // resolve. Most test files already import explicitly, but this keeps
    // ``process`` / ``Buffer`` / etc. clean if any sneak in.
    files: ["**/*.test.{js,jsx}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
