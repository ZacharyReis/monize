import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@/test/render';
import { AiBubbleToggle } from './AiBubbleToggle';

vi.mock('@/lib/user-settings', () => ({
  userSettingsApi: {
    updatePreferences: vi.fn(),
  },
}));

const updatePreferencesStore = vi.fn();
let mockPreferences: { aiBubbleEnabled: boolean } | null;

vi.mock('@/store/preferencesStore', () => ({
  usePreferencesStore: vi.fn(),
}));

vi.mock('@/lib/errors', () => ({
  getErrorMessage: vi.fn((_error: unknown, fallback: string) => fallback),
}));

import { userSettingsApi } from '@/lib/user-settings';
import { usePreferencesStore } from '@/store/preferencesStore';
import toast from 'react-hot-toast';

beforeEach(() => {
  vi.clearAllMocks();
  mockPreferences = { aiBubbleEnabled: false };
  (usePreferencesStore as unknown as Mock).mockImplementation((selector: any) =>
    selector({
      preferences: mockPreferences,
      updatePreferences: updatePreferencesStore,
    }),
  );
});

describe('AiBubbleToggle', () => {
  it('renders the heading and an off switch by default', () => {
    render(<AiBubbleToggle />);
    expect(screen.getByText('Floating chat bubble')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('enables the bubble and shows the success toast', async () => {
    (userSettingsApi.updatePreferences as Mock).mockResolvedValue({
      aiBubbleEnabled: true,
    });

    render(<AiBubbleToggle />);
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => {
      expect(userSettingsApi.updatePreferences).toHaveBeenCalledWith({
        aiBubbleEnabled: true,
      });
      expect(toast.success).toHaveBeenCalledWith('Floating chat bubble enabled');
    });
    // Optimistic update fired immediately with the new value.
    expect(updatePreferencesStore).toHaveBeenCalledWith({ aiBubbleEnabled: true });
  });

  it('disables the bubble when currently on', async () => {
    mockPreferences = { aiBubbleEnabled: true };
    (userSettingsApi.updatePreferences as Mock).mockResolvedValue({
      aiBubbleEnabled: false,
    });

    render(<AiBubbleToggle />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => {
      expect(userSettingsApi.updatePreferences).toHaveBeenCalledWith({
        aiBubbleEnabled: false,
      });
      expect(toast.success).toHaveBeenCalledWith('Floating chat bubble disabled');
    });
  });

  it('reverts the optimistic change and shows an error toast on failure', async () => {
    (userSettingsApi.updatePreferences as Mock).mockRejectedValue(
      new Error('Network error'),
    );

    render(<AiBubbleToggle />);
    fireEvent.click(screen.getByRole('switch'));
    // Drain the rejection handler microtask.
    await act(async () => {});

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Could not update the chat bubble setting',
      );
    });
    // Optimistic on, then revert back off.
    expect(updatePreferencesStore).toHaveBeenCalledWith({ aiBubbleEnabled: true });
    expect(updatePreferencesStore).toHaveBeenCalledWith({ aiBubbleEnabled: false });
  });

  it('disables the switch when the disabled prop is set', () => {
    render(<AiBubbleToggle disabled />);
    expect(screen.getByRole('switch')).toBeDisabled();
  });
});
