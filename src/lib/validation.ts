/**
 * Shared Zod schemas and a safe-error helper for server actions / API routes.
 */

import { z } from "zod";

/** YYYY-MM-DD or YYYY-MM-DD (first-of-month key used throughout the dashboard). */
export const monthKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}(-\d{2})?$/, "Invalid month key format (expected YYYY-MM or YYYY-MM-DD)")
  .refine((v) => {
    const [y, m] = v.split("-").map(Number);
    return y! >= 2020 && y! <= 2099 && m! >= 1 && m! <= 12;
  }, "Month key out of range");

export const monthKeysSchema = z
  .array(monthKeySchema)
  .max(24, "Too many month keys");

export const monthStartsSchema = z
  .array(monthKeySchema)
  .max(24, "Too many month starts")
  .optional();

/**
 * Strip internal details from an error and return a safe message for the client.
 * In production, always returns a generic message. In dev, includes the original.
 */
export function safeErrorMessage(err: unknown, fallback = "An unexpected error occurred."): string {
  if (process.env.NODE_ENV === "production") return fallback;
  return err instanceof Error ? err.message : fallback;
}
