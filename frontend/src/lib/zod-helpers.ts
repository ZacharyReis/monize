import '@/lib/zodConfig';
import { z } from 'zod';

/** Shared password validation matching backend requirements (register, change, reset). */
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(100, 'Password must be 100 characters or less')
  .regex(/(?=.*[a-z])/, 'Must contain a lowercase letter')
  .regex(/(?=.*[A-Z])/, 'Must contain an uppercase letter')
  .regex(/(?=.*\d)/, 'Must contain a number')
  .regex(/(?=.*[^A-Za-z\d\s])/, 'Must contain a special character');

/** Shared email validation used by the auth forms (login, register, forgot password). */
export const emailSchema = z
  .string()
  .email('Please enter a valid email address');

/** Translator-aware variants for forms that surface validation messages. */
export const buildPasswordSchema = (t: (key: string) => string) => z
  .string()
  .min(12, t('passwordValidation.min'))
  .max(100, t('passwordValidation.max'))
  .regex(/(?=.*[a-z])/, t('passwordValidation.lowercase'))
  .regex(/(?=.*[A-Z])/, t('passwordValidation.uppercase'))
  .regex(/(?=.*\d)/, t('passwordValidation.number'))
  .regex(/(?=.*[^A-Za-z\d\s])/, t('passwordValidation.special'));

export const buildEmailSchema = (t: (key: string) => string) => z
  .string()
  .email(t('emailInvalid'));

/**
 * Shared 6-digit TOTP code field validation (2FA setup, 2FA verify, step-up
 * auth). `t` is the `common` namespace translator -- the messages live under
 * `common.codeValidation`.
 */
export const buildTotpCodeSchema = (t: (key: string) => string) => z
  .string()
  .length(6, t('codeValidation.length'))
  .regex(/^\d{6}$/, t('codeValidation.digits'));

export const PASSWORD_REQUIREMENTS_TEXT =
  'Password must be at least 12 characters and contain an uppercase letter, a lowercase letter, a number, and a special character.';

/** Convert empty strings to undefined for optional UUID fields */
export const optionalUuid = z.preprocess(
  (val) => (val === '' ? undefined : val),
  z.string().uuid().optional()
);

/** Convert empty strings to undefined for optional string fields */
export const optionalString = z.preprocess(
  (val) => (val === '' ? undefined : val),
  z.string().optional()
);

/** Convert empty strings/null/undefined to undefined for optional number fields */
export const optionalNumber = z.preprocess(
  (val) => (val === '' || val === undefined || val === null ? undefined : val),
  z.number().optional()
);
