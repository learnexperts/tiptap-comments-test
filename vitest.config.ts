import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Three projects, plus a `writeback` tag, each chosen by its own command — see
 * `docs/adr/0001-tests-are-a-bug-report.md`.
 *
 * `pnpm test` runs `repro` without the `writeback` tag, so the default run is
 * the defects themselves and the all-green workaround halves cannot bury them.
 */
export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./"),
    },
  },

  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./setup.ts"],
    // The test names are the report, so print the whole tree.
    reporters: ["tree"],
    tags: [
      {
        name: "writeback",
        description:
          "The matrices with workaround/ added. Held out of `pnpm test`.",
      },
    ],

    projects: [
      {
        // Unit tests for the helpers the repro leans on. Offline.
        extends: true,
        test: { name: "utils", include: ["tests/utils/**/*.test.ts"] },
      },
      {
        // The workaround's own contract. Offline, and green.
        extends: true,
        test: {
          name: "workaround",
          include: ["workaround/**/*.test.ts"],
        },
      },
      {
        // The report itself. `tests/*.test.ts` is deliberately not `**` so the
        // utils tests above are not collected twice. The matrices' `writeback`
        // halves live here too; the scripts choose them by tag.
        extends: true,
        test: { name: "repro", include: ["tests/*.test.ts"] },
      },
    ],
  },
});
