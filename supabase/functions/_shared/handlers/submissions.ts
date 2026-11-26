import { type GradeResult, gradeSubmission } from "../ai.ts";
import { aiConfig } from "../env.ts";
import { type AppContext, notifyStaff } from "../context.ts";
import { decideGrade } from "../logic/decide.ts";
import { esc, fmtPoints, truncate } from "../logic/format.ts";
import { clampScore, pointsKindForTask } from "../logic/points.ts";
import { fill, T, TASK_KIND_LABEL } from "../texts.ts";
import {
  extractContent,
  MediaTooLargeError,
  REACTION,
  reactionForScore,
  toBase64,
} from "../telegram.ts";
import { bonusTaskKeyboard, gradeKeyboard, startBotKeyboard } from "../ui.ts";
import type { ExtractedContent } from "../telegram.ts";
import type { SubmissionRow, TaskRow, TgReplyMarkup, UserRow } from "../types.ts";

export const MAX_ATTEMPTS = 5;
const MAX_TEXT_CHARS = 8000;

/** Jarima chegarasi (foizda): shundan past natija qo'shimcha vazifa beradi. */
export function penaltyPercent(ctx: AppContext): number {
  const value = Number(ctx.settings.penalty_min_percent ?? 40);
  if (!Number.isFinite(value)) return 40;
  return Math.min(100, Math.max(0, value));
}

/** Ball 0–10 shkalada: 40% = 4 ball. */
export function belowThreshold(ctx: AppContext, score: number): boolean {
  return score * 10 < penaltyPercent(ctx);
}

type Prepared =
  | { ok: true; text: string; media: { mimeType: string; base64: string }[] }
  | { ok: false; reason: "too_large" | "unsupported" | "download_failed" };

function canSendInline(mime: string): boolean {
  return mime.startsWith("image/") ||
    mime.startsWith("audio/") ||
    mime.startsWith("video/") ||
    mime === "application/pdf";
}

function isPlainTextMime(mime: string): boolean {
  return mime.startsWith("text/") || mime === "application/json" || mime === "application/xml";
}

/**
 * O'quvchi javobini AI uchun tayyorlaydi: matn, rasm, ovoz, video, PDF hammasi.
 * Qo'llab-quvvatlanmaydigan formatlar (docx, zip, ...) ustozga yuboriladi.
 */
async function prepareAnswer(ctx: AppContext, content: ExtractedContent): Promise<Prepared> {
  let text = content.text;
  const media: { mimeType: string; base64: string }[] = [];

  if (!content.fileId) {
    return text ? { ok: true, text, media } : { ok: false, reason: "unsupported" };
  }

  const mime = content.mimeType ?? "application/octet-stream";
  try {
    const fileIds = (content.mediaFileIds?.length ? content.mediaFileIds : [content.fileId]).slice(
      0,
      10,
    );
    for (const fileId of fileIds) {
      const bytes = await ctx.tg.downloadFile(fileId);
      if (isPlainTextMime(mime)) {
        const decoded = new TextDecoder().decode(bytes).slice(0, MAX_TEXT_CHARS);
        text = `${text}\n\n${decoded}`.trim();
      } else if (canSendInline(mime)) {
        media.push({ mimeType: mime, base64: toBase64(bytes) });
      } else {
        return { ok: false, reason: "unsupported" };
      }
    }
  } catch (error) {
    if (error instanceof MediaTooLargeError) return { ok: false, reason: "too_large" };
    console.error("media yuklab bo'lmadi", error);
    return { ok: false, reason: "download_failed" };
  }

  return { ok: true, text, media };
}

async function taskMedia(ctx: AppContext, task: TaskRow) {
  if (!task.attachment_file_id) return null;
  const mime = task.attachment_type ?? "application/octet-stream";
  if (!mime.startsWith("image/") && mime !== "application/pdf") return null;
  try {
    const bytes = await ctx.tg.downloadFile(task.attachment_file_id);
    return { mimeType: mime, base64: toBase64(bytes) };
  } catch (error) {
    console.error("vazifa ilovasi yuklanmadi", error);
    return null;
  }
}

const NUDGE_EVERY_MS = 3 * 86_400_000;

/**
 * O'quvchiga natijani SHAXSIY chatda yuboradi (guruh toza qoladi).
 * Agar o'quvchi botga hali /start bosmagan bo'lsa, guruhda bir marta (3 kunda bir martadan
 * ko'p emas) "botni ishga tushiring" tugmasi ko'rsatiladi.
 */
export async function dmStudent(
  ctx: AppContext,
  student: UserRow,
  text: string,
  options: {
    markup?: TgReplyMarkup;
    nudgeIn?: { chatId: number; threadId?: number | null; replyTo?: number | null };
  } = {},
): Promise<boolean> {
  try {
    await ctx.tg.sendMessage(Number(student.tg_id), text, { markup: options.markup });
    if (!student.dm_open) await ctx.db.updateUser(student.id, { dm_open: true });
    return true;
  } catch (error) {
    console.error(
      "o'quvchiga DM yuborilmadi",
      student.id,
      error instanceof Error ? error.message : error,
    );
  }
  if (student.dm_open) await ctx.db.updateUser(student.id, { dm_open: false });

  const nudge = options.nudgeIn;
  const last = student.dm_nudged_at ? new Date(student.dm_nudged_at).getTime() : 0;
  if (nudge && Date.now() - last > NUDGE_EVERY_MS) {
    try {
      const me = await ctx.tg.getMe();
      if (me.username) {
        await ctx.tg.sendMessage(
          nudge.chatId,
          fill(T.dmNudge, { name: esc(student.full_name ?? "O'quvchi") }),
          {
            threadId: nudge.threadId ?? undefined,
            replyTo: nudge.replyTo ?? undefined,
            markup: startBotKeyboard(me.username, T.dmNudgeButton),
          },
        );
        await ctx.db.updateUser(student.id, { dm_nudged_at: new Date().toISOString() });
      }
    } catch (error) {
      console.error("start tugmasi yuborilmadi", error);
    }
  }
  return false;
}

export async function sendToStudent(
  ctx: AppContext,
  submission: SubmissionRow,
  text: string,
  markup?: TgReplyMarkup,
): Promise<void> {
  const student = await ctx.db.userById(submission.user_id);
  if (!student) return;
  await dmStudent(ctx, student, text, {
    markup,
    nudgeIn: submission.chat_id
      ? {
        chatId: Number(submission.chat_id),
        threadId: submission.thread_id,
        replyTo: submission.message_id,
      }
      : undefined,
  });
}

function taskLabel(task: TaskRow): string {
  return esc(truncate(task.title ?? task.prompt, 60));
}

/** To'g'ri javob (ustoz kiritgan kalit) — baholangandan keyin o'quvchiga ko'rsatiladi. */
function answerKeyBlock(task: TaskRow): string {
  const key = task.answer_key?.trim();
  return key ? `\n\n${fill(T.dmAnswerKey, { key: esc(truncate(key, 800)) })}` : "";
}

/** Bitta vazifa uchun eng yaxshi ball saqlanadi: qayta topshirish ballni faqat oshirishi mumkin. */
async function awardBest(
  ctx: AppContext,
  input: Parameters<AppContext["db"]["upsertPointEvent"]>[0] & { task_id: number },
): Promise<number> {
  const existing = (await ctx.db.pointsByTask(input.user_id, [input.task_id])).get(input.task_id);
  if (existing !== undefined && existing >= input.points) return existing;
  await ctx.db.upsertPointEvent(input);
  return input.points;
}

/** Past baho yoki tugallanmagan ish uchun bitta shaxsiy qo'shimcha vazifa ochadi. */
async function issueRemedialTask(
  ctx: AppContext,
  task: TaskRow,
  student: UserRow,
): Promise<void> {
  if (task.prompt.toLowerCase().includes("[qo'shimcha:")) return;
  const marker = `[qo'shimcha:${task.id}]`;
  const open = await ctx.db.activeTasksForStudent(student);
  if (open.some((item) => item.prompt.toLowerCase().includes(marker))) return;
  const percent = penaltyPercent(ctx);
  const hours = Number(ctx.settings.remedial_due_hours ?? 24) || 24;
  const prompt =
    `${marker} Ustoz bergan vazifa to'liq bajarilmadi yoki natija ${percent}% dan past.\n\n` +
    `Qo'shimcha vazifa: <b>${esc(truncate(task.title ?? task.prompt, 300))}</b>\n` +
    `Muddat: ${hours} soat. Vazifani qayta, to'liq bajaring va shu xabarga javob qilib yuboring.`;
  const remedial = await ctx.db.createTask({
    kind: "bot",
    prompt: prompt.replace(/<[^>]+>/g, ""),
    title: `Qo'shimcha vazifa #${task.id}`,
    chat_id: Number(student.tg_id),
    assigned_user_id: student.id,
    points_mode: "fixed",
    fixed_points: ctx.settings.bot_task_points,
    due_at: new Date(Date.now() + hours * 3_600_000).toISOString(),
    created_by: task.created_by,
  });
  try {
    const messageId = await ctx.tg.sendMessage(Number(student.tg_id), prompt);
    await ctx.db.updateTask(remedial.id, { message_id: messageId });
  } catch (error) {
    console.error("qo'shimcha vazifa yuborilmadi", student.id, error);
    await ctx.db.updateTask(remedial.id, { status: "closed" });
  }
}

/** Qo'lda tekshirish uchun ustozlarga javobni nusxalab yuboradi. */
export async function forwardToStaff(
  ctx: AppContext,
  submission: SubmissionRow,
  task: TaskRow,
  student: UserRow,
  reason: string,
  ai?: GradeResult | null,
): Promise<void> {
  const groupId = ctx.settings.group_chat_id;
  const threadId = ctx.settings.staff_thread_id;
  const header = fill(T.needManual, {
    name: esc(student.full_name ?? "O'quvchi"),
    task: esc(truncate(task.title ?? task.prompt, 70)),
  }) + `\n\n📌 Sabab: ${reason}\n🆔 Topshiriq #${submission.id}` +
    (ai
      ? `\n🤖 AI taklifi: <b>${fmtPoints(ai.score)}</b>/10 (${Math.round(ai.confidence * 100)}%)`
      : "");

  const targets: { chatId: number; threadId?: number }[] = [];
  if (groupId && threadId) {
    targets.push({ chatId: Number(groupId), threadId: Number(threadId) });
  } else {
    for (const staff of await ctx.db.staff()) {
      targets.push({ chatId: Number(staff.tg_id) });
    }
  }

  for (const target of targets) {
    try {
      if (submission.chat_id && submission.message_id) {
        const albumIds = submission.media_message_ids ?? [];
        if (albumIds.length > 1) {
          try {
            await ctx.tg.copyMessages(
              target.chatId,
              Number(submission.chat_id),
              albumIds,
              target.threadId,
            );
          } catch (error) {
            console.error("albom ustozga uzatilmadi, birinchi rasm nusxalanadi", error);
            await ctx.tg.copyMessage(
              target.chatId,
              Number(submission.chat_id),
              Number(submission.message_id),
              target.threadId,
            );
          }
        } else {
          await ctx.tg.copyMessage(
            target.chatId,
            Number(submission.chat_id),
            Number(submission.message_id),
            target.threadId,
          );
        }
      }
      await ctx.tg.sendMessage(target.chatId, header, {
        threadId: target.threadId,
        markup: gradeKeyboard(submission.id),
      });
    } catch (error) {
      console.error("ustozga yuborilmadi", target.chatId, error);
    }
  }
}

async function markManual(
  ctx: AppContext,
  submission: SubmissionRow,
  task: TaskRow,
  student: UserRow,
  reason: string,
  ai?: GradeResult | null,
): Promise<void> {
  await ctx.db.updateSubmission(submission.id, {
    status: "manual",
    ...(ai
      ? {
        ai_score: ai.score,
        ai_feedback: ai.feedback,
        ai_confidence: ai.confidence,
        ai_model: ai.model,
      }
      : {}),
  });
  // Guruhda 👀 reaksiya qoladi; izoh shaxsiy chatga ketadi.
  await sendToStudent(ctx, submission, fill(T.dmManual, { task: taskLabel(task) }));
  await forwardToStaff(ctx, submission, task, student, reason, ai);
}

export interface SubmissionOptions {
  /** Muddat o'tganda yoki "topshira olmadim" bosilganda majburiy ustozga yuborish. */
  forceManual?: boolean;
  forceManualReason?: string;
}

/**
 * O'quvchi xabarini vazifa javobi sifatida qabul qiladi.
 * Guruhda faqat reaksiya qo'yiladi (👀 → 👍 / 🔥 / 💯); ball, izoh va to'g'ri javob shaxsiy chatga ketadi.
 */
export async function handleSubmission(
  ctx: AppContext,
  task: TaskRow,
  student: UserRow,
  options: SubmissionOptions = {},
): Promise<void> {
  const message = ctx.message;
  if (!message) return;
  const react = (emoji: string | null) => ctx.tg.reactSafe(ctx.chatId, message.message_id, emoji);
  const nudgeIn = { chatId: ctx.chatId, threadId: ctx.threadId, replyTo: message.message_id };

  const content = extractContent(message);
  if (!content) {
    await react(REACTION.nothing);
    return;
  }

  // Muddat o'tgan bo'lsa javob qabul qilinmaydi (ustoz /muddat 3 kun bilan uzaytiradi).
  if (task.due_at && new Date(task.due_at).getTime() < Date.now()) {
    await react(REACTION.think);
    await dmStudent(ctx, student, T.taskExpired, { nudgeIn });
    return;
  }

  const attempts = await ctx.db.attemptsFor(task.id, student.id);
  const alreadyScored = (await ctx.db.scoredTaskIds(student.id, [task.id])).has(task.id);
  if (!alreadyScored && attempts >= MAX_ATTEMPTS) {
    await react(REACTION.think);
    await dmStudent(ctx, student, T.dmAttemptsExhausted, { nudgeIn });
    return;
  }

  let submission: SubmissionRow;
  try {
    submission = await ctx.db.createSubmission({
      task_id: task.id,
      user_id: student.id,
      chat_id: ctx.chatId,
      thread_id: ctx.threadId,
      message_id: message.message_id,
      content_type: content.contentType,
      text_content: content.text || null,
      file_id: content.fileId,
      media_file_ids: content.mediaFileIds ?? (content.fileId ? [content.fileId] : []),
      media_message_ids: message.media_group_message_ids ?? [message.message_id],
      file_name: content.fileName,
    });
  } catch (error) {
    // Telegram bir xil xabarni qayta yuborgan bo'lsa (unique chat_id+message_id) — ikki marta sanamaymiz.
    console.error("topshiriq saqlanmadi (dublikat bo'lishi mumkin)", error);
    return;
  }

  await react(REACTION.seen);

  if (options.forceManual) {
    await markManual(
      ctx,
      submission,
      task,
      student,
      options.forceManualReason ?? "Qo'lda tekshirish so'ralgan",
    );
    return;
  }

  const config = aiConfig(ctx.settings.ai_model);
  if (!config) {
    await markManual(ctx, submission, task, student, "AI sozlanmagan (AI_API_KEY yo'q)");
    return;
  }

  const prepared = await prepareAnswer(ctx, content);
  if (!prepared.ok) {
    if (prepared.reason === "too_large") {
      await dmStudent(ctx, student, T.dmFileTooLarge, { nudgeIn });
    }
    const reason = prepared.reason === "too_large"
      ? "Fayl 14 MB dan katta"
      : prepared.reason === "unsupported"
      ? "AI bu fayl formatini o'qiy olmaydi"
      : "Faylni yuklab bo'lmadi";
    await markManual(ctx, submission, task, student, reason);
    return;
  }

  let result: GradeResult;
  try {
    result = await gradeSubmission({
      task,
      studentName: student.full_name ?? "O'quvchi",
      answerText: prepared.text,
      media: prepared.media,
      taskMedia: await taskMedia(ctx, task),
      settingsModel: ctx.settings.ai_model,
    });
  } catch (error) {
    console.error("AI baholashda xato", error);
    await markManual(ctx, submission, task, student, "AI javob bera olmadi — ustoz tekshirsin");
    return;
  }

  const decision = decideGrade({
    kind: task.kind,
    score: result.score,
    confidence: result.confidence,
    done: result.done,
    settings: ctx.settings,
    pointsMode: task.points_mode,
    fixedPoints: task.fixed_points,
  });

  if (!result.done || belowThreshold(ctx, result.score)) {
    await issueRemedialTask(ctx, task, student);
  }

  if (decision.type === "manual") {
    await markManual(
      ctx,
      submission,
      task,
      student,
      "AI ishonchi past — ustoz tasdiqlasin",
      result,
    );
    return;
  }

  await ctx.db.updateSubmission(submission.id, {
    status: decision.status,
    ai_score: result.score,
    ai_feedback: result.feedback,
    ai_confidence: result.confidence,
    ai_model: result.model,
    final_score: decision.finalScore,
    graded_at: new Date().toISOString(),
  });

  const points = await awardBest(ctx, {
    user_id: student.id,
    kind: pointsKindForTask(task.kind),
    points: decision.points,
    task_id: task.id,
    submission_id: submission.id,
    note: task.kind === "self_study" || task.kind === "bot" ? "AI: bajarildi" : "AI bahosi",
  });

  let text: string;
  if (decision.type === "fixed") {
    text = decision.awarded
      ? fill(T.dmFixed, {
        task: taskLabel(task),
        points: fmtPoints(points),
        feedback: esc(result.feedback),
      })
      : fill(T.dmFixedNot, { task: taskLabel(task), feedback: esc(result.feedback) });
  } else {
    text = fill(T.dmScore, {
      task: taskLabel(task),
      score: fmtPoints(decision.points),
      feedback: esc(result.feedback),
    });
  }
  text += answerKeyBlock(task);

  const showBonus = ctx.settings.ai_enabled && task.kind !== "bot";
  await dmStudent(ctx, student, text, {
    markup: showBonus ? bonusTaskKeyboard() : undefined,
    nudgeIn,
  });

  // Guruhda faqat reaksiya.
  if (decision.type === "fixed" && !decision.awarded) await react(REACTION.think);
  else await react(reactionForScore(decision.type === "auto" ? decision.points : 0));
}

/** Muddat o'tib javob berilmagan vazifa uchun ustozga xabar. */
export async function reportMissed(
  ctx: AppContext,
  task: TaskRow,
  student: UserRow | null,
): Promise<void> {
  if (!student) return;
  const name = esc(student.full_name ?? "O'quvchi");
  const text = fill(T.overdueStaff, {
    name,
    title: esc(truncate(task.title ?? task.prompt, 70)),
  });
  await notifyStaff(ctx, text);
  const submission = await ctx.db.createSubmission({
    task_id: task.id,
    user_id: student.id,
    chat_id: task.chat_id,
    thread_id: task.thread_id,
    content_type: "text",
    text_content: "Muddat o'tdi — javob yuborilmadi",
  });
  await ctx.db.updateSubmission(submission.id, { status: "missed" });
  await ctx.db.updateTask(task.id, { status: "closed" });
}

/** Ustoz bahosi. 0.5–10 oralig'ida qat'iy ball. */
export async function applyTeacherGrade(
  ctx: AppContext,
  submission: SubmissionRow,
  score: number,
  reviewerTgId: number,
  feedback?: string,
): Promise<{ points: number }> {
  const task = await ctx.db.taskById(submission.task_id);
  if (!task) throw new Error("Vazifa topilmadi");
  const normalized = clampScore(score);
  const fixed = task.kind === "self_study" || task.kind === "bot" ||
    (task.points_mode === "fixed" && Number(task.fixed_points ?? 0) > 0);
  const points = fixed
    ? Number(
      task.kind === "self_study"
        ? ctx.settings.self_study_points
        : task.kind === "bot"
        ? ctx.settings.bot_task_points
        : task.fixed_points,
    )
    : normalized;

  await ctx.db.updateSubmission(submission.id, {
    status: "graded",
    final_score: normalized,
    ...(feedback ? { ai_feedback: feedback } : {}),
    reviewed_by: reviewerTgId,
    reviewed_at: new Date().toISOString(),
    graded_at: new Date().toISOString(),
  });

  // Ustoz bahosi AI bahosini almashtiradi (ustoz so'zi oxirgi) — shuning uchun to'g'ridan-to'g'ri yoziladi.
  await ctx.db.upsertPointEvent({
    user_id: submission.user_id,
    kind: pointsKindForTask(task.kind),
    points,
    task_id: task.id,
    submission_id: submission.id,
    note: "Ustoz bahosi",
  });

  await sendToStudent(
    ctx,
    submission,
    fill(T.dmTeacherScore, {
      task: taskLabel(task),
      score: fmtPoints(normalized),
      feedback: esc(feedback ?? task.criteria ?? "Ustoz baholadi."),
    }) + answerKeyBlock(task),
    ctx.settings.ai_enabled && task.kind !== "bot" ? bonusTaskKeyboard() : undefined,
  );

  if (belowThreshold(ctx, normalized)) {
    const student = await ctx.db.userById(submission.user_id);
    if (student) await issueRemedialTask(ctx, task, student);
  }

  // Guruhdagi topshiriq xabariga natija reaksiyasi.
  if (submission.chat_id && submission.message_id) {
    await ctx.tg.reactSafe(
      Number(submission.chat_id),
      Number(submission.message_id),
      reactionForScore(normalized),
    );
  }

  return { points };
}

export function taskKindLabel(task: TaskRow): string {
  return TASK_KIND_LABEL[task.kind];
}
