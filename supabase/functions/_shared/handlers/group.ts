import { notifyStaff, reply, type AppContext } from "../context.ts";
import { onboardingSlide } from "../assets/onboarding.ts";
import { classifyTopicName, routeThread, topicTypeLabel, trackLabel } from "../logic/routing.ts";
import { sendLeaderboardCard } from "../logic/leaderboardCard.ts";
import { startOfWeek } from "../logic/period.ts";
import { parseDue, splitAnswerKey } from "../logic/taskParse.ts";
import { esc, fmtDateTime, truncate } from "../logic/format.ts";
import { fill, T } from "../texts.ts";
import { startBotKeyboard, taskKeyboard, topicTypeKeyboard } from "../ui.ts";
import {
  commandArgs,
  extractContent,
  isCommand,
  REACTION,
  type ExtractedContent,
} from "../telegram.ts";
import { ensureUser } from "./onboarding.ts";
import type { SettingsRow, TaskKind, TopicRow, UserRow } from "../types.ts";
import { applyTeacherGrade, handleSubmission } from "./submissions.ts";
import { answerQuestion } from "./aiTutor.ts";

const TOPIC_TYPE_LABEL: Record<string, string> = {
  task: "📝 Vazifa",
  questions: "❓ Savollar",
  announce: "🏆 Reyting / e'lon",
  ignore: "🚫 E'tiborsiz",
};

function topicNameOf(ctx: AppContext): string | null {
  const message = ctx.message;
  return message?.forum_topic_created?.name ??
    message?.forum_topic_edited?.name ??
    message?.reply_to_message?.forum_topic_created?.name ??
    null;
}

function trackSuffix(track: string | null): string {
  return track ? ` · ${esc(trackLabel(track))}` : "";
}

/** Ustozlarga "yangi bo'lim" xabarini (turni o'zgartirish tugmalari bilan) yuboradi. */
async function announceTopic(ctx: AppContext, topic: TopicRow, text: string): Promise<void> {
  try {
    await notifyStaff(ctx, text, topicTypeKeyboard(topic.id));
  } catch (error) {
    console.error("bo'lim xabari yuborilmadi", error);
  }
}

/**
 * Joriy bo'limni bazada yozib qo'yadi va (yangi bo'lsa) turini nomidan taxmin qiladi.
 * Kodda hech qanday thread ID qotirilmagan: bo'limlar qo'shilsa, nomi o'zgarsa yoki
 * qayta tuzilsa ham bot moslashadi. Taxmin noto'g'ri bo'lsa, ustoz /bolim bilan to'g'rilaydi.
 */
async function trackTopic(ctx: AppContext): Promise<TopicRow> {
  const threadId = ctx.threadId ?? 0;
  let topic = await ctx.db.upsertTopic(ctx.chatId, threadId, topicNameOf(ctx));
  if (topic.announced) return topic;

  // 1) General / oddiy guruh: bo'limsiz guruhda xabarlar vazifa sifatida qabul qilinadi.
  if (threadId === 0) {
    const plain = !ctx.message?.chat.is_forum;
    await ctx.db.updateTopic(topic.id, { type: plain ? "task" : "ignore", announced: true });
    return { ...topic, type: plain ? "task" : "ignore", announced: true };
  }

  // 2) Eski sozlamalar orqali ulangan bo'limlar (/mavzu) — jimgina o'tkaziladi.
  const settings = ctx.settings;
  const legacy: { id: number | null; type: TopicRow["type"]; track: string | null }[] = [
    { id: settings.tasks_thread_id, type: "task", track: null },
    { id: settings.self_study_thread_id, type: "task", track: "self_study" },
    { id: settings.questions_thread_id, type: "questions", track: null },
  ];
  const match = legacy.find((row) => row.id && Number(row.id) === threadId);
  if (match) {
    await ctx.db.updateTopic(topic.id, { type: match.type, track: match.track, announced: true });
    return { ...topic, type: match.type, track: match.track, announced: true };
  }

  // 3) Nomdan taxmin. Aniq bo'lsa — qo'llaymiz va ustozlarga bir marta xabar beramiz.
  const guess = classifyTopicName(topic.name);
  if (guess.confident && topic.name) {
    if (await ctx.db.claimTopicAnnounce(topic.id)) {
      await ctx.db.updateTopic(topic.id, { type: guess.type, track: guess.track });
      topic = { ...topic, type: guess.type, track: guess.track, announced: true };
      await announceTopic(
        ctx,
        topic,
        fill(T.topicNewAuto, {
          name: esc(topic.name ?? "—"),
          type: topicTypeLabel(guess.type),
          track: trackSuffix(guess.track),
        }),
      );
    }
  }
  // Aniq bo'lmasa (masalan o'quvchi ismi) — jim turadi; o'quvchi topshiriq tashlasa ustozdan so'raladi.
  return topic;
}

/** O'quvchi turi noma'lum bo'limga topshiriq tashlasa, ustozdan bir marta so'raydi. */
async function askTopicTypeOnce(ctx: AppContext, topic: TopicRow): Promise<void> {
  if (topic.announced || topic.type !== "ignore") return;
  if (!(await ctx.db.claimTopicAnnounce(topic.id))) return;
  await announceTopic(
    ctx,
    topic,
    fill(T.topicNewAsk, { name: esc(topic.name ?? `#${topic.thread_id}`) }),
  );
}

/** /bolim — bo'lim turini belgilash (kodga ID qotirilmagan). */
async function showTopicType(ctx: AppContext): Promise<void> {
  if (!ctx.isTeacher && !ctx.isAdmin) {
    await reply(ctx, T.onlyStaff);
    return;
  }
  if (!ctx.threadId) {
    await reply(ctx, T.onlyGroup);
    return;
  }
  const topic = await trackTopic(ctx);
  await reply(
    ctx,
    fill(T.topicTypeAsk, {
      name: esc(topic.name ?? "—"),
      type: TOPIC_TYPE_LABEL[topic.type] ?? topic.type,
    }),
    { markup: topicTypeKeyboard(topic.id) },
  );
}

const DEFAULT_DUE_HOURS: Record<TaskKind, number> = {
  personal: 48,
  class: 48,
  self_study: 72,
  bot: 24,
};

/** Rasm/ovoz/video/fayl bormi (matn emas). */
function hasMedia(content: ExtractedContent | null): boolean {
  return Boolean(content?.fileId);
}

/** Ustozning oddiy suhbat xabarlari vazifa bo'lib ketmasligi uchun. */
const MIN_TASK_TEXT = 10;

export async function createTaskFromContent(
  ctx: AppContext,
  kind: TaskKind,
  content: ExtractedContent,
  options: { assignedUserId?: number | null; dueHours?: number } = {},
): Promise<void> {
  const message = ctx.message;
  if (!message) return;

  const raw = content.text.trim();
  if (!raw && !content.fileId) return;
  if (raw.startsWith("/")) return;
  // Ustoz o'quvchiga javob yozyapti yoki izoh qoldiryapti — bu yangi vazifa emas.
  const replyTo = message.reply_to_message;
  if (replyTo && !replyTo.forum_topic_created) return;
  // Qisqa suhbat xabarlari ("ok", "yaxshi") vazifa emas.
  if (!content.fileId && raw.length < MIN_TASK_TEXT) return;

  const { prompt, answerKey } = splitAnswerKey(raw || content.fileName || "Fayl topshirig'i");
  const dueHours = options.dueHours ?? DEFAULT_DUE_HOURS[kind];
  const title = truncate(prompt || content.fileName || "Fayl topshirig'i", 60);

  try {
    await ctx.db.createTask({
      kind,
      prompt: prompt || "(fayl topshirig'i)",
      title,
      answer_key: answerKey,
      chat_id: ctx.chatId,
      thread_id: ctx.threadId,
      message_id: message.message_id,
      assigned_user_id: options.assignedUserId ?? null,
      points_mode: kind === "self_study" || kind === "bot" ? "fixed" : "graded",
      fixed_points: kind === "self_study"
        ? ctx.settings.self_study_points
        : kind === "bot"
        ? ctx.settings.bot_task_points
        : null,
      attachment_file_id: content.fileId,
      attachment_type: content.mimeType,
      due_at: new Date(Date.now() + dueHours * 3_600_000).toISOString(),
      created_by: ctx.user?.id ?? null,
    });
  } catch (error) {
    console.error("vazifa saqlanmadi", error);
    return;
  }
  // Guruhga xabar yozmaymiz — faqat 👌 reaksiya: bot vazifani qabul qildi.
  await ctx.tg.reactSafe(ctx.chatId, message.message_id, REACTION.taskPosted);
}

/** Ustoz vazifa xabarini tahrirlasa, vazifa matni ham yangilanadi. */
async function updateTaskFromEdit(ctx: AppContext): Promise<void> {
  const message = ctx.message;
  if (!message || !ctx.isTeacher) return;
  const task = await ctx.db.taskByMessage(ctx.chatId, message.message_id);
  if (!task) return;
  const content = extractContent(message);
  if (!content) return;
  const { prompt, answerKey } = splitAnswerKey(content.text || content.fileName || task.prompt);
  await ctx.db.updateTask(task.id, {
    prompt: prompt || task.prompt,
    title: truncate(prompt || task.prompt, 60),
    answer_key: answerKey ?? task.answer_key,
  });
}

/**
 * /ulash — guruhni botga ulaydi. Bo'limlar YARATILMAYDI: bot mavjud bo'limlarni o'zi taniydi.
 * Bo'limsiz oddiy guruhda ham ishlaydi.
 */
async function linkGroup(ctx: AppContext): Promise<void> {
  if (!ctx.isGroup) {
    await reply(ctx, T.needGroup);
    return;
  }
  if (!ctx.isTeacher && !ctx.isAdmin) {
    await reply(ctx, T.onlyStaff);
    return;
  }
  if (ctx.settings.group_chat_id === ctx.chatId) {
    await reply(ctx, T.groupLinkedOnce);
    return;
  }
  await ctx.db.updateSettings({
    group_chat_id: ctx.chatId,
    group_title: ctx.message?.chat.title ?? null,
  });
  ctx.settings = { ...ctx.settings, group_chat_id: ctx.chatId, group_title: ctx.message?.chat.title ?? null };
  await trackTopic(ctx);
  await reply(ctx, fill(T.linked, { title: esc(ctx.message?.chat.title ?? "guruh") }));
}

/** /yonalish speaking — bo'limga yo'nalish nomini beradi ("-" bilan tozalanadi). */
async function setTrack(ctx: AppContext, raw: string): Promise<void> {
  if (!ctx.isTeacher && !ctx.isAdmin) {
    await reply(ctx, T.onlyStaff);
    return;
  }
  if (!ctx.threadId) {
    await reply(ctx, T.onlyGroup);
    return;
  }
  const value = raw.trim().toLowerCase();
  if (!value) {
    await reply(ctx, T.trackAsk);
    return;
  }
  const track = value === "-" ? null : value.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 30);
  const topic = await trackTopic(ctx);
  await ctx.db.updateTopic(topic.id, { track, announced: true });
  await reply(ctx, fill(T.trackSet, {
    name: esc(topic.name ?? `#${topic.thread_id}`),
    track: track ? esc(trackLabel(track)) : "—",
  }));
}

/** /qoidalar — qoidalarni guruhga rasm bilan yuboradi va qadab qo'yadi (faqat ustoz/admin). */
async function postGroupRules(ctx: AppContext): Promise<void> {
  if (!ctx.isTeacher && !ctx.isAdmin) return;
  const me = await ctx.tg.getMe();
  const text = fill(T.groupRules, { penalty: ctx.settings.daily_penalty });
  const markup = me.username ? startBotKeyboard(me.username, T.dmNudgeButton) : undefined;

  let messageId: number;
  try {
    const image = onboardingSlide(1); // "Vazifani guruhga tashlang" slaydi
    if (!image) throw new Error("slayd yo'q");
    const sent = await ctx.tg.sendPhoto(ctx.chatId, image, {
      caption: text,
      threadId: ctx.threadId,
      markup,
    });
    messageId = sent.messageId;
  } catch (error) {
    console.error("qoidalar rasmi yuborilmadi, matn yuboriladi", error);
    messageId = await ctx.tg.sendMessage(ctx.chatId, text, { threadId: ctx.threadId, markup });
  }

  try {
    await ctx.tg.call("pinChatMessage", {
      chat_id: ctx.chatId,
      message_id: messageId,
      disable_notification: true,
    });
  } catch (error) {
    console.error("qoidalar qadalmadi (botda 'xabarni qadash' huquqi yo'q bo'lishi mumkin)", error);
  }
}

async function bindTopic(ctx: AppContext, raw: string): Promise<void> {
  if (!ctx.isTeacher) {
    await reply(ctx, T.onlyStaff);
    return;
  }
  if (!ctx.threadId) {
    await reply(ctx, T.needForum);
    return;
  }
  const map: Record<string, string> = {
    vazifalar: "tasks_thread_id",
    tasks: "tasks_thread_id",
    selfstudy: "self_study_thread_id",
    "self-study": "self_study_thread_id",
    self: "self_study_thread_id",
    ustozlar: "staff_thread_id",
    staff: "staff_thread_id",
    savollar: "questions_thread_id",
    questions: "questions_thread_id",
  };
  const key = map[raw.trim().toLowerCase()];
  if (!key) {
    await reply(ctx, T.topicBad);
    return;
  }
  const patch: Record<string, unknown> = {};
  patch[key] = ctx.threadId;
  await ctx.db.updateSettings(patch);
  await reply(ctx, fill(T.topicBound, { kind: raw.trim() }));
}

async function bindStudent(ctx: AppContext, query: string): Promise<void> {
  if (!ctx.isTeacher) {
    await reply(ctx, T.onlyStaff);
    return;
  }
  if (!ctx.threadId) {
    await reply(ctx, T.needForum);
    return;
  }
  const target = ctx.message?.reply_to_message?.from;
  let student: UserRow | null = null;
  if (target) student = await ctx.db.userByTg(target.id);
  else if (query) student = await ctx.db.findStudent(query);

  if (!student || student.role !== "student") {
    await reply(ctx, T.studentNotFound);
    return;
  }
  await ctx.db.updateUser(student.id, { topic_thread_id: ctx.threadId });
  await reply(ctx, fill(T.studentBound, { name: esc(student.full_name ?? "O'quvchi") }));
}

async function setDueDate(ctx: AppContext, raw: string): Promise<void> {
  if (!ctx.isTeacher) {
    await reply(ctx, T.onlyStaff);
    return;
  }
  const replyTo = ctx.message?.reply_to_message;
  const task = replyTo ? await ctx.db.taskByMessage(ctx.chatId, replyTo.message_id) : null;
  if (!task) {
    await reply(ctx, T.notTaskReply);
    return;
  }
  const due = parseDue(raw);
  if (!due) {
    await reply(ctx, T.dueBad);
    return;
  }
  await ctx.db.updateTask(task.id, { due_at: due.toISOString(), status: "active" });
  await reply(ctx, fill(T.dueSet, { date: fmtDateTime(due.toISOString(), ctx.settings.tz) }));
}

async function closeTask(ctx: AppContext, remove = false): Promise<void> {
  if (!ctx.isTeacher) {
    await reply(ctx, T.onlyStaff);
    return;
  }
  const replyTo = ctx.message?.reply_to_message;
  const task = replyTo ? await ctx.db.taskByMessage(ctx.chatId, replyTo.message_id) : null;
  if (!task) {
    await reply(ctx, T.notTaskReply);
    return;
  }
  await ctx.db.updateTask(task.id, { status: remove ? "deleted" : "closed" });
  await reply(ctx, fill(remove ? T.taskDeleted : T.taskClosedByStaff, { id: task.id }));
}

/** /bahola 8 — javobga reply qilib; yoki /bahola 12345 8. */
async function gradeByReply(ctx: AppContext, raw: string): Promise<void> {
  if (!ctx.isTeacher) {
    await reply(ctx, T.onlyStaff);
    return;
  }
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  let scoreText = parts[0] ?? "";
  const replyTo = ctx.message?.reply_to_message;
  let target = replyTo ? await ctx.db.submissionByMessage(ctx.chatId, replyTo.message_id) : null;

  if (!target && parts.length >= 2 && /^\d+$/.test(parts[0])) {
    target = await ctx.db.submissionById(Number(parts[0]));
    scoreText = parts[1];
  }
  const value = Number(scoreText.replace(",", "."));
  if (!target) {
    await reply(ctx, T.gradeNoSubmission);
    return;
  }
  if (!Number.isFinite(value) || value < 0.5 || value > 10) {
    await reply(ctx, T.badGrade);
    return;
  }
  try {
    const { points } = await applyTeacherGrade(ctx, target, value, ctx.sender.id);
    await reply(ctx, `✅ ${fill(T.gradeSaved, { score: value })} (+${points} ball)`);
  } catch (error) {
    console.error("baholashda xato", error);
    await reply(ctx, T.gradeNoSubmission);
  }
}

/** Savollar bo'limida bot faqat so'ralganda (/savol yoki @bot) AI bilan javob beradi. */
async function maybeAnswerInQuestions(ctx: AppContext): Promise<void> {
  if (ctx.isTeacher) return; // ustozlar o'zaro / o'quvchiga yozadi — bot aralashmaydi
  const text = (ctx.message?.text ?? "").trim();
  if (!text) return;
  if (isCommand(text, "/savol")) {
    await answerQuestion(ctx, commandArgs(text, "/savol"));
    return;
  }
  try {
    const me = await ctx.tg.getMe();
    if (me.username && text.toLowerCase().includes(`@${me.username.toLowerCase()}`)) {
      const question = text.replace(new RegExp(`@${me.username}`, "ig"), "").trim();
      await answerQuestion(ctx, question);
    }
  } catch (error) {
    console.error("getMe xatosi", error);
  }
}

/**
 * Suhbat xabari topshiriq emasligini aniqlaydi: qisqa matn yoki boshqa odamga javob.
 * Media (ovoz, rasm, video, fayl) har doim topshiriq hisoblanadi.
 */
function isChatterNotSubmission(ctx: AppContext, content: ExtractedContent | null): boolean {
  if (!content) return true;
  if (hasMedia(content)) return false;
  const replyTo = ctx.message?.reply_to_message;
  const replyingToTopicStart = Boolean(replyTo?.forum_topic_created);
  if (replyTo && !replyingToTopicStart) return true;
  return content.text.trim().length < 15;
}

async function routeGroupMessage(
  ctx: AppContext,
  route: ReturnType<typeof routeThread>,
  topic: TopicRow | null,
): Promise<void> {
  const message = ctx.message;
  if (!message) return;
  const student = route.type === "student" ? await ctx.db.userById(route.userId) : null;

  if (route.type === "questions") {
    await maybeAnswerInQuestions(ctx);
    return;
  }
  // Boshqa bo'limlarda (General, ustozlar, noma'lum) bot jim turadi — spam yo'q.
  if (route.type === "staff" || route.type === "group_root" || route.type === "unknown_topic") return;
  if (route.type === "ignored") {
    // Noma'lum bo'limga o'quvchi fayl tashlasa — ustozdan bir marta so'raymiz.
    const content = extractContent(message);
    if (topic && !ctx.isTeacher && hasMedia(content)) await askTopicTypeOnce(ctx, topic);
    return;
  }

  const kind: TaskKind = route.type === "self_study"
    ? "self_study"
    : route.type === "student"
    ? "personal"
    : "class";

  const content = extractContent(message);

  // --- Ustoz: oddiy xabar = kunlik vazifa ---
  if (ctx.isTeacher) {
    if (!content) return;
    await createTaskFromContent(ctx, kind, content, { assignedUserId: student?.id ?? null });
    return;
  }

  // --- O'quvchi: ro'yxatdan o'tmagan bo'lsa ham ID, nik va ism avtomatik saqlanadi ---
  if (isChatterNotSubmission(ctx, content)) return;
  const sender = await ensureUser(ctx);
  if (sender.role !== "student" || sender.status !== "active") return; // bloklangan / rad etilgan

  if (route.type === "student" && student && student.id !== sender.id) return;

  const replyTo = message.reply_to_message;
  let task = replyTo && !replyTo.forum_topic_created
    ? await ctx.db.taskByMessage(ctx.chatId, replyTo.message_id)
    : null;
  if (!task && route.type === "student") task = await ctx.db.answerableTask(sender.id, ["personal"]);
  if (!task) task = await ctx.db.latestTaskInThread(ctx.chatId, ctx.threadId);
  if (!task) {
    // Bu bo'limda hali vazifa yo'q: jim, faqat 🤷 reaksiya.
    await ctx.tg.reactSafe(ctx.chatId, message.message_id, REACTION.nothing);
    return;
  }
  if (task.status !== "active") {
    await ctx.tg.reactSafe(ctx.chatId, message.message_id, REACTION.think);
    return;
  }
  if (task.kind === "personal" && task.assigned_user_id !== sender.id) return;
  await handleSubmission(ctx, task, sender);
}

export async function handleGroup(ctx: AppContext): Promise<void> {
  const settings = ctx.settings;
  const text = ctx.message?.text ?? "";

  // Admin (ADMIN_TELEGRAM_IDS) botga /start bosmagan bo'lsa ham guruhda ustoz sifatida ishlaydi.
  if (!ctx.user && ctx.isAdmin) await ensureUser(ctx);

  if (isCommand(text, "/ulash")) {
    await linkGroup(ctx);
    return;
  }
  if (settings.group_chat_id !== ctx.chatId) {
    if (isCommand(text, "/start")) await reply(ctx, T.groupNotLinked);
    return;
  }

  if (ctx.message?.forum_topic_created || ctx.message?.forum_topic_edited) {
    await trackTopic(ctx);
    return;
  }

  // Tahrirlangan xabar yangi topshiriq emas (faqat ustoz vazifa matnini to'g'rilashi mumkin).
  if (ctx.update.edited_message) {
    await updateTaskFromEdit(ctx);
    return;
  }

  if (isCommand(text, "/bolim")) {
    await showTopicType(ctx);
    return;
  }
  if (isCommand(text, "/yonalish")) {
    await setTrack(ctx, commandArgs(text, "/yonalish"));
    return;
  }
  if (isCommand(text, "/id")) {
    await reply(ctx, fill(T.idText, { id: ctx.sender.id }));
    return;
  }
  if (isCommand(text, "/qoidalar")) {
    await postGroupRules(ctx);
    return;
  }
  if (isCommand(text, "/reyting") || isCommand(text, "/leaderboard") || isCommand(text, "/hafta")) {
    const weekly = isCommand(text, "/hafta");
    const since = weekly ? startOfWeek(new Date(), ctx.settings.tz) : null;
    const rows = await ctx.db.leaderboard(since, null);
    await sendLeaderboardCard(ctx.tg, ctx.chatId, rows, {
      period: weekly ? "week" : "all",
      threadId: ctx.threadId,
      replyTo: ctx.message?.message_id,
      meTgId: ctx.sender.id,
    });
    return;
  }
  if (isCommand(text, "/yordam") || isCommand(text, "/help")) {
    await reply(ctx, ctx.isTeacher ? T.helpStaff : T.helpStudent);
    return;
  }
  if (isCommand(text, "/mavzu")) {
    await bindTopic(ctx, commandArgs(text, "/mavzu"));
    return;
  }
  if (isCommand(text, "/bogla")) {
    await bindStudent(ctx, commandArgs(text, "/bogla"));
    return;
  }
  if (isCommand(text, "/muddat")) {
    await setDueDate(ctx, commandArgs(text, "/muddat"));
    return;
  }
  if (isCommand(text, "/yopish")) {
    await closeTask(ctx);
    return;
  }
  if (isCommand(text, "/ochirish")) {
    await closeTask(ctx, true);
    return;
  }
  if (isCommand(text, "/bahola")) {
    await gradeByReply(ctx, commandArgs(text, "/bahola"));
    return;
  }
  if (isCommand(text, "/topshiraolmadim")) {
    const sender = await ensureUser(ctx);
    if (sender.role !== "student" || sender.status !== "active") return;
    const task = await ctx.db.latestTaskInThread(ctx.chatId, ctx.threadId);
    if (!task) {
      await ctx.tg.reactSafe(ctx.chatId, ctx.message?.message_id, REACTION.nothing);
      return;
    }
    await handleSubmission(ctx, task, sender, {
      forceManual: true,
      forceManualReason: "O'quvchi topshira olmadi deb yozdi",
    });
    return;
  }
  if (isCommand(text, "/panel") || isCommand(text, "/fikr")) {
    await reply(ctx, T.onlyPrivate);
    return;
  }
  if (text.startsWith("/")) return; // boshqa buyruqlar (boshqa botlarniki ham bo'lishi mumkin)

  const topicOwner = ctx.threadId ? await ctx.db.userByThread(ctx.threadId) : null;
  const topic = topicOwner ? null : await trackTopic(ctx);
  const route = routeThread({
    chatId: ctx.chatId,
    threadId: ctx.threadId,
    settings,
    student: topicOwner ? { userId: topicOwner.id, tgId: Number(topicOwner.tg_id) } : null,
    topic: topic ? { type: topic.type, track: topic.track } : null,
  });

  if (route.type === "not_group") return;
  await routeGroupMessage(ctx, route, topic);
}
