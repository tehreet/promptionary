"use client";

import { useEffect, useState } from "react";

// Interpolate a number to its target over `duration` ms (easeOutCubic).
export function useAnimatedNumber(target: number, duration = 800): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const from = 0;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}
