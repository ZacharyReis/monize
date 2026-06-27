import { z } from "zod";

/**
 * Shared Zod primitives for tool inputs exposed to LLMs, used by both
 * the internal AI query engine (src/ai) and the MCP server (src/mcp).
 *
 * Keeping date and direction validation in one place prevents drift
 * between the two surfaces — the same normalization rules apply
 * regardless of which surface the model is talking to.
 */

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const isoDateSchema = z
  .string()
  .regex(isoDateRegex, "Expected YYYY-MM-DD");

/**
 * Direction normalization. The model often sends variants of the same
 * concept (e.g. "expense" vs "expenses", "all" vs "both"). Normalize
 * at the schema boundary so the tool executor always gets a canonical
 * value and the user doesn't see a failed tool call for a cosmetic
 * difference.
 */
export const directionSchema = z.preprocess(
  (val) => {
    if (typeof val !== "string") return val;
    const normalized = val.toLowerCase().trim();
    const aliases: Record<string, string> = {
      expense: "expenses",
      expenditure: "expenses",
      expenditures: "expenses",
      spending: "expenses",
      out: "expenses",
      outgoing: "expenses",
      debit: "expenses",
      debits: "expenses",
      earnings: "income",
      revenue: "income",
      in: "income",
      incoming: "income",
      credit: "income",
      credits: "income",
      all: "both",
      any: "both",
    };
    return aliases[normalized] ?? normalized;
  },
  z.enum(["expenses", "income", "both"]),
);

/**
 * Coerce clean numeric strings ("5") to integers while letting other
 * strings fail validation with a clear error. The model sometimes
 * sends topN / limit as a string.
 */
export const positiveIntSchema = (min: number, max: number) =>
  z.preprocess(
    (val) =>
      typeof val === "string" && /^-?\d+$/.test(val) ? Number(val) : val,
    z.number().int().min(min).max(max),
  );

/**
 * Defaults applied when an LLM omits parameters that would otherwise be
 * required. Centralized here so the AI Assistant and the MCP server
 * fall back to the same values.
 */
export const DEFAULT_LOOKBACK_DAYS = 30;
export const DEFAULT_TOP_N = 10;

/**
 * Format a local Date as YYYY-MM-DD using local-time components.
 * Defaults work with calendar dates from the server's perspective,
 * so local components avoid an off-by-one shift that UTC formatting
 * would introduce in non-UTC timezones.
 */
function localYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Return a {startDate, endDate} pair covering the last `lookbackDays`
 * days (inclusive of today). Used when the model omits a date range.
 */
export function getDefaultDateRange(
  lookbackDays: number = DEFAULT_LOOKBACK_DAYS,
): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - lookbackDays);
  return { startDate: localYMD(start), endDate: localYMD(end) };
}

export interface ComparePeriods {
  period1Start: string;
  period1End: string;
  period2Start: string;
  period2End: string;
}

/**
 * Return the four dates needed to compare the previous full month
 * against the current month-to-date. Used when the model omits any
 * period in compare_periods -- treated as all-or-nothing because
 * mixing user-supplied dates with computed ones would be surprising.
 */
export function getDefaultComparePeriods(): ComparePeriods {
  const now = new Date();
  const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  // Day 0 of the current month = last day of the previous month
  const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  return {
    period1Start: localYMD(prevStart),
    period1End: localYMD(prevEnd),
    period2Start: localYMD(currentStart),
    period2End: localYMD(now),
  };
}

/**
 * Resolve the four `compare_periods` dates from caller input. If any of the
 * four dates is missing, falls back to the all-or-nothing default
 * ({@link getDefaultComparePeriods}) -- mixing user-supplied dates with
 * computed ones would compare unrelated windows.
 *
 * Used by both the AI tool executor and the MCP tool adapter so the
 * surfaces stay in lockstep.
 */
export function resolveComparePeriods(input: {
  period1Start?: string | null;
  period1End?: string | null;
  period2Start?: string | null;
  period2End?: string | null;
}): ComparePeriods {
  const hasAllPeriods = Boolean(
    input.period1Start &&
    input.period1End &&
    input.period2Start &&
    input.period2End,
  );
  if (hasAllPeriods) {
    return {
      period1Start: input.period1Start as string,
      period1End: input.period1End as string,
      period2Start: input.period2Start as string,
      period2End: input.period2End as string,
    };
  }
  return getDefaultComparePeriods();
}

/**
 * Return the previous complete calendar month in YYYY-MM format.
 * Used as the default for the generate_report month_comparison type so
 * reports run against a month that has already closed.
 */
export function getDefaultPreviousMonth(): string {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}
