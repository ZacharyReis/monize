import { describe, it, expect } from 'vitest';
// The preloaded console formatter ships as raw CommonJS at the project root (it
// is referenced by the container start command, not imported by app code).
import {
  prefixArgs,
  installConsoleTimestamps,
  ISO_PREFIX_RE,
} from '../../server-log-format.cjs';

const FIXED = new Date('2026-06-19T11:20:00.123Z');

describe('prefixArgs', () => {
  it('merges an ISO timestamp, context, and level into a leading string arg', () => {
    expect(prefixArgs('log', ['▲ Next.js 16.2.6'], FIXED)).toEqual([
      '2026-06-19T11:20:00.123Z [Next.js] INFO: ▲ Next.js 16.2.6',
    ]);
  });

  it('maps console methods to level labels', () => {
    expect(prefixArgs('warn', ['careful'], FIXED)[0]).toContain('[Next.js] WARN:');
    expect(prefixArgs('error', ['boom'], FIXED)[0]).toContain('[Next.js] ERROR:');
    expect(prefixArgs('debug', ['trace'], FIXED)[0]).toContain('[Next.js] DEBUG:');
  });

  it('leaves lines that already start with an ISO timestamp untouched', () => {
    const fromLogger = ['2026-06-19T11:20:00.123Z [Proxy] INFO:', 'Backend connected'];
    expect(prefixArgs('info', fromLogger, FIXED)).toBe(fromLogger);
  });

  it('keeps printf-style format specifiers in the first argument working', () => {
    const result = prefixArgs('log', ['%s ready in %dms', 'app', 5], FIXED);
    // The format string stays the (single) first argument so util.format can
    // still interpolate the trailing values.
    expect(result[0]).toBe('2026-06-19T11:20:00.123Z [Next.js] INFO: %s ready in %dms');
    expect(result.slice(1)).toEqual(['app', 5]);
  });

  it('flattens an Error argument onto a single line', () => {
    const error = new Error('something failed');
    error.stack = 'Error: something failed\n    at foo (file.ts:1:1)\n    at bar (file.ts:2:2)';
    const result = prefixArgs('error', ['Request failed:', error], FIXED);
    expect(result[0]).toBe('2026-06-19T11:20:00.123Z [Next.js] ERROR: Request failed:');
    const serialized = result[1] as string;
    expect(serialized).not.toContain('\n');
    expect(serialized).toContain('Error: something failed');
    expect(serialized).toContain('at foo (file.ts:1:1)');
    expect(serialized).toContain('at bar (file.ts:2:2)');
  });

  it('flattens an Error passed as the sole argument into one line', () => {
    const error = new Error('boom');
    error.stack = 'Error: boom\n    at x (y.ts:1:1)';
    const result = prefixArgs('error', [error], FIXED);
    // The flattened error becomes the leading string and merges with the prefix.
    expect(result).toEqual([
      '2026-06-19T11:20:00.123Z [Next.js] ERROR: Error: boom \\n at x (y.ts:1:1)',
    ]);
  });

  it('prepends the prefix as a separate argument when the first arg is not a string', () => {
    const obj = { ready: true };
    expect(prefixArgs('info', [obj], FIXED)).toEqual([
      '2026-06-19T11:20:00.123Z [Next.js] INFO:',
      obj,
    ]);
  });

  it('handles a call with no arguments', () => {
    expect(prefixArgs('log', [], FIXED)).toEqual(['2026-06-19T11:20:00.123Z [Next.js] INFO:']);
  });
});

describe('ISO_PREFIX_RE', () => {
  it('matches createLogger output and rejects the framework banner', () => {
    expect(ISO_PREFIX_RE.test('2026-06-19T11:20:00.123Z [Proxy] INFO:')).toBe(true);
    expect(ISO_PREFIX_RE.test('▲ Next.js 16.2.6')).toBe(false);
  });
});

describe('installConsoleTimestamps', () => {
  it('timestamps output and is idempotent, without double-prefixing logger lines', () => {
    const calls: unknown[][] = [];
    const fakeConsole = {
      log: (...args: unknown[]) => calls.push(args),
      info: (...args: unknown[]) => calls.push(args),
      debug: (...args: unknown[]) => calls.push(args),
      warn: (...args: unknown[]) => calls.push(args),
      error: (...args: unknown[]) => calls.push(args),
    };

    installConsoleTimestamps(fakeConsole);
    installConsoleTimestamps(fakeConsole); // second call is a no-op

    fakeConsole.log('▲ Next.js 16.2.6');
    fakeConsole.info('2026-06-19T11:20:00.123Z [Proxy] INFO:', 'Backend connected');

    expect(calls[0][0]).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[Next\.js\] INFO: ▲ Next\.js 16\.2\.6$/,
    );
    // The logger line is passed through unchanged (no second timestamp).
    expect(calls[1]).toEqual(['2026-06-19T11:20:00.123Z [Proxy] INFO:', 'Backend connected']);
  });
});
