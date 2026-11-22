import type { SettingsRow, TaskKind } from "../types.ts";
import { clampScore, fixedPointsFor, qualifiesForFixedPoints } from "./points.ts";

/** AI bahosiga avtomatik ishonish uchun minimal ishonch darajasi. */
export const MIN_AUTO_CONFIDENCE = 0.55;

export type GradeDecision =
  | { type: "auto"; points: number; finalScore: number; status: "ai_graded" }
  | {
    type: "fixed";
    points: number;
    finalScore: number;
    awarded: boolean;
    status: "graded";
  }
  | { type: "manual"; reason: "low_confidence" | "ai_failed" | "unsupported_media" | "no_ai" };

/**
 * AI natijasini ballga aylantiradi.
 * - self study / bot vazifa: bajarilgan bo'lsa qat'iy ball (+2 / +3).
 * - oddiy vazifa: 0.5–10 oralig'ida baho; ishonch past bo'lsa ustozga yuboriladi.
 */
export function decideGrade(input: {
  kind: TaskKind;
  score: number;
  confidence: number;
  done: boolean;
  settings: Pick<SettingsRow, "self_study_points" | "bot_task_points">;
  minConfidence?: number;
  pointsMode?: "graded" | "fixed";
  fixedPoints?: number | null;
}): GradeDecision {
  const minConfidence = input.minConfidence ?? MIN_AUTO_CONFIDENCE;
  const score = clampScore(input.score);

  if (input.kind === "self_study" || input.kind === "bot") {
    const awarded = qualifiesForFixedPoints(input.done, score);
    return {
      type: "fixed",
      points: awarded ? fixedPointsFor(input.kind, input.settings) : 0,
      finalScore: score,
      awarded,
      status: "graded",
    };
  }

  if (input.pointsMode === "fixed" && input.fixedPoints && input.fixedPoints > 0) {
    const awarded = qualifiesForFixedPoints(input.done, score);
    return {
      type: "fixed",
      points: awarded ? Number(input.fixedPoints) : 0,
      finalScore: score,
      awarded,
      status: "graded",
    };
  }

  if (!Number.isFinite(input.confidence) || input.confidence < minConfidence) {
    return { type: "manual", reason: "low_confidence" };
  }

  return { type: "auto", points: score, finalScore: score, status: "ai_graded" };
}

/** Kunlik jarima faqat o'sha kuni hech qanday vazifa topshirilmasa qo'llanadi. */
export function needsDailyPenalty(input: {
  hasTasksThatDay: boolean;
  submittedThatDay: boolean;
}): boolean {
  return input.hasTasksThatDay && !input.submittedThatDay;
}
