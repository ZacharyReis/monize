import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/render';
import { ReportError } from './ReportError';

describe('ReportError', () => {
  it('renders a default message', () => {
    render(<ReportError />);
    expect(screen.getByText(/failed to load report data/i)).toBeInTheDocument();
  });

  it('renders a custom message', () => {
    render(<ReportError message="Custom failure" />);
    expect(screen.getByText('Custom failure')).toBeInTheDocument();
  });

  it('omits the retry button when no handler is given', () => {
    render(<ReportError />);
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('calls onRetry when the retry button is clicked', () => {
    const onRetry = vi.fn();
    render(<ReportError onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
