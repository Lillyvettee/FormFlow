/**
 * Password rules, shared by sign-up, Settings > Password and the reset
 * password page, so a password accepted in one place is accepted everywhere.
 *
 * The special character check accepts any non-letter, non-digit character,
 * including ~ ` and spaces.
 */
export const PASSWORD_RULES: { label: string; test: (pw: string) => boolean }[] = [
  { label: "At least 8 characters", test: (pw) => pw.length >= 8 },
  { label: "An uppercase letter", test: (pw) => /[A-Z]/.test(pw) },
  { label: "A lowercase letter", test: (pw) => /[a-z]/.test(pw) },
  { label: "A number", test: (pw) => /\d/.test(pw) },
  { label: "A special character, like ! # or ?", test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];
