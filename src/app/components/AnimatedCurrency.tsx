"use client";

import { useEffect, useRef } from "react";

function formatUsd(
  n: number,
  minimumFractionDigits: number,
  maximumFractionDigits: number,
): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(n);
}

export type AnimatedCurrencyProps = {
  value: number;
  className?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
};

/**
 * Smoothly animates a currency value (ease-out cubic), matching Main Stats behavior.
 */
export function AnimatedCurrency({
  value,
  className,
  minimumFractionDigits = 0,
  maximumFractionDigits = 0,
}: AnimatedCurrencyProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  const raf = useRef(0);

  useEffect(() => {
    const from = prev.current;
    const to = value;
    prev.current = to;
    if (from === to) return;

    const duration = 400;
    const start = performance.now();
    const min = minimumFractionDigits;
    const max = maximumFractionDigits;

    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      const current = from + (to - from) * ease;
      if (ref.current) {
        ref.current.textContent = formatUsd(current, min, max);
      }
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, minimumFractionDigits, maximumFractionDigits]);

  return (
    <span ref={ref} className={className}>
      {formatUsd(value, minimumFractionDigits, maximumFractionDigits)}
    </span>
  );
}

export type AnimatedNumberTextProps = {
  value: number;
  /** Called each frame with interpolated value; return display string. */
  format: (n: number) => string;
  className?: string;
};

/**
 * Same easing as AnimatedCurrency, for non-currency numbers (%, compact $, etc.).
 */
export function AnimatedNumberText({
  value,
  format,
  className,
}: AnimatedNumberTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  const raf = useRef(0);
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    const from = prev.current;
    const to = value;
    prev.current = to;
    if (from === to) return;

    const duration = 400;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      const current = from + (to - from) * ease;
      if (ref.current) ref.current.textContent = formatRef.current(current);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);

  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}
