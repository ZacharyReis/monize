import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/render';
import { FormActions } from './FormActions';

describe('FormActions', () => {
  it('renders Cancel and Save buttons when onCancel is provided', () => {
    const onCancel = vi.fn();
    render(<FormActions onCancel={onCancel} />);
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
  });

  it('does not render Cancel button when onCancel is not provided', () => {
    render(<FormActions />);
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
  });

  it('calls onCancel when Cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<FormActions onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('uses custom submitLabel', () => {
    render(<FormActions submitLabel="Create Account" />);
    expect(screen.getByText('Create Account')).toBeInTheDocument();
  });

  it('disables Cancel when isSubmitting is true', () => {
    const onCancel = vi.fn();
    render(<FormActions onCancel={onCancel} isSubmitting={true} />);
    expect(screen.getByText('Cancel').closest('button')).toBeDisabled();
  });

  it('disables submit button when submitDisabled is true', () => {
    render(<FormActions submitDisabled={true} />);
    expect(screen.getByText('Save').closest('button')).toBeDisabled();
  });

  it('applies custom className', () => {
    const { container } = render(<FormActions className="custom-class" />);
    expect(container.querySelector('.custom-class')).toBeInTheDocument();
  });

  it('wraps only the buttons when anchorProps is given', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <FormActions
        onCancel={onCancel}
        anchorProps={{ 'data-tour-id': 'transaction-form-actions' }}
      />,
    );
    const anchor = container.querySelector(
      '[data-tour-id="transaction-form-actions"]',
    )!;
    // A guided tour spotlights this element, so it must hold the button pair
    // and nothing else -- not the full-width row around them.
    expect(anchor).toBeInTheDocument();
    expect(anchor.querySelectorAll('button')).toHaveLength(2);
    expect(anchor.parentElement).toBe(container.firstChild);
  });

  it('renders the buttons unwrapped without anchorProps', () => {
    const { container } = render(<FormActions onCancel={vi.fn()} />);
    expect(container.querySelector('[data-tour-id]')).toBeNull();
    expect((container.firstChild as HTMLElement).children).toHaveLength(2);
  });
});
