import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@/test/render';
import { ExportIconButton } from './ExportIconButton';

describe('ExportIconButton', () => {
  it('runs the export when clicked and exposes the title as its label', async () => {
    const onExport = vi.fn();
    render(<ExportIconButton onExport={onExport} title="Download Data as CSV" />);

    const button = screen.getByRole('button', { name: 'Download Data as CSV' });
    expect(button).toHaveAttribute('title', 'Download Data as CSV');
    await act(async () => {
      fireEvent.click(button);
    });

    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('disables itself while an async export is running', async () => {
    let finish: () => void = () => {};
    const onExport = vi.fn(
      () => new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    render(<ExportIconButton onExport={onExport} title="Export" />);

    const button = screen.getByRole('button', { name: 'Export' });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(button).toBeDisabled();

    await act(async () => {
      finish();
    });
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('respects the disabled prop', () => {
    const onExport = vi.fn();
    render(<ExportIconButton onExport={onExport} title="Export" disabled />);

    const button = screen.getByRole('button', { name: 'Export' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onExport).not.toHaveBeenCalled();
  });
});
