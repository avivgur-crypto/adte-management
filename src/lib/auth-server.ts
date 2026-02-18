/**
 * Server-only auth helpers (Node). Use in server actions.
 */

import { createHash } from "crypto";

export function hashPassword(password: string): string {
  return createHash("sha256").update(password, "utf8").digest("hex");
}
