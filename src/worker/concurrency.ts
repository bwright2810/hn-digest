export class ConcurrencyGate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new RangeError("concurrency limit must be a positive integer");
    }
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
  }

  private release(): void {
    this.active -= 1;
    this.waiting.shift()?.();
  }
}

export class HostConcurrencyGate {
  private readonly hosts = new Map<string, ConcurrencyGate>();

  constructor(readonly limitPerHost: number) {
    if (!Number.isInteger(limitPerHost) || limitPerHost <= 0) {
      throw new RangeError(
        "per-host concurrency limit must be a positive integer",
      );
    }
  }

  run<T>(url: URL, operation: () => Promise<T>): Promise<T> {
    let gate = this.hosts.get(url.host);
    if (!gate) {
      gate = new ConcurrencyGate(this.limitPerHost);
      this.hosts.set(url.host, gate);
    }
    return gate.run(operation);
  }
}
