import { spawn } from "node:child_process";

import { getConfig } from "../src/config/server";

const config = getConfig();
const web = spawn(process.execPath, ["server.js"], {
  stdio: "inherit",
  env: process.env,
});
const background = spawn(process.execPath, ["background.js"], {
  stdio: "inherit",
  env: process.env,
});
let stopping = false;

async function stop(signal: NodeJS.Signals = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  web.kill(signal);
  background.kill(signal);
  const timeout = setTimeout(() => {
    web.kill("SIGKILL");
    background.kill("SIGKILL");
  }, config.runtime.shutdownGraceMs);
  timeout.unref();
  await Promise.all([waitForExit(web), waitForExit(background)]);
  clearTimeout(timeout);
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => void stop(signal));
}

web.once("exit", (code, signal) => {
  if (!stopping) {
    console.error(
      JSON.stringify({ event: "web_process_exited", code, signal }),
    );
    void stop().then(() => process.exit(code ?? 1));
  }
});
background.once("exit", (code, signal) => {
  if (!stopping) {
    console.error(
      JSON.stringify({ event: "background_process_exited", code, signal }),
    );
    void stop().then(() => process.exit(code ?? 1));
  }
});

function waitForExit(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve();
  return new Promise((resolve) => child.once("exit", () => resolve()));
}
