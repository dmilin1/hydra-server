import { z } from "zod";

export type HydraMode = "official" | "selfhost";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type AiProvider = "groq" | "openai";
/**
 * Which proxy headers carry the client IP: none (peer address only), "fly"
 * (Fly-Client-IP) or a count of trusted proxies appending X-Forwarded-For.
 */
export type TrustProxy = "none" | "fly" | number;

export interface Config {
  readonly mode: HydraMode;
  readonly port: number;
  readonly databasePath: string;
  readonly isProduction: boolean;
  /** 64 hex chars (32 bytes). Used for encryption and decryption. */
  readonly encryptionKey: string;
  /** Older 64-hex keys, used for decryption only (key rotation). */
  readonly encryptionKeysPrevious: readonly string[];
  /** Null when /admin is disabled (unset, too short, or the .env.example placeholder). */
  readonly dashboardPassword: string | null;
  readonly revenuecat: {
    readonly projectId: string | null;
    readonly apiKey: string | null;
    readonly webhookSecret: string | null;
  };
  readonly webshareToken: string | null;
  readonly discordWebhookUrl: string | null;
  readonly expoAccessToken: string | null;
  readonly ai: {
    readonly provider: AiProvider;
    readonly groqApiKey: string | null;
    readonly openaiApiKey: string | null;
    readonly openaiBaseUrl: string | null;
    /** When set, filterPosts uses TypeSafe AI's Jev decision model instead of AI_PROVIDER's model. */
    readonly typesafeApiKey: string | null;
    /** Overrides; null means "use the registry default for the provider". */
    readonly models: {
      readonly summary: string | null;
      readonly filter: string | null;
      readonly answer: string | null;
    };
    /** Per-customer monthly cap on Pro features. Null means unlimited. */
    readonly monthlyLimitUsd: number | null;
    readonly freeDailyBudgetUsd: number;
  };
  readonly pollIntervalMs: number;
  readonly pollConcurrency: number;
  readonly logLevel: LogLevel;
  /** See src/http/clientIp.ts. */
  readonly trustProxy: TrustProxy;
  /** What was deployed. The deploy workflow sets these; otherwise they're null. */
  readonly deployment: {
    readonly commit: string | null;
    readonly commitTitle: string | null;
  };
  /** Non-fatal problems to log at boot. */
  readonly warnings: readonly string[];
}

export type Env = Record<string, string | undefined>;

/** The placeholder from .env.example. A dashboard with this password is never enabled. */
export const DASHBOARD_PASSWORD_PLACEHOLDER = "your_secure_dashboard_password";
export const DASHBOARD_PASSWORD_MIN_LENGTH = 16;

export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

const HEX_KEY = /^[0-9a-fA-F]{64}$/;

/**
 * An optional variable. Docker and compose often pass empty strings for unset
 * variables, so a blank value counts as unset; others go through `normalize`.
 */
const blank = <S extends z.ZodType>(schema: S, normalize = (v: string): string => v) =>
  z.preprocess(
    (v) => (typeof v !== "string" ? v : v.trim() === "" ? undefined : normalize(v)),
    schema.optional(),
  );

const optionalString = blank(z.string().trim());
const intInRange = (min: number, max: number) => blank(z.coerce.number().int().min(min).max(max));
const nonNegativeNumber = blank(z.coerce.number().nonnegative());

const envSchema = z.object({
  HYDRA_MODE: blank(z.enum(["official", "selfhost"])),
  IS_CUSTOM_SERVER: optionalString,
  NODE_ENV: optionalString,
  /** 0 picks a free port (tests). */
  PORT: intInRange(0, 65535),
  DATABASE_PATH: optionalString,
  ENCRYPTION_KEY: optionalString,
  ENCRYPTION_KEYS_PREVIOUS: optionalString,
  // Trimmed like every other secret: stray whitespace or a CR from a quoted
  // .env value must not turn the public placeholder into a "different" password.
  DASHBOARD_PASSWORD: optionalString,
  REVENUECAT_PROJECT_ID: optionalString,
  REVENUECAT_API_KEY: optionalString,
  REVENUECAT_WEBHOOK_SECRET: optionalString,
  WEBSHARE_TOKEN: optionalString,
  DISCORD_WEBHOOK_URL: blank(z.url({ protocol: /^https?$/ })),
  EXPO_ACCESS_TOKEN: optionalString,
  AI_PROVIDER: blank(z.enum(["groq", "openai"])),
  GROQ_API_KEY: optionalString,
  OPENAI_API_KEY: optionalString,
  OPENAI_BASE_URL: blank(z.url({ protocol: /^https?$/ })),
  TYPESAFE_AI_API_KEY: optionalString,
  AI_MODEL_SUMMARY: optionalString,
  AI_MODEL_FILTER: optionalString,
  AI_MODEL_ANSWER: optionalString,
  OPENAI_SUMMARY_MODEL: optionalString,
  OPENAI_FILTER_MODEL: optionalString,
  AI_MONTHLY_LIMIT_USD: nonNegativeNumber,
  AI_FREE_DAILY_BUDGET_USD: nonNegativeNumber,
  POLL_INTERVAL_MS: intInRange(5_000, 24 * 60 * 60 * 1000),
  POLL_CONCURRENCY: intInRange(1, 1024),
  /** "fly", "none", or the number of trusted proxies that append X-Forwarded-For. */
  TRUST_PROXY: blank(
    z.union([z.enum(["fly", "none"]), z.coerce.number().int().min(1).max(10)]),
    (v) => v.trim().toLowerCase(),
  ),
  /** Set by Fly on every machine. */
  FLY_APP_NAME: optionalString,
  /** Set by .github/workflows/deploy.yml. Free text on purpose: a bad value must never block a boot. */
  HYDRA_COMMIT: optionalString,
  HYDRA_COMMIT_TITLE: optionalString,
  LOG_LEVEL: blank(z.enum(["debug", "info", "warn", "error"]), (v) => v.toLowerCase()),
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Parses the environment once at boot. Throws a ConfigError that lists every
 * problem at once, so an operator can fix them all in one go.
 */
export function loadConfig(env: Env): Config {
  const parsed = envSchema.safeParse(env);
  const problems: string[] = [];
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(`${issue.path.join(".") || "(env)"}: ${issue.message}`);
    }
  }
  const raw = (name: string): string | undefined => {
    const value = env[name]?.trim();
    return value ? value : undefined;
  };
  const warnings: string[] = [];

  // HYDRA_MODE wins; IS_CUSTOM_SERVER=true is the v1 alias for selfhost.
  const explicitMode = raw("HYDRA_MODE");
  const mode: HydraMode =
    explicitMode === "official" || explicitMode === "selfhost"
      ? explicitMode
      : raw("IS_CUSTOM_SERVER") === "true"
        ? "selfhost"
        : "official";

  const encryptionKey = raw("ENCRYPTION_KEY");
  if (!encryptionKey) {
    problems.push("ENCRYPTION_KEY: required (64 hex chars; generate with `openssl rand -hex 32`)");
  } else if (!HEX_KEY.test(encryptionKey)) {
    problems.push("ENCRYPTION_KEY: must be exactly 64 hex characters (32 bytes)");
  }

  const previousKeys = (raw("ENCRYPTION_KEYS_PREVIOUS") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  previousKeys.forEach((key, i) => {
    if (!HEX_KEY.test(key)) {
      problems.push(`ENCRYPTION_KEYS_PREVIOUS[${i}]: must be exactly 64 hex characters (32 bytes)`);
    }
  });

  if (mode === "official") {
    if (!raw("REVENUECAT_PROJECT_ID")) {
      problems.push("REVENUECAT_PROJECT_ID: required in official mode");
    }
    if (!raw("REVENUECAT_API_KEY")) problems.push("REVENUECAT_API_KEY: required in official mode");
  }

  if (!parsed.success || problems.length > 0) throw new ConfigError(problems);
  const e = parsed.data;
  const isProduction = e.NODE_ENV === "production";

  if (mode === "official" && !e.WEBSHARE_TOKEN) {
    warnings.push("WEBSHARE_TOKEN is not set: Reddit requests go direct with no proxy");
  }

  let dashboardPassword: string | null = e.DASHBOARD_PASSWORD ?? null;
  if (dashboardPassword === null) {
    warnings.push("DASHBOARD_PASSWORD is not set: /admin is disabled");
  } else if (dashboardPassword.toLowerCase() === DASHBOARD_PASSWORD_PLACEHOLDER) {
    dashboardPassword = null;
    warnings.push("DASHBOARD_PASSWORD is the .env.example placeholder: /admin is disabled");
  } else if (dashboardPassword.length < DASHBOARD_PASSWORD_MIN_LENGTH) {
    dashboardPassword = null;
    warnings.push(
      `DASHBOARD_PASSWORD is shorter than ${DASHBOARD_PASSWORD_MIN_LENGTH} characters: /admin is disabled`,
    );
  }

  if (mode === "official" && !e.REVENUECAT_WEBHOOK_SECRET) {
    warnings.push(
      "REVENUECAT_WEBHOOK_SECRET is not set: the webhook route is disabled and entitlements reconcile hourly",
    );
  }

  // OPENAI_SUMMARY_MODEL and OPENAI_FILTER_MODEL are v1 aliases that only applied to openai.
  const legacyModels: Partial<typeof e> = e.AI_PROVIDER === "openai" ? e : {};

  const config: Config = {
    mode,
    port: e.PORT ?? 3000,
    databasePath: e.DATABASE_PATH ?? (isProduction ? "/data/sqlite.db" : "./sqlite.db"),
    isProduction,
    encryptionKey: (encryptionKey ?? "").toLowerCase(),
    encryptionKeysPrevious: previousKeys.map((k) => k.toLowerCase()),
    dashboardPassword,
    revenuecat: {
      projectId: e.REVENUECAT_PROJECT_ID ?? null,
      apiKey: e.REVENUECAT_API_KEY ?? null,
      webhookSecret: e.REVENUECAT_WEBHOOK_SECRET ?? null,
    },
    webshareToken: e.WEBSHARE_TOKEN ?? null,
    discordWebhookUrl: e.DISCORD_WEBHOOK_URL ?? null,
    expoAccessToken: e.EXPO_ACCESS_TOKEN ?? null,
    ai: {
      provider: e.AI_PROVIDER ?? "groq",
      groqApiKey: e.GROQ_API_KEY ?? null,
      openaiApiKey: e.OPENAI_API_KEY ?? null,
      openaiBaseUrl: e.OPENAI_BASE_URL ?? null,
      typesafeApiKey: e.TYPESAFE_AI_API_KEY ?? null,
      models: {
        summary: e.AI_MODEL_SUMMARY ?? legacyModels.OPENAI_SUMMARY_MODEL ?? null,
        filter: e.AI_MODEL_FILTER ?? legacyModels.OPENAI_FILTER_MODEL ?? null,
        answer: e.AI_MODEL_ANSWER ?? null,
      },
      monthlyLimitUsd: e.AI_MONTHLY_LIMIT_USD ?? (mode === "official" ? 2 : null),
      freeDailyBudgetUsd: e.AI_FREE_DAILY_BUDGET_USD ?? 5,
    },
    pollIntervalMs: e.POLL_INTERVAL_MS ?? 120_000,
    pollConcurrency: e.POLL_CONCURRENCY ?? 32,
    logLevel: e.LOG_LEVEL ?? "info",
    trustProxy: e.TRUST_PROXY ?? (e.FLY_APP_NAME ? "fly" : "none"),
    deployment: {
      commit: e.HYDRA_COMMIT ?? null,
      commitTitle: e.HYDRA_COMMIT_TITLE ?? null,
    },
    warnings,
  };
  return deepFreeze(config);
}
