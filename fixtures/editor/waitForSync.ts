import { TiptapCollabProvider } from "@tiptap-pro/provider";
import { promisify } from "../utils/promisify";

type Milliseconds = number;

interface WaitForSyncOptions {
  timeout?: Milliseconds;
}

const defaults = {
  timeout: 5_000,
} as const satisfies WaitForSyncOptions;

/**
 * Wait for the given provider to be synced.
 */
export function waitForSync(
  provider: TiptapCollabProvider,
  options?: WaitForSyncOptions
): Promise<void> {
  const { timeout } = { ...defaults, ...options };

  provider.attach();
  if (provider.isSynced) {
    return Promise.resolve();
  }

  return promisify((callback) => {
    provider.on("synced", callback);
    return () => {
      provider.off("synced");
    };
  }, AbortSignal.timeout(timeout));
}
