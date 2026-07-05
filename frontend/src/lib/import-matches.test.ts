import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("./api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("./apiCache", () => ({ invalidateCache: vi.fn() }));
import apiClient from "./api";
import { invalidateCache } from "./apiCache";
import { importMatchesApi } from "./import-matches";

describe("importMatchesApi", () => {
  beforeEach(() => vi.clearAllMocks());
  it("merge posts transactionId and invalidates caches", async () => {
    (apiClient.post as any).mockResolvedValue({ data: undefined });
    await importMatchesApi.merge("cand-1", "txn-1");
    expect(apiClient.post).toHaveBeenCalledWith("/import/matches/cand-1/merge", { transactionId: "txn-1" });
    expect(invalidateCache).toHaveBeenCalledWith("accounts:");
    expect(invalidateCache).toHaveBeenCalledWith("transactions:");
  });
  it("dismiss posts to the dismiss route", async () => {
    (apiClient.post as any).mockResolvedValue({ data: undefined });
    await importMatchesApi.dismiss("cand-1");
    expect(apiClient.post).toHaveBeenCalledWith("/import/matches/cand-1/dismiss");
  });
  it("list returns response.data", async () => {
    (apiClient.get as any).mockResolvedValue({ data: [] });
    expect(await importMatchesApi.list()).toEqual([]);
  });
});
