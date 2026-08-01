import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@/test/render';
import {
  ImportDefaultCategoriesDialog,
  guessCountry,
} from './ImportDefaultCategoriesDialog';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const mockGetDefaultCountries = vi.fn();
vi.mock('@/lib/categories', () => ({
  categoriesApi: {
    getDefaultCountries: (...args: any[]) => mockGetDefaultCountries(...args),
  },
}));

async function renderDialog(props: Partial<Parameters<typeof ImportDefaultCategoriesDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  await act(async () => {
    render(
      <ImportDefaultCategoriesDialog
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
        {...props}
      />,
    );
  });
  return { onConfirm, onClose };
}

describe('guessCountry', () => {
  it('uses the region of the app locale when it has one', () => {
    expect(guessCountry('en-CA', ['CA', 'GB', 'US'])).toBe('CA');
    expect(guessCountry('en-GB', ['CA', 'GB', 'US'])).toBe('GB');
  });

  it('ignores regions the backend does not offer', () => {
    expect(guessCountry('fr-FR', ['CA', 'GB'])).toBe('');
  });

  it("falls back to the browser's region when the app locale has none", () => {
    // jsdom reports navigator.language as en-US.
    expect(guessCountry('de', ['CA', 'GB', 'US'])).toBe('US');
  });

  it('falls back to generic when nothing matches', () => {
    expect(guessCountry('de', [])).toBe('');
  });
});

describe('ImportDefaultCategoriesDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDefaultCountries.mockResolvedValue(['CA', 'GB', 'US']);
  });

  it('lists the generic option plus every country from the API', async () => {
    await renderDialog();

    await waitFor(() => {
      expect(screen.getByText('Canada')).toBeInTheDocument();
    });
    expect(screen.getByText('Generic (no country-specific categories)')).toBeInTheDocument();
    expect(screen.getByText('United Kingdom')).toBeInTheDocument();
    expect(screen.getByText('United States')).toBeInTheDocument();
  });

  it('defaults the language to the active locale', async () => {
    await renderDialog();

    expect((screen.getByLabelText('Language') as HTMLSelectElement).value).toBe('en');
  });

  it('confirms with the selected country and language', async () => {
    const { onConfirm } = await renderDialog();
    await waitFor(() => expect(screen.getByText('Canada')).toBeInTheDocument());

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'CA' } });
      fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'fr' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Import Categories'));
    });

    expect(onConfirm).toHaveBeenCalledWith({ country: 'CA', language: 'fr' });
  });

  it('omits the country when the generic set is chosen', async () => {
    const { onConfirm } = await renderDialog();
    await waitFor(() => expect(screen.getByText('Canada')).toBeInTheDocument());

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Country'), { target: { value: '' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Import Categories'));
    });

    expect(onConfirm).toHaveBeenCalledWith({ language: 'en' });
  });

  it('still offers the generic set when the country list fails to load', async () => {
    mockGetDefaultCountries.mockRejectedValueOnce(new Error('boom'));
    const { onConfirm } = await renderDialog();
    await act(async () => {});

    expect(screen.queryByText('Canada')).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText('Import Categories'));
    });
    expect(onConfirm).toHaveBeenCalledWith({ language: 'en' });
  });

  it('closes without importing when cancelled', async () => {
    const { onClose, onConfirm } = await renderDialog();

    await act(async () => {
      fireEvent.click(screen.getByText('Cancel'));
    });

    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('disables the controls while an import is running', async () => {
    await renderDialog({ isImporting: true });

    expect(screen.getByLabelText('Country')).toBeDisabled();
    expect(screen.getByLabelText('Language')).toBeDisabled();
  });

  it('renders nothing when closed', async () => {
    await renderDialog({ isOpen: false });

    expect(screen.queryByText('Import default categories')).not.toBeInTheDocument();
    expect(mockGetDefaultCountries).not.toHaveBeenCalled();
  });
});
