import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

/**
 * Standard pagination envelope for paginated list responses.
 *
 * Endpoints that page over entity lists should return `{ data, pagination }`
 * (plus any per-endpoint extras such as `startingBalance`). Compute the
 * envelope via `buildPaginationMeta()` so the math is consistent everywhere.
 */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: PaginationMeta;
}

/**
 * Maximum page size any endpoint may return. Caps blast radius regardless
 * of what an individual endpoint claims its limit is.
 */
export const PAGINATION_MAX_LIMIT = 200;
export const PAGINATION_DEFAULT_LIMIT = 50;

/**
 * Mixin DTO for endpoints that accept `?page=` and `?limit=`. Endpoints can
 * extend this class to inherit consistent validation and Swagger annotations.
 *
 * `page` defaults to 1, `limit` defaults to {@link PAGINATION_DEFAULT_LIMIT},
 * and the caller-provided values are clamped via {@link clampPagination}.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: "1-based page number",
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: "Maximum number of items per page",
    minimum: 1,
    maximum: PAGINATION_MAX_LIMIT,
    default: PAGINATION_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGINATION_MAX_LIMIT)
  limit?: number;
}

/**
 * Clamp caller-supplied pagination inputs into safe defaults. Returns the
 * safe `page`, `limit`, and `skip` (offset) values to use for the query.
 *
 * - `page` is clamped to at least 1.
 * - `limit` is clamped between 1 and {@link PAGINATION_MAX_LIMIT} (or a
 *   caller-specified `maxLimit`).
 * - Missing values fall back to defaults.
 */
export function clampPagination(
  page: number | undefined,
  limit: number | undefined,
  options: { defaultLimit?: number; maxLimit?: number } = {},
): { page: number; limit: number; skip: number } {
  const defaultLimit = options.defaultLimit ?? PAGINATION_DEFAULT_LIMIT;
  const maxLimit = options.maxLimit ?? PAGINATION_MAX_LIMIT;
  const safePage = Math.max(1, Math.floor(page ?? 1));
  const requested = Math.floor(limit ?? defaultLimit);
  const safeLimit = Math.min(maxLimit, Math.max(1, requested));
  return { page: safePage, limit: safeLimit, skip: (safePage - 1) * safeLimit };
}

/**
 * Build the `{ page, limit, total, totalPages, hasMore }` envelope from a
 * paginated query's `total` count. Always pair with {@link clampPagination}
 * so the inputs are safe.
 */
export function buildPaginationMeta(
  page: number,
  limit: number,
  total: number,
): PaginationMeta {
  const safeTotal = Math.max(0, total);
  const totalPages = safeTotal === 0 ? 0 : Math.ceil(safeTotal / limit);
  return {
    page,
    limit,
    total: safeTotal,
    totalPages,
    hasMore: totalPages > 0 && page < totalPages,
  };
}
