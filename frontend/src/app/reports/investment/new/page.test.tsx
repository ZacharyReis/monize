import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@/test/render';
import NewInvestmentReportPage from './page';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock('@/components/auth/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/layout/PageLayout', () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/layout/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

const mockCreate = vi.fn();
vi.mock('@/lib/investment-reports', () => ({
  investmentReportsApi: { create: (...a: unknown[]) => mockCreate(...a) },
}));

vi.mock('@/components/reports/InvestmentReportForm', () => ({
  InvestmentReportForm: ({
    onSubmit,
    onCancel,
  }: {
    onSubmit: (d: unknown) => Promise<void>;
    onCancel: () => void;
  }) => (
    <div>
      <button
        onClick={() => {
          void onSubmit({ name: 'X', config: { columns: ['symbol'] } }).catch(() => {});
        }}
      >
        do-submit
      </button>
      <button onClick={onCancel}>do-cancel</button>
    </div>
  ),
}));

describe('NewInvestmentReportPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a report and navigates to it', async () => {
    mockCreate.mockResolvedValue({ id: 'r1' });
    render(<NewInvestmentReportPage />);
    expect(screen.getByText('Create Investment Report')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText('do-submit'));
    });
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockPush).toHaveBeenCalledWith('/reports/investment/r1');
  });

  it('navigates back to reports on cancel', () => {
    render(<NewInvestmentReportPage />);
    fireEvent.click(screen.getByText('do-cancel'));
    expect(mockPush).toHaveBeenCalledWith('/reports');
  });

  it('surfaces an error when creation fails', async () => {
    mockCreate.mockRejectedValue(new Error('boom'));
    render(<NewInvestmentReportPage />);
    await act(async () => {
      fireEvent.click(screen.getByText('do-submit'));
    });
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockPush).not.toHaveBeenCalled();
  });
});
