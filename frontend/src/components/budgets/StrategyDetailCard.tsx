'use client';

import { useTranslations } from 'next-intl';
import type { BudgetStrategy } from '@/types/budget';

interface StrategyDetailCardProps {
  strategy: BudgetStrategy;
}

export function StrategyDetailCard({ strategy }: StrategyDetailCardProps) {
  const t = useTranslations('budgets');

  const title = t(`strategyCard.strategies.${strategy}.title`);
  const description = t(`strategyCard.strategies.${strategy}.description`);
  const pros = t.raw(`strategyCard.strategies.${strategy}.pros`) as string[];
  const cons = t.raw(`strategyCard.strategies.${strategy}.cons`) as string[];
  const bestFor = t(`strategyCard.strategies.${strategy}.bestFor`);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
      <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {title}
      </h4>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 min-h-[4.5rem]">
        {description}
      </p>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <h5 className="text-sm font-medium text-green-700 dark:text-green-400">
            {t('strategyCard.pros')}
          </h5>
          <ul className="mt-2 space-y-1.5">
            {pros.map((pro) => (
              <li
                key={pro}
                className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300"
              >
                <span className="mt-0.5 text-green-500 dark:text-green-400">
                  +
                </span>
                {pro}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h5 className="text-sm font-medium text-amber-700 dark:text-amber-400">
            {t('strategyCard.cons')}
          </h5>
          <ul className="mt-2 space-y-1.5">
            {cons.map((con) => (
              <li
                key={con}
                className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300"
              >
                <span className="mt-0.5 text-amber-500 dark:text-amber-400">
                  -
                </span>
                {con}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-5 rounded-md bg-blue-50 p-3 dark:bg-blue-900/20">
        <p className="text-sm text-blue-800 dark:text-blue-300">
          <span className="font-medium">{t('strategyCard.bestFor')}</span>
          {bestFor}
        </p>
      </div>
    </div>
  );
}
