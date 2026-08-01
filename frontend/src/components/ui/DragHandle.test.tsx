import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/render';
import { DragHandle } from './DragHandle';

function setup(props: Partial<React.ComponentProps<typeof DragHandle>> = {}) {
  const handlers = {
    onDragStart: vi.fn(),
    onDragMove: vi.fn(),
    onDragEnd: vi.fn(),
    onNudge: vi.fn(),
    onActivate: vi.fn(),
  };
  render(<DragHandle label="Move this panel" {...handlers} {...props} />);
  return { ...handlers, handle: () => screen.getByLabelText('Move this panel') };
}

describe('DragHandle', () => {
  it('reports offsets from where the press started', () => {
    const { handle, onDragStart, onDragMove, onDragEnd } = setup();

    fireEvent.pointerDown(handle(), { clientX: 100, clientY: 200, pointerId: 1 });
    expect(onDragStart).toHaveBeenCalled();

    fireEvent.pointerMove(handle(), { clientX: 130, clientY: 180, pointerId: 1 });
    expect(onDragMove).toHaveBeenCalledWith(30, -20);

    fireEvent.pointerUp(handle(), { clientX: 140, clientY: 175, pointerId: 1 });
    expect(onDragEnd).toHaveBeenCalledWith(40, -25);
  });

  it('ignores movement that did not start on the handle', () => {
    const { handle, onDragMove } = setup();
    fireEvent.pointerMove(handle(), { clientX: 500, clientY: 500, pointerId: 1 });
    expect(onDragMove).not.toHaveBeenCalled();
  });

  it('nudges with the arrow keys', () => {
    const { handle, onNudge } = setup();

    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    expect(onNudge).toHaveBeenLastCalledWith(24, 0);
    fireEvent.keyDown(handle(), { key: 'ArrowUp' });
    expect(onNudge).toHaveBeenLastCalledWith(0, -24);

    fireEvent.keyDown(handle(), { key: 'Enter' });
    expect(onNudge).toHaveBeenCalledTimes(2);
  });

  it('honours a custom nudge step', () => {
    const { handle, onNudge } = setup({ nudgeStep: 8 });
    fireEvent.keyDown(handle(), { key: 'ArrowDown' });
    expect(onNudge).toHaveBeenCalledWith(0, 8);
  });

  it('activates on a click that did not drag', () => {
    const { handle, onActivate } = setup();
    fireEvent.click(handle());
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('does not activate on the click that follows a drag', () => {
    const { handle, onActivate } = setup();

    fireEvent.pointerDown(handle(), { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientX: 60, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(handle(), { clientX: 60, clientY: 40, pointerId: 1 });
    // Browsers fire click after a drag on the same element; a drag is not a
    // click, so the snap-to-next action must stay out of it.
    fireEvent.click(handle());
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('still activates from the keyboard after a mouse drag', () => {
    const { handle, onActivate } = setup();

    fireEvent.pointerDown(handle(), { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientX: 60, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(handle(), { clientX: 60, clientY: 40, pointerId: 1 });
    fireEvent.click(handle()); // the click that follows the drag: suppressed
    expect(onActivate).not.toHaveBeenCalled();

    // Enter reaches onClick with no pointerdown before it, so the drag flag
    // must not still be set from the mouse.
    fireEvent.click(handle());
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('still activates when the pointer barely moved', () => {
    const { handle, onActivate } = setup();

    fireEvent.pointerDown(handle(), { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientX: 11, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(handle(), { clientX: 11, clientY: 10, pointerId: 1 });
    fireEvent.click(handle());
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('uses the label as its tooltip unless given one', () => {
    const { handle } = setup();
    expect(handle()).toHaveAttribute('title', 'Move this panel');
  });
});
