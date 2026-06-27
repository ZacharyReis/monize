import { describe, it, expect, vi, beforeEach } from 'vitest';
import apiClient from './api';
import { getCached } from './apiCache';
import { investmentReportsApi } from './investment-reports';

vi.mock('./api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('./apiCache', () => ({
  getCached: vi.fn(() => undefined),
  setCache: vi.fn(),
  invalidateCache: vi.fn(),
}));

describe('investmentReportsApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('create posts to /reports/investment', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { id: 'r1' } });
    const result = await investmentReportsApi.create({ name: 'R', config: { columns: ['symbol'] } });
    expect(apiClient.post).toHaveBeenCalledWith('/reports/investment', {
      name: 'R',
      config: { columns: ['symbol'] },
    });
    expect(result).toEqual({ id: 'r1' });
  });

  it('getAll fetches and caches', async () => {
    vi.mocked(getCached).mockReturnValue(undefined);
    vi.mocked(apiClient.get).mockResolvedValue({ data: [{ id: 'r1' }] });
    const result = await investmentReportsApi.getAll();
    expect(apiClient.get).toHaveBeenCalledWith('/reports/investment');
    expect(result).toHaveLength(1);
  });

  it('getAll returns cached data without a request', async () => {
    vi.mocked(getCached).mockReturnValue([{ id: 'cached' }] as never);
    const result = await investmentReportsApi.getAll();
    expect(apiClient.get).not.toHaveBeenCalled();
    expect(result).toEqual([{ id: 'cached' }]);
  });

  it('getById fetches by id', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { id: 'r1' } });
    await investmentReportsApi.getById('r1');
    expect(apiClient.get).toHaveBeenCalledWith('/reports/investment/r1');
  });

  it('update patches the report', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({ data: { id: 'r1' } });
    await investmentReportsApi.update('r1', { name: 'New' });
    expect(apiClient.patch).toHaveBeenCalledWith('/reports/investment/r1', { name: 'New' });
  });

  it('delete removes the report', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({ data: {} });
    await investmentReportsApi.delete('r1');
    expect(apiClient.delete).toHaveBeenCalledWith('/reports/investment/r1');
  });

  it('execute posts with as-of date params', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { groups: [] } });
    await investmentReportsApi.execute('r1', { asOfDate: '2024-06-10' });
    expect(apiClient.post).toHaveBeenCalledWith('/reports/investment/r1/execute', {
      asOfDate: '2024-06-10',
    });
  });

  it('execute posts an empty body when no params', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { groups: [] } });
    await investmentReportsApi.execute('r1');
    expect(apiClient.post).toHaveBeenCalledWith('/reports/investment/r1/execute', {});
  });

  it('toggleFavourite patches isFavourite', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({ data: { id: 'r1' } });
    await investmentReportsApi.toggleFavourite('r1', true);
    expect(apiClient.patch).toHaveBeenCalledWith('/reports/investment/r1', { isFavourite: true });
  });
});
