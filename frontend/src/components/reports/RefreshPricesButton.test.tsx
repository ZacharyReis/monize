import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/render';

const mockTrigger = vi.fn();
const state = { isRefreshing: false, lastOptions: undefined as unknown };

vi.mock('@/hooks/usePriceRefresh', () => ({
  usePriceRefresh: (opts: unknown) => {
    state.lastOptions = opts;
    return { isRefreshing: state.isRefreshing, triggerManualRefresh: mockTrigger };
  },
}));

import { RefreshPricesButton } from './RefreshPricesButton';

describe('RefreshPricesButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.isRefreshing = false;
    state.lastOptions = undefined;
  });

  it('renders a Refresh button and triggers a manual refresh on click', () => {
    render(<RefreshPricesButton />);
    const btn = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(btn);
    expect(mockTrigger).toHaveBeenCalledTimes(1);
  });

  it('shows the updating state and disables the button while refreshing', () => {
    state.isRefreshing = true;
    render(<RefreshPricesButton />);
    const btn = screen.getByRole('button', { name: /updating/i });
    expect(btn).toBeDisabled();
  });

  it('forwards onRefreshComplete to the price-refresh hook', () => {
    const onRefreshComplete = vi.fn();
    render(<RefreshPricesButton onRefreshComplete={onRefreshComplete} />);
    expect((state.lastOptions as { onRefreshComplete?: unknown })?.onRefreshComplete).toBe(
      onRefreshComplete,
    );
  });
});
