import { generateDailyTask, AiError } from "../ai.ts";
import { aiConfig } from "../env.ts";
import {
  bumpBotTaskCounter,
  clearState,
  freshCounters,
  notifyStaff,
  reply,
  setState,
  type AppContext,
} from "../context.ts";
import { esc, fmtPoints } from "../logic/format.ts";
import { renderLeaderboard } from "../logic/leaderboard.ts";
import { sendLeaderboardCard } from "../logic/leaderboardCard.ts";
import { startOfWeek } from "../logic/period.ts";
import { BTN, fill, T } from "../texts.ts";
import { mainMenu, pendingUserKeyboard, periodKeyboard, startKeyboard } from "../ui.ts";
import type { UserRow } from "../types.ts";
import { commandArgs, isCommand } from "../telegram.ts";
import { answerQuestion } from "./aiTutor.ts";
import { startTour } from "./tour.ts";
import {
  beginRegistration,
  ensureUser,
  handleRegistration,
  startRegistration,
} from "./onboarding.ts";
import {
  openPanel,
  panelSection,
  renderMyTasks,
  renderResults,
  saveSettingValue,
  sendBroadcast,
  startBroadcast,
  startSettingEdit,
} from "./panel.ts";
import { handleSubmission } from "./submissions.ts";

export async function sendDailyTask(ctx: AppContext, user: UserRow): Promise<void> {
  const teacherTask = await ctx.db.answerableTask(user.id, ["personal", "class", "self_study"]);
  if (teacherTask) {
    await reply(ctx, "Avval ustoz bergan vazifani topshirib, so'ng botdan kunlik vazifa olishingiz mumkin.");
    return;
  }
  if (!ctx.settings.ai_enabled) {
    await reply(ctx, T.aiOff);
    return;
  }
  if (!aiConfig(ctx.settings.ai_model)) {
    await reply(ctx, T.dailyNoAi);
    return;
  }
  const fresh = await freshCounters(ctx, user);
  if (fresh.bot_tasks_count >= ctx.settings.bot_tasks_per_day) {
    await reply(ctx, fill(T.dailyLimit, { limit: ctx.settings.bot_tasks_per_day }));
    return;
  }

  const placeholder = await reply(ctx, T.dailyGenerating);
  let generated;
  try {
    generated = await generateDailyTask({
      recentPrompts: await ctx.db.recentPrompts(6),
      studentName: user.full_name ?? "O'quvchi",
      settingsModel: ctx.settings.ai_model,
    });
  } catch (error) {
    console.error("kunlik vazifa yaratilmadi", error instanceof AiError ? error.reason : error);
    await ctx.tg.editMessage(ctx.chatId, placeholder, T.dailyFailed);
    return;
  }

  const inTopic = Boolean(ctx.settings.group_chat_id && user.topic_thread_id);
  const targetChat = inTopic ? Number(ctx.settings.group_chat_id) : ctx.chatId;
  const threadId = inTopic ? Number(user.topic_thread_id) : null;

  const task = await ctx.db.createTask({
    kind: "bot",
    prompt: generated.prompt,
    title: generated.prompt.slice(0, 60),
    answer_key: generated.answerKey,
    criteria: generated.criteria,
    chat_id: targetChat,
    thread_id: threadId,
    assigned_user_id: user.id,
    points_mode: "fixed",
    fixed_points: ctx.settings.bot_task_points,
    due_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
  });

  const text = fill(T.dailyCreated, {
    id: task.id,
    points: fmtPoints(ctx.settings.bot_task_points),
  }) + `\n\n${esc(generated.prompt)}`;

  try {
    if (inTopic) {
      const messageId = await ctx.tg.sendMessage(targetChat, text, {
        threadId: threadId ?? undefined,
        replyTo: undefined,
      });
      await ctx.db.updateTask(task.id, { message_id: messageId });
      await ctx.tg.editMessage(
        ctx.chatId,
        placeholder,
        `✅ Kunlik vazifa shaxsiy mavzuingizga yuborildi. Javobni o'sha yerda vazifaga reply qilib yuboring.`,
      );
    } else {
      const messageId = await ctx.tg.sendMessage(ctx.chatId, text, {
        markup: undefined,
      });
      await ctx.db.updateTask(task.id, { message_id: messageId });
      await ctx.tg.deleteMessage(ctx.chatId, placeholder).catch(() => undefined);
    }
  } catch (error) {
    console.error("kunlik vazifa yuborilmadi", error);
    await ctx.tg.editMessage(ctx.chatId, placeholder, T.dailyFailed);
    return;
  }

  await bumpBotTaskCounter(ctx, fresh);
}

async function addTeacher(ctx: AppContext, raw: string): Promise<void> {
  if (!ctx.isAdmin) {
    await reply(ctx, T.onlyStaff);
    return;
  }
  const idText = raw.replace(/^@/, "").trim();
  if (!idText) {
    await reply(ctx, "/ustoz <telegram_id yoki @username>");
    return;
  }
  const target = /^\d{5,}$/.test(idText)
    ? await ctx.db.userByTg(Number(idText))
    : await ctx.db.userByUsername(idText);
  if (!target) {
    await reply(ctx, T.teacherNotFound);
    return;
  }
  await ctx.db.updateUser(target.id, { role: "teacher", status: "active" });
  await reply(ctx, fill(T.newTeacher, { name: esc(target.full_name ?? "—") }));
  try {
    await ctx.tg.sendMessage(Number(target.tg_id), T.teacherAdded);
  } catch (error) {
    console.error("ustozga xabar yuborilmadi", error);
  }
}

async function showLeaderboard(ctx: AppContext, period: string): Promise<void> {
  const since = period === "week"
    ? new Date(Date.now() - 7 * 86_400_000)
    : period === "month"
    ? new Date(Date.now() - 30 * 86_400_000)
    : null;
  const rows = await ctx.db.leaderboard(since, ctx.user?.group_name ?? null);
  const normalized = period === "week" ? "week" : period === "month" ? "month" : "all";
  const text = renderLeaderboard(rows, normalized, ctx.sender.id);
  await reply(ctx, text, { markup: periodKeyboard(normalized) });
}

/** /ustoz_taklif — ustoz uchun bir martalik havola (2 kun). */
async function createTeacherInvite(ctx: AppContext): Promise<void> {
  if (!ctx.isAdmin) {
    await reply(ctx, T.onlyAdmin);
    return;
  }
  const code = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await ctx.db.createInvite({
    code,
    role: "teacher",
    createdBy: ctx.user?.id ?? null,
    days: 2,
  });
  let link = `/start t_${code}`;
  try {
    const me = await ctx.tg.getMe();
    if (me.username) link = `https://t.me/${me.username}?start=t_${code}`;
  } catch (error) {
    console.error("getMe xatosi", error);
  }
  await reply(ctx, fill(T.inviteCreated, { link }));
}

/** Taklif havolasi orqali ustoz bo'lish (rol hech qachon pasaytirilmaydi). */
async function redeemTeacherInvite(ctx: AppContext, code: string): Promise<void> {
  const user = await ensureUser(ctx);
  const invite = await ctx.db.redeemInvite(code, ctx.sender.id);
  if (!invite) {
    await reply(ctx, T.inviteInvalid);
    return;
  }
  if (user.role !== "admin") {
    ctx.user = await ctx.db.updateUser(user.id, {
      role: invite.role === "admin" ? "admin" : "teacher",
      status: "active",
    });
    ctx.isTeacher = true;
    ctx.isAdmin = ctx.user.role === "admin";
  }
  await reply(ctx, T.inviteUsed, { markup: mainMenu(true) });
}

async function handlePrivateCommand(ctx: AppContext, text: string, user: UserRow): Promise<boolean> {
  if (text === BTN.tasks || isCommand(text, "/vazifalarim")) {
    await reply(ctx, await renderMyTasks(ctx, user), { markup: mainMenu(ctx.isTeacher) });
    return true;
  }
  if (text === BTN.results || isCommand(text, "/natijam")) {
    await reply(ctx, await renderResults(ctx, user), { markup: mainMenu(ctx.isTeacher) });
    return true;
  }
  if (text === BTN.rating || isCommand(text, "/reyting")) {
    await showLeaderboard(ctx, "all");
    return true;
  }
  if (isCommand(text, "/hafta")) {
    const since = startOfWeek(new Date(), ctx.settings.tz);
    const rows = await ctx.db.leaderboard(since, null);
    await sendLeaderboardCard(ctx.tg, ctx.chatId, rows, { period: "week", meTgId: ctx.sender.id });
    return true;
  }
  if (text === BTN.daily || isCommand(text, "/vazifa")) {
    await sendDailyTask(ctx, user);
    return true;
  }
  if (text === BTN.question || isCommand(text, "/savol")) {
    await setState(ctx, "ask_ai");
    await reply(ctx, T.askQuestion);
    return true;
  }
  if (text === BTN.feedback || isCommand(text, "/fikr")) {
    await setState(ctx, "feedback");
    await reply(ctx, T.feedbackAsk);
    return true;
  }
  if (isCommand(text, "/qoidalar") || isCommand(text, "/rules")) {
    await startTour(ctx);
    return true;
  }
  if (isCommand(text, "/bolimlar") || text === BTN.topics) {
    if (!ctx.isTeacher) {
      await reply(ctx, T.onlyStaff);
      return true;
    }
    const { text: body, markup } = await panelSection(ctx, "topics");
    await reply(ctx, body, { markup });
    return true;
  }
  if (text === BTN.panel || isCommand(text, "/panel") || isCommand(text, "/admin")) {
    await openPanel(ctx);
    return true;
  }
  if (text === BTN.code || isCommand(text, "/kod")) {
    await setState(ctx, "invite_code");
    await reply(ctx, T.codeAsk);
    return true;
  }
  if (text === BTN.cancel) {
    await clearState(ctx);
    await reply(ctx, T.cancelled, { markup: mainMenu(ctx.isTeacher) });
    return true;
  }
  if (isCommand(text, "/yordam") || isCommand(text, "/help")) {
    await reply(ctx, ctx.isTeacher ? T.helpStaff : T.helpStudent, {
      markup: mainMenu(ctx.isTeacher),
    });
    return true;
  }
  if (isCommand(text, "/id")) {
    await reply(ctx, fill(T.idText, { id: ctx.sender.id }));
    return true;
  }
  if (isCommand(text, "/ustoz")) {
    await addTeacher(ctx, text.slice("/ustoz".length));
    return true;
  }
  if (isCommand(text, "/ustoz_taklif")) {
    await createTeacherInvite(ctx);
    return true;
  }
  if (isCommand(text, "/elon")) {
    const body = text.slice("/elon".length).trim();
    if (body) await sendBroadcast(ctx, body);
    else await startBroadcast(ctx);
    return true;
  }
  return false;
}

export async function handlePrivate(ctx: AppContext): Promise<void> {
  if (!ctx.user) {
    await startRegistration(ctx);
    return;
  }
  if (ctx.isAdmin && ctx.user.role !== "admin") {
    ctx.user = await ctx.db.updateUser(ctx.user.id, { role: "admin", status: "active" });
    ctx.isTeacher = true;
  }
  let user = ctx.user;
  const text = (ctx.message?.text ?? "").trim();
  if (!user.dm_open) {
    user = await ctx.db.updateUser(user.id, { dm_open: true });
    ctx.user = user;
  }

  if (isCommand(text, "/start")) {
    const startArg = commandArgs(text, "/start");
    if (startArg.startsWith("t_")) {
      await redeemTeacherInvite(ctx, startArg.slice(2));
      return;
    }
    await startRegistration(ctx);
    return;
  }

  if (await handleRegistration(ctx)) return;

  if (ctx.state === "invite_code") {
    await clearState(ctx);
    const { approveCode } = await import("./onboarding.ts");
    await approveCode(ctx, text);
    return;
  }
  if (ctx.state === "feedback") {
    if (isCommand(text, "/bekor") || text === BTN.cancel) {
      await clearState(ctx);
      await reply(ctx, T.cancelled, { markup: mainMenu(ctx.isTeacher) });
      return;
    }
    if (text.length < 3) {
      await reply(ctx, T.feedbackTooShort);
      return;
    }
    await ctx.db.createFeedback(user.id, text.slice(0, 2000));
    await clearState(ctx);
    await reply(ctx, T.feedbackThanks, { markup: mainMenu(ctx.isTeacher) });
    await notifyStaff(ctx, fill(T.feedbackStaff, {
      name: esc(user.full_name ?? ctx.sender.username ?? "—"),
      text: esc(text.slice(0, 1500)),
    }));
    return;
  }
  if (ctx.state === "ask_ai") {
    await clearState(ctx);
    await answerQuestion(ctx, text);
    return;
  }
  if (ctx.state === "broadcast") {
    await sendBroadcast(ctx, text);
    return;
  }
  if (ctx.state === "set_value") {
    await saveSettingValue(ctx, text);
    return;
  }

  // Botda hali admin yo'q bo'lsa, /admin bilan birinchi murojaat qilgan admin bo'ladi.
  if (isCommand(text, "/admin") && user.role !== "admin" && !(await ctx.db.hasAdmin())) {
    user = await ctx.db.updateUser(user.id, { role: "admin", status: "active" });
    ctx.user = user;
    ctx.isAdmin = true;
    ctx.isTeacher = true;
    await reply(ctx, T.adminClaimed);
    await openPanel(ctx);
    return;
  }

  if (text === BTN.howto) {
    await reply(ctx, T.howTo, {
      markup: user.status === "active"
        ? mainMenu(ctx.isTeacher)
        : user.status === "pending" && user.phone
        ? pendingUserKeyboard()
        : startKeyboard(),
    });
    return;
  }
  if (text === BTN.status || isCommand(text, "/holat")) {
    const statusText = user.status === "active"
      ? T.approved
      : user.status === "blocked"
      ? T.blocked
      : user.status === "rejected"
      ? T.rejected
      : user.phone
      ? T.pendingStatus
      : T.pendingAlready;
    await reply(
      ctx,
      statusText,
      {
        markup: user.status === "active"
          ? mainMenu(ctx.isTeacher)
          : pendingUserKeyboard(),
      },
    );
    return;
  }
  if (text === BTN.register) {
    await beginRegistration(ctx);
    return;
  }

  if (await handlePrivateCommand(ctx, text, user)) return;

  // Telegram reply orqali bot vazifasiga javob
  const replyTo = ctx.message?.reply_to_message;
  if (replyTo && user.status === "active" && user.role === "student") {
    const task = await ctx.db.taskByMessage(ctx.chatId, replyTo.message_id);
    if (task) {
      await handleSubmission(ctx, task, user);
      return;
    }
  }

  if (user.status === "pending") {
    await reply(ctx, T.pendingAlready);
    return;
  }
  if (user.status !== "active") {
    await reply(ctx, user.status === "blocked" ? T.blocked : T.rejected);
    return;
  }

  if (user.role === "student") {
    if (text.length >= 8 && !ctx.message?.photo && !ctx.message?.voice) {
      await answerQuestion(ctx, text);
      return;
    }
    if (ctx.message && (ctx.message.photo || ctx.message.voice || ctx.message.document)) {
      await reply(ctx, T.useTopic, { markup: mainMenu(ctx.isTeacher) });
      return;
    }
    await reply(ctx, T.menu, { markup: mainMenu(ctx.isTeacher) });
    return;
  }

  await reply(ctx, T.menu, { markup: mainMenu(ctx.isTeacher) });
}

export async function openSettingsEdit(ctx: AppContext, field: string): Promise<void> {
  const prompt = await startSettingEdit(ctx, field);
  if (prompt) await reply(ctx, prompt);
}
