/**
 * GBX (penny sterling) conversion utilities.
 *
 * London Stock Exchange (LSE) shares are quoted in GBX (pence) rather than
 * GBP (pounds). Yahoo Finance returns LSE prices with currency "GBp".
 * This conversion applies only to Yahoo Finance price data; QIF files
 * from brokers already contain prices in GBP (pounds).
 *
 * 1 GBX = 0.01 GBP  (100 pence = 1 pound)
 */

/** Exchanges whose prices are quoted in GBX (pence sterling) */
const GBX_EXCHANGES = new Set(["LSE", "LON", "LONDON"]);

/**
 * Returns true if the currency string indicates pence sterling (GBX).
 * Yahoo Finance uses "GBp"; other platforms may use "GBX".
 */
export function isGbxCurrency(currency: string | null | undefined): boolean {
  if (!currency) return false;
  const trimmed = currency.trim();
  return trimmed === "GBp" || trimmed.toUpperCase() === "GBX";
}

/**
 * Returns true if the given exchange quotes prices in pence sterling.
 */
export function isGbxExchange(exchange: string | null | undefined): boolean {
  if (!exchange) return false;
  return GBX_EXCHANGES.has(exchange.toUpperCase().trim());
}

/**
 * Convert a price from GBX (pence) to GBP (pounds).
 * Rounds to 6 decimal places to match NUMERIC(20,6) storage. Sub-penny LSE
 * shares (e.g. 0.0318 GBX = 0.000318 GBP) need the full 6 places; rounding to
 * 4 collapsed adjacent days to the same value, zeroing out daily change.
 */
export function convertGbxToGbp(penceValue: number): number {
  return Math.round((penceValue / 100) * 1000000) / 1000000;
}
