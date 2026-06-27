import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen } from '@/test/render';
import { render } from '@/test/render';
import { AuthLanguageSwitcher } from './AuthLanguageSwitcher';

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

async function openMenu() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Language' }));
  });
}

describe('AuthLanguageSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('renders a globe button and no menu initially', () => {
    render(<AuthLanguageSwitcher />);
    expect(screen.getByRole('button', { name: 'Language' })).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens a menu listing every supported locale with the active one checked', async () => {
    render(<AuthLanguageSwitcher />);
    await openMenu();

    expect(screen.getByRole('menu')).toBeInTheDocument();
    const items = screen.getAllByRole('menuitemradio');
    expect(items.length).toBeGreaterThanOrEqual(9);
    expect(screen.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemradio', { name: 'Polski' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('persists the chosen language to the cookie, refreshes, and closes the menu', async () => {
    render(<AuthLanguageSwitcher />);
    await openMenu();

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Polski' }));
    });

    expect(Cookies.set).toHaveBeenCalledWith(
      'NEXT_LOCALE',
      'pl',
      expect.objectContaining({ sameSite: 'lax' }),
    );
    // Flags the choice as deliberate so the post-login preference sync
    // persists it to the user's stored preferences.
    expect(sessionStorage.getItem('preLoginLocale')).toBe('pl');
    expect(mockRefresh).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('does nothing when re-selecting the active language', async () => {
    render(<AuthLanguageSwitcher />);
    await openMenu();

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'English' }));
    });

    expect(Cookies.set).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes the menu on Escape', async () => {
    render(<AuthLanguageSwitcher />);
    await openMenu();

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes the menu when clicking outside', async () => {
    render(<AuthLanguageSwitcher />);
    await openMenu();

    await act(async () => {
      fireEvent.mouseDown(document.body);
    });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
