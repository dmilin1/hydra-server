import { describe, expect, test } from "bun:test";
import { ConfigError, DASHBOARD_PASSWORD_PLACEHOLDER, type Env, loadConfig } from "../src/config";
import { TEST_KEY, TEST_KEY_2 } from "./helpers";

const officialEnv: Env = {
  ENCRYPTION_KEY: TEST_KEY,
  REVENUECAT_PROJECT_ID: "proj",
  REVENUECAT_API_KEY: "sk_test",
};

function problemsOf(env: Env): string[] {
  try {
    loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return [...err.problems];
    throw err;
  }
  throw new Error("expected loadConfig to throw");
}

describe("loadConfig", () => {
  test("missing ENCRYPTION_KEY fails", () => {
    const problems = problemsOf({ HYDRA_MODE: "selfhost" });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toStartWith("ENCRYPTION_KEY: required");
  });

  test("bad hex keys fail", () => {
    expect(problemsOf({ HYDRA_MODE: "selfhost", ENCRYPTION_KEY: "abc" })[0]).toContain(
      "64 hex characters",
    );
    expect(problemsOf({ HYDRA_MODE: "selfhost", ENCRYPTION_KEY: "g".repeat(64) })[0]).toContain(
      "64 hex characters",
    );
    expect(
      problemsOf({
        HYDRA_MODE: "selfhost",
        ENCRYPTION_KEY: TEST_KEY,
        ENCRYPTION_KEYS_PREVIOUS: `${TEST_KEY_2},nothex`,
      }),
    ).toEqual(["ENCRYPTION_KEYS_PREVIOUS[1]: must be exactly 64 hex characters (32 bytes)"]);
  });

  test("lists every problem in one error", () => {
    const problems = problemsOf({ PORT: "not-a-port", LOG_LEVEL: "loud" });
    expect(problems.some((p) => p.startsWith("PORT"))).toBe(true);
    expect(problems.some((p) => p.startsWith("LOG_LEVEL"))).toBe(true);
    expect(problems.some((p) => p.startsWith("ENCRYPTION_KEY"))).toBe(true);
    expect(problems.some((p) => p.startsWith("REVENUECAT_PROJECT_ID"))).toBe(true);
    expect(problems.some((p) => p.startsWith("REVENUECAT_API_KEY"))).toBe(true);
    try {
      loadConfig({});
    } catch (err) {
      expect((err as Error).message).toStartWith("Invalid configuration:\n  - ");
    }
  });

  test("official mode is the default and requires RevenueCat", () => {
    const problems = problemsOf({ ENCRYPTION_KEY: TEST_KEY });
    expect(problems).toEqual([
      "REVENUECAT_PROJECT_ID: required in official mode",
      "REVENUECAT_API_KEY: required in official mode",
    ]);
    const config = loadConfig(officialEnv);
    expect(config.mode).toBe("official");
    expect(config.ai.monthlyLimitUsd).toBe(2);
    expect(config.warnings.some((w) => w.includes("WEBSHARE_TOKEN"))).toBe(true);
    expect(config.warnings.some((w) => w.includes("REVENUECAT_WEBHOOK_SECRET"))).toBe(true);
  });

  test("selfhost mode needs no RevenueCat and has no monthly cap", () => {
    const config = loadConfig({ HYDRA_MODE: "selfhost", ENCRYPTION_KEY: TEST_KEY });
    expect(config.mode).toBe("selfhost");
    expect(config.revenuecat.projectId).toBeNull();
    expect(config.ai.monthlyLimitUsd).toBeNull();
    expect(config.warnings.some((w) => w.includes("WEBSHARE_TOKEN"))).toBe(false);
  });

  test("IS_CUSTOM_SERVER=true is an alias for selfhost; HYDRA_MODE wins", () => {
    expect(loadConfig({ IS_CUSTOM_SERVER: "true", ENCRYPTION_KEY: TEST_KEY }).mode).toBe(
      "selfhost",
    );
    expect(loadConfig({ ...officialEnv, IS_CUSTOM_SERVER: "false" }).mode).toBe("official");
    expect(
      loadConfig({ ...officialEnv, IS_CUSTOM_SERVER: "true", HYDRA_MODE: "official" }).mode,
    ).toBe("official");
    expect(problemsOf({ HYDRA_MODE: "cluster", ENCRYPTION_KEY: TEST_KEY })[0]).toStartWith(
      "HYDRA_MODE",
    );
  });

  test("DASHBOARD_PASSWORD gating", () => {
    const base = { HYDRA_MODE: "selfhost", ENCRYPTION_KEY: TEST_KEY };
    const unset = loadConfig(base);
    expect(unset.dashboardPassword).toBeNull();
    expect(unset.warnings.some((w) => w.includes("DASHBOARD_PASSWORD is not set"))).toBe(true);

    const short = loadConfig({ ...base, DASHBOARD_PASSWORD: "short-password" });
    expect(short.dashboardPassword).toBeNull();
    expect(short.warnings.some((w) => w.includes("shorter than 16"))).toBe(true);

    const placeholder = loadConfig({ ...base, DASHBOARD_PASSWORD: DASHBOARD_PASSWORD_PLACEHOLDER });
    expect(placeholder.dashboardPassword).toBeNull();
    expect(placeholder.warnings.some((w) => w.includes("placeholder"))).toBe(true);
    // Whitespace (quoted .env values, compose, fly secrets) or case changes don't sneak it past.
    for (const variant of [
      ` ${DASHBOARD_PASSWORD_PLACEHOLDER}`,
      `${DASHBOARD_PASSWORD_PLACEHOLDER} `,
      `${DASHBOARD_PASSWORD_PLACEHOLDER}\r`,
      `\t${DASHBOARD_PASSWORD_PLACEHOLDER}\n`,
      DASHBOARD_PASSWORD_PLACEHOLDER.toUpperCase(),
    ]) {
      expect(loadConfig({ ...base, DASHBOARD_PASSWORD: variant }).dashboardPassword).toBeNull();
    }
    // Length counts after trimming.
    expect(
      loadConfig({ ...base, DASHBOARD_PASSWORD: "  short-password   " }).dashboardPassword,
    ).toBeNull();
    expect(loadConfig({ ...base, DASHBOARD_PASSWORD: "   " }).dashboardPassword).toBeNull();

    const good = loadConfig({ ...base, DASHBOARD_PASSWORD: "a-long-enough-password" });
    expect(good.dashboardPassword).toBe("a-long-enough-password");
    expect(good.warnings.some((w) => w.includes("DASHBOARD_PASSWORD"))).toBe(false);
    expect(
      loadConfig({ ...base, DASHBOARD_PASSWORD: " a-long-enough-password\r" }).dashboardPassword,
    ).toBe("a-long-enough-password");
  });

  test("TRUST_PROXY: none by default, fly on Fly, or a hop count", () => {
    const base = { HYDRA_MODE: "selfhost", ENCRYPTION_KEY: TEST_KEY };
    expect(loadConfig(base).trustProxy).toBe("none");
    expect(loadConfig({ ...base, FLY_APP_NAME: "hydra" }).trustProxy).toBe("fly");
    expect(loadConfig({ ...base, FLY_APP_NAME: "hydra", TRUST_PROXY: "none" }).trustProxy).toBe(
      "none",
    );
    expect(loadConfig({ ...base, TRUST_PROXY: "1" }).trustProxy).toBe(1);
    expect(loadConfig({ ...base, TRUST_PROXY: " FLY " }).trustProxy).toBe("fly");
    for (const bad of ["yes", "0", "-1", "1.5", "11"]) {
      expect(problemsOf({ ...base, TRUST_PROXY: bad })[0]).toStartWith("TRUST_PROXY");
    }
  });

  test("defaults, empty strings and legacy model aliases", () => {
    const config = loadConfig({
      HYDRA_MODE: "selfhost",
      ENCRYPTION_KEY: TEST_KEY.toUpperCase(),
      PORT: "",
      OPENAI_SUMMARY_MODEL: "gpt-legacy-summary",
      OPENAI_FILTER_MODEL: "gpt-legacy-filter",
      AI_MODEL_FILTER: "new-filter",
    });
    expect(config.port).toBe(3000);
    expect(config.databasePath).toBe("./sqlite.db");
    expect(config.encryptionKey).toBe(TEST_KEY);
    expect(config.ai.provider).toBe("groq");
    expect(config.ai.models).toEqual({
      summary: null,
      filter: "new-filter",
      answer: null,
    });
    const openai = loadConfig({
      ...officialEnv,
      AI_PROVIDER: "openai",
      OPENAI_SUMMARY_MODEL: "gpt-legacy-summary",
      OPENAI_FILTER_MODEL: "gpt-legacy-filter",
    });
    expect(openai.ai.models).toEqual({
      summary: "gpt-legacy-summary",
      filter: "gpt-legacy-filter",
      answer: null,
    });
    expect(config.ai.freeDailyBudgetUsd).toBe(5);
    expect(config.pollIntervalMs).toBe(120_000);
    expect(config.pollConcurrency).toBe(32);
    expect(config.logLevel).toBe("info");
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.ai.models)).toBe(true);

    const prod = loadConfig({ ...officialEnv, NODE_ENV: "production", PORT: "8080" });
    expect(prod.databasePath).toBe("/data/sqlite.db");
    expect(prod.port).toBe(8080);
  });
});
