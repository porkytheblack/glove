/** Bound preparation (policy/credentials), transport and response reading. */
export async function withDeadline<T>(
  ms: number,
  parent: AbortSignal | undefined,
  work: (signal: AbortSignal, commit: () => void) => Promise<T>,
): Promise<T> {
  if (parent?.aborted) throw new Error("HTTP request aborted by the host");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let abort: () => void;
  const failure = new Promise<never>((_, reject) => {
    abort = () => { controller.abort(); reject(new Error("HTTP request aborted by the host")); };
    parent?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => { controller.abort(); reject(new Error("HTTP request timed out")); }, ms);
  });
  const commit = () => {
    if (controller.signal.aborted) throw new Error("HTTP request aborted");
    // Do not report a timeout after a filesystem commit has begun.
    clearTimeout(timer!);
    parent?.removeEventListener("abort", abort!);
  };
  try { return await Promise.race([work(controller.signal, commit), failure]); }
  finally {
    clearTimeout(timer!);
    parent?.removeEventListener("abort", abort!);
    controller.abort(); // stop late continuations of timed-out host callbacks
  }
}
