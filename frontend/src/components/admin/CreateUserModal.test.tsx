import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@/test/render';
import { CreateUserModal } from './CreateUserModal';

const mockCreateUser = vi.fn();
vi.mock('@/lib/admin', () => ({
  adminApi: {
    createUser: (...args: any[]) => mockCreateUser(...args),
  },
}));

vi.mock('@/lib/errors', () => ({
  getErrorMessage: (_e: any, fallback: string) => fallback,
}));

describe('CreateUserModal', () => {
  const onClose = vi.fn();
  const onCreated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderModal(smtpConfigured = true) {
    return render(
      <CreateUserModal
        isOpen
        smtpConfigured={smtpConfigured}
        onClose={onClose}
        onCreated={onCreated}
      />,
    );
  }

  it('defaults to the invite method when SMTP is configured', () => {
    renderModal(true);
    const inviteRadio = screen.getByRole('radio', {
      name: /send an email invite/i,
    });
    expect(inviteRadio).toBeChecked();
    // No password field while inviting.
    expect(screen.queryByPlaceholderText('Set a password')).not.toBeInTheDocument();
  });

  it('disables the invite option and defaults to password when SMTP is off', () => {
    renderModal(false);
    expect(
      screen.getByRole('radio', { name: /send an email invite/i }),
    ).toBeDisabled();
    expect(screen.getByRole('radio', { name: /set a password now/i })).toBeChecked();
    expect(screen.getByPlaceholderText('Set a password')).toBeInTheDocument();
  });

  it('submits an invite request', async () => {
    mockCreateUser.mockResolvedValue({ email: 'new@example.com', invited: true, upgraded: false });
    renderModal(true);

    fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'new@example.com' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create User' }));
    });

    await waitFor(() =>
      expect(mockCreateUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new@example.com',
          sendInvite: true,
          role: 'user',
        }),
      ),
    );
    expect(onCreated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('rejects a weak password without calling the API', async () => {
    renderModal(false);

    fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Set a password'), {
      target: { value: 'weak' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create User' }));
    });

    expect(mockCreateUser).not.toHaveBeenCalled();
    // The shared passwordSchema surfaces an inline validation error.
    await waitFor(() =>
      expect(screen.getByText(/at least 12 characters/i)).toBeInTheDocument(),
    );
  });

  it('sends the chosen role and a valid password', async () => {
    mockCreateUser.mockResolvedValue({ email: 'boss@example.com', invited: false, upgraded: false });
    renderModal(false);

    fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'boss@example.com' },
    });
    fireEvent.change(screen.getByDisplayValue('User'), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByPlaceholderText('Set a password'), {
      target: { value: 'Sup3rStr0ng!Pass' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create User' }));
    });

    await waitFor(() =>
      expect(mockCreateUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'boss@example.com',
          role: 'admin',
          password: 'Sup3rStr0ng!Pass',
        }),
      ),
    );
  });

  it('shows an error toast when the API call fails', async () => {
    const toast = await import('react-hot-toast');
    mockCreateUser.mockRejectedValue(new Error('boom'));
    renderModal(false);

    fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Set a password'), {
      target: { value: 'Sup3rStr0ng!Pass' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create User' }));
    });
    await act(async () => {});

    await waitFor(() => expect(toast.default.error).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });
});
