import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@/test/render';
import toast from 'react-hot-toast';

const resetProgress = vi.fn().mockResolvedValue({ reset: true });
vi.mock('@/lib/tours-api', () => ({
  toursApi: {
    resetProgress: () => resetProgress(),
    saveProgress: vi.fn().mockResolvedValue({ saved: true }),
  },
}));

import { TourSettingsRow } from './TourSettingsRow';
import { useTourStore } from '@/store/tourStore';
import { ALL_TOURS } from '@/lib/tours/registry';

beforeEach(() => {
  resetProgress.mockClear();
  useTourStore.setState({
    active: null,
    progress: { 'intro/basics': { status: 'completed', updatedAt: 'now' } },
    progressLoaded: true,
  });
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: q.includes('min-width'),
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => cleanup());

/** The row whose title matches, so status and button assertions stay scoped. */
function rowFor(title: string) {
  return screen.getByText(title).closest('li') as HTMLElement;
}

/**
 * Render with the list open. It ships collapsed -- it grows with every release
 * -- so everything below the disclosure needs the click first.
 */
function renderExpanded() {
  const view = render(<TourSettingsRow />);
  fireEvent.click(screen.getByRole('button', { name: /Show tours/ }));
  return view;
}

describe('TourSettingsRow', () => {
  it('keeps the list collapsed until asked', () => {
    render(<TourSettingsRow />);

    expect(screen.queryByRole('listitem')).toBeNull();
    expect(screen.queryByText('Reset tour progress')).toBeNull();
    // The count is on the disclosure, so the list's size is visible closed.
    const toggle = screen.getByRole('button', {
      name: `Show tours (${ALL_TOURS.length})`,
    });

    fireEvent.click(toggle);
    expect(screen.getAllByRole('listitem')).toHaveLength(ALL_TOURS.length);
    expect(
      screen.getByRole('button', { name: 'Hide tours' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Hide tours' }));
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('lists every tour the app knows about', () => {
    renderExpanded();
    expect(screen.getAllByRole('listitem')).toHaveLength(ALL_TOURS.length);
    // The release tours are otherwise only reachable from the What's New modal.
    expect(screen.getByText('Foreign currency transactions')).toBeInTheDocument();
    expect(screen.getByText("What's New digest")).toBeInTheDocument();
  });

  it('shows each tour area and viewed state', () => {
    useTourStore.setState({
      progress: {
        'intro/basics': { status: 'completed', updatedAt: 'now' },
        'release-1.13.0/settings': { status: 'dismissed', updatedAt: 'now' },
      },
    });
    renderExpanded();

    expect(
      within(rowFor('New here? Take the introduction tour')).getByText(
        /Getting started · Viewed/,
      ),
    ).toBeInTheDocument();
    expect(
      within(rowFor("What's New digest")).getByText(/Settings · Left early/),
    ).toBeInTheDocument();
    // Never started: no progress entry at all.
    expect(
      within(rowFor('Foreign currency transactions')).getByText(
        /Transactions · Not viewed/,
      ),
    ).toBeInTheDocument();
  });

  it('offers Retake for a viewed tour and Start for an unseen one', () => {
    renderExpanded();
    expect(
      within(rowFor('New here? Take the introduction tour')).getByText('Retake'),
    ).toBeInTheDocument();
    expect(
      within(rowFor('Foreign currency transactions')).getByText('Start'),
    ).toBeInTheDocument();
  });

  it('starts the tour whose button was clicked', () => {
    renderExpanded();
    fireEvent.click(
      within(rowFor('Foreign currency transactions')).getByText('Start'),
    );
    expect(useTourStore.getState().active?.tour.id).toBe(
      'release-1.13.0/foreign-currency',
    );
  });

  it('restarts the introduction tour from its row', () => {
    renderExpanded();
    fireEvent.click(
      within(rowFor('New here? Take the introduction tour')).getByText('Retake'),
    );
    expect(useTourStore.getState().active?.tour.id).toBe('intro/basics');
  });

  it('resets tour progress and clears the local map', async () => {
    renderExpanded();
    fireEvent.click(screen.getByText('Reset tour progress'));
    await waitFor(() => expect(resetProgress).toHaveBeenCalled());
    expect(useTourStore.getState().progress).toEqual({});
    expect(toast.success).toHaveBeenCalled();
  });
});
