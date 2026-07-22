import { describe, expect, it } from "vitest";

import { ConcurrencyGate, HostConcurrencyGate } from "./concurrency";

describe("HD-050 concurrency gates", () => {
  it("bounds concurrent LLM operations", async () => {
    const gate = new ConcurrencyGate(2);
    let active = 0;
    let maximum = 0;
    const work = Array.from({ length: 6 }, () =>
      gate.run(async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        active -= 1;
      }),
    );
    await Promise.all(work);
    expect(maximum).toBe(2);
  });

  it("applies fetch limits independently per host", async () => {
    const gate = new HostConcurrencyGate(1);
    let firstHostActive = 0;
    let firstHostMaximum = 0;
    let totalMaximum = 0;
    let total = 0;
    const run = (url: string) =>
      gate.run(new URL(url), async () => {
        total += 1;
        totalMaximum = Math.max(totalMaximum, total);
        if (url.includes("first")) {
          firstHostActive += 1;
          firstHostMaximum = Math.max(firstHostMaximum, firstHostActive);
        }
        await Promise.resolve();
        if (url.includes("first")) firstHostActive -= 1;
        total -= 1;
      });
    await Promise.all([
      run("https://first.example/a"),
      run("https://first.example/b"),
      run("https://second.example/a"),
    ]);
    expect(firstHostMaximum).toBe(1);
    expect(totalMaximum).toBe(2);
  });
});
