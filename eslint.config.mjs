import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["app/market-chart.tsx", "app/trading-dashboard.tsx", "app/home-market-rankings.tsx"],
    rules: {
      // These client views intentionally reset loading/result state when a
      // market, symbol, ranking tab, dialog target, or route view changes
      // before starting the corresponding async request lifecycle. Keep the
      // heuristic visible in CI without failing otherwise-valid fetch
      // synchronization effects.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
