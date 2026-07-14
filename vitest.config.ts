import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The schema package ships only type declarations at runtime, so we alias it to
// its source to avoid requiring a build step before tests can run.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@demoscope\/schema$/,
        replacement: fileURLToPath(
          new URL("./packages/schema/src/types.ts", import.meta.url)
        ),
      },
      {
        find: /^@demoscope\/timeline$/,
        replacement: fileURLToPath(
          new URL("./packages/timeline/src/index.ts", import.meta.url)
        ),
      },
    ],
  },
  test: {
    include: ["packages/**/*.test.ts"],
    environment: "node",
  },
});
