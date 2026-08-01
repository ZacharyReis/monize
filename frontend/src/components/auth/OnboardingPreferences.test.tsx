import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@/test/render';
import { OnboardingPreferences } from './OnboardingPreferences';

const mockUpdatePreferences = vi.fn();
const mockStoreUpdate = vi.fn();
const mockRefresh = vi.fn();

vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<typeof import('next/navigation')>(
    'next/navigation',
  );
  return {
    ...actual,
    useRouter: () => ({ refresh: mockRefresh, push: vi.fn(), replace: vi.fn() }),
  };
});

vi.mock('@/lib/exchange-rates', () => ({
  exchangeRatesApi: {
    getCurrencyCatalog: vi.fn().mockResolvedValue([
      { code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2 },
      { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', decimalPlaces: 2 },
    ]),
  },
}));

vi.mock('@/lib/user-settings', () => ({
  userSettingsApi: {
    updatePreferences: (...args: unknown[]) => mockUpdatePreferences(...args),
  },
}));

vi.mock('@/store/preferencesStore', () => ({
  usePreferencesStore: (selector: (s: unknown) => unknown) =>
    selector({ updatePreferences: mockStoreUpdate }),
}));

vi.mock('js-cookie', () => ({ default: { set: vi.fn() } }));

async function renderOnboarding(onComplete = vi.fn()) {
  await act(async () => {
    render(<OnboardingPreferences initialLanguage="en" onComplete={onComplete} />);
  });
  return { onComplete };
}

/** Render without an explicit language so the browser detection path runs. */
async function renderAutoDetected(onComplete = vi.fn()) {
  await act(async () => {
    render(<OnboardingPreferences onComplete={onComplete} />);
  });
  return { onComplete };
}

const originalLanguages = window.navigator.languages;

function setBrowserLanguages(languages: string[]) {
  Object.defineProperty(window.navigator, 'languages', {
    value: languages,
    configurable: true,
  });
  Object.defineProperty(window.navigator, 'language', {
    value: languages[0],
    configurable: true,
  });
}

describe('OnboardingPreferences', () => {
  beforeEach(() => vi.clearAllMocks());

  afterEach(() => {
    Object.defineProperty(window.navigator, 'languages', {
      value: originalLanguages,
      configurable: true,
    });
    Object.defineProperty(window.navigator, 'language', {
      value: originalLanguages[0],
      configurable: true,
    });
  });

  it('pre-selects the currency detected from the browser region', async () => {
    setBrowserLanguages(['en-CA', 'en']);
    await renderOnboarding();
    await waitFor(() =>
      expect(screen.getByLabelText('Default currency')).toHaveValue('CAD'),
    );
  });

  it('falls back to USD when the detected currency is not in the catalog', async () => {
    // The catalog this instance serves only carries USD and CAD, so a detected
    // JPY must not leave the picker showing a code it cannot offer.
    setBrowserLanguages(['ja-JP']);
    await renderOnboarding();
    await waitFor(() =>
      expect(screen.getByLabelText('Default currency')).toHaveValue('USD'),
    );
  });

  it('pre-selects the browser language when none is supplied', async () => {
    setBrowserLanguages(['pl-PL', 'pl']);
    await renderAutoDetected();
    expect(screen.getByLabelText('Language')).toHaveValue('pl');
  });

  it('saves the detected values when the user just continues', async () => {
    setBrowserLanguages(['fr-CA', 'fr']);
    mockUpdatePreferences.mockResolvedValue({ language: 'fr', defaultCurrency: 'CAD' });
    await renderAutoDetected();

    await waitFor(() =>
      expect(screen.getByLabelText('Default currency')).toHaveValue('CAD'),
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Continue'));
    });

    await waitFor(() =>
      expect(mockUpdatePreferences).toHaveBeenCalledWith({
        language: 'fr',
        defaultCurrency: 'CAD',
      }),
    );
  });

  it('renders language and currency selectors', async () => {
    await renderOnboarding();
    expect(screen.getByText('Language')).toBeInTheDocument();
    expect(screen.getByText('Default currency')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText('CA$ - Canadian Dollar (CAD)')).toBeInTheDocument(),
    );
  });

  it('saves the chosen language and currency on continue', async () => {
    mockUpdatePreferences.mockResolvedValue({ language: 'en', defaultCurrency: 'CAD' });
    const { onComplete } = await renderOnboarding();

    await waitFor(() =>
      expect(screen.getByText('CA$ - Canadian Dollar (CAD)')).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Default currency'), {
        target: { value: 'CAD' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Continue'));
    });

    await waitFor(() =>
      expect(mockUpdatePreferences).toHaveBeenCalledWith({
        language: 'en',
        defaultCurrency: 'CAD',
      }),
    );
    expect(mockStoreUpdate).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith({ localeChanged: false });
  });

  it('reports a locale change so the caller performs a full navigation', async () => {
    mockUpdatePreferences.mockResolvedValue({ language: 'pl', defaultCurrency: 'USD' });
    const { onComplete } = await renderOnboarding();

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Language'), {
        target: { value: 'pl' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Continue'));
    });

    await waitFor(() =>
      expect(mockUpdatePreferences).toHaveBeenCalledWith({
        language: 'pl',
        defaultCurrency: 'USD',
      }),
    );
    // The active locale is 'en' in tests, so picking 'pl' must flag the
    // change; the register page then does window.location.assign instead of
    // a client-side push that would reuse the cached English layout.
    expect(onComplete).toHaveBeenCalledWith({ localeChanged: true });
  });

  it('skips without saving', async () => {
    const { onComplete } = await renderOnboarding();
    await act(async () => {
      fireEvent.click(screen.getByText('Skip for now'));
    });
    expect(mockUpdatePreferences).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalledWith({ localeChanged: true });
  });
});
