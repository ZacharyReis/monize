import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@/test/render';
import { SharedAccessSection } from './SharedAccessSection';
import { __resetModalStateForTesting } from '@/components/ui/Modal';

vi.mock('@/lib/delegation', () => ({
  delegationApi: {
    listDelegates: vi.fn(),
    lookupEmail: vi.fn(),
    createDelegate: vi.fn(),
    setGrants: vi.fn(),
    setCapabilities: vi.fn(),
    setSectionGrants: vi.fn(),
    revokeDelegate: vi.fn(),
    resetPassword: vi.fn(),
  },
}));

vi.mock('@/lib/accounts', () => ({
  accountsApi: { getAll: vi.fn() },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { delegationApi } from '@/lib/delegation';
import { accountsApi } from '@/lib/accounts';
import toast from 'react-hot-toast';

const delegate = {
  id: 'g1',
  status: 'active',
  createdAt: '2026-01-01',
  delegate: {
    id: 'd1',
    email: 'd@e.f',
    firstName: null,
    lastName: null,
    hasPassword: true,
    canResetPassword: true,
  },
  grants: [{ accountId: 'a1', canRead: true }],
  capabilities: {
    payees: { create: false, edit: true, delete: false },
    categories: { create: false, edit: false, delete: false },
    tags: { create: false, edit: false, delete: false },
  },
  sections: {
    bills: true,
    investments: false,
    budgets: false,
    reports: false,
    ai: false,
  },
};

async function renderSection() {
  await act(async () => {
    render(<SharedAccessSection />);
  });
}

// The header trigger and the modal submit are both "Add delegate"; the
// trigger renders first.
function openCreateModal() {
  const triggers = screen.getAllByRole('button', { name: 'Add delegate' });
  fireEvent.click(triggers[0]);
}
function submitCreate() {
  const buttons = screen.getAllByRole('button', { name: 'Add delegate' });
  fireEvent.click(buttons[buttons.length - 1]);
}

describe('SharedAccessSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetModalStateForTesting();
    vi.mocked(delegationApi.lookupEmail).mockResolvedValue({
      exists: false,
    });
    vi.mocked(delegationApi.listDelegates).mockResolvedValue([
      { ...delegate },
    ]);
    vi.mocked(accountsApi.getAll).mockResolvedValue([
      { id: 'a1', name: 'Chequing', accountType: 'CHEQUING' },
    ] as never);
  });

  it('lists delegates with a summary of granted access', async () => {
    await renderSection();
    expect(await screen.findByText('d@e.f')).toBeInTheDocument();
    expect(
      screen.getByText(/Sections: 1.*Accounts: 1.*Shared data: 1/),
    ).toBeInTheDocument();
  });

  it('opens the edit-access modal for a delegate', async () => {
    await renderSection();
    await screen.findByText('d@e.f');

    await act(async () => {
      fireEvent.click(screen.getByText('Edit access'));
    });

    expect(
      await screen.findByRole('switch', {
        name: /Read access to Chequing/i,
      }),
    ).toBeInTheDocument();
  });

  it('add-delegate is a modal with a last name field', async () => {
    await renderSection();
    await screen.findByText('d@e.f');

    expect(
      screen.queryByPlaceholderText('Delegate email'),
    ).not.toBeInTheDocument();

    await act(async () => {
      openCreateModal();
    });

    expect(
      await screen.findByPlaceholderText('Delegate email'),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Last name (optional)'),
    ).toBeInTheDocument();
  });

  it('rejects a password that fails the complexity policy', async () => {
    await renderSection();
    await screen.findByText('d@e.f');

    await act(async () => {
      openCreateModal();
    });
    await screen.findByPlaceholderText('Delegate email');

    fireEvent.change(screen.getByPlaceholderText('Delegate email'), {
      target: { value: 'new@x.y' },
    });
    fireEvent.change(
      screen.getByPlaceholderText('Set a password'),
      { target: { value: 'weak' } },
    );
    await act(async () => {
      submitCreate();
    });

    expect(toast.error).toHaveBeenCalled();
    expect(delegationApi.createDelegate).not.toHaveBeenCalled();
  });

  it('creates a delegate with a policy-compliant password and last name', async () => {
    vi.mocked(delegationApi.createDelegate).mockResolvedValue({
      id: 'g2',
      delegateUserId: 'd2',
      email: 'new@x.y',
      invited: false,
    });
    await renderSection();
    await screen.findByText('d@e.f');

    await act(async () => {
      openCreateModal();
    });
    await screen.findByPlaceholderText('Delegate email');

    fireEvent.change(screen.getByPlaceholderText('Delegate email'), {
      target: { value: 'new@x.y' },
    });
    fireEvent.change(screen.getByPlaceholderText('Last name (optional)'), {
      target: { value: 'Doe' },
    });
    fireEvent.change(
      screen.getByPlaceholderText('Set a password'),
      { target: { value: 'StrongPass1!xyz' } },
    );
    await act(async () => {
      submitCreate();
    });

    await waitFor(() =>
      expect(delegationApi.createDelegate).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new@x.y',
          lastName: 'Doe',
          password: 'StrongPass1!xyz',
          sendInvite: false,
        }),
      ),
    );
  });

  it('links an existing user without password/invite', async () => {
    vi.mocked(delegationApi.lookupEmail).mockResolvedValue({ exists: true });
    vi.mocked(delegationApi.createDelegate).mockResolvedValue({
      id: 'g3',
      delegateUserId: 'd3',
      email: 'exists@x.y',
      invited: false,
    });
    await renderSection();
    await screen.findByText('d@e.f');

    await act(async () => {
      openCreateModal();
    });
    await screen.findByPlaceholderText('Delegate email');

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Delegate email'), {
        target: { value: 'exists@x.y' },
      });
    });

    expect(
      await screen.findByText(/already has a Monize login/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText('Set a password'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText('First name (optional)'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText('Last name (optional)'),
    ).not.toBeInTheDocument();

    await act(async () => {
      submitCreate();
    });

    await waitFor(() =>
      expect(delegationApi.createDelegate).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'exists@x.y',
          password: undefined,
          sendInvite: false,
        }),
      ),
    );
  });

  it('revokes a delegate via the confirm dialog', async () => {
    vi.mocked(delegationApi.revokeDelegate).mockResolvedValue();
    await renderSection();
    await screen.findByText('d@e.f');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    });

    // The confirm dialog adds a second "Remove" (the confirm action).
    const removeButtons = await screen.findAllByRole('button', {
      name: 'Remove',
    });
    expect(removeButtons.length).toBeGreaterThan(1);
    await act(async () => {
      fireEvent.click(removeButtons[removeButtons.length - 1]);
    });

    await waitFor(() =>
      expect(delegationApi.revokeDelegate).toHaveBeenCalledWith('g1'),
    );
  });

  it('shows the reset temporary password in a modal with a copy option', async () => {
    vi.mocked(delegationApi.resetPassword).mockResolvedValue({
      temporaryPassword: 'Tiger!River42',
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    await renderSection();
    await screen.findByText('d@e.f');

    await act(async () => {
      fireEvent.click(screen.getByText('Reset password'));
    });

    expect(await screen.findByText('Tiger!River42')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });
    expect(writeText).toHaveBeenCalledWith('Tiger!River42');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('disables Reset password when the delegate manages their own', async () => {
    vi.mocked(delegationApi.listDelegates).mockResolvedValue([
      { ...delegate, delegate: { ...delegate.delegate, canResetPassword: false } },
    ]);

    await renderSection();
    await screen.findByText('d@e.f');

    expect(
      screen.getByRole('button', { name: 'Reset password' }),
    ).toBeDisabled();
  });

  it('errors when submitting with neither a password nor an invite', async () => {
    // lookupEmail stays at the default { exists: false }, so the new email is
    // treated as a brand-new login that requires a password or invite.
    await renderSection();
    await screen.findByText('d@e.f');

    await act(async () => {
      openCreateModal();
    });
    await screen.findByPlaceholderText('Delegate email');

    const emailInput = screen.getByPlaceholderText('Delegate email');
    await act(async () => {
      fireEvent.change(emailInput, { target: { value: 'new@x.y' } });
    });
    // Submit the form directly: the password field is `required`, so a real
    // submit-button click is blocked by native validation before handleCreate
    // runs. Submitting the form exercises the component's own JS guard that
    // protects programmatic submits.
    await act(async () => {
      fireEvent.submit(emailInput.closest('form')!);
    });

    expect(toast.error).toHaveBeenCalledWith(
      'Set a password or send an email invite.',
    );
    expect(delegationApi.createDelegate).not.toHaveBeenCalled();
  });

  it('creates a delegate via email invite instead of a password', async () => {
    vi.mocked(delegationApi.createDelegate).mockResolvedValue({
      id: 'g4',
      delegateUserId: 'd4',
      email: 'invite@x.y',
      invited: true,
    });
    await renderSection();
    await screen.findByText('d@e.f');

    await act(async () => {
      openCreateModal();
    });
    await screen.findByPlaceholderText('Delegate email');

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Delegate email'), {
        target: { value: 'invite@x.y' },
      });
    });
    // Toggle "send an email invite instead of setting a password".
    await act(async () => {
      fireEvent.click(screen.getByRole('switch'));
    });
    await act(async () => {
      submitCreate();
    });

    await waitFor(() =>
      expect(delegationApi.createDelegate).toHaveBeenCalledWith(
        expect.objectContaining({ sendInvite: true, password: undefined }),
      ),
    );
    expect(toast.success).toHaveBeenCalledWith('Invitation email sent');
  });

  it('reports a temporary password returned from create', async () => {
    vi.mocked(delegationApi.createDelegate).mockResolvedValue({
      id: 'g5',
      delegateUserId: 'd5',
      email: 'new@x.y',
      invited: false,
      temporaryPassword: 'Generated!Pass9',
    });
    await renderSection();
    await screen.findByText('d@e.f');

    await act(async () => {
      openCreateModal();
    });
    await screen.findByPlaceholderText('Delegate email');

    fireEvent.change(screen.getByPlaceholderText('Delegate email'), {
      target: { value: 'new@x.y' },
    });
    fireEvent.change(screen.getByPlaceholderText('Set a password'), {
      target: { value: 'StrongPass1!xyz' },
    });
    await act(async () => {
      submitCreate();
    });

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining('Generated!Pass9'),
        expect.anything(),
      ),
    );
  });

  it('treats the email as new when the lookup request fails', async () => {
    vi.mocked(delegationApi.lookupEmail).mockRejectedValue(
      new Error('lookup failed'),
    );
    await renderSection();
    await screen.findByText('d@e.f');

    await act(async () => {
      openCreateModal();
    });
    await screen.findByPlaceholderText('Delegate email');

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Delegate email'), {
        target: { value: 'maybe@x.y' },
      });
    });

    // After the 400ms debounce + failed lookup, emailExists stays null so the
    // password field remains visible (existing-login notice never appears).
    await waitFor(
      () =>
        expect(
          screen.getByPlaceholderText('Set a password'),
        ).toBeInTheDocument(),
      { timeout: 2000 },
    );
    await waitFor(() =>
      expect(delegationApi.lookupEmail).toHaveBeenCalledWith('maybe@x.y'),
    );
  });

  it('surfaces an error toast when creating a delegate fails', async () => {
    vi.mocked(delegationApi.createDelegate).mockRejectedValue(
      new Error('create failed'),
    );
    await renderSection();
    await screen.findByText('d@e.f');

    await act(async () => {
      openCreateModal();
    });
    await screen.findByPlaceholderText('Delegate email');

    fireEvent.change(screen.getByPlaceholderText('Delegate email'), {
      target: { value: 'new@x.y' },
    });
    fireEvent.change(screen.getByPlaceholderText('Set a password'), {
      target: { value: 'StrongPass1!xyz' },
    });
    await act(async () => {
      submitCreate();
    });
    await act(async () => {});

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it('surfaces an error toast when revoking a delegate fails', async () => {
    vi.mocked(delegationApi.revokeDelegate).mockRejectedValue(
      new Error('revoke failed'),
    );
    await renderSection();
    await screen.findByText('d@e.f');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    });
    const removeButtons = await screen.findAllByRole('button', { name: 'Remove' });
    await act(async () => {
      fireEvent.click(removeButtons[removeButtons.length - 1]);
    });
    await act(async () => {});

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it('surfaces an error toast when resetting the password fails', async () => {
    vi.mocked(delegationApi.resetPassword).mockRejectedValue(
      new Error('reset failed'),
    );
    await renderSection();
    await screen.findByText('d@e.f');

    await act(async () => {
      fireEvent.click(screen.getByText('Reset password'));
    });
    await act(async () => {});

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it('surfaces an error toast when copying the temporary password fails', async () => {
    vi.mocked(delegationApi.resetPassword).mockResolvedValue({
      temporaryPassword: 'Tiger!River42',
    });
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.assign(navigator, { clipboard: { writeText } });

    await renderSection();
    await screen.findByText('d@e.f');

    await act(async () => {
      fireEvent.click(screen.getByText('Reset password'));
    });
    expect(await screen.findByText('Tiger!River42')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });
    await act(async () => {});

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not copy to clipboard'),
    );
  });
});
