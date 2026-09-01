import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * The anchor-loss probes are historical bug-hunt cases (see
 * `tests/probes/anchor-loss.probe.ts`). They are kept out of the default
 * `pnpm test` run — which is why they use a `.probe.ts` suffix rather than
 * `.test.ts` — so the curated matrix stays readable. Run them with
 * `pnpm test:probes`.
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
    include: ["tests/probes/**/*.probe.ts"],
  },
});
