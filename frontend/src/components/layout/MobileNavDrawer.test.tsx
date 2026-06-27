import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/render';
import { MobileNavDrawer } from './MobileNavDrawer';

vi.mock('next/image', () => ({
  default: ({ priority, fill, ...props }: any) => <img {...props} />,
}));

const navLinks = [
  { href: '/transactions', label: 'Transactions' },
  { href: '/accounts', label: 'Accounts' },
];
const aiLinks = [
  { href: '/insights', label: 'Insights' },
  { href: '/ai', label: 'AI Assistant' },
];
const toolsLinks = [
  { href: '/categories', label: 'Categories' },
  { href: '/import', label: 'Import Transactions', badge: 'Beta' },
];

function renderDrawer(overrides: Partial<React.ComponentProps<typeof MobileNavDrawer>> = {}) {
  const onClose = vi.fn();
  const onNavigate = vi.fn();
  const props: React.ComponentProps<typeof MobileNavDrawer> = {
    isOpen: true,
    onClose,
    pathname: '/dashboard',
    onNavigate,
    navLinks,
    aiLinks,
    showAiMenu: true,
    toolsLinks,
    showAdmin: false,
    ...overrides,
  };
  render(<MobileNavDrawer {...props} />);
  return { onClose, onNavigate };
}

describe('MobileNavDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    renderDrawer({ isOpen: false });
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('renders the brand, Dashboard, nav, AI, Tools and Settings entries', () => {
    renderDrawer();
    expect(screen.getByText('Monize')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Transactions')).toBeInTheDocument();
    expect(screen.getByText('Accounts')).toBeInTheDocument();
    expect(screen.getByText('AI')).toBeInTheDocument();
    expect(screen.getByText('Insights')).toBeInTheDocument();
    expect(screen.getByText('AI Assistant')).toBeInTheDocument();
    expect(screen.getByText('Categories')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders a badge on a tools link when present', () => {
    renderDrawer();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('hides the AI section when showAiMenu is false', () => {
    renderDrawer({ showAiMenu: false });
    expect(screen.queryByText('Insights')).not.toBeInTheDocument();
    // "AI" section header should be gone too (AI Assistant lives under it)
    expect(screen.queryByText('AI Assistant')).not.toBeInTheDocument();
  });

  it('omits the Tools section when there are no tools links', () => {
    renderDrawer({ toolsLinks: [] });
    expect(screen.queryByText('Tools')).not.toBeInTheDocument();
    expect(screen.queryByText('Categories')).not.toBeInTheDocument();
  });

  it('shows the Admin section only when showAdmin is true', () => {
    renderDrawer({ showAdmin: true });
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('User Management')).toBeInTheDocument();
  });

  it('navigates when a link is clicked', () => {
    const { onNavigate } = renderDrawer();
    fireEvent.click(screen.getByText('Transactions'));
    expect(onNavigate).toHaveBeenCalledWith('/transactions');
  });

  it('navigates to the dashboard from the brand button', () => {
    const { onNavigate } = renderDrawer();
    fireEvent.click(screen.getByText('Monize'));
    expect(onNavigate).toHaveBeenCalledWith('/dashboard');
  });

  it('closes when the close button is clicked', () => {
    const { onClose } = renderDrawer();
    fireEvent.click(screen.getByLabelText('Close menu'));
    expect(onClose).toHaveBeenCalled();
  });

  it('highlights the active route', () => {
    renderDrawer({ pathname: '/transactions' });
    const active = screen.getByText('Transactions').closest('button');
    expect(active?.className).toContain('bg-blue-50');
  });

  it('highlights the Admin entry when on an admin route', () => {
    renderDrawer({ showAdmin: true, pathname: '/admin/users' });
    const active = screen.getByText('User Management').closest('button');
    expect(active?.className).toContain('bg-blue-50');
  });
});
