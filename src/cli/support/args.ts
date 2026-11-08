import { parseArgs } from "node:util";
import { UsageError } from "../errors.js";

export const RUN_OPTIONS = {
  "dry-run": { type: "boolean" },
  push: { type: "boolean" },
  pr: { type: "boolean" },
  "max-attempts": { type: "string" },
  "agent-timeout-min": { type: "string" },
  "check-timeout-min": { type: "string" },
  model: { type: "string" },
  "agent-command": { type: "string" },
  "data-dir": { type: "string" },
} as const;

export function parse<T extends Record<string, { type: "string" | "boolean" }>>(
  args: string[],
  options: T,
  allowPositionals = true,
) {
  try {
    return parseArgs({ args, allowPositionals, options });
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
}

export type RunValues = ReturnType<typeof parse<typeof RUN_OPTIONS>>["values"];

export function positiveNumber(raw: string | undefined, flag: string, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new UsageError(`${flag} must be a positive number, got '${raw}'`);
  return n;
}
