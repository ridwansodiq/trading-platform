import eslint from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

/**
 * Module and layer boundaries, enforced rather than only documented. Each rule
 * below corresponds to a line in AGENTS.md.
 *
 * Two things to know before editing:
 *
 *  1. `no-restricted-imports` patterns match the *import specifier text*, not
 *     the resolved path. `**\/modules/auth/**` will never match
 *     `../../auth/services/auth.service`, so patterns are written against
 *     the relative forms the code actually uses.
 *  2. In flat config, a later block *replaces* a rule for overlapping files
 *     instead of merging with it. So every file pattern must carry its complete
 *     set of restrictions — hence the composed arrays below.
 *
 * Both mistakes fail silently, which is why `npm run lint:boundaries` asserts
 * that each rule actually rejects a forbidden import.
 */

const noFastify = {
  group: ["fastify", "fastify/*", "@fastify/*", "fastify-*"],
  message: "Only routes and middleware may depend on Fastify."
};

const noPrisma = {
  group: ["@prisma/client", "prisma", "**/infrastructure/database/*", "../**/database/prisma*"],
  message: "This layer must not access Prisma. Go through a repository."
};

const noPrismaForRoutes = {
  group: ["@prisma/client", "prisma", "**/infrastructure/database/*", "../**/database/prisma*"],
  message: "Routes must not access Prisma. Call a service."
};

const noRepositories = {
  group: ["**/repositories/*", "../repositories/*", "./repositories/*"],
  message: "Routes must not use repositories directly. Call a service."
};

const noServices = {
  group: ["**/services/*", "../services/*", "./services/*"],
  message: "Persistence must not depend on the layers above it."
};

const noRoutes = {
  group: ["**/routes/*", "../routes/*", "./routes/*"],
  message: "Inner layers must not import routes."
};

/** Anything below the barrel of another module. `../../auth/index` is fine. */
const noAuthInternals = {
  group: ["**/auth/*/*", "**/auth/*/**", "../auth/*/**", "../../auth/*/**"],
  message:
    "Import another module through its index.ts, never from inside it. Trade routes receive `requireAuth` from the composition root."
};

/** For everything in trades except routes: no contact with auth at all. */
const noAuthModule = {
  group: ["**/auth", "**/auth/**", "../auth/**", "../../auth/**"],
  message:
    "The trades module must not import the auth module. Accept an authenticated actor as a plain value."
};

const noModuleInternals = {
  group: [
    "**/modules/*/services/*",
    "**/modules/*/repositories/*",
    "**/modules/*/routes/*",
    "../../modules/*/services/*",
    "../../modules/*/repositories/*",
    "../../modules/*/routes/*"
  ],
  message:
    "Realtime must not import module internals. Depend on a type from the module barrel and let the service call in."
};

const noModules = {
  group: ["**/modules/**", "../**/modules/**", "**/realtime/**", "../**/realtime/**"],
  message: "Infrastructure is the bottom of the stack and must not depend on modules."
};

// ── Frontend ───────────────────────────────────────────────────────────────

/**
 * A feature owns a vertical slice. Reaching into another one couples two
 * slices through their internals, which is the thing the layout prevents.
 * Cross-feature sharing goes to `components/`, `hooks/`, `lib/` or `types/`.
 *
 * One entry per other feature rather than a negated wildcard, because the
 * patterns match specifier text: a relative `../../auth/...` has to be listed
 * as well as the aliased `@/features/auth/...`.
 */
const noFeature = (other) => ({
  group: [
    `@/features/${other}`,
    `@/features/${other}/**`,
    `../../${other}/**`,
    `../../../features/${other}/**`
  ],
  message: `Features are vertical slices. Promote anything ${other} shares to components/, hooks/, lib/ or types/.`
});

const noFeatureImportsFromShared = {
  group: ["@/features/**", "../features/**", "../../features/**", "../../../features/**"],
  message: "Shared code must not depend on a feature. Take what it needs as props or arguments."
};

const restrict = (...patterns) => ({
  "no-restricted-imports": ["error", { patterns }]
});

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "frontend/src/api/generated/**"
    ]
  },

  {
    rules: {
      /*
       * A leading underscore marks something deliberately unused: a
       * compile-time assertion that only has to typecheck, or a binding
       * destructured purely to omit it from a rest spread.
       */
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true
        }
      ]
    }
  },

  // ── Trades module ────────────────────────────────────────────────────────
  {
    files: ["backend/src/modules/trades/routes/**/*.ts"],
    rules: restrict(noPrismaForRoutes, noRepositories, noAuthInternals)
  },
  {
    files: ["backend/src/modules/trades/services/**/*.ts"],
    rules: restrict(noFastify, noPrisma, noRoutes, noAuthModule)
  },
  {
    files: ["backend/src/modules/trades/repositories/**/*.ts"],
    rules: restrict(noFastify, noRoutes, noServices, noAuthModule)
  },
  {
    files: [
      "backend/src/modules/trades/types.ts",
      "backend/src/modules/trades/errors/**/*.ts",
      "backend/src/modules/trades/mappers/**/*.ts",
      "backend/src/modules/trades/schemas/**/*.ts"
    ],
    rules: restrict(noFastify, noAuthModule)
  },

  // ── Auth module ──────────────────────────────────────────────────────────
  {
    files: ["backend/src/modules/auth/routes/**/*.ts"],
    rules: restrict(noPrismaForRoutes, noRepositories)
  },
  {
    files: ["backend/src/modules/auth/services/**/*.ts"],
    rules: restrict(noFastify, noPrisma, noRoutes)
  },
  {
    files: ["backend/src/modules/auth/repositories/**/*.ts"],
    rules: restrict(noFastify, noRoutes, noServices)
  },

  // ── Cross-cutting ────────────────────────────────────────────────────────
  {
    files: ["backend/src/realtime/**/*.ts"],
    rules: restrict(noModuleInternals, noPrisma)
  },
  {
    files: ["backend/src/infrastructure/**/*.ts"],
    rules: restrict(noModules)
  },

  // ── Frontend ─────────────────────────────────────────────────────────────
  {
    files: ["frontend/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      /*
       * The blotter's correctness leans on hooks: the SSE watchdog, the
       * dirty-field baseline and the keyboard cursor all depend on effects
       * firing exactly when their inputs change. A wrong dependency array is
       * a stale-data bug, so these are errors rather than warnings.
       */
      ...reactHooks.configs.recommended.rules,
      "react-hooks/exhaustive-deps": "error"
    }
  },
  {
    files: ["frontend/src/features/trades/**/*.{ts,tsx}"],
    rules: restrict(noFeature("auth"))
  },
  {
    files: ["frontend/src/features/auth/**/*.{ts,tsx}"],
    rules: restrict(noFeature("trades"))
  },
  {
    files: [
      "frontend/src/components/**/*.{ts,tsx}",
      "frontend/src/lib/**/*.ts",
      "frontend/src/hooks/**/*.ts",
      "frontend/src/types/**/*.ts"
    ],
    rules: restrict(noFeatureImportsFromShared)
  },
  {
    // Vendored ShadCN primitives are generated by the shadcn CLI, not
    // hand-maintained, so they are exempt from our own style rules.
    files: ["frontend/src/components/ui/**/*.tsx"],
    plugins: { "react-refresh": reactRefresh },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "react-refresh/only-export-components": "off",
      ...restrict(noFeatureImportsFromShared)
    }
  },

  // ── Tooling ──────────────────────────────────────────────────────────────
  {
    // Build scripts and config run in Node before the app exists.
    files: ["scripts/**/*.mjs", "*.config.{ts,mjs}", "**/*.config.{ts,mjs}"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } }
  }
);
