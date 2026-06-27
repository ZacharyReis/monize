import { describe, it, expect, vi } from 'vitest';
import { render } from '@/test/render';
import { fireEvent, screen } from '@testing-library/react';
import { NewReportButton } from './NewReportButton';

describe('NewReportButton', () => {
  it('renders the New Report trigger', () => {
    render(<NewReportButton onNewStandard={vi.fn()} onNewInvestment={vi.fn()} />);
    expect(screen.getByText('New Report')).toBeInTheDocument();
  });

  it('shows both options when clicked', () => {
    render(<NewReportButton onNewStandard={vi.fn()} onNewInvestment={vi.fn()} />);
    fireEvent.click(screen.getByText('New Report'));
    expect(screen.getByText('Standard Report')).toBeInTheDocument();
    expect(screen.getByText('Investment Report')).toBeInTheDocument();
  });

  it('calls onNewStandard when Standard Report is clicked', () => {
    const onNewStandard = vi.fn();
    render(<NewReportButton onNewStandard={onNewStandard} onNewInvestment={vi.fn()} />);
    fireEvent.click(screen.getByText('New Report'));
    fireEvent.click(screen.getByText('Standard Report'));
    expect(onNewStandard).toHaveBeenCalledOnce();
  });

  it('calls onNewInvestment when Investment Report is clicked', () => {
    const onNewInvestment = vi.fn();
    render(<NewReportButton onNewStandard={vi.fn()} onNewInvestment={onNewInvestment} />);
    fireEvent.click(screen.getByText('New Report'));
    fireEvent.click(screen.getByText('Investment Report'));
    expect(onNewInvestment).toHaveBeenCalledOnce();
  });

  it('closes the menu after selecting an option', () => {
    render(<NewReportButton onNewStandard={vi.fn()} onNewInvestment={vi.fn()} />);
    fireEvent.click(screen.getByText('New Report'));
    expect(screen.getByText('Standard Report')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Standard Report'));
    expect(screen.queryByText('Standard Report')).not.toBeInTheDocument();
  });

  it('closes the menu on Escape', () => {
    render(<NewReportButton onNewStandard={vi.fn()} onNewInvestment={vi.fn()} />);
    fireEvent.click(screen.getByText('New Report'));
    expect(screen.getByText('Investment Report')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Investment Report')).not.toBeInTheDocument();
  });

  it('closes the menu when clicking outside', () => {
    render(
      <div>
        <NewReportButton onNewStandard={vi.fn()} onNewInvestment={vi.fn()} />
        <span data-testid="outside">outside</span>
      </div>,
    );
    fireEvent.click(screen.getByText('New Report'));
    expect(screen.getByText('Investment Report')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByText('Investment Report')).not.toBeInTheDocument();
  });
});
