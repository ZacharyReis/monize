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
    (importMatchesApi.list as any).mockRejectedValue(new Error("boom"));
    await usePendingReviewsStore.getState().refresh();
    expect(usePendingReviewsStore.getState().count).toBe(0);
  });
});
