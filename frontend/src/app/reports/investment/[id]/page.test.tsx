import { Suspense } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@/test/render';
import ViewInvestmentReportPage from './page';

vi.mock('@/components/auth/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/layout/PageLayout', () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/reports/InvestmentReportViewer', () => ({
  InvestmentReportViewer: ({ reportId }: { reportId: string }) => (
    <div data-testid="viewer">{reportId}</div>
  ),
}));

describe('ViewInvestmentReportPage', () => {
  it('renders the viewer for the route id', async () => {
    await act(async () => {
      render(
        <Suspense fallback={<div>suspense</div>}>
          <ViewInvestmentReportPage params={Promise.resolve({ id: 'r1' })} />
        </Suspense>,
      );
    });
    expect(await screen.findByTestId('viewer')).toHaveTextContent('r1');
  });
});
