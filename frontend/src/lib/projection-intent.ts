export type ProjectionSelectValue = 'auto' | 'one_time' | 'recurring';

export function projectionToSelect(
  value: boolean | null | undefined,
): ProjectionSelectValue {
  if (value === true) return 'one_time';
  if (value === false) return 'recurring';
  return 'auto';
}

export function selectToProjection(value: string): boolean | null {
  if (value === 'one_time') return true;
  if (value === 'recurring') return false;
  return null;
}
