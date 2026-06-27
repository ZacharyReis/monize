import { render, RenderOptions } from '@testing-library/react';
import { ReactElement } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@/contexts/ThemeContext';

// Eagerly load every English namespace so component tests resolve translated
// strings without mocking next-intl. New namespaces are picked up automatically
// -- no need to edit this file when a feature area is extracted.
//
// `import.meta.glob` is a Vite/Vitest build-time macro: it is statically
// replaced during transformation, so it must be referenced by its full literal
// name (see `src/types/vite-glob.d.ts` for the tsc type declaration).
const namespaceModules = import.meta.glob<{ default: Record<string, unknown> }>(
  '@/i18n/messages/en/*.json',
  { eager: true },
);

const testMessages = Object.fromEntries(
  Object.entries(namespaceModules).map(([path, mod]) => {
    const namespace = path.split('/').pop()!.replace(/\.json$/, '');
    return [namespace, mod.default];
  }),
);

function AllProviders({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={testMessages}>
      <ThemeProvider>{children}</ThemeProvider>
    </NextIntlClientProvider>
  );
}

function customRender(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  return render(ui, { wrapper: AllProviders, ...options });
}

export * from '@testing-library/react';
export { customRender as render };
