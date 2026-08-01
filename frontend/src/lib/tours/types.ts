import type { TourAnchorId } from './anchors';

/** App areas a tour belongs to, used for grouping and the offer-row label. */
export type TourArea =
  | 'intro'
  | 'transactions'
  | 'accounts'
  | 'budgets'
  | 'reports'
  | 'settings';

/**
 * How a step advances to the next one.
 * - `next`     passive: the user clicks Next (the default).
 * - `click`    interactive: advance when the user clicks the highlighted anchor.
 *              A click that triggers navigation must use `route`, not this.
 * - `appear`   advance when a target element appears (e.g. a form opens).
 * - `disappear` advance when a target goes away (e.g. the user closes a form).
 * - `route`    advance when the pathname changes (optionally matching a prefix).
 */
export type TourAdvance =
  | { type: 'next' }
  | { type: 'click' }
  | { type: 'appear'; anchorId: TourAnchorId }
  | { type: 'disappear'; anchorId: TourAnchorId }
  | { type: 'route'; route?: string };

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'auto';

/**
 * Data a step needs before it is worth showing.
 * - `transactionEntry` the user has at least one account, so walking them
 *   through the New Transaction form makes sense. Deliberately *only* accounts:
 *   the account is the one field the form requires and the one thing that
 *   cannot be created from inside it, while payee and category are optional and
 *   can be created inline -- which the walkthrough itself teaches. Gating on
 *   those too would hide the tour's most useful section from exactly the new
 *   users it is for.
 */
export type TourRequirement = 'transactionEntry';

export interface TourStep {
  /** i18n leaf: tours.<i18nPrefix>.steps.<id>.{title,body}. */
  id: string;
  /**
   * The engine navigates here first if the current route differs. Omit for a
   * route-agnostic step (a centered welcome/outro that shows wherever the user
   * already is) -- the engine neither navigates nor treats a route change as a
   * dismissal for it, which also avoids colliding with a closing
   * `pushHistory` modal's `history.back()` when a tour is launched from one.
   */
  route?: string;
  /** Prefix match for dynamic routes (e.g. '/accounts/' matches '/accounts/<id>'). */
  routeMatch?: string;
  /** null = centered welcome/outro card with no anchor. */
  anchorId: TourAnchorId | null;
  /** Defaults to { type: 'next' }. */
  advance?: TourAdvance;
  /**
   * Keep the spotlit control clickable on a passive (Next-advancing) step, so
   * the user can type into it while reading the explanation. Passive steps
   * otherwise cover the cutout with a blocker to keep the page inert. Implied
   * by any interactive `advance`; only set it alongside `{ type: 'next' }`.
   */
  allowInteraction?: boolean;
  /**
   * Show the step as an unobtrusive coach mark: no dimming overlay, and (for an
   * anchorless step) the card parked in a screen corner rather than centered.
   * An anchored step keeps its highlight ring, so it still points somewhere.
   * For steps introducing a whole screen, or asking the user to scan the page
   * and act on it (e.g. "find your credit card and choose Edit"), where dimming
   * hides the very content the step is about.
   */
  unobtrusive?: boolean;
  /**
   * Open the header's Tools dropdown while this step is showing, so the step
   * can describe what is inside it rather than pointing at a closed menu.
   */
  openToolsMenu?: boolean;
  /**
   * Data this step needs to be worth showing. The engine omits the step (with
   * no "steps were skipped" outro -- the omission is deliberate) when the
   * requirement is not met, e.g. skipping the record-a-transaction walkthrough
   * for a user who has no accounts yet.
   */
  requires?: TourRequirement;
  placement?: TourPlacement;
  /** Filtered out at startTour on narrow viewports. */
  skipOnMobile?: boolean;
  /**
   * The step only makes sense while transient UI it does not open itself is on
   * screen -- the fields inside the New Transaction form, say. Once that UI is
   * gone, Back must not land here: the anchor can no longer mount, so the card
   * would vanish and the engine would auto-skip forward seconds later, which
   * reads as the tour breaking. Back walks past such steps (while their anchor
   * is missing) to the nearest one that can be shown again; with the form still
   * open they behave normally, so stepping back inside a form keeps working.
   */
  skipOnBack?: boolean;
  /**
   * When the anchor never appears, show the step as a centered card carrying
   * `steps.<id>.fallbackBody` instead of skipping it.
   *
   * For steps whose anchor depends on the user's own data -- the
   * foreign-currency section exists only once an account has foreign activity,
   * so a tour run on a fresh account would drop the very step it builds up to.
   * Skipping is right for an anchor that went missing to a refactor; it is
   * wrong for one whose absence is itself worth a sentence, and it leaves the
   * step counter jumping with nothing to explain the gap.
   *
   * Pair it with a short `anchorTimeoutMs`: the stand-in only appears once the
   * wait is over, and the overlay renders nothing while waiting, so a default
   * timeout would blank the screen for seconds before explaining itself.
   */
  fallbackWhenMissing?: boolean;
  /**
   * How long to wait for the anchor before gracefully skipping the step.
   * Defaults to 5000ms; the engine uses 10000ms for the first anchor after a
   * navigation so cold route loads on slow connections do not eat steps.
   */
  anchorTimeoutMs?: number;
}

export interface TourDefinition {
  /** Persistence key ('intro/basics', 'release-1.13.0/foreign-currency'). Never rename. */
  id: string;
  area: TourArea;
  /** Minor line for release tours ('1.13'); undefined for evergreen tours. */
  version?: string;
  /** i18n prefix under the `tours` namespace (e.g. 'intro.basics'). */
  i18nPrefix: string;
  /**
   * Disable the transaction form's Split controls while this tour runs, so the
   * walkthrough keeps to the single path it covers. They stay visible (just
   * greyed out) so the form does not change shape mid-tour. Off by default --
   * the introduction tour teaches Split and must keep it usable.
   */
  disableTransactionSplit?: boolean;
  steps: readonly TourStep[];
}

/** Terminal states persisted for a tour. */
export type TourStatus = 'completed' | 'dismissed';

export interface TourProgressEntry {
  status: TourStatus;
  version?: string;
  updatedAt: string;
}

export type TourProgressMap = Record<string, TourProgressEntry>;
