'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import toast from 'react-hot-toast';
import { Select } from '@/components/ui/Select';
import { userSettingsApi } from '@/lib/user-settings';
import { usePreferencesStore } from '@/store/preferencesStore';
import { useTheme } from '@/contexts/ThemeContext';
import { getErrorMessage } from '@/lib/errors';

type Theme = 'light' | 'dark' | 'system';

const THEME_OPTIONS: { value: Theme; labelKey: string }[] = [
  { value: 'system', labelKey: 'themeOptions.system' },
  { value: 'light', labelKey: 'themeOptions.light' },
  { value: 'dark', labelKey: 'themeOptions.dark' },
];

interface ThemeSelectorProps {
  value: Theme;
  onChange: (theme: Theme) => void;
}

/**
 * Theme picker that applies and persists the choice immediately, mirroring the
 * LanguageSelector. The change is reflected in the app right away (via the
 * theme context) and saved to the server without waiting for "Save
 * Preferences".
 */
export function ThemeSelector({ value, onChange }: ThemeSelectorProps) {
  const t = useTranslations('settings.preferences');
  const [isSaving, startTransition] = useTransition();
  const updatePreferencesStore = usePreferencesStore((state) => state.updatePreferences);
  const { setTheme: setAppTheme } = useTheme();

  const handleChange = (next: Theme) => {
    onChange(next);
    setAppTheme(next);

    startTransition(async () => {
      try {
        const updated = await userSettingsApi.updatePreferences({ theme: next });
        updatePreferencesStore(updated);
        toast.success(t('toasts.saved'));
      } catch (error) {
        toast.error(getErrorMessage(error, t('toasts.themeSaveFailed')));
      }
    });
  };

  return (
    <Select
      label={t('themeLabel')}
      options={THEME_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
      value={value}
      onChange={(e) => handleChange(e.target.value as Theme)}
      disabled={isSaving}
    />
  );
}
