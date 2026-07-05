import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/lib/import-matches", () => ({ importMatchesApi: { list: vi.fn() } }));
import { importMatchesApi } from "@/lib/import-matches";
import { usePendingReviewsStore } from "./pendingReviewsStore";

describe("pendingReviewsStore", () => {
  beforeEach(() => { vi.clearAllMocks(); usePendingReviewsStore.setState({ count: 0 }); });
  it("refresh sets count to the list length", async () => {
    (importMatchesApi.list as any).mockResolvedValue([{}, {}, {}]);
    await usePendingReviewsStore.getState().refresh();
    expect(usePendingReviewsStore.getState().count).toBe(3);
  });
  it("refresh leaves count unchanged on error", async () => {
    // First set count to a known non-zero value
    usePendingReviewsStore.setState({ count: 5 });
    // Then make the API reject
    (importMatchesApi.list as any).mockRejectedValue(new Error("boom"));
    await usePendingReviewsStore.getState().refresh();
    // Count should remain 5 (the last-known value), not reset to 0
    expect(usePendingReviewsStore.getState().count).toBe(5);
  });
});
