/** One deadline covers headers and body; abort also bounds non-cooperative fetch mocks. */
export async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch = globalThis.fetch,
  readErrorBody = false,
): Promise<{ response: Response; body: unknown }> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const userSignal = init.signal;
  userSignal?.addEventListener("abort", abort, { once: true });
  if (userSignal?.aborted) controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  let rejectOnAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
    if (controller.signal.aborted) rejectOnAbort();
  });
  try {
    if (controller.signal.aborted) return await aborted;
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, { ...init, signal: controller.signal });
        const body = response.ok || readErrorBody ? await response.json() : null;
        return { response, body };
      })(),
      aborted,
    ]);
  } finally {
    clearTimeout(timer);
    userSignal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectOnAbort);
  }
}
