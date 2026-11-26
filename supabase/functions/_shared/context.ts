import { adminTgIds } from "./env.ts";
import { localDayKey } from "./logic/period.ts";
import type { Db } from "./db.ts";
import { botApi, type TelegramApi } from "./telegram.ts";
import type {
  SettingsRow,
  TgCallbackQuery,
  TgMessage,
  TgReplyMarkup,
  TgUpdate,
  TgUser,
  UserRow,
} from "./types.ts";

export interface AppContext {
  tg: TelegramApi;
  db: Db;
  settings: SettingsRow;
  update: TgUpdate;
  sender: TgUser;
  chatId: number;
  threadId: number | null;
  message?: TgMessage;
  callback?: TgCallbackQuery;
  user: UserRow | null;
  isGroup: boolean;
  isChannel: boolean;
  isTeacher: boolean;
  isAdmin: boolean;
  state: string | null;
  data: Record<string, unknown>;
}

export async function buildContext(
  update: TgUpdate,
  db: Db,
  tg: TelegramApi = botApi(),
): Promise<AppContext | null> {
  const message = update.message ?? update.edited_message;
  const callback = update.callback_query;
  const sender = message?.from ?? callback?.from;
  if (!sender || sender.is_bot) return null;

  const chat = message?.chat ?? callback?.message?.chat;
  if (!chat) return null;

  const settings = await db.getSettings();
  const user = await db.userByTg(sender.id);
  const session = chat.type === "private" && user
    ? await db.getSession(chat.id, user.id)
    : {};

  const isTeacher = Boolean(
    user && (user.role === "admin" || user.role === "teacher") && user.status === "active",
  );
  const isAdmin = Boolean(user?.role === "admin") ||
    (adminTgIds().includes(sender.id) && user?.admin_opt_out !== true);

  return {
    tg,
    db,
    settings,
    update,
    sender,
    chatId: chat.id,
    threadId: message?.message_thread_id ?? callback?.message?.message_thread_id ?? null,
    message,
    callback,
    user,
    isGroup: chat.type === "group" || chat.type === "supergroup",
    isChannel: chat.type === "channel",
    isTeacher,
    isAdmin,
    state: (session.__state as string | undefined) ?? null,
    data: session,
  };
}

export function displayName(user: TgUser): string {
  return [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || "O'quvchi";
}

export function fullNameOf(user: UserRow | null, fallback = "O'quvchi"): string {
  return user?.full_name?.trim() || fallback;
}

export function todayKey(ctx: AppContext): string {
  return localDayKey(new Date(), ctx.settings.tz);
}

// --------------------------------------------------------------------- xabarlar
export async function reply(
  ctx: AppContext,
  text: string,
  options: { threadId?: number | null; markup?: TgReplyMarkup; toChatId?: number } = {},
): Promise<number> {
  const threadId = options.threadId === undefined ? ctx.threadId : options.threadId;
  return await ctx.tg.sendMessage(options.toChatId ?? ctx.chatId, text, {
    threadId: ctx.isGroup ? threadId : null,
    markup: options.markup,
  });
}

/** Ustozlarga xabar: "Ustozlar" mavzusi bo'lsa o'sha yerga, aks holda shaxsiy chatga. */
export async function notifyStaff(
  ctx: AppContext,
  text: string,
  markup?: TgReplyMarkup,
): Promise<void> {
  const groupId = ctx.settings.group_chat_id;
  const threadId = ctx.settings.staff_thread_id;
  if (groupId && threadId) {
    try {
      await ctx.tg.sendMessage(Number(groupId), text, { threadId: Number(threadId), markup });
    } catch (error) {
      console.error("staff topic xabari yuborilmadi", error);
    }
  }
  const staff = await ctx.db.staff();
  const ids = new Set<number>(staff.map((row) => Number(row.tg_id)));
  for (const id of adminTgIds()) ids.add(id);
  for (const id of ids) {
    try {
      await ctx.tg.sendMessage(id, text, { markup });
    } catch (error) {
      console.error("staff dm yuborilmadi", id, error);
    }
  }
}

/** Tanlangan ustozga shaxsiy xabar; ustoz yo'q bo'lsa barcha ustozlarga. */
export async function notifyTeacher(
  ctx: AppContext,
  teacher: UserRow | null,
  text: string,
  markup?: TgReplyMarkup,
): Promise<void> {
  if (teacher) {
    try {
      await ctx.tg.sendMessage(Number(teacher.tg_id), text, { markup });
      return;
    } catch (error) {
      console.error("ustozga xabar yuborilmadi", teacher.id, error);
    }
  }
  await notifyStaff(ctx, text, markup);
}

/** O'quvchiga xabar: avval shaxsiy chat; bo'lmasa (eski) shaxsiy mavzu. */
export async function notifyStudent(
  ctx: AppContext,
  student: UserRow,
  text: string,
  markup?: TgReplyMarkup,
): Promise<void> {
  try {
    await ctx.tg.sendMessage(Number(student.tg_id), text, { markup });
    return;
  } catch (error) {
    console.error("student dm yuborilmadi", student.id, error);
  }
  const groupId = ctx.settings.group_chat_id;
  const threadId = student.topic_thread_id;
  if (groupId && threadId) {
    try {
      await ctx.tg.sendMessage(Number(groupId), text, { threadId: Number(threadId), markup });
    } catch (error) {
      console.error("student topic xabari yuborilmadi", error);
    }
  }
}

// ---------------------------------------------------------------------- state
export async function setState(
  ctx: AppContext,
  state: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  if (!ctx.user) return;
  await ctx.db.setSession(ctx.chatId, ctx.user.id, state, data);
  ctx.state = state;
  ctx.data = { __state: state, ...data };
}

export async function clearState(ctx: AppContext): Promise<void> {
  if (!ctx.user) return;
  await ctx.db.clearSession(ctx.chatId, ctx.user.id);
  ctx.state = null;
  ctx.data = {};
}

export function stateData(ctx: AppContext): Record<string, unknown> {
  const { __state: _ignored, ...rest } = ctx.data;
  return rest;
}

// ------------------------------------------------------------ kunlik limitlar
/** Kun o'zgargan bo'lsa hisoblagichlarni nolga qaytaradi. */
export async function freshCounters(ctx: AppContext, user: UserRow): Promise<UserRow> {
  const today = todayKey(ctx);
  const patch: Partial<UserRow> = {};
  if (user.bot_tasks_date !== today && user.bot_tasks_count !== 0) {
    patch.bot_tasks_date = today;
    patch.bot_tasks_count = 0;
  }
  if (user.ai_date !== today && user.ai_count !== 0) {
    patch.ai_date = today;
    patch.ai_count = 0;
  }
  if (Object.keys(patch).length === 0) {
    if (user.bot_tasks_date !== today || user.ai_date !== today) {
      const updated = await ctx.db.updateUser(user.id, {
        bot_tasks_date: today,
        ai_date: today,
        bot_tasks_count: user.bot_tasks_date === today ? user.bot_tasks_count : 0,
        ai_count: user.ai_date === today ? user.ai_count : 0,
      });
      ctx.user = updated;
      return updated;
    }
    return user;
  }
  const updated = await ctx.db.updateUser(user.id, patch);
  ctx.user = updated;
  return updated;
}

export async function bumpBotTaskCounter(ctx: AppContext, user: UserRow): Promise<void> {
  const today = todayKey(ctx);
  const count = user.bot_tasks_date === today ? user.bot_tasks_count + 1 : 1;
  ctx.user = await ctx.db.updateUser(user.id, {
    bot_tasks_date: today,
    bot_tasks_count: count,
  });
}

export async function bumpAiCounter(ctx: AppContext, user: UserRow): Promise<void> {
  const today = todayKey(ctx);
  const count = user.ai_date === today ? user.ai_count + 1 : 1;
  ctx.user = await ctx.db.updateUser(user.id, { ai_date: today, ai_count: count });
}
