'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import '@/lib/zodConfig';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { userSettingsApi } from '@/lib/user-settings';
import { useAuthStore } from '@/store/authStore';
import { User, UpdateProfileData } from '@/types/auth';
import { getErrorMessage } from '@/lib/errors';

const buildProfileSchema = (t: (key: string) => string) => z.object({
  firstName: z
    .string()
    .max(100, t('validation.firstNameMax'))
    .optional()
    .or(z.literal('')),
  lastName: z
    .string()
    .max(100, t('validation.lastNameMax'))
    .optional()
    .or(z.literal('')),
  email: z
    .string()
    .min(1, t('validation.emailRequired'))
    .email(t('validation.emailInvalid'))
    .max(254, t('validation.emailMax')),
  currentPassword: z
    .string()
    .max(128, t('validation.passwordMax'))
    .optional()
    .or(z.literal('')),
});

type ProfileFormData = z.infer<ReturnType<typeof buildProfileSchema>>;

interface ProfileSectionProps {
  user: User;
  onUserUpdated: (user: User) => void;
}

export function ProfileSection({ user, onUserUpdated }: ProfileSectionProps) {
  const t = useTranslations('settings.profile');
  const { setUser } = useAuthStore();
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(buildProfileSchema(t)),
    defaultValues: {
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email,
      currentPassword: '',
    },
  });

  const watchedEmail = watch('email');
  const isEmailChanged = watchedEmail !== user.email;

  const onSubmit = async (formData: ProfileFormData) => {
    setIsUpdatingProfile(true);
    try {
      const data: UpdateProfileData = {};
      if (formData.firstName !== (user.firstName || '')) data.firstName = formData.firstName;
      if (formData.lastName !== (user.lastName || '')) data.lastName = formData.lastName;
      if (isEmailChanged) {
        if (!formData.currentPassword) {
          toast.error(t('passwordRequired'));
          return;
        }
        data.email = formData.email;
        data.currentPassword = formData.currentPassword;
      }

      if (Object.keys(data).length === 0) {
        toast.error(t('noChanges'));
        return;
      }

      const updatedUser = await userSettingsApi.updateProfile(data);
      onUserUpdated(updatedUser);
      setUser(updatedUser);
      setValue('currentPassword', '');
      toast.success(t('toasts.success'));
    } catch (error) {
      toast.error(getErrorMessage(error, t('toasts.updateFailed')));
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 shadow dark:shadow-gray-700/50 rounded-lg p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{t('heading')}</h2>
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label={t('firstNameLabel')}
            {...register('firstName')}
            error={errors.firstName?.message}
            placeholder={t('firstNamePlaceholder')}
          />
          <Input
            label={t('lastNameLabel')}
            {...register('lastName')}
            error={errors.lastName?.message}
            placeholder={t('lastNamePlaceholder')}
          />
        </div>
        <div className="mt-4">
          <Input
            label={t('emailLabel')}
            type="email"
            {...register('email')}
            error={errors.email?.message}
            placeholder={t('emailPlaceholder')}
          />
        </div>
        {isEmailChanged && (
          <div className="mt-4">
            <Input
              label={t('currentPasswordLabel')}
              type="password"
              {...register('currentPassword')}
              error={errors.currentPassword?.message}
              placeholder={t('currentPasswordPlaceholder')}
            />
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t('passwordConfirmNote')}
            </p>
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={isUpdatingProfile}>
            {isUpdatingProfile ? t('savingButton') : t('saveButton')}
          </Button>
        </div>
      </form>
    </div>
  );
}
