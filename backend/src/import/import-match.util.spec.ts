import { matchDateWindow } from "./import-match.util";

describe("matchDateWindow", () => {
  it("returns a symmetric ±7-day window by default", () => {
    expect(matchDateWindow("2026-07-01")).toEqual({ lo: "2026-06-24", hi: "2026-07-08" });
  });
  it("crosses month boundaries correctly", () => {
    expect(matchDateWindow("2026-03-03")).toEqual({ lo: "2026-02-24", hi: "2026-03-10" });
  });
  it("honours a custom day count", () => {
    expect(matchDateWindow("2026-07-01", 3)).toEqual({ lo: "2026-06-28", hi: "2026-07-04" });
  });
});
