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
    "src/app/.well-known/workflow/**",
  ]),
  // ADR-6 has teeth: every structured model call goes through src/lib/ai/.
  // Importing the raw OpenAI client or the AI SDK's generateObject anywhere else
  // means a call site is hand-rolling retry, validation, cost logging, model
  // selection — and, critically, skipping the no-fabrication numeric guard.
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "scripts/**/*.ts"],
    ignores: [
      // the sanctioned home of every model call
      "src/lib/ai/**",
      // Pre-ADR-6 call sites, grandfathered until they migrate to generateStructured().
      // DO NOT ADD TO THIS LIST. Adding a file here is opting a surface out of the
      // no-fabrication guarantee.
      "src/lib/usageTracker.ts",
      "src/lib/anonScore.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "openai",
              message:
                "ADR-6: do not use the OpenAI client directly. Call generateStructured() from src/lib/ai/structured.ts.",
            },
            {
              name: "ai",
              importNames: ["generateObject", "streamObject"],
              message:
                "ADR-6: generateObject is owned by src/lib/ai/structured.ts, which applies zod validation, the numeric guard and cost logging. Call generateStructured() instead.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
