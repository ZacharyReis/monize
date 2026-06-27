import { describe, it, expect, vi, beforeEach } from 'vitest';
import apiClient from './api';
import { investmentsApi } from './investments';
import { invalidateCache } from './apiCache';

vi.mock('./api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

describe('investmentsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCache('investments:');
  });

  it('getPortfolioSummary fetches /portfolio/summary', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { totalValue: 1000 } });
    await investmentsApi.getPortfolioSummary();
    expect(apiClient.get).toHaveBeenCalledWith('/portfolio/summary', { params: undefined });
  });

  it('getPortfolioSummary passes accountIds', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { totalValue: 1000 } });
    await investmentsApi.getPortfolioSummary(['a1', 'a2']);
    expect(apiClient.get).toHaveBeenCalledWith('/portfolio/summary', {
      params: { accountIds: 'a1,a2' },
    });
  });

  it('getAssetAllocation fetches /portfolio/allocation', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: {} });
    await investmentsApi.getAssetAllocation();
    expect(apiClient.get).toHaveBeenCalledWith('/portfolio/allocation', { params: undefined });
  });

  it('getInvestmentAccounts fetches /portfolio/accounts', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
    await investmentsApi.getInvestmentAccounts();
    expect(apiClient.get).toHaveBeenCalledWith('/portfolio/accounts');
  });

  it('getTopMovers fetches /portfolio/top-movers', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
    await investmentsApi.getTopMovers();
    expect(apiClient.get).toHaveBeenCalledWith('/portfolio/top-movers');
  });

  it('getFavouriteSecurities fetches /securities/favourites', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
    await investmentsApi.getFavouriteSecurities();
    expect(apiClient.get).toHaveBeenCalledWith('/securities/favourites');
  });

  it('getFavouriteSecurities returns cached result on second call', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [{ securityId: '1' }] });
    await investmentsApi.getFavouriteSecurities();
    await investmentsApi.getFavouriteSecurities();
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it('setSecurityFavourite patches the security and invalidates the cache', async () => {
    // Prime the favourites cache.
    vi.mocked(apiClient.get).mockResolvedValue({ data: [{ securityId: '1' }] });
    await investmentsApi.getFavouriteSecurities();

    vi.mocked(apiClient.patch).mockResolvedValue({ data: { id: 's-1', isFavourite: true } });
    await investmentsApi.setSecurityFavourite('s-1', true);
    expect(apiClient.patch).toHaveBeenCalledWith('/securities/s-1', { isFavourite: true });

    // Cache was invalidated, so the next read hits the API again.
    vi.mocked(apiClient.get).mockClear();
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
    await investmentsApi.getFavouriteSecurities();
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it('getHoldings fetches /holdings with optional accountId', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
    await investmentsApi.getHoldings('a1');
    expect(apiClient.get).toHaveBeenCalledWith('/holdings', { params: { accountId: 'a1' } });
  });

  it('getHoldings without accountId passes undefined params', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
    await investmentsApi.getHoldings();
    expect(apiClient.get).toHaveBeenCalledWith('/holdings', { params: undefined });
  });

  it('getTransactions fetches /investment-transactions', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { items: [], total: 0 } });
    await investmentsApi.getTransactions({ page: 1, limit: 20 });
    expect(apiClient.get).toHaveBeenCalledWith('/investment-transactions', {
      params: { page: 1, limit: 20 },
    });
  });

  it('createTransaction posts to /investment-transactions', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { id: 'it-1' } });
    await investmentsApi.createTransaction({ action: 'BUY' } as any);
    expect(apiClient.post).toHaveBeenCalledWith('/investment-transactions', { action: 'BUY' });
  });

  it('updateTransaction patches /investment-transactions/:id', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({ data: { id: 'it-1' } });
    await investmentsApi.updateTransaction('it-1', { quantity: 10 } as any);
    expect(apiClient.patch).toHaveBeenCalledWith('/investment-transactions/it-1', { quantity: 10 });
  });

  it('getTransaction fetches /investment-transactions/:id', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { id: 'it-1' } });
    await investmentsApi.getTransaction('it-1');
    expect(apiClient.get).toHaveBeenCalledWith('/investment-transactions/it-1');
  });

  it('deleteTransaction deletes /investment-transactions/:id', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({});
    await investmentsApi.deleteTransaction('it-1');
    expect(apiClient.delete).toHaveBeenCalledWith('/investment-transactions/it-1');
  });

  it('getSecurities fetches /securities', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
    await investmentsApi.getSecurities();
    expect(apiClient.get).toHaveBeenCalledWith('/securities', { params: undefined });
  });

  it('getSecurities passes includeInactive', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
    await investmentsApi.getSecurities(true);
    expect(apiClient.get).toHaveBeenCalledWith('/securities', { params: { includeInactive: true } });
  });

  it('getSecurity fetches /securities/:id', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { id: 's-1' } });
    await investmentsApi.getSecurity('s-1');
    expect(apiClient.get).toHaveBeenCalledWith('/securities/s-1');
  });

  it('createSecurity posts to /securities', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { id: 's-1' } });
    await investmentsApi.createSecurity({ symbol: 'AAPL' } as any);
    expect(apiClient.post).toHaveBeenCalledWith('/securities', { symbol: 'AAPL' });
  });

  it('updateSecurity patches /securities/:id', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({ data: { id: 's-1' } });
    await investmentsApi.updateSecurity('s-1', { name: 'Apple' } as any);
    expect(apiClient.patch).toHaveBeenCalledWith('/securities/s-1', { name: 'Apple' });
  });

  it('deactivateSecurity posts to /securities/:id/deactivate', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { id: 's-1' } });
    await investmentsApi.deactivateSecurity('s-1');
    expect(apiClient.post).toHaveBeenCalledWith('/securities/s-1/deactivate');
  });

  it('activateSecurity posts to /securities/:id/activate', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { id: 's-1' } });
    await investmentsApi.activateSecurity('s-1');
    expect(apiClient.post).toHaveBeenCalledWith('/securities/s-1/activate');
  });

  it('searchSecurities fetches /securities/search', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
    await investmentsApi.searchSecurities('AAPL');
    expect(apiClient.get).toHaveBeenCalledWith('/securities/search', { params: { q: 'AAPL' } });
  });

  it('lookupSecurity fetches /securities/lookup', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { symbol: 'AAPL', name: 'Apple' } });
    const result = await investmentsApi.lookupSecurity('AAPL');
    expect(apiClient.get).toHaveBeenCalledWith('/securities/lookup', { params: { q: 'AAPL' } });
    expect(result!.symbol).toBe('AAPL');
  });

  it('refreshPrices posts to /securities/prices/refresh', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { updated: 5 } });
    const result = await investmentsApi.refreshPrices();
    // Per-request 120s timeout overrides the global 10s default; the
    // refresh-all endpoint hits Yahoo for every active security and
    // routinely takes longer than 10s on portfolios with many holdings.
    expect(apiClient.post).toHaveBeenCalledWith(
      '/securities/prices/refresh',
      undefined,
      { timeout: 120_000 },
    );
    expect(result.updated).toBe(5);
  });

  it('refreshSelectedPrices posts with securityIds', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { updated: 2 } });
    await investmentsApi.refreshSelectedPrices(['s-1', 's-2']);
    expect(apiClient.post).toHaveBeenCalledWith(
      '/securities/prices/refresh/selected',
      { securityIds: ['s-1', 's-2'] },
      { timeout: 120_000 },
    );
  });

  it('backfillSecurityPrices posts to the per-security backfill endpoint', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { symbol: 'AAPL', success: true, pricesLoaded: 100 },
    });
    const result = await investmentsApi.backfillSecurityPrices('s-1');
    // Generous timeout: fetches the security's full provider history.
    expect(apiClient.post).toHaveBeenCalledWith(
      '/securities/s-1/prices/backfill',
      undefined,
      { timeout: 120_000 },
    );
    expect(result.pricesLoaded).toBe(100);
  });

  it('getPriceStatus fetches /securities/prices/status', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { lastUpdated: '2025-01-01' } });
    const result = await investmentsApi.getPriceStatus();
    expect(result.lastUpdated).toBe('2025-01-01');
  });

  it('getSectorWeightings fetches /portfolio/sector-weightings', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { items: [], totalPortfolioValue: 0 } });
    await investmentsApi.getSectorWeightings();
    expect(apiClient.get).toHaveBeenCalledWith('/portfolio/sector-weightings', {
      params: undefined,
    });
  });

  it('getSectorWeightings passes accountIds and securityIds as CSV', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { items: [] } });
    await investmentsApi.getSectorWeightings(['a1', 'a2'], ['s1']);
    expect(apiClient.get).toHaveBeenCalledWith('/portfolio/sector-weightings', {
      params: { accountIds: 'a1,a2', securityIds: 's1' },
    });
  });

  it('rebuildHoldings posts to /holdings/rebuild', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { holdingsCreated: 1, holdingsUpdated: 2, holdingsDeleted: 0 },
    });
    const result = await investmentsApi.rebuildHoldings();
    expect(apiClient.post).toHaveBeenCalledWith('/holdings/rebuild');
    expect(result.holdingsUpdated).toBe(2);
  });

  it('getHoldingAt passes params', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { quantity: 10, averageCost: 50 } });
    await investmentsApi.getHoldingAt({
      accountId: 'a-1',
      securityId: 's-1',
      asOfDate: '2025-01-01',
    });
    expect(apiClient.get).toHaveBeenCalledWith('/holdings/at', {
      params: { accountId: 'a-1', securityId: 's-1', asOfDate: '2025-01-01' },
    });
  });

  it('getRealizedGains fetches with params', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
    await investmentsApi.getRealizedGains({ accountIds: 'a-1' });
    expect(apiClient.get).toHaveBeenCalledWith('/investment-transactions/realized-gains', {
      params: { accountIds: 'a-1' },
    });
  });

  it('getCapitalGains fetches with params', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
    await investmentsApi.getCapitalGains({ startDate: '2025-01-01', endDate: '2025-12-31' });
    expect(apiClient.get).toHaveBeenCalledWith('/investment-transactions/capital-gains', {
      params: { startDate: '2025-01-01', endDate: '2025-12-31' },
    });
  });

  it('deleteSecurity deletes /securities/:id', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({});
    await investmentsApi.deleteSecurity('s-1');
    expect(apiClient.delete).toHaveBeenCalledWith('/securities/s-1');
  });

  it('getUsedSecurityIds fetches /securities/used', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: ['s-1', 's-2'] });
    const result = await investmentsApi.getUsedSecurityIds();
    expect(apiClient.get).toHaveBeenCalledWith('/securities/used');
    expect(result).toHaveLength(2);
  });

  it('lookupSecurity passes preferredExchanges and provider', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { symbol: 'AAPL' } });
    await investmentsApi.lookupSecurity('AAPL', ['NASDAQ', 'NYSE'], 'yahoo');
    expect(apiClient.get).toHaveBeenCalledWith('/securities/lookup', {
      params: { q: 'AAPL', exchanges: 'NASDAQ,NYSE', provider: 'yahoo' },
    });
  });

  it('lookupSecurityCandidates returns empty array when data is falsy', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: null });
    const result = await investmentsApi.lookupSecurityCandidates('AAPL');
    expect(result).toEqual([]);
  });

  it('lookupSecurityCandidates passes options', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
    await investmentsApi.lookupSecurityCandidates('AAPL', ['NASDAQ'], 'msn');
    expect(apiClient.get).toHaveBeenCalledWith('/securities/lookup/candidates', {
      params: { q: 'AAPL', exchanges: 'NASDAQ', provider: 'msn' },
    });
  });

  it('getProviderStatus fetches provider status', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { yahoo: { ready: true }, msn: { ready: false } },
    });
    const result = await investmentsApi.getProviderStatus();
    expect(apiClient.get).toHaveBeenCalledWith('/securities/providers/status');
    expect(result.msn.ready).toBe(false);
  });

  it('getSecurityPrices fetches security prices with default limit', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
    await investmentsApi.getSecurityPrices('s-1');
    expect(apiClient.get).toHaveBeenCalledWith('/securities/s-1/prices', {
      params: { limit: 365 },
    });
  });

  it('createSecurityPrice posts to /securities/:id/prices', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { id: 'p-1' } });
    await investmentsApi.createSecurityPrice('s-1', { price: 100 } as any);
    expect(apiClient.post).toHaveBeenCalledWith('/securities/s-1/prices', { price: 100 });
  });

  it('updateSecurityPrice patches a price entry', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({ data: { id: 'p-1' } });
    await investmentsApi.updateSecurityPrice('s-1', 1, { price: 110 } as any);
    expect(apiClient.patch).toHaveBeenCalledWith('/securities/s-1/prices/1', { price: 110 });
  });

  it('deleteSecurityPrice deletes a price entry', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({});
    await investmentsApi.deleteSecurityPrice('s-1', 1);
    expect(apiClient.delete).toHaveBeenCalledWith('/securities/s-1/prices/1');
  });

  it('getPortfolioSummary returns cached result on second call', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { totalValue: 1000 } });
    await investmentsApi.getPortfolioSummary();
    await investmentsApi.getPortfolioSummary();
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it('getAssetAllocation returns cached result on second call', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: {} });
    await investmentsApi.getAssetAllocation();
    await investmentsApi.getAssetAllocation();
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it('getInvestmentAccounts returns cached result on second call', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
    await investmentsApi.getInvestmentAccounts();
    await investmentsApi.getInvestmentAccounts();
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it('getTopMovers returns cached result on second call', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
    await investmentsApi.getTopMovers();
    await investmentsApi.getTopMovers();
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it('getPortfolioSummary with empty accountIds passes undefined params', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { totalValue: 0 } });
    await investmentsApi.getPortfolioSummary([]);
    expect(apiClient.get).toHaveBeenCalledWith('/portfolio/summary', { params: undefined });
  });

  it('getAssetAllocation with empty accountIds passes undefined params', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: {} });
    await investmentsApi.getAssetAllocation([]);
    expect(apiClient.get).toHaveBeenCalledWith('/portfolio/allocation', { params: undefined });
  });

  it('transferSecurity posts both legs and invalidates the cache', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { transferOut: { id: 'out' }, transferIn: { id: 'in' } },
    });
    const data = {
      fromAccountId: 'a1',
      toAccountId: 'a2',
      securityId: 's1',
      transactionDate: '2025-01-01',
      quantity: 10,
      costPerShare: 5,
    };
    const result = await investmentsApi.transferSecurity(data);
    expect(apiClient.post).toHaveBeenCalledWith(
      '/investment-transactions/transfer-security',
      data,
    );
    expect(result).toEqual({
      transferOut: { id: 'out' },
      transferIn: { id: 'in' },
    });
  });

  it('getSecurityTransactionHistory fetches the security history', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { transactions: [] } });
    const result = await investmentsApi.getSecurityTransactionHistory('s1');
    expect(apiClient.get).toHaveBeenCalledWith(
      '/investment-transactions/security/s1/history',
    );
    expect(result).toEqual({ transactions: [] });
  });
});
