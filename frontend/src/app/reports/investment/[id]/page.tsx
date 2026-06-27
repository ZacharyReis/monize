'use client';

import { use } from 'react';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { PageLayout } from '@/components/layout/PageLayout';
import { InvestmentReportViewer } from '@/components/reports/InvestmentReportViewer';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function ViewInvestmentReportPage({ params }: PageProps) {
  const { id } = use(params);

  return (
    <ProtectedRoute>
      <PageLayout>
        <main className="px-4 sm:px-6 lg:px-8 pt-6 pb-8">
          <InvestmentReportViewer reportId={id} />
        </main>
      </PageLayout>
    </ProtectedRoute>
  );
}
