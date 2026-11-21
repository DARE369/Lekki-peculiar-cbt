"use client";

import { useState, useTransition } from "react";

/**
 * Runs server actions in a transition and remembers which button started it,
 * so only that button shows it is working while the others are just paused.
 */
export function useAction() {
  const [pending, start] = useTransition();
  const [key, setKey] = useState<string | null>(null);
  return {
    pending,
    running: (k: string) => pending && key === k,
    run: (k: string, fn: () => Promise<void>) => {
      setKey(k);
      start(fn);
    },
  };
}
