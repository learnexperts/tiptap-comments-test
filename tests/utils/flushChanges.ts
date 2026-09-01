import type { TiptapCollabProvider } from "@tiptap-pro/provider";
import { vi } from "vitest";

interface FlushChangesOptions {
  timeout?: number;
  /** CommentsKit `onTransaction` debounce is 350ms. */
  debounceMs?: number;
  /**
   * If `hasUnsyncedChanges` stays true after Y is quiet this long, the
   * Hocuspocus SyncStatus counter is stuck (applied=false, or origin-null
   * writes like `__tiptapcollab__users`). Proceed and let assertions check
   * the document.
   */
  stuckQuietMs?: number;
}

/**
 * Wait until local Y updates have been sent and acked — without calling
 * `startSync()`, which resets `unsyncedChanges` to 1 and re-runs a handshake
 * that can increment the counter again (PermanentUserData, thread store).
 */
export async function waitUntilFlushed(
  provider: TiptapCollabProvider,
  options?: FlushChangesOptions
): Promise<void> {
  const timeout = options?.timeout ?? 10_000;
  const debounceMs = options?.debounceMs ?? 400;
  const stuckQuietMs = options?.stuckQuietMs ?? 1_500;
  const ydoc = provider.document;
  let lastUpdateAt = Date.now();

  const onUpdate = () => {
    lastUpdateAt = Date.now();
  };

  ydoc.on("update", onUpdate);

  try {
    await vi.waitUntil(
      () => {
        const quietMs = Date.now() - lastUpdateAt;
        if (quietMs < debounceMs) {
          return false;
        }
        if (!provider.hasUnsyncedChanges) {
          return true;
        }
        return quietMs >= stuckQuietMs;
      },
      { timeout, interval: 50 }
    );
  } finally {
    ydoc.off("update", onUpdate);
  }
}
