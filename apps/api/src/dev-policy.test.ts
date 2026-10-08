import { describe, expect, it } from "vitest";

import { resolveDevAuth, resolveSessionSecret } from "./dev-policy.js";

describe("dev auth policy", () => {
  it("stays disabled unless the flag or --dev is present", () => {
    expect(resolveDevAuth({ NODE_ENV: "development" }, []).enabled).toBe(false);
    expect(resolveDevAuth({ NODE_ENV: "development" }, ["--dev"]).enabled).toBe(true);
    expect(
      resolveDevAuth({ NODE_ENV: "development", ALLOW_DEV_PASSWORD_AUTH: "true" }, []).enabled,
    ).toBe(true);
  });

  it("fails closed in production without an override key", () => {
    expect(() =>
      resolveDevAuth({ NODE_ENV: "production", ALLOW_DEV_PASSWORD_AUTH: "true" }, []),
    ).toThrow(/DEV_OVERRIDE_KEY/);
    expect(() => resolveDevAuth({ NODE_ENV: "production" }, ["--dev"])).toThrow(/DEV_OVERRIDE_KEY/);
    expect(
      resolveDevAuth(
        {
          NODE_ENV: "production",
          ALLOW_DEV_PASSWORD_AUTH: "true",
          DEV_OVERRIDE_KEY: "override-not-a-real-secret",
        },
        [],
      ).enabled,
    ).toBe(true);
  });

  it("requires a session secret in production", () => {
    expect(resolveSessionSecret({ NODE_ENV: "development" })).toBe(
      "dev-only-insecure-session-secret",
    );
    expect(() => resolveSessionSecret({ NODE_ENV: "production" })).toThrow(/SESSION_SECRET/);
    expect(
      resolveSessionSecret({ NODE_ENV: "production", SESSION_SECRET: "prod-session-secret" }),
    ).toBe("prod-session-secret");
  });
});
