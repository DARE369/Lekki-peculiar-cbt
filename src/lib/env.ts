// Central place for environment variables so a missing one fails loudly with a useful message.
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing environment variable ${name}. See docs/DEPLOYMENT.md.`);
  return value;
}

export const env = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabaseAnonKey() {
    return required(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
  },
  get supabaseServiceKey() {
    return required(
      "SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY,
    );
  },
  get examTokenSecret() {
    const v = required("EXAM_TOKEN_SECRET", process.env.EXAM_TOKEN_SECRET);
    if (v.length < 32) throw new Error("EXAM_TOKEN_SECRET must be at least 32 characters.");
    return v;
  },
  get setupSecret() {
    return process.env.SETUP_SECRET;
  },
  get cronSecret() {
    return process.env.CRON_SECRET;
  },
};

export function isConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  );
}
