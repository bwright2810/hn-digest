export interface PollLoopOptions {
  readonly name: string;
  readonly intervalMs: number;
  readonly signal: AbortSignal;
  readonly run: () => Promise<void>;
  readonly onError: (error: unknown) => void;
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export async function runPollLoop(options: PollLoopOptions): Promise<void> {
  if (!Number.isInteger(options.intervalMs) || options.intervalMs <= 0) {
    throw new RangeError(`${options.name} interval must be a positive integer`);
  }
  const wait = options.wait ?? abortableWait;
  while (!options.signal.aborted) {
    try {
      await options.run();
    } catch (error) {
      options.onError(error);
    }
    if (!options.signal.aborted) {
      await wait(options.intervalMs, options.signal);
    }
  }
}

export function abortableWait(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timeout = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
