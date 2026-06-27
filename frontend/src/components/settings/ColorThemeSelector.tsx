'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import toast from 'react-hot-toast';
import { Select } from '@/components/ui/Select';
import { userSettingsApi } from '@/lib/user-settings';
import { usePreferencesStore } from '@/store/preferencesStore';
import { useTheme } from '@/contexts/ThemeContext';
import { getErrorMessage } from '@/lib/errors';
import { COLOR_THEMES, ColorTheme } from '@/lib/color-themes';

interface ColorThemeSelectorProps {
  value: ColorTheme;
  onChange: (colorTheme: ColorTheme) => void;
}

/**
 * Colour theme (palette) picker that applies and persists the choice
 * immediately, mirroring the ThemeSelector. The change is reflected in the
 * app right away (via the theme context) and saved to the server without
 * waiting for "Save Preferences".
 */
export function ColorThemeSelector({ value, onChange }: ColorThemeSelectorProps) {
  const t = useTranslations('settings.preferences');
  const [isSaving, startTransition] = useTransition();
  const updatePreferencesStore = usePreferencesStore((state) => state.updatePreferences);
  const { setColorTheme: setAppColorTheme } = useTheme();

  const handleChange = (next: ColorTheme) => {
    onChange(next);
    setAppColorTheme(next);

    startTransition(async () => {
      try {
        const updated = await userSettingsApi.updatePreferences({ colorTheme: next });
        updatePreferencesStore(updated);
        toast.success(t('toasts.saved'));
      } catch (error) {
        toast.error(getErrorMessage(error, t('toasts.colorThemeSaveFailed')));
      }
    });
  };

  return (
    <Select
      label={t('colorThemeLabel')}
      options={COLOR_THEMES.map((name) => ({
        value: name,
        label: t(`colorThemeOptions.${name}`),
      }))}
      value={value}
      onChange={(e) => handleChange(e.target.value as ColorTheme)}
      disabled={isSaving}
    />
  );
}
