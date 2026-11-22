import { assertEquals } from "jsr:@std/assert@1";
import { clampScore, parseTeacherScore } from "../functions/_shared/logic/points.ts";
import { decideGrade } from "../functions/_shared/logic/decide.ts";
import {
  localDayKey,
  localMidnight,
  parsePeriod,
  periodSince,
  startOfWeek,
} from "../functions/_shared/logic/period.ts";
import { guessTopicKind, routeThread } from "../functions/_shared/logic/routing.ts";
import { parseDue, splitAnswerKey } from "../functions/_shared/logic/taskParse.ts";
import { esc, fmtPoints, truncate } from "../functions/_shared/logic/format.ts";
import { renderLeaderboard } from "../functions/_shared/logic/leaderboard.ts";
import { parseAdminTgIds } from "../functions/_shared/env.ts";
import { pendingUserKeyboard, startKeyboard } from "../functions/_shared/ui.ts";
import type { LeaderboardRow, SettingsRow } from "../functions/_shared/types.ts";

const settings = {
  group_chat_id: 100,
  tasks_thread_id: 5,
  self_study_thread_id: 6,
  staff_thread_id: 7,
  questions_thread_id: 8,
} satisfies Pick<
  SettingsRow,
  | "group_chat_id"
  | "tasks_thread_id"
  | "self_study_thread_id"
  | "staff_thread_id"
  | "questions_thread_id"
>;

const pointsSettings = { self_study_points: 2, bot_task_points: 3 };

Deno.test("admin Telegram ID lar vergul yoki bo'shliq bilan ajratiladi", () => {
  assertEquals(parseAdminTgIds(" 123456789, 987654321\n123456789, 0, -4, x"), [
    123456789,
    987654321,
  ]);
  assertEquals(parseAdminTgIds(undefined), []);
});

Deno.test("start va kutayotgan ariza menyularida foydali amallar bor", () => {
  const startButtons = startKeyboard().keyboard?.flat().map((button) => button.text);
  assertEquals(startButtons?.includes("🎯 Kunlik vazifa"), true);
  assertEquals(startButtons?.includes("🏆 Reyting"), true);
  assertEquals(startButtons?.includes("📖 Qanday ishlatiladi"), true);

  const pendingButtons = pendingUserKeyboard().keyboard?.flat().map((button) => button.text);
  assertEquals(pendingButtons?.includes("📨 Ariza holati"), true);
  assertEquals(pendingButtons?.includes("🔑 Kod bilan kirish"), true);
  assertEquals(pendingButtons?.includes("📖 Qanday ishlatiladi"), true);
  assertEquals(pendingButtons?.includes("📝 Ro'yxatdan o'tish"), false);
});

Deno.test("clampScore 0.5–10 oralig'ida, 0.5 qadam bilan", () => {
  assertEquals(clampScore(0), 0.5);
  assertEquals(clampScore(11), 10);
  assertEquals(clampScore(7.2), 7);
  assertEquals(clampScore(7.26), 7.5);
  assertEquals(clampScore("8,5"), 8.5);
  assertEquals(clampScore("abc"), 0.5);
});

Deno.test("parseTeacherScore noto'g'ri bahoni rad etadi", () => {
  assertEquals(parseTeacherScore("8"), 8);
  assertEquals(parseTeacherScore("7.5"), 7.5);
  assertEquals(parseTeacherScore("8,5"), 8.5);
  assertEquals(parseTeacherScore("0.3"), null);
  assertEquals(parseTeacherScore("12"), null);
  assertEquals(parseTeacherScore("yaxshi"), null);
});

Deno.test("self study va bot vazifasi qat'iy ball beradi", () => {
  assertEquals(
    decideGrade({
      kind: "self_study",
      score: 9,
      confidence: 0.9,
      done: true,
      settings: pointsSettings,
    }),
    { type: "fixed", points: 2, finalScore: 9, awarded: true, status: "graded" },
  );
  assertEquals(
    decideGrade({
      kind: "bot",
      score: 6,
      confidence: 0.8,
      done: true,
      settings: pointsSettings,
    }).type,
    "fixed",
  );
  assertEquals(
    decideGrade({
      kind: "self_study",
      score: 5,
      confidence: 0.9,
      done: false,
      settings: pointsSettings,
    }),
    { type: "fixed", points: 0, finalScore: 5, awarded: false, status: "graded" },
  );
});

Deno.test("oddiy vazifa AI bahosini oladi, ishonch past bo'lsa ustozga ketadi", () => {
  assertEquals(
    decideGrade({
      kind: "class",
      score: 8,
      confidence: 0.9,
      done: true,
      settings: pointsSettings,
    }),
    { type: "auto", points: 8, finalScore: 8, status: "ai_graded" },
  );
  assertEquals(
    decideGrade({
      kind: "personal",
      score: 7,
      confidence: 0.3,
      done: true,
      settings: pointsSettings,
    }),
    { type: "manual", reason: "low_confidence" },
  );
  assertEquals(
    decideGrade({
      kind: "class",
      score: 0.1,
      confidence: 0.95,
      done: false,
      settings: pointsSettings,
    }),
    { type: "auto", points: 0.5, finalScore: 0.5, status: "ai_graded" },
  );
  assertEquals(
    decideGrade({
      kind: "class",
      score: 9,
      confidence: 0.9,
      done: true,
      settings: pointsSettings,
      pointsMode: "fixed",
      fixedPoints: 5,
    }),
    { type: "fixed", points: 5, finalScore: 9, awarded: true, status: "graded" },
  );
});

Deno.test("vaqt mintaqasi: Toshkent kuni va hafta boshi", () => {
  const evening = new Date("2026-03-01T20:00:00Z"); // 02-mart 01:00 Toshkent
  assertEquals(localDayKey(evening, "Asia/Tashkent"), "2026-03-02");

  const wednesday = new Date("2026-03-04T09:00:00Z");
  const monday = startOfWeek(wednesday, "Asia/Tashkent");
  assertEquals(localDayKey(monday, "Asia/Tashkent"), "2026-03-02");
  assertEquals(monday.getTime() < wednesday.getTime(), true);

  const midnight = localMidnight(wednesday, "Asia/Tashkent");
  assertEquals(localDayKey(midnight, "Asia/Tashkent"), "2026-03-04");
  assertEquals(localDayKey(periodSince("week", wednesday, "Asia/Tashkent")!, "Asia/Tashkent"), "2026-03-02");
  assertEquals(periodSince("all", wednesday, "Asia/Tashkent"), null);
  assertEquals(parsePeriod("month"), "month");
  assertEquals(parsePeriod("nonsense"), "all");
});

Deno.test("mavzu yo'naltirish: vazifalar, self study, savollar, o'quvchi mavzusi", () => {
  assertEquals(routeThread({ chatId: 100, threadId: 5, settings }), { type: "tasks", track: null });
  assertEquals(routeThread({ chatId: 100, threadId: 6, settings }), { type: "self_study" });
  assertEquals(routeThread({ chatId: 100, threadId: 7, settings }), { type: "staff" });
  assertEquals(routeThread({ chatId: 100, threadId: 8, settings }), { type: "questions" });
  assertEquals(routeThread({ chatId: 100, threadId: 99, settings }), { type: "unknown_topic" });
  assertEquals(routeThread({ chatId: 555, threadId: 5, settings }), { type: "not_group" });
  assertEquals(
    routeThread({
      chatId: 100,
      threadId: 42,
      settings,
      student: { userId: 3, tgId: 900 },
    }),
    { type: "student", userId: 3, tgId: 900 },
  );
  assertEquals(guessTopicKind("📖 Self study"), "self_study");
  assertEquals(guessTopicKind("❓ Savollar"), "questions");
  assertEquals(guessTopicKind("Ali Valiyev"), null);
});

Deno.test("vazifa matnidan javob kalitini ajratish", () => {
  assertEquals(splitAnswerKey("Quyidagini tarjima qiling.\nJavob: I go to school"), {
    prompt: "Quyidagini tarjima qiling.",
    answerKey: "I go to school",
  });
  assertEquals(splitAnswerKey("Faqat matn"), { prompt: "Faqat matn", answerKey: null });
});

Deno.test("muddat: kunlar va ISO sana", () => {
  const now = new Date("2026-11-15T10:00:00Z");
  assertEquals(parseDue("2", now)?.toISOString(), "2026-11-17T10:00:00.000Z");
  assertEquals(parseDue("0", now), null);
  assertEquals(parseDue("abc", now), null);
  assertEquals(parseDue("2026-11-20")?.toISOString(), "2026-11-20T15:00:00.000Z");
});

Deno.test("matn formatlash va HTML escape", () => {
  assertEquals(esc("<b>&"), "&lt;b&gt;&amp;");
  assertEquals(truncate("a".repeat(30), 10).length, 10);
  assertEquals(fmtPoints(2), "2");
  assertEquals(fmtPoints(7.5), "7.5");
  assertEquals(fmtPoints("bad"), "0");
});

Deno.test("leaderboard: top, guruhlar va o'z o'rni", () => {
  const rows: LeaderboardRow[] = [
    {
      user_id: 1,
      tg_id: 101,
      full_name: "Ali",
      group_name: "IELTS-1",
      points: 42,
      tasks_done: 5,
      self_study_done: 3,
      bot_tasks_done: 2,
      penalties: 1,
      place: 1,
    },
    {
      user_id: 2,
      tg_id: 102,
      full_name: "Muhayyo",
      group_name: "IELTS-1",
      points: 30,
      tasks_done: 4,
      self_study_done: 1,
      bot_tasks_done: 0,
      penalties: 0,
      place: 2,
    },
  ];
  const text = renderLeaderboard(rows, "week", 102);
  assertEquals(text.includes("Ali"), true);
  assertEquals(text.includes("shu hafta"), true);
  assertEquals(text.includes("Guruhlar"), true);
  assertEquals(text.includes("2/2"), true);
  assertEquals(renderLeaderboard([], "all").includes("Hali natijalar yo'q"), true);
});

Deno.test("bo'lim turi bo'yicha routing (topics jadvali)", () => {
  const base = { chatId: 100, settings };
  assertEquals(
    routeThread({ ...base, threadId: 9, topic: { type: "task", track: null } }).type,
    "tasks",
  );
  assertEquals(
    routeThread({ ...base, threadId: 9, topic: { type: "task", track: "self_study" } }).type,
    "self_study",
  );
  assertEquals(
    routeThread({ ...base, threadId: 9, topic: { type: "questions", track: null } }).type,
    "questions",
  );
  assertEquals(
    routeThread({ ...base, threadId: 9, topic: { type: "ignore", track: null } }).type,
    "ignored",
  );
  assertEquals(
    routeThread({
      ...base,
      threadId: 9,
      topic: { type: "ignore", track: null },
      student: { userId: 7, tgId: 700 },
    }).type,
    "student",
  );
});
