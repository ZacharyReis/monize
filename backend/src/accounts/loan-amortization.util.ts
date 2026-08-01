/**
 * Loan Amortization Utility Functions
 *
 * Provides calculations for loan payment schedules, including:
 * - Principal/interest split for each payment
 * - Total number of payments
 * - End date calculation
 */

import { roundMoney } from "../common/round.util";

export type PaymentFrequency =
  | "WEEKLY"
  | "BIWEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "YEARLY";

export interface AmortizationResult {
  /** Principal portion of the current payment */
  principalPayment: number;
  /** Interest portion of the current payment */
  interestPayment: number;
  /** Balance remaining after this payment */
  remainingBalance: number;
  /** Total number of payments to pay off the loan */
  totalPayments: number;
  /** Estimated end date of the loan */
  endDate: Date;
}

export interface PaymentSplit {
  /** Principal portion of the payment */
  principal: number;
  /** Interest portion of the payment */
  interest: number;
}

/**
 * Get the number of payment periods per year based on frequency
 */
export function getPeriodsPerYear(frequency: PaymentFrequency): number {
  switch (frequency) {
    case "WEEKLY":
      return 52;
    case "BIWEEKLY":
      return 26;
    case "MONTHLY":
      return 12;
    case "QUARTERLY":
      return 4;
    case "YEARLY":
      return 1;
    default:
      return 12; // Default to monthly
  }
}

/**
 * Calculate the principal/interest split for a payment based on remaining balance
 *
 * @param remainingBalance - Current loan balance (positive number)
 * @param annualRate - Annual interest rate as percentage (e.g., 5.5 for 5.5%)
 * @param paymentAmount - Payment amount per period
 * @param frequency - Payment frequency
 * @returns The principal and interest portions of the payment
 */
export function calculatePaymentSplit(
  remainingBalance: number,
  annualRate: number,
  paymentAmount: number,
  frequency: PaymentFrequency,
): PaymentSplit {
  const periodsPerYear = getPeriodsPerYear(frequency);
  const periodicRate = annualRate / 100 / periodsPerYear;

  // Calculate interest for this period
  const interest = remainingBalance * periodicRate;

  // Principal is the remainder after interest
  let principal = paymentAmount - interest;

  // Handle case where payment is less than interest (shouldn't happen with valid inputs)
  if (principal < 0) {
    principal = 0;
  }

  // If principal would exceed remaining balance, cap it
  if (principal > remainingBalance) {
    principal = remainingBalance;
  }

  // Round to storage precision for currency
  return {
    principal: roundMoney(principal),
    interest: roundMoney(interest),
  };
}

/**
 * Calculate the total number of payments needed to pay off a loan
 *
 * Uses the standard amortization formula:
 * n = -ln(1 - (P * r) / A) / ln(1 + r)
 *
 * Where:
 * - n = number of payments
 * - P = principal (loan amount)
 * - r = periodic interest rate
 * - A = payment amount
 *
 * @param principal - Loan amount (positive number)
 * @param annualRate - Annual interest rate as percentage
 * @param paymentAmount - Payment amount per period
 * @param frequency - Payment frequency
 * @returns Number of payments needed (rounded up)
 */
export function calculateTotalPayments(
  principal: number,
  annualRate: number,
  paymentAmount: number,
  frequency: PaymentFrequency,
): number {
  // Handle 0% interest rate
  if (annualRate === 0) {
    return Math.ceil(principal / paymentAmount);
  }

  const periodsPerYear = getPeriodsPerYear(frequency);
  const periodicRate = annualRate / 100 / periodsPerYear;

  // Check if payment is sufficient to cover interest
  const minPayment = principal * periodicRate;
  if (paymentAmount <= minPayment) {
    // Payment doesn't cover interest - loan will never be paid off
    // Return a large number to indicate this
    return Infinity;
  }

  // Use amortization formula: n = -ln(1 - (P * r) / A) / ln(1 + r)
  const numerator = -Math.log(1 - (principal * periodicRate) / paymentAmount);
  const denominator = Math.log(1 + periodicRate);
  const payments = numerator / denominator;

  return Math.ceil(payments);
}

/**
 * Calculate the end date of a loan based on start date, frequency, and number of payments
 *
 * @param startDate - Date of first payment
 * @param frequency - Payment frequency
 * @param totalPayments - Number of payments
 * @returns Estimated end date
 */
export function calculateEndDate(
  startDate: Date,
  frequency: PaymentFrequency,
  totalPayments: number,
): Date {
  const date = new Date(startDate);

  // Handle infinite payments case
  if (!isFinite(totalPayments) || totalPayments > 2500) {
    // Return a far future date to indicate the loan won't be paid off
    date.setFullYear(date.getFullYear() + 100);
    return date;
  }

  for (let i = 0; i < totalPayments; i++) {
    switch (frequency) {
      case "WEEKLY":
        date.setDate(date.getDate() + 7);
        break;
      case "BIWEEKLY":
        date.setDate(date.getDate() + 14);
        break;
      case "MONTHLY":
        date.setMonth(date.getMonth() + 1);
        break;
      case "QUARTERLY":
        date.setMonth(date.getMonth() + 3);
        break;
      case "YEARLY":
        date.setFullYear(date.getFullYear() + 1);
        break;
    }
  }

  return date;
}

/**
 * Calculate full amortization details for a loan
 *
 * @param principal - Loan amount (positive number)
 * @param annualRate - Annual interest rate as percentage (e.g., 5.5 for 5.5%)
 * @param paymentAmount - Payment amount per period
 * @param frequency - Payment frequency
 * @param startDate - Date of first payment
 * @returns Full amortization details including first payment split and end date
 */
export function calculateAmortization(
  principal: number,
  annualRate: number,
  paymentAmount: number,
  frequency: PaymentFrequency,
  startDate: Date,
): AmortizationResult {
  // Calculate first payment split
  const { principal: principalPayment, interest: interestPayment } =
    calculatePaymentSplit(principal, annualRate, paymentAmount, frequency);

  // Calculate remaining balance after first payment
  const remainingBalance = Math.max(
    0,
    roundMoney(principal - principalPayment),
  );

  // Calculate total payments
  const totalPayments = calculateTotalPayments(
    principal,
    annualRate,
    paymentAmount,
    frequency,
  );

  // Calculate end date
  const endDate = calculateEndDate(startDate, frequency, totalPayments);

  return {
    principalPayment,
    interestPayment,
    remainingBalance,
    totalPayments: isFinite(totalPayments) ? totalPayments : -1, // -1 indicates infinite
    endDate,
  };
}

/**
 * Calculate the installment that amortizes a balance over a fixed number of
 * remaining periods -- the annuity `A = B*r / (1 - (1 + r)^(-n))`.
 *
 * This is the inverse of `calculateTotalPayments` (which solves for n given the
 * payment): it solves for the payment given the term. A bank recomputes this
 * for the *obniżenie raty* (lower-installment) overpayment mode, where the
 * payoff date is held fixed and the installment shrinks after an overpayment.
 *
 * @param balance - Balance to amortize (positive number)
 * @param annualRate - Annual interest rate as percentage (e.g., 5.5)
 * @param periods - Number of remaining payment periods (must be > 0)
 * @param frequency - Payment frequency
 * @returns The installment; a 0% rate splits the balance evenly
 */
export function calculatePaymentForTerm(
  balance: number,
  annualRate: number,
  periods: number,
  frequency: PaymentFrequency,
): number {
  if (balance <= 0 || periods <= 0) return 0;

  const periodicRate = annualRate / 100 / getPeriodsPerYear(frequency);
  if (periodicRate === 0) {
    return roundMoney(balance / periods);
  }
  return roundMoney(
    (balance * periodicRate) / (1 - Math.pow(1 + periodicRate, -periods)),
  );
}

/**
 * Calculate the final payment amount when loan balance is less than regular payment
 *
 * @param remainingBalance - Current loan balance
 * @param annualRate - Annual interest rate as percentage
 * @param frequency - Payment frequency
 * @returns The final payment amount needed to pay off the loan
 */
export function calculateFinalPayment(
  remainingBalance: number,
  annualRate: number,
  frequency: PaymentFrequency,
): number {
  const periodsPerYear = getPeriodsPerYear(frequency);
  const periodicRate = annualRate / 100 / periodsPerYear;

  // Final payment = remaining balance + one period's interest
  const interest = remainingBalance * periodicRate;
  const finalPayment = remainingBalance + interest;

  return roundMoney(finalPayment);
}
