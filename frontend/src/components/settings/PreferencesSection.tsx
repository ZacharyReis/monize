'use client';

import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { userSettingsApi } from '@/lib/user-settings';
import { usePreferencesStore } from '@/store/preferencesStore';
import { useTheme } from '@/contexts/ThemeContext';
import { UserPreferences, UpdatePreferencesData } from '@/types/auth';
import { getErrorMessage } from '@/lib/errors';
import { exchangeRatesApi, CurrencyInfo } from '@/lib/exchange-rates';
import { Combobox } from '@/components/ui/Combobox';
import { DATE_FORMAT_OPTIONS, EXCHANGE_OPTIONS } from '@/lib/constants';

const NUMBER_FORMAT_OPTIONS = [
  { value: 'browser', label: 'Use browser locale (auto-detect)' },
  { value: 'en-US', label: 'English (US) - 1,234.56' },
  { value: 'en-GB', label: 'English (UK) - 1,234.56' },
  { value: 'de-DE', label: 'German - 1.234,56' },
  { value: 'fr-FR', label: 'French - 1 234,56' },
];

function getBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function buildTimezoneOptions(): { value: string; label: string }[] {
  const browserTz = getBrowserTimezone();
  const options: { value: string; label: string }[] = [
    { value: 'browser', label: `Use browser timezone (auto-detected as ${browserTz})` },
    { value: 'UTC', label: 'UTC' },
  ];

  const allTimezones = Intl.supportedValuesOf('timeZone').filter((tz) => tz !== 'UTC');

  for (const tz of allTimezones) {
    // Format: "America/New_York" -> "America/New York"
    const label = tz.replaceAll('_', ' ');
    options.push({ value: tz, label });
  }

  return options;
}

const TIMEZONE_OPTIONS = buildTimezoneOptions();

const WEEK_STARTS_ON_OPTIONS = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
];

const THEME_OPTIONS = [
  { value: 'system', label: 'System (follow device setting)' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const LOOKBACK_OPTIONS = [
  { value: '1', label: '1 month' },
  { value: '2', label: '2 months' },
  { value: '3', label: '3 months' },
  { value: '6', label: '6 months' },
  { value: '9', label: '9 months' },
  { value: '12', label: '12 months' },
];

interface PreferencesSectionProps {
  preferences: UserPreferences;
  onPreferencesUpdated: (prefs: UserPreferences) => void;
}

export function PreferencesSection({ preferences, onPreferencesUpdated }: PreferencesSectionProps) {
  const updatePreferencesStore = usePreferencesStore((state) => state.updatePreferences);
  const { setTheme: setAppTheme } = useTheme();

  const [dateFormat, setDateFormat] = useState(preferences.dateFormat);
  const [numberFormat, setNumberFormat] = useState(preferences.numberFormat);
  const [timezone, setTimezone] = useState(preferences.timezone);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(preferences.theme);
  const [defaultCurrency, setDefaultCurrency] = useState(preferences.defaultCurrency);
  const [weekStartsOn, setWeekStartsOn] = useState(preferences.weekStartsOn ?? 1);
  const [showCreatedAt, setShowCreatedAt] = useState(preferences.showCreatedAt ?? false);
  const [timeFormat, setTimeFormat] = useState<'24h' | '12h'>(preferences.timeFormat ?? '24h');
  const [preferredExchanges, setPreferredExchanges] = useState<string[]>(
    preferences.preferredExchanges ?? [],
  );
  const [forecastLookbackMonths, setForecastLookbackMonths] = useState(
    preferences.forecastLookbackMonths ?? 3,
  );
  const [isUpdatingPreferences, setIsUpdatingPreferences] = useState(false);

  const [availableCurrencies, setAvailableCurrencies] = useState<CurrencyInfo[]>([]);

  useEffect(() => {
    exchangeRatesApi.getCurrencies().then(setAvailableCurrencies).catch(() => {});
  }, []);

  const currencyOptions = useMemo(() => {
    return availableCurrencies.map((c) => ({
      value: c.code,
      label: `${c.code} - ${c.name}`,
    }));
  }, [availableCurrencies]);

  const handleUpdatePreferences = async () => {
    setIsUpdatingPreferences(true);
    try {
      const data: UpdatePreferencesData = {
        dateFormat,
        numberFormat,
        timezone,
        theme,
        defaultCurrency,
        weekStartsOn,
        showCreatedAt,
        timeFormat,
        preferredExchanges: preferredExchanges.filter(Boolean),
        forecastLookbackMonths,
      };

      const updated = await userSettingsApi.updatePreferences(data);
      onPreferencesUpdated(updated);
      updatePreferencesStore(updated);
      setAppTheme(theme);
      toast.success('Preferences saved');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to save preferences'));
    } finally {
      setIsUpdatingPreferences(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 shadow dark:shadow-gray-700/50 rounded-lg p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Preferences</h2>

      <div className="space-y-4">
        <Select
          label="Theme"
          options={THEME_OPTIONS}
          value={theme}
          onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
        />

        <Select
          label="Default Currency"
          options={currencyOptions}
          value={defaultCurrency}
          onChange={(e) => setDefaultCurrency(e.target.value)}
        />

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Preferred Exchanges (for security lookups)
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            Select up to 3 exchanges in priority order. These will be preferred when looking up securities.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <Combobox
                key={i}
                options={EXCHANGE_OPTIONS
                  .filter(
                    (opt) =>
                      !preferredExchanges.includes(opt.value) ||
                      preferredExchanges[i] === opt.value,
                  )
                  .sort((a, b) => a.label.localeCompare(b.label))}
                value={preferredExchanges[i] || ''}
                onChange={(value) => {
                  const updated = [...preferredExchanges];
                  if (value) {
                    updated[i] = value;
                  } else {
                    updated.splice(i, 1);
                  }
                  setPreferredExchanges(updated.filter(Boolean));
                }}
                placeholder={`Priority ${i + 1}`}
                alwaysShowSubtitle
              />
            ))}
          </div>
        </div>

        <Select
          label="Date Format"
          options={DATE_FORMAT_OPTIONS}
          value={dateFormat}
          onChange={(e) => setDateFormat(e.target.value)}
        />

        <Select
          label="Number Format"
          options={NUMBER_FORMAT_OPTIONS}
          value={numberFormat}
          onChange={(e) => setNumberFormat(e.target.value)}
        />

        <Combobox
          label="Timezone"
          options={TIMEZONE_OPTIONS}
          value={timezone}
          onChange={(value) => setTimezone(value)}
          placeholder="Search timezones..."
        />

        <Select
          label="Week starts on"
          options={WEEK_STARTS_ON_OPTIONS}
          value={String(weekStartsOn)}
          onChange={(e) => setWeekStartsOn(Number(e.target.value))}
        />

        <div className="flex items-center">
          <input
            id="showCreatedAt"
            type="checkbox"
            checked={showCreatedAt}
            onChange={(e) => setShowCreatedAt(e.target.checked)}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-600 rounded"
          />
          <label htmlFor="showCreatedAt" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
            Show Create Date in transaction forms
          </label>
        </div>

        {showCreatedAt && (
          <Select
            label="Time Format"
            options={[
              { value: '24h', label: '24-hour (14:30)' },
              { value: '12h', label: '12-hour (2:30 PM)' },
            ]}
            value={timeFormat}
            onChange={(e) => setTimeFormat(e.target.value as '24h' | '12h')}
          />
        )}

        {/* Cash Flow Forecast */}
        <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Cash Flow Forecast</h3>
          <Select
            label="Trend Lookback Period"
            options={LOOKBACK_OPTIONS}
            value={String(forecastLookbackMonths)}
            onChange={(e) => setForecastLookbackMonths(Number(e.target.value))}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            How many months of spending history to use when projecting discretionary spending trends in the cash flow forecast.
          </p>
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <Button onClick={handleUpdatePreferences} disabled={isUpdatingPreferences}>
          {isUpdatingPreferences ? 'Saving...' : 'Save Preferences'}
        </Button>
      </div>
    </div>
  );
}
