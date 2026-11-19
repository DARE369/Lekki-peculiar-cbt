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

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "EXAM_TOKEN_SECRET",
] as const;

/**
 * Which settings this deployment can see — names and yes/no only, never values. `atBuild` is what was
 * baked in when the app was built (NEXT_PUBLIC_* values are fixed at build time); `now` is what the
 * server sees at this moment. A variable that is there now but wasn't at build means: redeploy.
 */
export function envReport() {
  const atBuild: Record<string, boolean> = {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  };
  const env = process.env as Record<string, string | undefined>;
  return REQUIRED.map((name) => {
    const now = Boolean(env[name] ?? (name === "NEXT_PUBLIC_SUPABASE_ANON_KEY" ? env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] : undefined));
    return { name, now, atBuild: name in atBuild ? atBuild[name] : now };
  });
}
