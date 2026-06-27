import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@/test/render';
import { ReactivatePayeeDialog } from './ReactivatePayeeDialog';
import { Payee } from '@/types/payee';

describe('ReactivatePayeeDialog', () => {
  const onReactivate = vi.fn();
  const onCancel = vi.fn();

  const mockPayee: Payee = {
    id: 'payee-1',
    userId: 'user-1',
    name: 'Old Store',
    defaultCategoryId: null,
    defaultCategory: null,
    notes: null,
    isActive: false,
    createdAt: '2024-01-01',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the payee name in the dialog', () => {
    const { getByText } = render(
      <ReactivatePayeeDialog
        isOpen={true}
        payee={mockPayee}
        onReactivate={onReactivate}
        onCancel={onCancel}
      />,
    );

    expect(getByText(/"Old Store"/)).toBeInTheDocument();
    expect(getByText('Reactivate Payee?')).toBeInTheDocument();
  });

  it('does not render when payee is null', () => {
    const { container } = render(
      <ReactivatePayeeDialog
        isOpen={true}
        payee={null}
        onReactivate={onReactivate}
        onCancel={onCancel}
      />,
    );

    expect(container.innerHTML).toBe('');
  });

  it('does not render when not open', () => {
    const { queryByText } = render(
      <ReactivatePayeeDialog
        isOpen={false}
        payee={mockPayee}
        onReactivate={onReactivate}
        onCancel={onCancel}
      />,
    );

    expect(queryByText('Reactivate Payee?')).not.toBeInTheDocument();
  });

  it('calls onReactivate when Reactivate button is clicked', () => {
    const { getByText } = render(
      <ReactivatePayeeDialog
        isOpen={true}
        payee={mockPayee}
        onReactivate={onReactivate}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(getByText('Reactivate'));

    expect(onReactivate).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when No Keep Inactive button is clicked', () => {
    const { getByText } = render(
      <ReactivatePayeeDialog
        isOpen={true}
        payee={mockPayee}
        onReactivate={onReactivate}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(getByText('No, Keep Inactive'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows Reactivating text when isReactivating is true', () => {
    const { getByText } = render(
      <ReactivatePayeeDialog
        isOpen={true}
        payee={mockPayee}
        onReactivate={onReactivate}
        onCancel={onCancel}
        isReactivating={true}
      />,
    );

    expect(getByText('Reactivating...')).toBeInTheDocument();
  });

  it('disables buttons when isReactivating is true', () => {
    const { getByText } = render(
      <ReactivatePayeeDialog
        isOpen={true}
        payee={mockPayee}
        onReactivate={onReactivate}
        onCancel={onCancel}
        isReactivating={true}
      />,
    );

    expect(getByText('Reactivating...')).toBeDisabled();
    expect(getByText('No, Keep Inactive')).toBeDisabled();
  });
});
