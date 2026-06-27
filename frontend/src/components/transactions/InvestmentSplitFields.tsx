'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/ui/Select';
import { NumericInput } from '@/components/ui/NumericInput';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { investmentsApi } from '@/lib/investments';
import {
  EMBEDDED_INVESTMENT_SPLIT_ACTIONS,
  computeInvestmentCashImpact,
} from '@/lib/investmentCashImpact';
import { roundToCents, getCurrencySymbol } from '@/lib/format';
import { InvestmentAction, Security } from '@/types/investment';
import { InvestmentSplitDetails } from '@/types/transaction';

interface InvestmentSplitFieldsProps {
  value: InvestmentSplitDetails | undefined;
  onChange: (next: InvestmentSplitDetails, computedAmount: number) => void;
  disabled?: boolean;
  currencyCode?: string;
}

const ACTION_LABELS: Record<InvestmentAction, string> = {
  BUY: 'Buy',
  SELL: 'Sell',
  DIVIDEND: 'Dividend',
  INTEREST: 'Interest',
  CAPITAL_GAIN: 'Capital Gain',
  REINVEST: 'Reinvest',
  SPLIT: 'Split',
  TRANSFER_IN: 'Transfer In',
  TRANSFER_OUT: 'Transfer Out',
  ADD_SHARES: 'Add Shares',
  REMOVE_SHARES: 'Remove Shares',
};

const ACTIONS_NEEDING_SECURITY: ReadonlySet<InvestmentAction> = new Set([
  'BUY',
  'SELL',
  'REINVEST',
  'DIVIDEND',
  'CAPITAL_GAIN',
]);

const ACTIONS_NEEDING_QUANTITY_PRICE: ReadonlySet<InvestmentAction> = new Set([
  'BUY',
  'SELL',
  'REINVEST',
]);

export function InvestmentSplitFields({
  value,
  onChange,
  disabled = false,
  currencyCode = 'CAD',
}: InvestmentSplitFieldsProps) {
  const t = useTranslations('transactions');
  const [securities, setSecurities] = useState<Security[]>([]);
  const symbol = getCurrencySymbol(currencyCode);

  useEffect(() => {
    investmentsApi
      .getSecurities()
      .then(setSecurities)
      .catch(() => {
        /* fail silently - editor stays usable without the dropdown */
      });
  }, []);

  const action: InvestmentAction = value?.action ?? 'BUY';
  const quantity = value?.quantity ?? 0;
  const price = value?.price ?? 0;
  const commission = value?.commission ?? 0;
  const exchangeRate = value?.exchangeRate ?? 1;

  const updateField = <K extends keyof InvestmentSplitDetails>(
    field: K,
    fieldValue: InvestmentSplitDetails[K],
  ) => {
    const next: InvestmentSplitDetails = {
      action,
      securityId: value?.securityId,
      quantity,
      price,
      commission,
      exchangeRate,
      description: value?.description,
      ...(field === 'action' ? { action: fieldValue as InvestmentAction } : {}),
      [field]: fieldValue,
    };

    const cashImpact = computeInvestmentCashImpact(
      next.action,
      Number(next.quantity ?? 0),
      Number(next.price ?? 0),
      Number(next.commission ?? 0),
    );
    const amount = roundToCents(cashImpact * Number(next.exchangeRate ?? 1));
    onChange(next, amount);
  };

  const needsSecurity = ACTIONS_NEEDING_SECURITY.has(action);
  const needsQtyPrice = ACTIONS_NEEDING_QUANTITY_PRICE.has(action);

  return (
    <div className="space-y-2 p-2 bg-gray-50 dark:bg-gray-800 rounded">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Select
          options={EMBEDDED_INVESTMENT_SPLIT_ACTIONS.map((a) => ({
            value: a,
            label: ACTION_LABELS[a],
          }))}
          value={action}
          onChange={(e) => updateField('action', e.target.value as InvestmentAction)}
          disabled={disabled}
          aria-label={t('investmentSplit.ariaAction')}
        />
        {needsSecurity && (
          <Select
            options={[
              { value: '', label: t('investmentSplit.selectSecurity') },
              ...securities.map((s) => ({
                value: s.id,
                label: `${s.symbol} - ${s.name}`,
              })),
            ]}
            value={value?.securityId ?? ''}
            onChange={(e) => updateField('securityId', e.target.value || undefined)}
            disabled={disabled}
            aria-label={t('investmentSplit.ariaSecurity')}
          />
        )}
      </div>
      {needsQtyPrice && (
        <div className="grid grid-cols-3 gap-2">
          <NumericInput
            value={quantity || undefined}
            onChange={(v) => updateField('quantity', Number(v ?? 0))}
            decimalPlaces={8}
            min={0}
            disabled={disabled}
            placeholder={t('investmentSplit.quantityPlaceholder')}
          />
          <NumericInput
            value={price || undefined}
            onChange={(v) => updateField('price', Number(v ?? 0))}
            decimalPlaces={6}
            min={0}
            disabled={disabled}
            placeholder={t('investmentSplit.pricePlaceholder')}
            prefix={symbol}
          />
          <CurrencyInput
            value={commission || undefined}
            onChange={(v) => updateField('commission', Number(v ?? 0))}
            disabled={disabled}
            placeholder={t('investmentSplit.commissionPlaceholder')}
            prefix={symbol}
            allowNegative={false}
          />
        </div>
      )}
      {!needsQtyPrice && (
        <CurrencyInput
          value={price || undefined}
          onChange={(v) => updateField('price', Number(v ?? 0))}
          disabled={disabled}
          placeholder={t('investmentSplit.amountPlaceholder', { currency: currencyCode })}
          prefix={symbol}
          allowNegative={false}
        />
      )}
    </div>
  );
}
