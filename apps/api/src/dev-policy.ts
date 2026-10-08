export interface DevAuthDecision {
  enabled: boolean;
}

/**
 * Dev username/password auth is opt-in.
 * Production refuses the flag unless DEV_OVERRIDE_KEY is set.
 */
export function resolveDevAuth(
  env: Record<string, string | undefined>,
  argv: readonly string[],
): DevAuthDecision {
  const requested = env.ALLOW_DEV_PASSWORD_AUTH === "true" || argv.includes("--dev");
  if (!requested) {
    return { enabled: false };
  }
  if (env.NODE_ENV === "production" && !env.DEV_OVERRIDE_KEY) {
    throw new Error("Refusing dev password auth in production without DEV_OVERRIDE_KEY");
  }
  return { enabled: true };
}

export function resolveSessionSecret(env: Record<string, string | undefined>): string {
  if (env.SESSION_SECRET) {
    return env.SESSION_SECRET;
  }
  if (env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is required when NODE_ENV=production");
  }
  return "dev-only-insecure-session-secret";
}
