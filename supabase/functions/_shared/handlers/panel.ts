import { clearState, reply, setState, stateData, type AppContext } from "../context.ts";
import { esc, fmtPoints, truncate } from "../logic/format.ts";
import { fill, T, TASK_KIND_LABEL } from "../texts.ts";
import { panelKeyboard, settingsKeyboard, topicsListKeyboard } from "../ui.ts";
import { fmtDateTime } from "../logic/format.ts";
import type { TgReplyMarkup, UserRow } from "../types.ts";

const STATUS_ICON: Record<string, string> = {
  pending: "⏳",
  ai_graded: "🤖",
  manual: "👨‍🏫",
  graded: "✅",
  missed: "⌛",
  rejected: "❌",
};

export async function renderResults(ctx: AppContext, user: UserRow): Promise<string> {
  const rows = await ctx.db.leaderboard(null);
  const mine = rows.find((row) => Number(row.tg_id) === Number(user.tg_id));
  const submissions = await ctx.db.userSubmissions(user.id, 6);
  const lines = [T.myResultsTitle, ""];

  if (mine) {
    lines.push(
      `🏅 Jami ball: <b>${fmtPoints(mine.points)}</b>`,
      `🎯 O'rin: <b>${mine.place}/${rows.length}</b>`,
      `📌 Vazifalar: <b>${mine.tasks_done}</b> · 📖 Self study: <b>${mine.self_study_done}</b>` +
        ` · 🤖 Bot: <b>${mine.bot_tasks_done}</b>`,
    );
    if (mine.penalties > 0) lines.push(`⚠️ Jarima: <b>${mine.penalties}</b> kun`);
  } else {
    lines.push("Hali ball yo'q — birinchi vazifani bajaring!");
  }

  if (submissions.length > 0) {
    lines.push("", "🕘 <b>Oxirgi topshiriqlar</b>");
    for (const submission of submissions) {
      const task = await ctx.db.taskById(submission.task_id);
      const score = submission.final_score ?? submission.ai_score;
      lines.push(
        `${STATUS_ICON[submission.status] ?? "•"} ${esc(truncate(task?.title ?? "Vazifa", 32))}` +
          ` · ${score === null ? "—" : `${fmtPoints(score)}/10`}`,
      );
    }
  }
  return lines.join("\n");
}

export async function renderMyTasks(ctx: AppContext, user: UserRow): Promise<string> {
  const tasks = await ctx.db.activeTasksForStudent(user);
  if (tasks.length === 0) return `${T.tasksTitle}\n\n${T.tasksEmpty}`;
  const points = await ctx.db.pointsByTask(user.id, tasks.map((task) => task.id));
  const lines = [T.tasksTitle, ""];
  for (const task of tasks.slice(0, 12)) {
    const done = points.has(task.id);
    const icon = done ? "✅" : task.kind === "self_study" ? "📖" : task.kind === "bot" ? "🤖" : "🔓";
    const value = done
      ? `+${fmtPoints(points.get(task.id))} ball`
      : task.kind === "self_study"
      ? `+${fmtPoints(ctx.settings.self_study_points)} ball`
      : task.kind === "bot"
      ? `+${fmtPoints(ctx.settings.bot_task_points)} ball`
      : "0.5–10 ball";
    lines.push(
      `${icon} <b>#${task.id}</b> · ${TASK_KIND_LABEL[task.kind]} — ${esc(truncate(task.title ?? task.prompt, 40))}`,
      `   ${value}`,
    );
  }
  lines.push("", "✍️ Javobni guruhdagi vazifa xabariga reply qilib yuboring.");
  return lines.join("\n");
}

export async function openPanel(ctx: AppContext): Promise<void> {
  if (!ctx.isTeacher) {
    await reply(ctx, T.onlyStaff);
    return;
  }
  await clearState(ctx);
  await reply(ctx, T.panelTitle, { markup: panelKeyboard() });
}

export async function panelSection(
  ctx: AppContext,
  section: string,
): Promise<{ text: string; markup: TgReplyMarkup }> {
  if (section === "pending") {
    const users = await ctx.db.pendingUsers();
    if (users.length === 0) return { text: T.panelPendingEmpty, markup: panelKeyboard() };
    const rows = [];
    const lines = ["👥 <b>Yangi so'rovlar</b>", ""];
    for (const user of users.slice(0, 8)) {
      lines.push(
        `👤 <b>${esc(user.full_name ?? "—")}</b> · ${esc(user.group_name ?? "—")}`,
        `📞 ${esc(user.phone ?? "—")} · #${user.id}`,
      );
      rows.push([{ text: `✅ ${truncate(user.full_name ?? "O'quvchi", 20)}`, callback_data: `ap:${user.id}` }]);
    }
    return { text: lines.join("\n"), markup: { inline_keyboard: [...rows, [{ text: "⬅️ Panel", callback_data: "p:root" }]] } };
  }

  if (section === "queue") {
    const queue = await ctx.db.manualQueue(6);
    if (queue.length === 0) return { text: T.panelQueueEmpty, markup: panelKeyboard() };
    const lines = ["⏳ <b>Tekshirish navbati</b>", ""];
    const rows = [];
    for (const submission of queue) {
      const student = await ctx.db.userById(submission.user_id);
      const task = await ctx.db.taskById(submission.task_id);
      lines.push(
        `#${submission.id} · <b>${esc(student?.full_name ?? "O'quvchi")}</b>` +
          ` · ${esc(truncate(task?.title ?? "Vazifa", 30))}` +
          (submission.ai_score !== null ? ` · AI ${fmtPoints(submission.ai_score)}` : ""),
      );
      rows.push([{ text: `Baholash #${submission.id}`, callback_data: `g:${submission.id}:ask` }]);
    }
    return { text: lines.join("\n"), markup: { inline_keyboard: [...rows, [{ text: "⬅️ Panel", callback_data: "p:root" }]] } };
  }

  if (section === "students") {
    const students = await ctx.db.activeStudents();
    if (students.length === 0) return { text: T.panelStudentsEmpty, markup: panelKeyboard() };
    const rows = await ctx.db.leaderboard(null);
    const byId = new Map(rows.map((row) => [Number(row.user_id), row]));
    const lines = [fill(T.panelStudents, {
      count: students.length,
      list: students.slice(0, 40).map((student) => {
        const stat = byId.get(student.id);
        return `👤 ${esc(truncate(student.full_name ?? "—", 24))} · ${esc(student.group_name ?? "—")}` +
          ` · <b>${fmtPoints(stat?.points ?? 0)}</b> ball`;
      }).join("\n"),
    })];
    return { text: lines.join("\n"), markup: panelKeyboard() };
  }

  if (section === "tasks") {
    const tasks = await ctx.db.activeTasks(10);
    if (tasks.length === 0) return { text: T.panelTasksEmpty, markup: panelKeyboard() };
    const lines = [fill(T.panelTasks, {
      list: tasks.slice(0, 10).map((task) =>
        `#${task.id} · ${TASK_KIND_LABEL[task.kind]} · ${esc(truncate(task.title ?? task.prompt, 34))}`
      ).join("\n"),
    })];
    const rows = tasks.slice(0, 6).map((task) => [{
      text: `🔒 Yopish #${task.id}`,
      callback_data: `t:close:${task.id}`,
    }]);
    return { text: lines.join("\n"), markup: { inline_keyboard: [...rows, [{ text: "⬅️ Panel", callback_data: "p:root" }]] } };
  }

  if (section === "topics") {
    const chatId = ctx.settings.group_chat_id;
    const topics = chatId ? await ctx.db.topicsOfChat(Number(chatId)) : [];
    if (topics.length === 0) return { text: T.topicsEmpty, markup: panelKeyboard() };
    const base = topicsListKeyboard(topics);
    return {
      text: T.topicsListTitle,
      markup: { inline_keyboard: [...(base.inline_keyboard ?? []), [{ text: "⬅️ Panel", callback_data: "p:root" }]] },
    };
  }

  if (section === "feedback") {
    const items = await ctx.db.recentFeedback(8);
    if (items.length === 0) return { text: T.feedbackEmpty, markup: panelKeyboard() };
    const list = items.map((item) =>
      `• <b>${esc(item.author ?? "—")}</b> · ${fmtDateTime(item.created_at, ctx.settings.tz)}\n${esc(truncate(item.text, 300))}`
    ).join("\n\n");
    return {
      text: fill(T.feedbackListTitle, { list }),
      markup: { inline_keyboard: [[{ text: "⬅️ Panel", callback_data: "p:root" }]] },
    };
  }

  if (section === "stats") {
    const [students, pending, queue, tasks, todaySubmissions] = await Promise.all([
      ctx.db.activeStudents(),
      ctx.db.pendingUsers(),
      ctx.db.manualQueue(50),
      ctx.db.activeTaskCount(),
      ctx.db.daySubmissions(new Date(Date.now() - 86_400_000), new Date()),
    ]);
    return {
      text: fill(T.panelStats, {
        students: students.length,
        pending: pending.length,
        queue: queue.length,
        tasks,
        today: todaySubmissions.length,
      }),
      markup: panelKeyboard(),
    };
  }

  if (section === "settings") {
    const settings = ctx.settings;
    return {
      text: fill(T.panelSettings, {
        code: esc(settings.invite_code ?? "—"),
        self: fmtPoints(settings.self_study_points),
        bot: fmtPoints(settings.bot_task_points),
        penalty: fmtPoints(settings.daily_penalty),
        limit: settings.bot_tasks_per_day,
        tz: esc(settings.tz),
      }),
      markup: settingsKeyboard(),
    };
  }

  return { text: T.panelTitle, markup: panelKeyboard() };
}

const SETTING_FIELDS: Record<string, { label: string; parse: (raw: string) => number | string | null }> = {
  invite: {
    label: "O'quv kodi",
    parse: (raw) => (raw.length >= 3 && raw.length <= 40 ? raw.trim() : null),
  },
  self: {
    label: "Self study balli",
    parse: (raw) => {
      const value = Number(raw.replace(",", "."));
      return Number.isFinite(value) && value >= 0 && value <= 50 ? value : null;
    },
  },
  bot: {
    label: "Bot vazifa balli",
    parse: (raw) => {
      const value = Number(raw.replace(",", "."));
      return Number.isFinite(value) && value >= 0 && value <= 50 ? value : null;
    },
  },
  penalty: {
    label: "Kunlik jarima",
    parse: (raw) => {
      const value = Number(raw.replace(",", "."));
      return Number.isFinite(value) && value >= 0 && value <= 50 ? value : null;
    },
  },
  limit: {
    label: "Kunlik bot vazifalari",
    parse: (raw) => {
      const value = Number(raw);
      return Number.isInteger(value) && value >= 0 && value <= 20 ? value : null;
    },
  },
};

export async function startSettingEdit(ctx: AppContext, field: string): Promise<string | null> {
  const config = SETTING_FIELDS[field];
  if (!config) return null;
  await setState(ctx, "set_value", { field });
  return `${config.label} — ${T.askValue}`;
}

export async function saveSettingValue(ctx: AppContext, raw: string): Promise<void> {
  if (!ctx.isTeacher) return;
  const field = String(stateData(ctx).field ?? "");
  const config = SETTING_FIELDS[field];
  if (!config) {
    await clearState(ctx);
    return;
  }
  const value = config.parse(raw);
  if (value === null) {
    await reply(ctx, T.valueBad);
    return;
  }
  const map: Record<string, string> = {
    invite: "invite_code",
    self: "self_study_points",
    bot: "bot_task_points",
    penalty: "daily_penalty",
    limit: "bot_tasks_per_day",
  };
  const patch: Record<string, unknown> = { [map[field]]: value };
  await ctx.db.updateSettings(patch);
  await clearState(ctx);
  await reply(ctx, T.valueSaved);
}

export async function startBroadcast(ctx: AppContext): Promise<void> {
  if (ctx.isGroup) {
    await reply(ctx, T.onlyPrivate);
    return;
  }
  await setState(ctx, "broadcast");
  await reply(ctx, T.broadcastAsk);
}

export async function sendBroadcast(ctx: AppContext, text: string): Promise<void> {
  if (!ctx.isTeacher) return;
  if (text.trim() === "/bekor") {
    await clearState(ctx);
    await reply(ctx, T.cancelled);
    return;
  }
  await clearState(ctx);
  const students = await ctx.db.activeStudents();
  let sent = 0;
  for (const student of students) {
    try {
      await ctx.tg.sendMessage(Number(student.tg_id), text);
      sent += 1;
    } catch (error) {
      console.error("broadcast yuborilmadi", student.id, error);
    }
  }
  await reply(ctx, fill(T.broadcastDone, { sent, total: students.length }));
}

