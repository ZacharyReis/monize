import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@/test/render';
import { TourSpotlight } from './TourSpotlight';

const RECT = { top: 100, left: 200, width: 120, height: 40 };

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('TourSpotlight', () => {
  it('renders a single full-screen dim panel for a centered step', () => {
    render(
      <TourSpotlight rect={null} interactive={false} reducedMotion={false} />,
    );
    const dims = document.body.querySelectorAll('.inset-0');
    // The portal renders exactly one full-screen dimming div.
    expect(dims.length).toBe(1);
  });

  it('lets clicks through the centered dim on interactive steps', () => {
    render(
      <TourSpotlight rect={null} interactive={true} reducedMotion={false} />,
    );
    const dim = document.body.querySelector('.inset-0')!;
    // Interactive centered steps (e.g. close-the-form) must not block the page.
    expect(dim.className).toContain('pointer-events-none');
  });

  it('renders framing panels and a highlight ring around an anchor', () => {
    render(
      <TourSpotlight rect={RECT} interactive={false} reducedMotion={false} />,
    );
    expect(document.body.querySelector('.ring-blue-500')).not.toBeNull();
  });

  it('adds a hole blocker on passive steps and omits it on interactive steps', () => {
    const { unmount } = render(
      <TourSpotlight rect={RECT} interactive={false} reducedMotion={false} />,
    );
    const wrapper = document.body.querySelector('.inset-0')!;
    const passiveChildren = wrapper.childElementCount;
    unmount();
    document.body.innerHTML = '';

    render(
      <TourSpotlight rect={RECT} interactive={true} reducedMotion={false} />,
    );
    const interactiveWrapper = document.body.querySelector('.inset-0')!;
    // Interactive steps drop the transparent blocker over the hole.
    expect(interactiveWrapper.childElementCount).toBe(passiveChildren - 1);
  });

  it('lets clicks through the dimmed panels when passThrough is set', () => {
    // A field popup (combobox list, date picker) opened from the spotlit
    // control renders outside the cutout, so the dim must not capture clicks.
    render(
      <TourSpotlight
        rect={RECT}
        interactive
        passThrough
        reducedMotion={false}
      />,
    );
    const panels = [
      ...document.body.querySelectorAll('.inset-0 > div'),
    ] as HTMLElement[];
    const dimPanels = panels.filter((p) => p.className.includes('bg-black/50'));
    expect(dimPanels.length).toBeGreaterThan(0);
    for (const panel of dimPanels) {
      expect(panel.className).not.toContain('pointer-events-auto');
    }
  });

  it('keeps the dimmed panels click-swallowing by default', () => {
    render(
      <TourSpotlight rect={RECT} interactive={false} reducedMotion={false} />,
    );
    const dimPanels = [
      ...document.body.querySelectorAll('.inset-0 > div'),
    ].filter((p) => p.className.includes('bg-black/50'));
    for (const panel of dimPanels) {
      expect(panel.className).toContain('pointer-events-auto');
    }
  });

  it('shows only the ring, with no dimming, when dim is off', () => {
    render(
      <TourSpotlight rect={RECT} interactive={false} dim={false} reducedMotion={false} />,
    );
    // Nothing darkens the page: the step is introducing the page itself.
    expect(document.body.querySelector('.bg-black\\/50')).toBeNull();
    // The ring still points at the anchor, and never eats a click.
    const ring = document.body.querySelector('.ring-2') as HTMLElement;
    expect(ring).not.toBeNull();
    expect(ring.className).toContain('pointer-events-none');
  });

  it('renders nothing for an anchorless step when dim is off', () => {
    render(
      <TourSpotlight rect={null} interactive dim={false} reducedMotion={false} />,
    );
    expect(document.body.querySelector('.bg-black\\/50')).toBeNull();
    expect(document.body.querySelector('.ring-2')).toBeNull();
  });

  it('drops the animation classes under reduced motion', () => {
    render(
      <TourSpotlight rect={RECT} interactive={false} reducedMotion={true} />,
    );
    expect(document.body.querySelector('.transition-all')).toBeNull();
  });
});
