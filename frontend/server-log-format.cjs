'use strict';

/*
 * Standalone-server console formatter.
 *
 * Preloaded into the Next.js standalone server (via `node --require` in the
 * production Dockerfile) so that EVERY line the frontend container emits carries
 * an ISO timestamp -- including Next.js's own startup banner ("▲ Next.js ...",
 * "✓ Ready in ...") which is printed by the framework before any application
 * code (and therefore before `createLogger`) runs.
 *
 * Lines that already begin with an ISO timestamp are left untouched, so output
 * from `src/lib/logger.ts` (which timestamps its own server-side lines) is not
 * double-prefixed.
 *
 * This file ships as plain CommonJS (not TypeScript) because it is referenced by
 * the container start command, not imported by application code, so Next.js
 * never compiles it. The pure `prefixArgs` helper is unit-tested from
 * `src/lib/server-log-format.test.ts`.
 */

const ISO_PREFIX_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\b/;

const LEVEL_LABELS = {
  log: 'INFO',
  info: 'INFO',
  debug: 'DEBUG',
  warn: 'WARN',
  error: 'ERROR',
};

const CONSOLE_METHODS = ['log', 'info', 'debug', 'warn', 'error'];

/**
 * Flatten an Error onto a single line so a log shipper keeps one record per
 * error instead of splitting its stack across many lines. Mirrors the
 * flattening done server-side in src/lib/logger.ts.
 */
function flattenError(error) {
  const stack = error.stack || `${error.name}: ${error.message}`;
  return stack.replace(/\n\s*/g, ' \\n ');
}

/**
 * Build the argument list to forward to the underlying console method.
 *
 * Error arguments are flattened to a single line, and the prefix is merged into
 * a leading string argument (rather than unshifted as a separate argument) so
 * that printf-style format specifiers in that first argument -- e.g.
 * console.log('%s ready', name) -- keep working.
 */
function prefixArgs(level, args, now = new Date()) {
  const prefix = `${now.toISOString()} [Next.js] ${LEVEL_LABELS[level] || 'INFO'}:`;

  if (args.length === 0) {
    return [prefix];
  }

  const [first] = args;
  // Already timestamped (e.g. from createLogger, which flattens its own
  // errors) -- pass through untouched to avoid a second timestamp.
  if (typeof first === 'string' && ISO_PREFIX_RE.test(first)) {
    return args;
  }

  const flat = args.map((arg) => (arg instanceof Error ? flattenError(arg) : arg));
  const [flatFirst, ...rest] = flat;
  if (typeof flatFirst === 'string') {
    return [`${prefix} ${flatFirst}`, ...rest];
  }

  return [prefix, ...flat];
}

/**
 * Patch the console methods on `target` so their output is timestamped.
 * Idempotent: a second call on the same console is a no-op.
 */
function installConsoleTimestamps(target) {
  if (target.__monizeTimestamps) {
    return target;
  }

  for (const method of CONSOLE_METHODS) {
    const original = target[method].bind(target);
    target[method] = (...args) => original(...prefixArgs(method, args));
  }

  Object.defineProperty(target, '__monizeTimestamps', { value: true });
  return target;
}

module.exports = { ISO_PREFIX_RE, LEVEL_LABELS, prefixArgs, installConsoleTimestamps };

// When preloaded into the production standalone server, patch the real console
// immediately so Next.js's banner is timestamped too. Gated on NODE_ENV so unit
// tests (NODE_ENV=test) can import the pure helpers without mutating the global
// console.
if (process.env.NODE_ENV === 'production') {
  installConsoleTimestamps(console);
}
