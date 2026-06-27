import { describe, it, expect } from 'vitest';
import { loadMessages } from './messages';

describe('loadMessages', () => {
  it('loads every registered namespace for the default locale', async () => {
    const messages = await loadMessages('en');
    // Each namespace registered in messages.ts must resolve to an object so
    // that useTranslations(namespace) works at runtime, not just in tests.
    expect(Object.keys(messages)).toEqual(
      expect.arrayContaining(['common', 'settings', 'auth', 'navigation']),
    );
    for (const value of Object.values(messages)) {
      expect(typeof value).toBe('object');
    }
  });

  it('resolves nested keys for extracted feature areas', async () => {
    const messages = await loadMessages('en');
    const auth = messages.auth as Record<string, Record<string, string>>;
    expect(auth.signIn.title).toBe('Sign in to Monize');
    const navigation = messages.navigation as Record<string, string>;
    expect(navigation.transactions).toBe('Transactions');
  });

  it('wraps strings with pseudo markers for the xx locale', async () => {
    const messages = await loadMessages('xx');
    const common = messages.common as Record<string, string>;
    expect(common.save).toBe('[XX-Save-XX]');
  });

  it('falls back to the default locale when a locale folder is missing', async () => {
    const messages = await loadMessages('zz');
    const common = messages.common as Record<string, string>;
    // No zz/ folder exists, so the loader serves the English catalog.
    expect(common.save).toBe('Save');
  });
});
