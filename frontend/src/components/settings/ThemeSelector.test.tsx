import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { act, fireEvent, screen, waitFor, render } from '@/test/render';
import { ThemeSelector } from './ThemeSelector';

const { mockSetAppTheme } = vi.hoisted(() => ({ mockSetAppTheme: vi.fn() }));

// Mock the theme context so we can assert the live theme is updated. A
// pass-through ThemeProvider keeps the custom test render wrapper working.
vi.mock('@/contexts/ThemeContext', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
  useTheme: () => ({ theme: 'system', resolvedTheme: 'light', setTheme: mockSetAppTheme }),
}));

vi.mock('@/lib/user-settings', () => ({
  userSettingsApi: {
    updatePreferences: vi.fn().mockResolvedValue({ theme: 'dark', defaultCurrency: 'USD' }),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/errors', () => ({
  getErrorMessage: vi.fn((_error: unknown, fallback: string) => fallback),
}));

import toast from 'react-hot-toast';
import { userSettingsApi } from '@/lib/user-settings';

describe('ThemeSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the theme options', () => {
    render(<ThemeSelector value="system" onChange={() => {}} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(expect.arrayContaining(['system', 'light', 'dark']));
  });

  it('applies and persists the theme immediately on change', async () => {
    const onChange = vi.fn();
    render(<ThemeSelector value="system" onChange={onChange} />);

    await act(async () => {
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'dark' } });
    });

    // Parent state and the live theme update right away, no save step.
    expect(onChange).toHaveBeenCalledWith('dark');
    expect(mockSetAppTheme).toHaveBeenCalledWith('dark');

    await waitFor(() =>
      expect(userSettingsApi.updatePreferences).toHaveBeenCalledWith({ theme: 'dark' }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('still applies the theme locally and surfaces an error when saving fails', async () => {
    (userSettingsApi.updatePreferences as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('network'),
    );
    render(<ThemeSelector value="system" onChange={() => {}} />);

    await act(async () => {
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'dark' } });
    });

    expect(mockSetAppTheme).toHaveBeenCalledWith('dark');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to save theme'));
  });
});
