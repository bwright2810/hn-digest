"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const ACTIVE_RUN_REFRESH_MS = 3_000;

export function AdminAutoRefresh({ active }: { readonly active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, ACTIVE_RUN_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [active, router]);

  if (!active) return null;
  return (
    <p className="auto-refresh-notice" role="status">
      Run in progress. Status updates automatically.
    </p>
  );
}
