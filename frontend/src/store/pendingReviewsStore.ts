import { create } from "zustand";
import { importMatchesApi } from "@/lib/import-matches";

interface PendingReviewsState { count: number; refresh: () => Promise<void>; }

export const usePendingReviewsStore = create<PendingReviewsState>()((set) => ({
  count: 0,
  refresh: async () => {
    try { const matches = await importMatchesApi.list(); set({ count: matches.length }); }
    catch { /* leave last-known count */ }
  },
}));
