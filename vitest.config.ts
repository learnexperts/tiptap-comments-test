import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Four projects, each with its own command — see
 * `docs/adr/0001-tests-are-a-bug-report.md`.
 *
 * `pnpm test` runs `repro` only, so the default run is the defect itself and
 * the all-green probes cannot bury it.
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
        // utils tests above are not collected twice.
        extends: true,
        test: { name: "repro", include: ["tests/*.test.ts"] },
      },
      {
        // The same matrix with the stopgap applied. All green.
        extends: true,
        test: { name: "probes", include: ["tests/probes/**/*.probe.ts"] },
      },
    ],
  },
});
