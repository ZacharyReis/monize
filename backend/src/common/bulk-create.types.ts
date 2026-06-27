import { HttpException } from "@nestjs/common";

/**
 * Shared shape for the best-effort bulk-create paths used by the AI Assistant /
 * MCP "paste a table" flows. Each row is attempted independently: rows that
 * succeed land in `created`, rows that fail validation or persistence are
 * collected in `skipped` (by their index in the input array) with a
 * human-readable reason, rather than aborting the whole batch.
 */
export interface BulkCreateSkip {
  /** Index of the failed row within the input array. */
  index: number;
  /** Human-readable reason the row was skipped. */
  reason: string;
}

export interface BulkCreateResult<T> {
  created: T[];
  skipped: BulkCreateSkip[];
}

/**
 * Map an error thrown while creating one bulk row into a short reason for the
 * `skipped` list. Client errors (4xx) carry a safe, user-facing message and are
 * passed through; anything else is collapsed to a generic reason so internal
 * details never leak into the confirmation card.
 */
export function bulkSkipReason(error: unknown): string {
  if (error instanceof HttpException) {
    const status = error.getStatus();
    if (status >= 400 && status < 500) {
      return error.message;
    }
  }
  return "Could not be saved.";
}
