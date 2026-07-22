import { describe, expect, it, vi } from "vitest";

import { runPollLoop } from "./poll-loop";

describe("runPollLoop", () => {
  it("isolates an iteration failure and continues", async () => {
    const controller = new AbortController();
    const run = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockImplementationOnce(async () => controller.abort());
    const onError = vi.fn();

    await runPollLoop({
      name: "test",
      intervalMs: 1,
      signal: controller.signal,
      run,
      onError,
      wait: async () => {},
    });

    expect(run).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("drains the active iteration before cancellation completes", async () => {
    const controller = new AbortController();
    let finish!: () => void;
    const active = new Promise<void>((resolve) => (finish = resolve));
    const loop = runPollLoop({
      name: "test",
      intervalMs: 1,
      signal: controller.signal,
      run: () => active,
      onError: vi.fn(),
    });

    controller.abort();
    let stopped = false;
    void loop.then(() => (stopped = true));
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish();
    await loop;
    expect(stopped).toBe(true);
  });
});
