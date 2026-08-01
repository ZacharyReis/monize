import { TOUR_ANCHORS } from '../anchors';
import type { TourDefinition } from '../types';

/** Minor line these tours belong to; matched against the running major.minor. */
export const RELEASE_1_13_MINOR = '1.13';

/**
 * The full foreign-currency workflow (#931, #933, #935, #949): configure a
 * card's foreign-transaction fee, record a purchase in a foreign currency, see
 * the resulting per-account fee section, and find the cross-account report.
 *
 * It is deliberately interactive because there is no way to synthesize the
 * dynamic pieces (a specific account id, an open form, real foreign activity):
 *  - The fee step opens the account edit form itself (`appear` on the fee
 *    field, which the form always renders) and closes it again (`disappear`).
 *  - The transaction step opens the New Transaction form the same way and
 *    points at the entry-currency picker, whose popover hosts "Add currency..."
 *    for users whose only active currency is their own.
 *  - The detail-page steps use interactive route advances to `/accounts/` --
 *    the user opens the account via its Details action. When the account has no
 *    foreign activity yet, the fee-section anchor never mounts and the engine
 *    gracefully skips that step (falling through to the centered finish/outro),
 *    so the tour never strands silently.
 *
 * Every anchor it relies on is either page-level (New Transaction, the report
 * card) or a form field that renders unconditionally (the fee input, the
 * currency picker), so the tour runs on every viewport without desktop-only
 * skips.
 */
export const RELEASE_1_13_FOREIGN_CURRENCY_TOUR: TourDefinition = {
  id: 'release-1.13.0/foreign-currency',
  area: 'transactions',
  version: RELEASE_1_13_MINOR,
  i18nPrefix: 'release.v1_13_0.foreignCurrency',
  // The walkthrough covers one path: a normal, single-category transaction.
  // Splits support foreign entry too, but stepping into that mode mid-tour
  // swaps the fields out from under the remaining steps, so Split is greyed
  // out (not removed) while this tour runs.
  disableTransactionSplit: true,
  steps: [
    {
      // Route-agnostic welcome: shows wherever the tour was launched, so it
      // never fights a closing What's New modal's history.back().
      id: 'welcome',
      anchorId: null,
    },
    {
      // Prompt on the accounts list; advances when the account edit form opens
      // (its fee field mounts), however the user opens it. Unobtrusive: the
      // user has to read the list and find their card, so no dim and the card
      // sits in the corner.
      id: 'openAccountEdit',
      route: '/accounts',
      anchorId: null,
      unobtrusive: true,
      advance: { type: 'appear', anchorId: TOUR_ANCHORS.accountFxFeePercent },
    },
    {
      // In-form: the fee field renders unconditionally, so it is present for
      // every account type; the modal layers over /accounts (no route change).
      // allowInteraction so the user can actually type the percentage here.
      id: 'fxFeePercent',
      route: '/accounts',
      anchorId: TOUR_ANCHORS.accountFxFeePercent,
      placement: 'auto',
      allowInteraction: true,
      skipOnBack: true,
    },
    {
      // Spotlight the form's own Cancel/Update pair so the user can see (and
      // click) exactly what ends the step; advance once the form is gone.
      id: 'closeAccountForm',
      route: '/accounts',
      anchorId: TOUR_ANCHORS.accountFormActions,
      placement: 'top',
      advance: { type: 'disappear', anchorId: TOUR_ANCHORS.accountFxFeePercent },
      skipOnBack: true,
    },
    {
      // Interactive: clicking New Transaction opens the form; advance on appear.
      id: 'newTransaction',
      route: '/transactions',
      anchorId: TOUR_ANCHORS.transactionsNewButton,
      placement: 'bottom',
      advance: { type: 'appear', anchorId: TOUR_ANCHORS.transactionForm },
    },
    {
      // The fee is a property of the account, and the rate is fetched for the
      // transaction's date, so both have to be right before the currency step.
      // allowInteraction so the account select and date picker are usable.
      id: 'chooseAccount',
      route: '/transactions',
      anchorId: TOUR_ANCHORS.transactionAccountDate,
      placement: 'auto',
      allowInteraction: true,
      skipOnBack: true,
    },
    {
      // In-form: the ordinary payee/category entry, unchanged by foreign
      // currency -- fill it in as usual before the currency step.
      // allowInteraction so the fields accept input while the step is shown.
      id: 'enterDetails',
      route: '/transactions',
      anchorId: TOUR_ANCHORS.transactionFields,
      placement: 'auto',
      allowInteraction: true,
      skipOnBack: true,
    },
    {
      // Interactive: spotlight the entry-currency picker and wait until the
      // user actually chooses a foreign currency -- the converted-amount field
      // only mounts once one is set. Its popover carries "Add currency..." for
      // users whose only active currency is their own, and creating one there
      // auto-selects it, so this single advance covers both paths.
      id: 'entryCurrency',
      route: '/transactions',
      anchorId: TOUR_ANCHORS.transactionCurrencyField,
      // Sit the tooltip above the button so it clears the currency popover,
      // which opens downward from it.
      placement: 'top',
      advance: { type: 'appear', anchorId: TOUR_ANCHORS.transactionConvertedAmount },
      skipOnBack: true,
    },
    {
      // The payoff: the whole conversion group (entered amount, converted
      // total, rate and fee captions). Passive so the user reads it at their
      // own pace, but `allowInteraction` keeps the fields clickable so they can
      // type the amount and watch the rate and fee fill in live -- a plain
      // passive step would cover them with the spotlight's click blocker.
      id: 'enterAmount',
      route: '/transactions',
      anchorId: TOUR_ANCHORS.transactionFxConversion,
      placement: 'auto',
      allowInteraction: true,
      skipOnBack: true,
    },
    {
      // Spotlight the transaction form's own Cancel/Save pair, as above.
      id: 'closeTransactionForm',
      route: '/transactions',
      anchorId: TOUR_ANCHORS.transactionFormActions,
      placement: 'top',
      advance: { type: 'disappear', anchorId: TOUR_ANCHORS.transactionForm },
      skipOnBack: true,
    },
    {
      // Prompt on the accounts list; advance when the user opens an account's
      // Details page (any /accounts/<id>). Unobtrusive for the same reason as
      // the earlier accounts-list step.
      id: 'openAccountDetail',
      route: '/accounts',
      anchorId: null,
      unobtrusive: true,
      advance: { type: 'route', route: '/accounts/' },
    },
    {
      // The new per-account section. It only exists once the account has
      // foreign activity, so on a fresh account nothing mounts -- and this is
      // the step the whole tour builds up to. `fallbackWhenMissing` keeps it on
      // screen as a centered card that says so, instead of dropping it and
      // leaving a hole in the step counter.
      id: 'fxSection',
      route: '/accounts',
      routeMatch: '/accounts/',
      anchorId: TOUR_ANCHORS.foreignCurrencyFees,
      placement: 'auto',
      fallbackWhenMissing: true,
      // The stand-in only shows once the anchor times out, and the overlay
      // renders nothing while it waits. The user drove the navigation here, so
      // the page is already loaded and the section either mounts with it or
      // does not exist: a full 5s of blank screen would read as the crash this
      // fallback exists to prevent.
      anchorTimeoutMs: 2500,
    },
    {
      // The cross-account report card on the Reports listing. The category
      // filter there is remembered across visits, so the report can easily be
      // filtered out before the tour arrives: `?category=insights` forces the
      // listing to the group holding it. `routeMatch` keeps the engine's
      // "am I there yet" check working, since a pathname carries no query.
      id: 'report',
      route: '/reports?category=insights',
      routeMatch: '/reports',
      anchorId: TOUR_ANCHORS.reportForeignCurrencyFees,
      placement: 'auto',
      // A saved search or a hidden category can still filter the card out of
      // the listing; name the report in a centered card rather than vanish.
      fallbackWhenMissing: true,
      // Long enough for the engine's own navigation to /reports to land and the
      // listing to render, short enough that the stand-in does not sit behind a
      // blank screen (the post-navigation default is 10s).
      anchorTimeoutMs: 4000,
    },
    {
      id: 'finish',
      route: '/reports',
      anchorId: null,
    },
  ],
};

/**
 * The What's New feature itself (#951): the Settings toggle that controls the
 * auto-popup and the clickable version label that reopens the notes.
 */
export const RELEASE_1_13_SETTINGS_TOUR: TourDefinition = {
  id: 'release-1.13.0/settings',
  area: 'settings',
  version: RELEASE_1_13_MINOR,
  i18nPrefix: 'release.v1_13_0.settings',
  steps: [
    {
      id: 'whatsNewToggle',
      route: '/settings',
      anchorId: TOUR_ANCHORS.settingsWhatsNewToggle,
      placement: 'auto',
    },
    {
      id: 'appVersion',
      route: '/settings',
      anchorId: TOUR_ANCHORS.settingsAppVersion,
      placement: 'top',
    },
    {
      id: 'done',
      route: '/settings',
      anchorId: null,
    },
  ],
};

export const RELEASE_1_13_TOURS: readonly TourDefinition[] = [
  RELEASE_1_13_FOREIGN_CURRENCY_TOUR,
  RELEASE_1_13_SETTINGS_TOUR,
];
