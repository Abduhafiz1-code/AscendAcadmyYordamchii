import {
  clearState,
  displayName,
  notifyStaff,
  notifyStudent,
  notifyTeacher,
  reply,
  setState,
  type AppContext,
} from "../context.ts";
import { adminTgIds } from "../env.ts";
import { esc } from "../logic/format.ts";
import { BTN, fill, T } from "../texts.ts";
import {
  mainMenu,
  nameConfirmKeyboard,
  phoneKeyboard,
  startKeyboard,
  teacherKeyboard,
} from "../ui.ts";
import type { TgReplyMarkup, UserRow } from "../types.ts";
import { startTour } from "./tour.ts";

const PHONE_RE = /^\+?\d{7,15}$/;

export function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-()]/g, "");
  return PHONE_RE.test(cleaned) ? cleaned : null;
}

function nickOf(sender: { username?: string; first_name: string; last_name?: string }): string {
  return sender.username
    ? `@${sender.username}`
    : [sender.first_name, sender.last_name].filter(Boolean).join(" ").trim() || "O'quvchi";
}

/**
 * Foydalanuvchi bazada bo'lmasa yaratadi (ID, nik, ism avtomatik saqlanadi).
 * Admin: `ADMIN_TELEGRAM_IDS` dagi ID, yoki botda hali admin bo'lmasa — birinchi foydalanuvchi.
 * O'quvchi guruhga topshiriq tashlasa ham shu orqali avtomatik ro'yxatga olinadi.
 * Mavjud o'quvchining qo'lda kiritilgan ismi hech qachon ustiga yozilmaydi.
 */
export async function ensureUser(ctx: AppContext): Promise<UserRow> {
  const envAdmins = adminTgIds();
  const isEnvAdmin = envAdmins.includes(ctx.sender.id);
  const inPrivate = !ctx.isGroup;
  const nowIso = new Date().toISOString();

  if (ctx.user) {
    const patch: Partial<UserRow> = {};
    if (isEnvAdmin && !ctx.user.admin_opt_out && (ctx.user.role !== "admin" || ctx.user.status !== "active")) {
      patch.role = "admin";
      patch.status = "active";
    }
    if (ctx.sender.username && ctx.sender.username !== ctx.user.username) {
      patch.username = ctx.sender.username;
    }
    if (ctx.user.role === "student") {
      if (!ctx.user.full_name?.trim()) patch.full_name = nickOf(ctx.sender);
      if (ctx.user.status === "pending") patch.status = "active";
      if (ctx.isGroup && ctx.message?.chat.title && !ctx.user.group_name) {
        patch.group_name = ctx.message.chat.title;
      }
      if ((patch.status ?? ctx.user.status) === "active" && !ctx.user.approved_at) {
        patch.approved_at = nowIso;
      }
    }
    if (inPrivate && !ctx.user.dm_open) patch.dm_open = true;
    if (Object.keys(patch).length > 0) ctx.user = await ctx.db.updateUser(ctx.user.id, patch);
    if ((isEnvAdmin && !ctx.user.admin_opt_out) || ctx.user.role === "admin") {
      ctx.isAdmin = true;
      ctx.isTeacher = true;
    }
    return ctx.user;
  }

  // Birinchi foydalanuvchi admin bo'lishi FAQAT shaxsiy chatda: guruhdagi tasodifiy o'quvchi admin bo'lib qolmasin.
  const bootstrap = inPrivate && !isEnvAdmin && envAdmins.length === 0 && !(await ctx.db.hasAdmin());
  const role = isEnvAdmin || bootstrap ? "admin" : "student";
  const created = await ctx.db.createUser({
    tg_id: ctx.sender.id,
    full_name: nickOf(ctx.sender),
    username: ctx.sender.username ?? null,
    group_name: ctx.isGroup ? ctx.message?.chat.title ?? null : null,
    role,
    status: "active",
    approved_at: nowIso,
    dm_open: inPrivate,
  });
  ctx.user = created;
  if (created.role === "admin") {
    ctx.isAdmin = true;
    ctx.isTeacher = true;
  }
  return created;
}

/** Foydalanuvchi guruh a'zosimi: true / false / null (aniqlab bo'lmadi). */
async function isGroupMember(ctx: AppContext, chatId: number): Promise<boolean | null> {
  const info = await ctx.tg.getChatMember(chatId, ctx.sender.id);
  if (!info) return null;
  if (info.status === "creator" || info.status === "administrator" || info.status === "member") {
    return true;
  }
  if (info.status === "restricted") return info.is_member === true;
  return false;
}

/** Guruhda bitta ustoz bo'lsa — avtomatik biriktiradi. */
async function autoTeacher(ctx: AppContext): Promise<UserRow | null> {
  const staff = await ctx.db.staff();
  const teachers = staff.filter((row) => row.role === "teacher");
  const pool = teachers.length > 0 ? teachers : staff.filter((row) => row.role === "admin");
  return pool.length === 1 ? pool[0] : null;
}

/**
 * /start: foydalanuvchi allaqachon avtomatik ro'yxatga olingan (ID, nik, ism). Bu yerda
 * faqat ism tasdiqlanadi, telefon (ixtiyoriy) olinadi va qoidalar rasmlar bilan ko'rsatiladi.
 */
export async function startRegistration(ctx: AppContext): Promise<void> {
  const user = await ensureUser(ctx);
  if (user.role !== "student") {
    await reply(ctx, fill(T.welcomeBack, { name: esc(user.full_name ?? "do'stim") }), {
      markup: mainMenu(true),
    });
    return;
  }
  if (user.status === "blocked") {
    await reply(ctx, T.blocked);
    return;
  }
  if (user.onboarded) {
    await reply(ctx, fill(T.welcomeBack, { name: esc(user.full_name ?? "do'stim") }), {
      markup: mainMenu(false),
    });
    return;
  }

  const groupId = ctx.settings.group_chat_id;
  const groupTitle = esc(ctx.settings.group_title ?? "guruh");
  if (groupId && await isGroupMember(ctx, Number(groupId)) === false) {
    await reply(ctx, fill(T.notMember, { group: groupTitle }));
    return;
  }

  const name = displayName(ctx.sender);
  const teacher = await autoTeacher(ctx);
  ctx.user = await ctx.db.updateUser(user.id, {
    full_name: user.full_name && !user.full_name.startsWith("@") ? user.full_name : name,
    username: ctx.sender.username ?? user.username,
    group_name: ctx.settings.group_title ?? user.group_name,
    teacher_id: teacher?.id ?? user.teacher_id,
    role: "student",
    status: "active",
  });
  await setState(ctx, "reg_name_confirm");
  await reply(ctx, fill(T.nameConfirm, { name: esc(ctx.user.full_name ?? name), group: groupTitle }), {
    markup: nameConfirmKeyboard(),
  });
}

/** Ismni tasdiqlash tugmalari (nm:ok / nm:edit). */
export async function confirmStudentName(ctx: AppContext, action: string): Promise<string> {
  if (!ctx.user) return T.notRegistered;
  if (action === "edit") {
    await setState(ctx, "reg_name");
    await reply(ctx, T.askName);
    return "Ismni yozing";
  }
  await setState(ctx, "reg_phone");
  await reply(ctx, T.askPhone, { markup: phoneKeyboard() });
  return "Qabul qilindi";
}

/** «Ro'yxatdan o'tish» tugmasi — avtomatik ro'yxat oqimini boshlaydi. */
export async function beginRegistration(ctx: AppContext): Promise<void> {
  await startRegistration(ctx);
}

/** Joriy ro'yxatdan o'tish qadamining savoli. */
async function currentStepPrompt(
  ctx: AppContext,
): Promise<{ text: string; markup?: TgReplyMarkup }> {
  if (ctx.state === "reg_group") return { text: T.askGroup };
  if (ctx.state === "reg_teacher") {
    const staff = await ctx.db.staff();
    return staff.length > 0
      ? { text: T.askTeacher, markup: teacherKeyboard(staff) }
      : { text: T.noTeachers };
  }
  if (ctx.state === "reg_phone") return { text: T.askPhone, markup: phoneKeyboard() };
  return { text: T.askName };
}

async function askTeacherStep(ctx: AppContext): Promise<void> {
  const staff = await ctx.db.staff();
  if (staff.length === 0) {
    await setState(ctx, "reg_phone");
    await reply(ctx, `${T.noTeachers}\n\n${T.askPhone}`, { markup: phoneKeyboard() });
    return;
  }
  await setState(ctx, "reg_teacher");
  await reply(ctx, T.askTeacher, { markup: teacherKeyboard(staff) });
}

/** Ustoz tanlandi (inline tugma) yoki o'tkazib yuborildi. */
export async function chooseTeacher(ctx: AppContext, raw: string): Promise<string> {
  if (!ctx.user) return T.notRegistered;
  if (ctx.isGroup) return T.onlyPrivate;
  if (raw === "skip") {
    await setState(ctx, "reg_phone");
    await reply(ctx, T.askPhone, { markup: phoneKeyboard() });
    return "O'tkazildi";
  }
  const teacher = /^\d+$/.test(raw) ? await ctx.db.userById(Number(raw)) : null;
  if (!teacher || teacher.role === "student" || teacher.status !== "active") {
    return T.teacherNotFound;
  }
  ctx.user = await ctx.db.updateUser(ctx.user.id, { teacher_id: teacher.id });
  await setState(ctx, "reg_phone");
  await reply(
    ctx,
    `${fill(T.teacherSelected, { name: esc(teacher.full_name ?? "—") })}\n\n${T.askPhone}`,
    { markup: phoneKeyboard() },
  );
  return "Tanlandi";
}

/** Ro'yxatdan o'tish qadamlarini boshqaradi. true — xabar ishlatildi. */
export async function handleRegistration(ctx: AppContext): Promise<boolean> {
  if (!ctx.state || !ctx.state.startsWith("reg_") || !ctx.user) return false;
  const text = (ctx.message?.text ?? "").trim();

  if (text === BTN.cancel) {
    await clearState(ctx);
    await reply(ctx, T.cancelled, { markup: startKeyboard() });
    return true;
  }
  if (text === BTN.howto) {
    await reply(ctx, T.howTo, { markup: startKeyboard() });
    return true;
  }
  if (text === BTN.register) {
    const step = await currentStepPrompt(ctx);
    await reply(ctx, step.text, { markup: step.markup });
    return true;
  }

  if (ctx.state === "reg_name_confirm") {
    // Tugma o'rniga ismni yozib yuborsa — yangi ism sifatida qabul qilamiz.
    if (text.length < 3) {
      await reply(ctx, T.nameTooShort);
      return true;
    }
    await ctx.db.updateUser(ctx.user.id, { full_name: text.slice(0, 80) });
    await setState(ctx, "reg_phone");
    await reply(ctx, T.askPhone, { markup: phoneKeyboard() });
    return true;
  }

  if (ctx.state === "reg_name") {
    if (text.length < 3) {
      await reply(ctx, T.nameTooShort);
      return true;
    }
    await ctx.db.updateUser(ctx.user.id, { full_name: text.slice(0, 80) });
    await setState(ctx, "reg_phone");
    await reply(ctx, T.askPhone, { markup: phoneKeyboard() });
    return true;
  }

  if (ctx.state === "reg_group") {
    if (text.length < 2) {
      await reply(ctx, T.nameTooShort);
      return true;
    }
    await ctx.db.updateUser(ctx.user.id, { group_name: text.slice(0, 40) });
    await askTeacherStep(ctx);
    return true;
  }

  if (ctx.state === "reg_teacher") {
    const staff = await ctx.db.staff();
    if (text === BTN.skip) {
      await setState(ctx, "reg_phone");
      await reply(ctx, T.askPhone, { markup: phoneKeyboard() });
      return true;
    }
    const needle = text.toLowerCase();
    const found = staff.find((row) => (row.full_name ?? "").toLowerCase().includes(needle));
    if (!found) {
      await reply(ctx, T.askTeacher, { markup: teacherKeyboard(staff) });
      return true;
    }
    ctx.user = await ctx.db.updateUser(ctx.user.id, { teacher_id: found.id });
    await setState(ctx, "reg_phone");
    await reply(
      ctx,
      `${fill(T.teacherSelected, { name: esc(found.full_name ?? "—") })}\n\n${T.askPhone}`,
      { markup: phoneKeyboard() },
    );
    return true;
  }

  if (ctx.state === "reg_phone") {
    const contact = ctx.message?.contact?.phone_number;
    const skipped = text === BTN.skip;
    const phone = skipped ? null : normalizePhone(contact ?? text);
    if (!skipped && !phone) {
      await reply(ctx, T.badPhone);
      return true;
    }
    const updated = await ctx.db.updateUser(ctx.user.id, {
      ...(phone ? { phone } : {}),
      username: ctx.sender.username ?? ctx.user.username,
      status: "active",
      onboarded: true,
      dm_open: true,
    });
    ctx.user = updated;
    await clearState(ctx);

    const teacher = updated.teacher_id ? await ctx.db.userById(updated.teacher_id) : null;
    await reply(
      ctx,
      fill(T.registeredAuto, {
        name: esc(updated.full_name ?? displayName(ctx.sender)),
        group: esc(updated.group_name ?? ctx.settings.group_title ?? "—"),
        teacher: esc(teacher?.full_name ?? "—"),
        phone: esc(phone ?? "—"),
      }),
      { markup: mainMenu(false) },
    );
    await startTour(ctx);
    await notifyTeacher(ctx, teacher, fill(T.studentRegisteredTeacher, {
      name: esc(updated.full_name ?? "—"),
      group: esc(updated.group_name ?? "—"),
      phone: esc(phone ?? "—"),
      username: esc(ctx.sender.username ?? "—"),
    }));
    return true;
  }

  return false;
}

export async function approveCode(ctx: AppContext, code: string): Promise<void> {
  const user = await ensureUser(ctx);
  const expected = ctx.settings.invite_code?.trim();
  if (!expected) {
    await reply(ctx, T.codeNotSet);
    return;
  }
  if (code.trim() !== expected) {
    await reply(ctx, T.codeWrong);
    return;
  }
  await approveStudent(ctx, user, null);
  await reply(ctx, T.codeOk);
}

export interface ApproveResult {
  ok: boolean;
  error?: string;
  topicId?: number | null;
}

/** O'quvchini tasdiqlaydi (shaxsiy mavzu yaratilmaydi — bo'limlar yo'nalish bo'yicha). */
export async function approveStudent(
  ctx: AppContext,
  student: UserRow,
  reviewer: UserRow | null,
): Promise<ApproveResult> {
  const approved = await ctx.db.updateUser(student.id, {
    status: "active",
    approved_at: new Date().toISOString(),
    approved_by: reviewer?.id ?? null,
  });
  ctx.user = ctx.user?.id === approved.id ? approved : ctx.user;
  try {
    await ctx.tg.sendMessage(Number(approved.tg_id), T.approved);
  } catch (cause) {
    console.error("tasdiqlash DM yuborilmadi", cause);
  }
  return { ok: true, topicId: approved.topic_thread_id ?? null };
}

export async function rejectStudent(
  ctx: AppContext,
  student: UserRow,
  reviewer: UserRow | null,
): Promise<void> {
  await ctx.db.updateUser(student.id, { status: "rejected", approved_by: reviewer?.id ?? null });
  try {
    await ctx.tg.sendMessage(Number(student.tg_id), T.rejected);
  } catch (error) {
    console.error("rad etish DM yuborilmadi", error);
  }
  await notifyStaff(ctx, fill(T.rejectedNotify, {
    name: esc(student.full_name ?? "—"),
  }));
}

export async function unblockUser(ctx: AppContext, student: UserRow): Promise<void> {
  await ctx.db.updateUser(student.id, { status: "active" });
  await notifyStudent(ctx, student, T.approved);
}
