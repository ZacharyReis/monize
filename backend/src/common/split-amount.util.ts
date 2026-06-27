import { BadRequestException } from "@nestjs/common";
import { tr } from "../i18n/translate";
import { roundMoney, sumMoney } from "./round.util";

/**
 * Shared validation for transaction/scheduled-transaction split amount totals.
 *
 * Confirms that the rounded sum (4dp) of the split amounts equals the rounded
 * parent transaction amount, and that the minimum split count is met.
 *
 * - The default minimum split count is 2.
 * - When {@link options.allowSinglePassthrough} is `true` (the default for
 *   transaction-level splits where a single transfer or investment split is
 *   considered a "pass-through"), exactly one split is allowed when it is a
 *   transfer or investment split (the caller filters by `predicate`).
 *
 * @throws BadRequestException when the count or sum constraints are violated.
 */
export function validateSplitAmountSum(
  splits: { amount: number }[],
  transactionAmount: number,
  options: {
    allowSinglePassthrough?: boolean;
    isPassthrough?: (split: unknown) => boolean;
  } = {},
): void {
  const allowSinglePassthrough = options.allowSinglePassthrough ?? false;

  const isPassthrough =
    allowSinglePassthrough &&
    splits.length === 1 &&
    (options.isPassthrough?.(splits[0]) ?? false);

  if (splits.length < 2 && !isPassthrough) {
    throw new BadRequestException(
      tr(
        "errors.common.splitMinCount",
        "Split transactions must have at least 2 splits",
      ),
    );
  }

  const roundedSum = sumMoney(splits.map((split) => Number(split.amount)));
  const roundedAmount = roundMoney(Number(transactionAmount));

  if (roundedSum !== roundedAmount) {
    throw new BadRequestException(
      tr(
        "errors.common.splitAmountMismatch",
        `Split amounts (${roundedSum}) must equal transaction amount (${roundedAmount})`,
        { roundedSum, roundedAmount },
      ),
    );
  }
}
