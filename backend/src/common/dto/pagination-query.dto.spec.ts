import {
  buildPaginationMeta,
  clampPagination,
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
} from "./pagination-query.dto";

describe("clampPagination", () => {
  it("returns defaults for undefined inputs", () => {
    expect(clampPagination(undefined, undefined)).toEqual({
      page: 1,
      limit: PAGINATION_DEFAULT_LIMIT,
      skip: 0,
    });
  });

  it("clamps page to at least 1", () => {
    expect(clampPagination(0, 10).page).toBe(1);
    expect(clampPagination(-5, 10).page).toBe(1);
  });

  it("clamps limit to at least 1", () => {
    expect(clampPagination(1, 0).limit).toBe(1);
    expect(clampPagination(1, -10).limit).toBe(1);
  });

  it("caps limit at PAGINATION_MAX_LIMIT", () => {
    expect(clampPagination(1, 1000).limit).toBe(PAGINATION_MAX_LIMIT);
  });

  it("honors caller-supplied maxLimit", () => {
    expect(clampPagination(1, 1000, { maxLimit: 25 }).limit).toBe(25);
  });

  it("honors caller-supplied defaultLimit", () => {
    expect(clampPagination(2, undefined, { defaultLimit: 30 })).toEqual({
      page: 2,
      limit: 30,
      skip: 30,
    });
  });

  it("computes skip from page and limit", () => {
    expect(clampPagination(3, 20).skip).toBe(40);
  });

  it("floors fractional inputs", () => {
    expect(clampPagination(2.7, 10.9)).toEqual({
      page: 2,
      limit: 10,
      skip: 10,
    });
  });
});

describe("buildPaginationMeta", () => {
  it("computes a typical mid-list page", () => {
    expect(buildPaginationMeta(2, 10, 47)).toEqual({
      page: 2,
      limit: 10,
      total: 47,
      totalPages: 5,
      hasMore: true,
    });
  });

  it("returns hasMore=false on the last page", () => {
    expect(buildPaginationMeta(5, 10, 47).hasMore).toBe(false);
  });

  it("handles empty result sets", () => {
    expect(buildPaginationMeta(1, 10, 0)).toEqual({
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
      hasMore: false,
    });
  });

  it("normalizes negative totals to 0", () => {
    expect(buildPaginationMeta(1, 10, -5).total).toBe(0);
  });
});
