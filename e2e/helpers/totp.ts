import { authenticator } from 'otplib';

// The backend generates TOTP secrets with otplib defaults (SHA-1, 6 digits,
// 30s step), so generating from the same library guarantees matching codes.
// Anti-replay only kicks in on the login verify path, and each E2E test runs
// as its own isolated user, so a freshly generated code is always accepted.
export function generateTotp(secret: string): string {
  return authenticator.generate(secret);
}
