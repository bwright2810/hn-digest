export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getConfig } = await import("./config/server");
    getConfig();
  }
}
