import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen } from '@/test/render';
import { render } from '@/test/render';
import { AuthLanguagePicker } from './AuthLanguagePicker';

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

vi.mock('js-cookie', () => ({
  default: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
}));

import Cookies from 'js-cookie';

function getSelect() {
  return screen.getByRole('combobox', { name: 'Language' }) as HTMLSelectElement;
}

describe('AuthLanguagePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('renders a labelled dropdown listing every supported locale, active one selected', () => {
    render(<AuthLanguagePicker />);
    const select = getSelect();
    expect(select).toBeInTheDocument();
    expect(select.value).toBe('en');
    expect(
      screen.getByRole('option', { name: 'English' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Polski' })).toBeInTheDocument();
    expect(select.options.length).toBeGreaterThanOrEqual(9);
  });

  it('persists the chosen language to the cookie (only), flags it, and refreshes', async () => {
    render(<AuthLanguagePicker />);

    await act(async () => {
      fireEvent.change(getSelect(), { target: { value: 'pl' } });
    });

    expect(Cookies.set).toHaveBeenCalledWith(
      'NEXT_LOCALE',
      'pl',
      expect.objectContaining({ sameSite: 'lax' }),
    );
    // Flags the choice as deliberate so the post-login preference sync
    // persists it to the user's stored preferences (non-demo accounts).
    expect(sessionStorage.getItem('preLoginLocale')).toBe('pl');
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('does nothing when re-selecting the active language', async () => {
    render(<AuthLanguagePicker />);

    await act(async () => {
      fireEvent.change(getSelect(), { target: { value: 'en' } });
    });

    expect(Cookies.set).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('preLoginLocale')).toBeNull();
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
