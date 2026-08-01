import { describe, it, expect } from 'vitest';
import {
  RELEASE_1_13_FOREIGN_CURRENCY_TOUR,
  RELEASE_1_13_TOURS,
} from './release-1.13.0';
import { TOUR_ANCHORS } from '../anchors';
import { getReleaseTours } from '../registry';
import type { TourAnchorId } from '../anchors';

const tour = RELEASE_1_13_FOREIGN_CURRENCY_TOUR;
const ANCHOR_VALUES = new Set<TourAnchorId>(Object.values(TOUR_ANCHORS));

describe('foreign-currency release tour', () => {
  it('is a 1.13 release tour registered under a stable id', () => {
    expect(tour.id).toBe('release-1.13.0/foreign-currency');
    expect(tour.version).toBe('1.13');
    expect(tour.area).toBe('transactions');
    expect(tour.i18nPrefix).toBe('release.v1_13_0.foreignCurrency');
    expect(RELEASE_1_13_TOURS).toContain(tour);
    expect(getReleaseTours('1.13.4').map((t) => t.id)).toContain(tour.id);
  });

  it('walks the fee -> transaction -> detail -> report path in order', () => {
    expect(tour.steps.map((s) => s.id)).toEqual([
      'welcome',
      'openAccountEdit',
      'fxFeePercent',
      'closeAccountForm',
      'newTransaction',
      'chooseAccount',
      'enterDetails',
      'entryCurrency',
      'enterAmount',
      'closeTransactionForm',
      'openAccountDetail',
      'fxSection',
      'report',
      'finish',
    ]);
  });

  it('only anchors on ids that exist in TOUR_ANCHORS', () => {
    for (const step of tour.steps) {
      if (step.anchorId !== null) {
        expect(ANCHOR_VALUES.has(step.anchorId)).toBe(true);
      }
    }
  });

  it('opens and closes the account edit form around the fee field', () => {
    const openEdit = tour.steps.find((s) => s.id === 'openAccountEdit')!;
    expect(openEdit.advance).toEqual({
      type: 'appear',
      anchorId: TOUR_ANCHORS.accountFxFeePercent,
    });

    const fee = tour.steps.find((s) => s.id === 'fxFeePercent')!;
    expect(fee.anchorId).toBe(TOUR_ANCHORS.accountFxFeePercent);

    const closeForm = tour.steps.find((s) => s.id === 'closeAccountForm')!;
    // Spotlights the form's own Cancel/Update pair rather than floating a
    // centered card, so the user can see what ends the step.
    expect(closeForm.anchorId).toBe(TOUR_ANCHORS.accountFormActions);
    expect(closeForm.advance).toEqual({
      type: 'disappear',
      anchorId: TOUR_ANCHORS.accountFxFeePercent,
    });
  });

  it('opens the transaction form and points at the entry-currency picker', () => {
    const newTxn = tour.steps.find((s) => s.id === 'newTransaction')!;
    expect(newTxn.anchorId).toBe(TOUR_ANCHORS.transactionsNewButton);
    expect(newTxn.advance).toEqual({
      type: 'appear',
      anchorId: TOUR_ANCHORS.transactionForm,
    });

    // The fee lives on the account and the rate is fetched for the date, so
    // both are confirmed (and editable) before anything currency-specific.
    const account = tour.steps.find((s) => s.id === 'chooseAccount')!;
    expect(account.anchorId).toBe(TOUR_ANCHORS.transactionAccountDate);
    expect(tour.steps.findIndex((s) => s.id === 'chooseAccount')).toBeLessThan(
      tour.steps.findIndex((s) => s.id === 'entryCurrency'),
    );

    // The ordinary payee/category entry comes before the currency step.
    const details = tour.steps.find((s) => s.id === 'enterDetails')!;
    expect(details.anchorId).toBe(TOUR_ANCHORS.transactionFields);
    expect(tour.steps.findIndex((s) => s.id === 'enterDetails')).toBeLessThan(
      tour.steps.findIndex((s) => s.id === 'entryCurrency'),
    );

    const currency = tour.steps.find((s) => s.id === 'entryCurrency')!;
    expect(currency.anchorId).toBe(TOUR_ANCHORS.transactionCurrencyField);
    // Interactive: advances only once the user actually selects a foreign
    // currency (the converted-amount field mounts), not on a passive Next.
    expect(currency.advance).toEqual({
      type: 'appear',
      anchorId: TOUR_ANCHORS.transactionConvertedAmount,
    });

    const closeTxn = tour.steps.find((s) => s.id === 'closeTransactionForm')!;
    expect(closeTxn.anchorId).toBe(TOUR_ANCHORS.transactionFormActions);
    expect(closeTxn.advance).toEqual({
      type: 'disappear',
      anchorId: TOUR_ANCHORS.transactionForm,
    });
  });

  it('lets the user type the amount while the conversion step is shown', () => {
    const amount = tour.steps.find((s) => s.id === 'enterAmount')!;
    expect(amount.anchorId).toBe(TOUR_ANCHORS.transactionFxConversion);
    // Passive (Next-advancing) but the spotlit fields stay clickable, so the
    // amount can be typed and the rate/fee seen filling in live.
    expect(amount.advance).toBeUndefined();
    expect(amount.allowInteraction).toBe(true);
    // It follows the currency choice: the conversion group only exists then.
    expect(tour.steps.findIndex((s) => s.id === 'enterAmount')).toBeGreaterThan(
      tour.steps.findIndex((s) => s.id === 'entryCurrency'),
    );
  });

  // Every step that asks the user to type into the spotlit control must keep
  // the cutout clickable; a plain passive step covers it with a click blocker.
  it.each(['fxFeePercent', 'chooseAccount', 'enterDetails', 'enterAmount'])(
    'allows input on the "%s" step',
    (id) => {
      const step = tour.steps.find((s) => s.id === id)!;
      expect(step.allowInteraction).toBe(true);
    },
  );

  // The accounts-list steps ask the user to find their own card in the table,
  // so they must not dim it or park a card over the middle of it.
  it.each(['openAccountEdit', 'openAccountDetail'])(
    'shows the "%s" step as an unobtrusive coach mark',
    (id) => {
      const step = tour.steps.find((s) => s.id === id)!;
      expect(step.unobtrusive).toBe(true);
      expect(step.anchorId).toBeNull();
    },
  );

  it('routes to a dynamic account detail page then highlights its fx section', () => {
    const openDetail = tour.steps.find((s) => s.id === 'openAccountDetail')!;
    expect(openDetail.advance).toEqual({ type: 'route', route: '/accounts/' });

    const section = tour.steps.find((s) => s.id === 'fxSection')!;
    expect(section.routeMatch).toBe('/accounts/');
    expect(section.anchorId).toBe(TOUR_ANCHORS.foreignCurrencyFees);
  });

  it('ends on the cross-account report card', () => {
    const report = tour.steps.find((s) => s.id === 'report')!;
    // Forces the listing to the category holding the report, since the filter
    // is remembered across visits and could otherwise hide it. routeMatch
    // keeps the engine's route check working (a pathname carries no query).
    expect(report.route).toBe('/reports?category=insights');
    expect(report.routeMatch).toBe('/reports');
    expect(report.anchorId).toBe(TOUR_ANCHORS.reportForeignCurrencyFees);
  });

  it('keeps Split out of reach so the walkthrough has one path', () => {
    expect(tour.disableTransactionSplit).toBe(true);
  });

  it('does not sit behind a blank screen before standing in for itself', () => {
    // The stand-in card only shows once the anchor wait is over, and the
    // overlay renders nothing while it waits -- so a fallback step that kept
    // the 5s/10s defaults would blank the tour before explaining itself.
    for (const id of ['fxSection', 'report']) {
      const step = RELEASE_1_13_FOREIGN_CURRENCY_TOUR.steps.find((s) => s.id === id)!;
      expect(step.fallbackWhenMissing).toBe(true);
      expect(step.anchorTimeoutMs).toBeLessThanOrEqual(4000);
    }
  });
});
