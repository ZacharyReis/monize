import { describe, it, expect } from 'vitest';
import { getNextScheduled } from './scheduled-utils';
import { ScheduledTransaction } from '@/types/scheduled-transaction';

const makeScheduled = (
  overrides: Partial<ScheduledTransaction> = {},
): ScheduledTransaction =>
  ({
    id: 'st-1',
    accountId: 'a-1',
    payeeId: 'p-1',
    payee: null,
    payeeName: 'Hydro One',
    categoryId: 'c-1',
    amount: -120,
    currencyCode: 'CAD',
    frequency: 'MONTHLY',
    nextDueDate: '2026-08-01T00:00:00.000Z',
    isActive: true,
    nextOverride: null,
    ...overrides,
  }) as ScheduledTransaction;

describe('getNextScheduled', () => {
  it('returns the soonest matching active item', () => {
    const result = getNextScheduled(
      [
        makeScheduled({ id: 'later', nextDueDate: '2026-09-01' }),
        makeScheduled({ id: 'sooner', nextDueDate: '2026-07-15', amount: -55 }),
      ],
      (st) => st.accountId === 'a-1',
    );
    expect(result).toEqual({
      date: '2026-07-15',
      amount: -55,
      currencyCode: 'CAD',
      payeeName: 'Hydro One',
    });
  });

  it('skips inactive and non-matching items', () => {
    const result = getNextScheduled(
      [
        makeScheduled({ isActive: false }),
        makeScheduled({ accountId: 'a-2' }),
      ],
      (st) => st.accountId === 'a-1',
    );
    expect(result).toBeNull();
  });

  it('honours per-occurrence date and amount overrides', () => {
    const result = getNextScheduled(
      [
        makeScheduled({
          nextDueDate: '2026-08-01',
          nextOverride: {
            overrideDate: '2026-07-20T00:00:00.000Z',
            amount: -99.5,
          } as ScheduledTransaction['nextOverride'],
        }),
      ],
      () => true,
    );
    expect(result).toEqual({
      date: '2026-07-20',
      amount: -99.5,
      currencyCode: 'CAD',
      payeeName: 'Hydro One',
    });
  });

  it('prefers the linked payee name over the free-text name', () => {
    const result = getNextScheduled(
      [makeScheduled({ payee: { name: 'Hydro One Networks' } as ScheduledTransaction['payee'] })],
      () => true,
    );
    expect(result?.payeeName).toBe('Hydro One Networks');
  });
});
