import type { Message } from "./core";

// Returns messages from the last compaction onward. The store keeps full history
// for the frontend, while the model only sees the post-compaction context.
export function splitAtLastCompaction(messages: Array<Message>) {
    
    for (let i = messages.length - 1; i > 0;  i--) {
        if(messages[i].is_compaction) {
            return messages.slice(i)
        }
    }

    return messages
}


function abortableTool<T>(
  signal: AbortSignal,
  executor: (resolve: (v: T) => void, reject: (e: unknown) => void) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // Already aborted before we even started
    if (signal.aborted) {
      return reject(signal.reason);
    }

    signal.addEventListener("abort", () => reject(signal.reason), { once: true });

    executor(resolve, reject);
  });
}

/**
 * Wraps a Promise to make it abortable via an AbortSignal.
 * When the signal aborts, the returned Promise rejects immediately,
 * even if the wrapped Promise is still pending (e.g., waiting on pushAndWait).
 *
 * @example
 * await abortablePromise(signal, tool.run(inputs, handOver))
 */
export function abortablePromise<T>(
  signal: AbortSignal | undefined,
  promise: Promise<T>
): Promise<T> {
  // If no signal, just return the original promise
  if (!signal) return promise;

  // If already aborted, reject immediately
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error("Aborted"));
  }

  // Race the promise against abort
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason ?? new Error("Aborted"));
    };

    signal.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}