import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/render';
import { ActionMenu } from './ActionMenu';

const onMerge = vi.fn();
const onDeactivate = vi.fn();

function setup(overrides: Partial<React.ComponentProps<typeof ActionMenu>> = {}) {
  render(
    <ActionMenu
      label="Maintenance"
      items={[
        { id: 'merge', label: 'Auto-Merge Payees', onSelect: onMerge },
        { id: 'deactivate', label: 'Deactivate Unused', onSelect: onDeactivate },
      ]}
      {...overrides}
    />,
  );
  return {
    trigger: () => screen.getByRole('button', { name: /Maintenance/ }),
  };
}

beforeEach(() => {
  onMerge.mockClear();
  onDeactivate.mockClear();
});

describe('ActionMenu', () => {
  it('keeps the actions behind the trigger until it is opened', () => {
    const { trigger } = setup();

    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveAttribute('aria-haspopup', 'true');

    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'Maintenance' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });

  it('runs the chosen action and closes', () => {
    const { trigger } = setup();
    fireEvent.click(trigger());

    fireEvent.click(screen.getByRole('menuitem', { name: 'Deactivate Unused' }));

    expect(onDeactivate).toHaveBeenCalledTimes(1);
    expect(onMerge).not.toHaveBeenCalled();
    // The dialog the action opens becomes the focus of the page, so the menu
    // must not stay open behind it.
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on a click outside', () => {
    const { trigger } = setup();
    fireEvent.click(trigger());

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onMerge).not.toHaveBeenCalled();
  });

  it('closes on Escape and hands focus back to the trigger', () => {
    const { trigger } = setup();
    fireEvent.click(trigger());

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('toggles shut when the trigger is clicked again', () => {
    const { trigger } = setup();
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('lists a disabled action without letting it run', () => {
    const onSelect = vi.fn();
    setup({
      items: [{ id: 'x', label: 'Not yet available', onSelect, disabled: true }],
    });
    fireEvent.click(screen.getByRole('button', { name: /Maintenance/ }));

    const item = screen.getByRole('menuitem', { name: 'Not yet available' });
    expect(item).toBeDisabled();
    fireEvent.click(item);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('sits behind the page primary by default', () => {
    // Outline by default, so the header's single filled button stays the
    // primary action -- the rule the app's other list pages follow.
    const { trigger } = setup();
    expect(trigger().className).toContain('border-gray-300');
    expect(trigger().className).not.toContain('bg-blue-600');
  });

  it('can be promoted when the menu is the page\'s main action', () => {
    setup({ variant: 'primary' });
    expect(
      screen.getByRole('button', { name: /Maintenance/ }).className,
    ).toContain('bg-blue-600');
  });
});
