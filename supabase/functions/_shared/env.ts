export function env(name: string): string | undefined {
  const value = Deno.env.get(name);
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function requireEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`${name} sozlanmagan (Supabase secrets ga qo'shing).`);
  return value;
}

export function parseAdminTgIds(value: string | undefined): number[] {
  if (!value) return [];
  return [
    ...new Set(
      value.split(/[,\s]+/)
        .map((part) => Number(part))
        .filter((id) => Number.isSafeInteger(id) && id > 0),
    ),
  ];
}

export function adminTgIds(): number[] {
  // Support the current name and common names used by older deployments.
  return parseAdminTgIds(
    env("ADMIN_TELEGRAM_IDS") ?? env("ADMIN_TELEGRAM_ID") ?? env("ADMIN_IDS") ??
      env("ADMIN_ID"),
  );
}

export interface AiConfig {
  provider: "gemini" | "openai";
  apiKey: string;
  model: string;
  baseUrl: string;
}

export function aiConfig(settingsModel?: string | null): AiConfig | null {
  const apiKey = env("AI_API_KEY");
  if (!apiKey) return null;
  const provider = (env("AI_PROVIDER") ?? "gemini").toLowerCase() === "openai"
    ? "openai"
    : "gemini";
  const model = settingsModel?.trim() ||
    env("AI_MODEL") ||
    (provider === "gemini" ? "gemini-flash-latest" : "gpt-4o-mini");
  return {
    provider,
    apiKey,
    model,
    baseUrl: (env("AI_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
  };
}

export function webhookSecret(): string | undefined {
  return env("TELEGRAM_WEBHOOK_SECRET");
}

export function workerSecret(): string | undefined {
  return env("WORKER_SECRET");
}
