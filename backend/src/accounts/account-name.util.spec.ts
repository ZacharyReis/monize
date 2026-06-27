import { I18nContext } from "nestjs-i18n";
import {
  brokerageSuffix,
  cashSuffix,
  stripBrokerageSuffix,
} from "./account-name.util";

describe("account-name.util", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const mockLocale = (map: Record<string, string>) => {
    jest.spyOn(I18nContext, "current").mockReturnValue({
      t: (key: string) => map[key] ?? key,
    } as never);
  };

  describe("cashSuffix / brokerageSuffix", () => {
    it("falls back to English outside a request context", () => {
      jest.spyOn(I18nContext, "current").mockReturnValue(undefined as never);
      expect(cashSuffix()).toBe("Cash");
      expect(brokerageSuffix()).toBe("Brokerage");
    });

    it("returns the localized words inside a request context", () => {
      mockLocale({
        "common.accountSuffix.cash": "Bargeld",
        "common.accountSuffix.brokerage": "Depot",
      });
      expect(cashSuffix()).toBe("Bargeld");
      expect(brokerageSuffix()).toBe("Depot");
    });
  });

  describe("stripBrokerageSuffix", () => {
    it("strips the English suffix", () => {
      jest.spyOn(I18nContext, "current").mockReturnValue(undefined as never);
      expect(stripBrokerageSuffix("TFSA - Brokerage")).toBe("TFSA");
    });

    it("strips the localized suffix", () => {
      mockLocale({ "common.accountSuffix.brokerage": "Depot" });
      expect(stripBrokerageSuffix("Depotkonto - Depot")).toBe("Depotkonto");
    });

    it("still strips the English suffix when the locale differs", () => {
      mockLocale({ "common.accountSuffix.brokerage": "Depot" });
      expect(stripBrokerageSuffix("TFSA - Brokerage")).toBe("TFSA");
    });

    it("leaves names without a brokerage suffix untouched", () => {
      jest.spyOn(I18nContext, "current").mockReturnValue(undefined as never);
      expect(stripBrokerageSuffix("Chequing")).toBe("Chequing");
      expect(stripBrokerageSuffix("Brokerage - Reserve")).toBe(
        "Brokerage - Reserve",
      );
    });
  });
});
