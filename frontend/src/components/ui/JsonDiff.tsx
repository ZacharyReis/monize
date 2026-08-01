'use client';

import { ReactNode } from 'react';
import { highlightJson } from './JsonHighlight';

interface JsonDiffProps {
  /** The original row, before de-identification. */
  before: Record<string, unknown>;
  /** The row as it will appear in the shared file. */
  after: Record<string, unknown>;
  /** Column header over the original values. */
  beforeLabel: string;
  /** Column header over the de-identified values. */
  afterLabel: string;
  className?: string;
}

/** One `  "key": value` JSON line, indented, with an optional trailing comma. */
function jsonLine(key: string, value: unknown, comma: boolean): string {
  return `  ${JSON.stringify(key)}: ${JSON.stringify(value)}${comma ? ',' : ''}`;
}

const has = (obj: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

/**
 * Renders a before/after row pair as a two-column, GitHub-style diff: the
 * original values on the left, the de-identified values on the right, with
 * changed (and dropped) fields highlighted per line. Values are rendered
 * one per line so the two columns stay aligned key-for-key.
 */
export function JsonDiff({
  before,
  after,
  beforeLabel,
  afterLabel,
  className = '',
}: JsonDiffProps) {
  // Union of keys, preserving the original row's order, then any after-only keys.
  const keys: string[] = [...Object.keys(before)];
  for (const k of Object.keys(after)) {
    if (!keys.includes(k)) keys.push(k);
  }

  const cell = 'px-3 py-0.5 font-mono text-xs whitespace-pre-wrap break-all';
  const header =
    'px-3 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700';
  const removed = 'bg-red-50 dark:bg-red-950/40';
  const added = 'bg-emerald-50 dark:bg-emerald-950/40';
  const filler = 'bg-gray-50 dark:bg-gray-800/40';

  const rows: ReactNode[] = [];
  keys.forEach((k, i) => {
    const isLast = i === keys.length - 1;
    const bHas = has(before, k);
    const aHas = has(after, k);
    const changed = !bHas || !aHas || JSON.stringify(before[k]) !== JSON.stringify(after[k]);

    rows.push(
      <div
        key={`l-${k}`}
        className={`${cell} border-r border-gray-200 dark:border-gray-700 ${
          !bHas ? filler : changed ? removed : ''
        }`}
      >
        {bHas ? highlightJson(jsonLine(k, before[k], !isLast)) : ''}
      </div>,
    );
    rows.push(
      <div
        key={`r-${k}`}
        className={`${cell} ${!aHas ? filler : changed ? added : ''}`}
      >
        {aHas ? highlightJson(jsonLine(k, after[k], !isLast)) : ''}
      </div>,
    );
  });

  return (
    <div
      className={`grid grid-cols-2 overflow-hidden rounded-md border border-gray-200 dark:border-gray-700 ${className}`}
    >
      <div className={`${header} border-r`}>{beforeLabel}</div>
      <div className={header}>{afterLabel}</div>
      <div className="px-3 py-0.5 font-mono text-xs text-gray-500 border-r border-gray-200 dark:border-gray-700">
        {'{'}
      </div>
      <div className="px-3 py-0.5 font-mono text-xs text-gray-500">{'{'}</div>
      {rows}
      <div className="px-3 py-0.5 font-mono text-xs text-gray-500 border-r border-gray-200 dark:border-gray-700">
        {'}'}
      </div>
      <div className="px-3 py-0.5 font-mono text-xs text-gray-500">{'}'}</div>
    </div>
  );
}
