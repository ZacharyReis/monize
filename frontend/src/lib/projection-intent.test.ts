import { describe, it, expect } from 'vitest';
import { projectionToSelect, selectToProjection } from './projection-intent';

describe('projection-intent mapping', () => {
  it('maps flag -> select value', () => {
    expect(projectionToSelect(true)).toBe('one_time');
    expect(projectionToSelect(false)).toBe('recurring');
    expect(projectionToSelect(null)).toBe('auto');
    expect(projectionToSelect(undefined)).toBe('auto');
  });

  it('maps select value -> flag', () => {
    expect(selectToProjection('one_time')).toBe(true);
    expect(selectToProjection('recurring')).toBe(false);
    expect(selectToProjection('auto')).toBeNull();
  });
});
