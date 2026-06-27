import type { useTranslations } from 'next-intl';
import type { ActionHistoryItem } from './action-history';

// Stable description keys the backend emits (it sets `descriptionKey` to one of
// these on every recorded action). Each maps to a template under
// `layout.actionHistory.descriptions`. Anything outside this set -- a row
// written before localization, or a key newer than this client -- falls back to
// the stored English `description`. Keep in sync with the backend call sites.
export const KNOWN_DESCRIPTION_KEYS = new Set<string>([
  'createdAccount', 'updatedAccount', 'deletedAccount',
  'createdBudget', 'updatedBudget', 'deletedBudget',
  'createdCategory', 'updatedCategory', 'deletedCategory',
  'createdInstitution', 'updatedInstitution', 'deletedInstitution',
  'createdInvestmentReport', 'updatedInvestmentReport', 'deletedInvestmentReport',
  'createdPayee', 'updatedPayee', 'deletedPayee',
  'createdReport', 'updatedReport', 'deletedReport',
  'createdScheduledTransaction', 'updatedScheduledTransaction', 'deletedScheduledTransaction',
  'createdSecurity', 'updatedSecurity', 'deletedSecurity',
  'createdTag', 'updatedTag', 'deletedTag',
  'createdTransaction', 'updatedTransaction', 'deletedTransaction',
  'createdTransfer',
  'createdInvestmentTransaction', 'updatedInvestmentTransaction', 'deletedInvestmentTransaction',
  'transferredSecurity', 'updatedSecurityTransfer',
]);

// Description keys whose `action` param carries an InvestmentAction enum value
// (e.g. "BUY") that must be localized before it is interpolated into the
// template, otherwise the raw English enum leaks into the rendered string.
const ACTION_PARAM_KEYS = new Set<string>([
  'createdInvestmentTransaction',
  'updatedInvestmentTransaction',
  'deletedInvestmentTransaction',
]);

// InvestmentAction enum values that have a label under
// `layout.actionHistory.actionLabels`. Keep in sync with the backend enum
// (backend/src/securities/entities/investment-transaction.entity.ts).
const KNOWN_INVESTMENT_ACTIONS = new Set<string>([
  'BUY', 'SELL', 'DIVIDEND', 'INTEREST', 'CAPITAL_GAIN', 'SPLIT',
  'TRANSFER_IN', 'TRANSFER_OUT', 'REINVEST', 'ADD_SHARES', 'REMOVE_SHARES',
]);

type LayoutTranslator = ReturnType<typeof useTranslations<'layout'>>;

type DescribableAction = Pick<
  ActionHistoryItem,
  'description' | 'descriptionKey' | 'descriptionParams'
>;

/**
 * Render an action's description in the active locale. Prefers the localizable
 * `descriptionKey` + params; falls back to the stored English `description` for
 * legacy rows or unknown keys so nothing renders blank.
 */
export function renderActionDescription(
  t: LayoutTranslator,
  item: DescribableAction | null | undefined,
): string {
  if (item?.descriptionKey && KNOWN_DESCRIPTION_KEYS.has(item.descriptionKey)) {
    return t(
      `actionHistory.descriptions.${item.descriptionKey}` as never,
      localizeParams(t, item.descriptionKey, item.descriptionParams) as never,
    );
  }
  return item?.description ?? '';
}

/**
 * Localize interpolation params that hold enum values rather than free text.
 * Currently only the investment-transaction keys carry an `action` enum value
 * that needs translating; everything else is passed through untouched.
 */
function localizeParams(
  t: LayoutTranslator,
  descriptionKey: string,
  params: DescribableAction['descriptionParams'],
): Record<string, string | number> {
  const safeParams = params ?? {};
  if (!ACTION_PARAM_KEYS.has(descriptionKey)) {
    return safeParams;
  }
  const action = safeParams.action;
  if (typeof action !== 'string' || !KNOWN_INVESTMENT_ACTIONS.has(action)) {
    return safeParams;
  }
  return {
    ...safeParams,
    action: t(`actionHistory.actionLabels.${action}` as never),
  };
}
