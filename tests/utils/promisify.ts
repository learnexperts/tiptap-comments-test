interface Unsubscribe {
  (): void;
}

interface Callback<T> {
  (value: T): void;
}

interface Subscribe<T> {
  (callback: Callback<T>): Unsubscribe;
}

export function promisify<T>(
  subscribe: Subscribe<T>,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const unsubscribe = subscribe((value) => {
      cleanup();
      resolve(value);
    });

    function onAbort() {
      cleanup();
      reject(signal!.reason);
    }

    function cleanup() {
      unsubscribe();
      signal?.removeEventListener("abort", onAbort);
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export default promisify;
