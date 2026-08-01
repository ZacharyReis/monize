import { describe, it, expect } from 'vitest';
import { sanitizeFilename } from './export-filename';

describe('sanitizeFilename', () => {
  it('lowercases and collapses non-alphanumerics to single dashes', () => {
    expect(sanitizeFilename('Loan Schedule')).toBe('loan-schedule');
    expect(sanitizeFilename('Rate History (2024)')).toBe('rate-history-2024');
  });

  it('strips leading and trailing separators', () => {
    expect(sanitizeFilename('  -- Payoff Timeline -- ')).toBe('payoff-timeline');
  });

  it('falls back when nothing usable remains', () => {
    expect(sanitizeFilename('***')).toBe('export');
    expect(sanitizeFilename('***', 'chart')).toBe('chart');
  });
});
