"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type AutoRefreshProps = {
  active: boolean;
  intervalMs?: number;
};

export function AutoRefresh({ active, intervalMs = 4000 }: AutoRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      router.refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs, router]);

  return null;
}
