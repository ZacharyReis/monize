import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/render';
import { BillsFilterPanel } from './BillsFilterPanel';
import { Account } from '@/types/account';
import { Category } from '@/types/category';
import { BillsPayeeOption } from '@/lib/bills-filters';

const accounts: Account[] = [
  { id: 'acc-1', name: 'Checking' } as Account,
  { id: 'acc-2', name: 'Savings' } as Account,
];

const categories: Category[] = [
  { id: 'cat-1', name: 'Groceries', color: '#fff', effectiveColor: '#fff' } as Category,
  { id: 'cat-2', name: 'Salary', color: '#000', effectiveColor: '#000' } as Category,
];

const payees: BillsPayeeOption[] = [
  { id: 'pay-1', name: 'Acme Corp' },
  { id: 'pay-2', name: 'Beta LLC' },
];

function makeProps(overrides: Partial<React.ComponentProps<typeof BillsFilterPanel>> = {}) {
  return {
    filtersExpanded: true,
    setFiltersExpanded: vi.fn(),
    nameSearch: '',
    setNameSearch: vi.fn(),
    selectedPayeeIds: [],
    setSelectedPayeeIds: vi.fn(),
    selectedAccountIds: [],
    setSelectedAccountIds: vi.fn(),
    selectedCategoryIds: [],
    setSelectedCategoryIds: vi.fn(),
    accounts,
    categories,
    payees,
    activeFilterCount: 0,
    onClearFilters: vi.fn(),
    ...overrides,
  };
}

describe('BillsFilterPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the filter controls when expanded', () => {
    render(<BillsFilterPanel {...makeProps()} />);
    expect(screen.getByText('Filters')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Payees')).toBeInTheDocument();
    expect(screen.getByText('Accounts')).toBeInTheDocument();
    expect(screen.getByText('Categories')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search by name...')).toBeInTheDocument();
  });

  it('shows the active filter count badge', () => {
    render(<BillsFilterPanel {...makeProps({ activeFilterCount: 2 })} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('does not show a Clear button when there are no active filters', () => {
    render(<BillsFilterPanel {...makeProps({ activeFilterCount: 0 })} />);
    expect(screen.queryByText('Clear')).not.toBeInTheDocument();
  });

  it('calls onClearFilters when Clear is clicked', () => {
    const props = makeProps({ activeFilterCount: 1 });
    render(<BillsFilterPanel {...props} />);
    fireEvent.click(screen.getByText('Clear'));
    expect(props.onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('toggles expansion when the header is clicked', () => {
    const props = makeProps({ filtersExpanded: true });
    render(<BillsFilterPanel {...props} />);
    fireEvent.click(screen.getByText('Filters'));
    expect(props.setFiltersExpanded).toHaveBeenCalledWith(false);
  });

  it('updates the name search as the user types', () => {
    const props = makeProps();
    render(<BillsFilterPanel {...props} />);
    fireEvent.change(screen.getByPlaceholderText('Search by name...'), {
      target: { value: 'rent' },
    });
    expect(props.setNameSearch).toHaveBeenCalledWith('rent');
  });

  it('renders active filter chips when collapsed', () => {
    render(
      <BillsFilterPanel
        {...makeProps({
          filtersExpanded: false,
          activeFilterCount: 3,
          nameSearch: 'net',
          selectedPayeeIds: ['pay-1'],
          selectedAccountIds: ['acc-2'],
          selectedCategoryIds: ['cat-1'],
        })}
      />
    );
    expect(screen.getByText('"net"')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Savings')).toBeInTheDocument();
    expect(screen.getByText('Groceries')).toBeInTheDocument();
  });

  it('removes a selected account chip', () => {
    const props = makeProps({
      filtersExpanded: false,
      activeFilterCount: 1,
      selectedAccountIds: ['acc-1', 'acc-2'],
    });
    render(<BillsFilterPanel {...props} />);
    // The chip text and its remove button share the same span; click the button
    // inside the Checking chip.
    const checkingChip = screen.getByText('Checking').closest('span')!;
    fireEvent.click(checkingChip.querySelector('button')!);
    expect(props.setSelectedAccountIds).toHaveBeenCalledWith(['acc-2']);
  });

  it('keeps a selected id removable even when it is no longer in the option list', () => {
    // e.g. the only schedule referencing this account was deleted, so it
    // dropped out of the derived accounts list but is still selected.
    const props = makeProps({
      filtersExpanded: false,
      activeFilterCount: 1,
      selectedAccountIds: ['acc-gone'],
    });
    render(<BillsFilterPanel {...props} />);
    const orphanChip = screen.getByText('Unknown account').closest('span')!;
    fireEvent.click(orphanChip.querySelector('button')!);
    expect(props.setSelectedAccountIds).toHaveBeenCalledWith([]);
  });

  it('clears the name search from its chip', () => {
    const props = makeProps({
      filtersExpanded: false,
      activeFilterCount: 1,
      nameSearch: 'net',
    });
    render(<BillsFilterPanel {...props} />);
    const chip = screen.getByText('"net"').closest('span')!;
    fireEvent.click(chip.querySelector('button')!);
    expect(props.setNameSearch).toHaveBeenCalledWith('');
  });

  it('does not render chips when collapsed with no active filters', () => {
    render(<BillsFilterPanel {...makeProps({ filtersExpanded: false, activeFilterCount: 0 })} />);
    expect(screen.queryByText('Accounts')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search by name...')).not.toBeInTheDocument();
  });
});
