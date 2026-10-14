// ============================================================
// Reading secrets (set with `supabase secrets set NAME=value`).
// Kept separate from billing.ts so functions that don't bill, like
// form-notify, don't need the Stripe secrets to start.
// ============================================================

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing secret ${name}. Set it with: supabase secrets set ${name}=...`);
  return value;
}
