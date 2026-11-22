// Cron worker: muddat eslatmalari, o'tgan vazifalar, kunlik jarima va hisobotlar.
// Supabase Cron (pg_net) yoki tashqi cron tomonidan x-worker-secret bilan chaqiriladi.
import { db } from "../_shared/db.ts";
import { env, workerSecret } from "../_shared/env.ts";
import { localDayKey, localMidnight, startOfWeek } from "../_shared/logic/period.ts";
import { aiConfig } from "../_shared/env.ts";
import { bonusTaskKeyboard } from "../_shared/ui.ts";
import { sendLeaderboardCard } from "../_shared/logic/leaderboardCard.ts";
import { esc, fmtDate, fmtPoints, truncate } from "../_shared/logic/format.ts";
import { jsonResponse } from "../_shared/runtime.ts";
import { botApi } from "../_shared/telegram.ts";
import { fill, T } from "../_shared/texts.ts";
import type { SettingsRow, UserRow } from "../_shared/types.ts";

type Action = "tick" | "daily" | "weekly" | "all";

async function sendStaff(
  settings: SettingsRow,
  text: string,
): Promise<void> {
  const tg = botApi();
  const database = db();
  if (settings.group_chat_id && settings.staff_thread_id) {
    try {
      await tg.sendMessage(Number(settings.group_chat_id), text, {
        threadId: Number(settings.staff_thread_id),
      });
      return;
    } catch (error) {
      console.error("staff topic xabari yuborilmadi", error);
    }
  }
  for (const staff of await database.staff()) {
    try {
      await tg.sendMessage(Number(staff.tg_id), text);
    } catch (error) {
      console.error("staff DM yuborilmadi", staff.id, error);
    }
  }
}

async function notifyStudent(
  settings: SettingsRow,
  student: UserRow,
  text: string,
): Promise<void> {
  const tg = botApi();
  try {
    await tg.sendMessage(Number(student.tg_id), text);
    return;
  } catch (error) {
    console.error("student DM yuborilmadi", student.id, error);
  }
  if (settings.group_chat_id && student.topic_thread_id) {
    try {
      await tg.sendMessage(Number(settings.group_chat_id), text, {
        threadId: Number(student.topic_thread_id),
      });
    } catch (error) {
      console.error("student topic xabari yuborilmadi", error);
    }
  }
}

// ------------------------------------------------------------------------- tick
async function tick(settings: SettingsRow): Promise<Record<string, number>> {
  const database = db();
  const now = new Date();
  const soon = new Date(now.getTime() + 24 * 3_600_000);

  const upcoming = await database.tasksDueBetween(now, soon);
  let reminded = 0;
  for (const task of upcoming) {
    const student = task.assigned_user_id ? await database.userById(task.assigned_user_id) : null;
    const hours = Math.max(1, Math.round((new Date(task.due_at ?? now).getTime() - now.getTime()) / 3_600_000));
    const text = fill(T.dueReminder, {
      title: esc(truncate(task.title ?? task.prompt, 50)),
      hours,
    });
    if (student) await notifyStudent(settings, student, text);
    else if (task.chat_id) {
      try {
        await botApi().sendMessage(Number(task.chat_id), text, {
          threadId: task.thread_id ?? undefined,
        });
      } catch (error) {
        console.error("eslatma yuborilmadi", task.id, error);
      }
    }
    await database.updateTask(task.id, { reminded_at: now.toISOString() });
    reminded += 1;
  }

  const overdue = await database.tasksDueBefore(now);
  const lines: string[] = [];
  let missed = 0;
  for (const task of overdue) {
    if (task.kind === "personal" && task.assigned_user_id) {
      const student = await database.userById(task.assigned_user_id);
      if (student && !(await database.hasMissedSubmission(task.id, student.id))) {
        const created = await database.createSubmission({
          task_id: task.id,
          user_id: student.id,
          chat_id: task.chat_id,
          thread_id: task.thread_id,
          content_type: "text",
          text_content: "Muddat o'tdi — javob yuborilmadi",
        });
        await database.updateSubmission(created.id, { status: "missed" });
        missed += 1;
      }
      lines.push(
        `⌛ <b>${esc(student?.full_name ?? "O'quvchi")}</b> — ` +
          `${esc(truncate(task.title ?? task.prompt, 50))} (#${task.id})`,
      );
    } else {
      await database.updateTask(task.id, { status: "closed" });
    }
  }
  if (lines.length > 0) {
    await sendStaff(
      settings,
      `⌛ <b>Muddati o'tgan vazifalar</b>\n\n${lines.join("\n")}\n\n` +
        `Yangi yetim topshiriqlar: <b>${missed}</b>. Ustoz tekshirib baho qo'yishi mumkin.`,
    );
  }

  await database.cleanup(new Date(now.getTime() - 7 * 86_400_000));
  return { reminded, missed };
}

// ------------------------------------------------------------------------ daily
function summarizeTop(
  events: { user_id: number; kind: string; points: number }[],
  students: UserRow[],
): string {
  const names = new Map(students.map((student) => [student.id, student.full_name ?? "O'quvchi"]));
  const totals = new Map<number, number>();
  for (const event of events) {
    if (event.kind === "penalty") continue;
    totals.set(event.user_id, (totals.get(event.user_id) ?? 0) + Number(event.points));
  }
  const rows = [...totals.entries()]
    .filter(([, points]) => points > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (rows.length === 0) return "—";
  return rows.map(([userId, points], index) =>
    `${index + 1}. ${esc(names.get(userId) ?? "O'quvchi")} — <b>${fmtPoints(points)}</b> ball`
  ).join("\n");
}

async function daily(settings: SettingsRow): Promise<Record<string, number | string>> {
  const database = db();
  const now = new Date();
  const dayStart = new Date(localMidnight(now, settings.tz).getTime() - 86_400_000);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const day = localDayKey(dayStart, settings.tz);

  const penalties = await database.applyDailyPenalties(day);
  const students = await database.activeStudents();
  const [submissions, events] = await Promise.all([
    database.daySubmissions(dayStart, dayEnd),
    database.pointEventsForDay(day),
  ]);
  const active = new Set(submissions.map((row) => row.user_id)).size;
  const penaltyCount = events.filter((event) => event.kind === "penalty").length;

  const report = fill(T.dailyReport, {
    date: day,
    submissions: submissions.length,
    active,
    total: students.length,
    penalties: penaltyCount,
    top: summarizeTop(events, students),
  });
  await sendStaff(settings, report);

  // Bugun topshirganlarga: "erta tugatdingiz — qo'shimcha vazifa oling".
  let nudged = 0;
  if (settings.ai_enabled && aiConfig(settings.ai_model)) {
    const submitted = new Set(submissions.map((row) => row.user_id));
    for (const student of students) {
      if (!submitted.has(student.id) || !student.dm_open) continue;
      try {
        await botApi().sendMessage(Number(student.tg_id), T.bonusNudge, { markup: bonusTaskKeyboard() });
        nudged += 1;
      } catch (error) {
        console.error("bonus eslatmasi yuborilmadi", student.id, error);
      }
      await new Promise((resolve) => setTimeout(resolve, 60)); // Telegram limitlariga hurmat
    }
  }

  return { day, penalties, submissions: submissions.length, active, nudged };
}

// ----------------------------------------------------------------------- weekly
async function weekly(settings: SettingsRow): Promise<Record<string, number>> {
  const database = db();
  const tg = botApi();
  const since = startOfWeek(new Date(), settings.tz);
  const rows = (await database.leaderboard(since)).filter((row) => Number(row.points) > 0);
  if (rows.length === 0) return { rows: 0, sent: 0 };

  const range = `${fmtDate(since.toISOString(), settings.tz)} – ${fmtDate(new Date().toISOString(), settings.tz)}`;
  const caption = fill(T.weeklyCaption, { range });
  const options = { period: "week" as const, caption, subtitle: range };

  // Reyting bo'limlari (/bolim → 🏆 Reyting); yo'q bo'lsa guruhning umumiy (General) oqimi.
  const targets: { chatId: number; threadId: number | null }[] = [];
  if (settings.group_chat_id) {
    const chatId = Number(settings.group_chat_id);
    const topics = await database.announceTopics(chatId);
    if (topics.length > 0) {
      for (const topic of topics) targets.push({ chatId, threadId: topic.thread_id || null });
    } else {
      targets.push({ chatId, threadId: null });
    }
  }

  let sent = 0;
  for (const target of targets) {
    try {
      await sendLeaderboardCard(tg, target.chatId, rows, { ...options, threadId: target.threadId });
      sent += 1;
    } catch (error) {
      console.error("haftalik reyting yuborilmadi", target, error);
    }
  }
  if (sent === 0) {
    await sendStaff(settings, fill(T.weeklyReport, { top: rows.slice(0, 10).map((row) =>
      `${row.place}. ${esc(row.full_name)} — <b>${fmtPoints(row.points)}</b>`).join("\n") }));
  }
  return { rows: rows.length, sent };
}

// --------------------------------------------------------------------------- run
export async function runAction(action: Action): Promise<Record<string, unknown>> {
  const database = db();
  const settings = await database.getSettings();
  const result: Record<string, unknown> = { action };
  if (action === "tick" || action === "all") result.tick = await tick(settings);
  if (action === "daily" || action === "all") result.daily = await daily(settings);
  if (action === "weekly" || action === "all") result.weekly = await weekly(settings);
  return result;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "GET") return jsonResponse({ ok: true, service: "ascend-academy-worker" });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);

  const secret = workerSecret();
  if (secret) {
    if (req.headers.get("x-worker-secret") !== secret) {
      return jsonResponse({ ok: false, error: "unauthorized" }, 401);
    }
  } else {
    const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceKey || req.headers.get("authorization") !== `Bearer ${serviceKey}`) {
      return jsonResponse({ ok: false, error: "worker_secret_required" }, 401);
    }
  }

  let body: { action?: string } = {};
  try {
    body = await req.json() as { action?: string };
  } catch {
    body = {};
  }
  const action = body.action === "daily" || body.action === "weekly" || body.action === "all"
    ? body.action
    : "tick";

  try {
    const result = await runAction(action);
    return jsonResponse({ ok: true, result });
  } catch (error) {
    console.error("worker xatosi", error);
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : "unknown",
    }, 500);
  }
});
