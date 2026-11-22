import type { SettingsRow, TaskKind } from "../types.ts";

export const MIN_SCORE = 0.5;
export const MAX_SCORE = 10;

/** 0.5 qadam bilan 0.5–10 oralig'iga keltiradi. */
export function clampScore(value: unknown): number {
  const n = typeof value === "string" ? Number(value.replace(",", ".")) : Number(value);
  if (!Number.isFinite(n)) return MIN_SCORE;
  const clamped = Math.min(MAX_SCORE, Math.max(MIN_SCORE, n));
  return Math.round(clamped * 2) / 2;
}

/** Ustoz kiritgan bahoni qat'iy tekshiradi; noto'g'ri bo'lsa null. */
export function parseTeacherScore(text: string): number | null {
  const match = text.replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < MIN_SCORE || n > MAX_SCORE) return null;
  return Math.round(n * 2) / 2;
}

export function pointsKindForTask(kind: TaskKind): "task" | "self_study" | "bot_task" {
  if (kind === "self_study") return "self_study";
  if (kind === "bot") return "bot_task";
  return "task";
}

export function fixedPointsFor(
  kind: TaskKind,
  settings: Pick<SettingsRow, "self_study_points" | "bot_task_points">,
): number {
  if (kind === "self_study") return Number(settings.self_study_points);
  if (kind === "bot") return Number(settings.bot_task_points);
  return 0;
}

/** AI "bajardi" deganda self-study/bot vazifasi uchun ball beriladi. */
export function qualifiesForFixedPoints(done: boolean, score: number): boolean {
  return done && score >= MIN_SCORE;
}
