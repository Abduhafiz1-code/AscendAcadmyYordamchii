import { reply, type AppContext } from "../context.ts";
import { esc, fmtDateTime, fmtPoints, truncate } from "../logic/format.ts";
import { renderLeaderboard } from "../logic/leaderboard.ts";
import { fill, T } from "../texts.ts";
import { gradeKeyboard, periodKeyboard, topicTypeKeyboard } from "../ui.ts";
import {
  approveStudent,
  chooseTeacher,
  confirmStudentName,
  rejectStudent,
} from "./onboarding.ts";
import { panelSection, startSettingEdit } from "./panel.ts";
import { applyTeacherGrade, sendToStudent } from "./submissions.ts";
import { tourStep } from "./tour.ts";
import { sendDailyTask } from "./private.ts";
import { REACTION } from "../telegram.ts";
import { topicTypeLabel } from "../logic/routing.ts";
import type { SubmissionRow, TgReplyMarkup } from "../types.ts";

async function editOrSend(
  ctx: AppContext,
  text: string,
  markup?: TgReplyMarkup,
): Promise<void> {
  const message = ctx.callback?.message;
  if (!message) {
    await reply(ctx, text, { markup });
    return;
  }
  try {
    await ctx.tg.editMessage(ctx.chatId, message.message_id, text, markup);
  } catch {
    await reply(ctx, text, { markup });
  }
}

async function submissionCard(ctx: AppContext, submission: SubmissionRow): Promise<string> {
  const student = await ctx.db.userById(submission.user_id);
  const task = await ctx.db.taskById(submission.task_id);
  const lines = [
    `👨‍🏫 <b>Topshiriq #${submission.id}</b>`,
    `👤 ${esc(student?.full_name ?? "O'quvchi")}`,
    `📝 ${esc(truncate(task?.title ?? "Vazifa", 60))}`,
    `🕘 ${fmtDateTime(submission.created_at, ctx.settings.tz)}`,
    `📎 Turi: ${submission.content_type}`,
  ];
  if (submission.text_content) {
    lines.push("", `<i>${esc(truncate(submission.text_content, 400))}</i>`);
  }
  if (submission.ai_score !== null) {
    lines.push(
      "",
      `🤖 AI: <b>${fmtPoints(submission.ai_score)}</b>/10` +
        (submission.ai_confidence !== null
          ? ` (${Math.round(Number(submission.ai_confidence) * 100)}%)`
          : ""),
    );
    if (submission.ai_feedback) lines.push(`💬 ${esc(truncate(submission.ai_feedback, 250))}`);
  }
  lines.push("", "Baho tanlang (0.5–10):");
  return lines.join("\n");
}

async function handleGradeAction(ctx: AppContext, parts: string[]): Promise<string> {
  if (!ctx.isTeacher && !ctx.isAdmin) return T.onlyStaff;
  const submissionId = Number(parts[1]);
  const action = parts[2] ?? "";
  if (!Number.isFinite(submissionId)) return T.gradeNoSubmission;

  const submission = await ctx.db.submissionById(submissionId);
  if (!submission) return T.gradeNoSubmission;

  if (action === "ask" || action === "show") {
    await editOrSend(ctx, await submissionCard(ctx, submission), gradeKeyboard(submission.id));
    return " ";
  }
  if (action === "retry") {
    await ctx.db.updateSubmission(submission.id, {
      status: "rejected",
      reviewed_by: ctx.sender.id,
      reviewed_at: new Date().toISOString(),
    });
    await sendToStudent(ctx, submission, T.retryAllowed);
    if (submission.chat_id && submission.message_id) {
      await ctx.tg.reactSafe(Number(submission.chat_id), Number(submission.message_id), REACTION.think);
    }
    await editOrSend(ctx, `🔁 #${submission.id} — qayta topshirishga ruxsat berildi.`);
    return "Ruxsat berildi";
  }
  if (action === "reject") {
    await ctx.db.updateSubmission(submission.id, {
      status: "rejected",
      reviewed_by: ctx.sender.id,
      reviewed_at: new Date().toISOString(),
    });
    await sendToStudent(ctx, submission, T.submissionRejected);
    if (submission.chat_id && submission.message_id) {
      await ctx.tg.reactSafe(Number(submission.chat_id), Number(submission.message_id), REACTION.think);
    }
    await editOrSend(ctx, `🚫 #${submission.id} — javob rad etildi.`);
    return "Rad etildi";
  }

  const score = Number(action.replace(",", "."));
  if (!Number.isFinite(score) || score < 0.5 || score > 10) return T.badGrade;

  try {
    const { points } = await applyTeacherGrade(ctx, submission, score, ctx.sender.id);
    await editOrSend(
      ctx,
      `✅ <b>#${submission.id}</b> baholandi: <b>${fmtPoints(score)}</b>/10 · +${fmtPoints(points)} ball`,
    );
    return fill(T.gradeSaved, { score: fmtPoints(score) });
  } catch (error) {
    console.error("callback baholash xatosi", error);
    return T.gradeNoSubmission;
  }
}

async function handlePanel(ctx: AppContext, section: string): Promise<string> {
  if (!ctx.isTeacher && !ctx.isAdmin) return T.onlyStaff;
  const { text, markup } = await panelSection(ctx, section);
  await editOrSend(ctx, text, markup);
  return " ";
}

async function handleTaskAction(ctx: AppContext, parts: string[]): Promise<string> {
  if (!ctx.isTeacher) return T.onlyStaff;
  const action = parts[1];
  const taskId = Number(parts[2]);
  const task = Number.isFinite(taskId) ? await ctx.db.taskById(taskId) : null;
  if (!task) return T.notTaskReply;
  const status = action === "del" ? "deleted" : "closed";
  await ctx.db.updateTask(task.id, { status });
  await editOrSend(ctx, fill(status === "deleted" ? T.taskDeleted : T.taskClosedByStaff, {
    id: task.id,
  }));
  return status === "deleted" ? "O'chirildi" : "Yopildi";
}

export async function handleCallback(ctx: AppContext): Promise<void> {
  const data = ctx.callback?.data ?? "";
  if (!data) return;
  const parts = data.split(":");
  const head = parts[0];
  let toast = " ";

  try {
    if (head === "ap" || head === "rj") {
      if (!ctx.isTeacher && !ctx.isAdmin) throw new Error(T.onlyStaff);
      const student = await ctx.db.userById(Number(parts[1]));
      if (!student) throw new Error(T.studentNotFound);
      if (head === "ap") {
        const result = await approveStudent(ctx, student, ctx.user);
        toast = result.ok ? "Tasdiqlandi" : "Tasdiqlandi (mavzu xatosi)";
        await editOrSend(ctx, fill(T.approvedNotify, { name: esc(student.full_name ?? "—") }));
      } else {
        await rejectStudent(ctx, student, ctx.user);
        toast = "Rad etildi";
        await editOrSend(ctx, fill(T.rejectedNotify, { name: esc(student.full_name ?? "—") }));
      }
    } else if (head === "g") {
      toast = await handleGradeAction(ctx, parts);
    } else if (head === "nm") {
      toast = await confirmStudentName(ctx, parts[1] ?? "ok");
    } else if (head === "dt") {
      // "🎯 Qo'shimcha vazifa olish" — erta tugatganlar uchun bot vazifasi.
      if (ctx.isGroup) throw new Error(T.onlyPrivate);
      if (!ctx.user || ctx.user.status !== "active") throw new Error(T.notRegistered);
      await sendDailyTask(ctx, ctx.user);
      toast = " ";
    } else if (head === "ob") {
      toast = await tourStep(ctx, parts[1] ?? "0");
    } else if (head === "tt") {
      if (!ctx.isTeacher && !ctx.isAdmin) throw new Error(T.onlyStaff);
      const topicId = Number(parts[1]);
      const type = parts[2] ?? "";
      if (type !== "task" && type !== "questions" && type !== "announce" && type !== "ignore") {
        throw new Error(T.topicTypeBad);
      }
      const topic = await ctx.db.topicById(topicId);
      if (!topic) throw new Error(T.topicTypeBad);
      // Ustoz tanlagach bot bu bo'limni qayta taxmin qilmaydi (announced = true).
      await ctx.db.updateTopic(topic.id, { type, announced: true });
      toast = "Saqlandi";
      await editOrSend(ctx, fill(T.topicTypeSet, {
        name: esc(topic.name ?? `#${topic.thread_id}`),
        type: topicTypeLabel(type),
      }));
    } else if (head === "tp") {
      // Bo'limlar ro'yxatidan bo'lim tanlash: tp:<topicId>
      if (!ctx.isTeacher && !ctx.isAdmin) throw new Error(T.onlyStaff);
      const topic = await ctx.db.topicById(Number(parts[1]));
      if (!topic) throw new Error(T.topicTypeBad);
      await editOrSend(
        ctx,
        fill(T.topicTypeAsk, {
          name: esc(topic.name ?? `#${topic.thread_id}`),
          type: topicTypeLabel(topic.type),
        }),
        topicTypeKeyboard(topic.id),
      );
    } else if (head === "th") {
      toast = await chooseTeacher(ctx, parts[1] ?? "");
    } else if (head === "p") {
      toast = await handlePanel(ctx, parts[1] ?? "root");
    } else if (head === "s") {
      if (!ctx.isTeacher && !ctx.isAdmin) throw new Error(T.onlyStaff);
      if (ctx.isGroup) throw new Error(T.onlyPrivate);
      const prompt = await startSettingEdit(ctx, parts[1] ?? "");
      if (prompt) await reply(ctx, prompt);
      toast = " ";
    } else if (head === "t") {
      toast = await handleTaskAction(ctx, parts);
    } else if (head === "lb") {
      const period = parts[1] === "week" ? "week" : parts[1] === "month" ? "month" : "all";
      const since = period === "week"
        ? new Date(Date.now() - 7 * 86_400_000)
        : period === "month"
        ? new Date(Date.now() - 30 * 86_400_000)
        : null;
      const rows = await ctx.db.leaderboard(
        since,
        ctx.isGroup ? ctx.settings.group_title : ctx.user?.group_name ?? null,
      );
      await editOrSend(
        ctx,
        renderLeaderboard(rows, period, ctx.sender.id),
        periodKeyboard(period),
      );
      toast = " ";
    }
  } catch (error) {
    toast = error instanceof Error ? error.message.slice(0, 180) : "Xatolik";
    console.error("callback xatosi", error);
  }

  try {
    await ctx.tg.answerCallback(ctx.callback!.id, toast.trim() || undefined);
  } catch (error) {
    console.error("answerCallback xatosi", error);
  }
}
