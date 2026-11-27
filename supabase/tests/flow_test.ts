// Guruh oqimi testi: xotiradagi soxta baza va soxta Telegram bilan.
// Tekshiriladi: bo'limni avtomatik tanish, ustoz vazifasi, o'quvchini avto-ro'yxatga olish,
// guruhda FAQAT reaksiya, natija shaxsiy chatga, "botni ishga tushiring" eslatmasi bir marta.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { AppContext } from "../functions/_shared/context.ts";
import { handleGroup } from "../functions/_shared/handlers/group.ts";
import { handleRegistration, startRegistration } from "../functions/_shared/handlers/onboarding.ts";
import { BTN } from "../functions/_shared/texts.ts";
import { defaultSettings } from "../functions/_shared/db.ts";
import type {
  SettingsRow,
  TaskRow,
  TgMessage,
  TopicRow,
  UserRow,
} from "../functions/_shared/types.ts";

const GROUP = -1001;
const TEACHER_TG = 111;

// ------------------------------------------------------------------ soxta baza
class FakeDb {
  users: UserRow[] = [];
  topics: TopicRow[] = [];
  tasks: TaskRow[] = [];
  subs: Record<string, unknown>[] = [];
  points: { user_id: number; task_id: number; points: number }[] = [];
  private seq = 1;

  sessions = new Map<string, { state: string; data: Record<string, unknown> }>();
  getSession(chatId: number, userId: number) {
    const row = this.sessions.get(`${chatId}:${userId}`);
    return Promise.resolve(row ? { __state: row.state, ...row.data } : {});
  }
  setSession(chatId: number, userId: number, state: string, data: Record<string, unknown>) {
    this.sessions.set(`${chatId}:${userId}`, { state, data });
    return Promise.resolve();
  }
  clearSession(chatId: number, userId: number) {
    this.sessions.delete(`${chatId}:${userId}`);
    return Promise.resolve();
  }
  userByThread() {
    return Promise.resolve(null);
  }
  userById(id: number) {
    return Promise.resolve(this.users.find((u) => u.id === id) ?? null);
  }
  userByTg(tgId: number) {
    return Promise.resolve(this.users.find((u) => u.tg_id === tgId) ?? null);
  }
  userByUsername(username: string) {
    return Promise.resolve(this.users.find((u) => u.username === username) ?? null);
  }
  updateSettings() {
    return Promise.resolve();
  }
  linkChat() {
    return Promise.resolve();
  }
  isLinkedChat() {
    return Promise.resolve(false);
  }
  touchMember() {
    return Promise.resolve();
  }
  membersOfChat() {
    return Promise.resolve([]);
  }
  topicsOfChat(chatId: number) {
    return Promise.resolve(this.topics.filter((t) => t.chat_id === chatId));
  }
  hasMissedSubmission() {
    return Promise.resolve(false);
  }
  userSubmissions(userId: number) {
    return Promise.resolve(this.subs.filter((s) => s.user_id === userId) as never);
  }
  answerableTasksInChat(userId: number, chatId: number) {
    const rows = this.tasks.filter((task) =>
      task.status === "active" && task.chat_id === chatId &&
      ((task.kind !== "personal" && task.kind !== "bot") || task.assigned_user_id === userId)
    );
    return Promise.resolve(
      rows.filter((task) =>
        !this.points.some((p) => p.user_id === userId && p.task_id === task.id)
      ),
    );
  }
  lastTaskInThreadAnyStatus(chatId: number, threadId: number | null) {
    const list = this.tasks.filter((t) =>
      t.chat_id === chatId && (t.thread_id ?? null) === threadId && t.status !== "deleted"
    );
    return Promise.resolve(list[list.length - 1] ?? null);
  }
  activeTasksForStudent(user: UserRow) {
    return Promise.resolve(
      this.tasks.filter((t) =>
        t.status === "active" && (t.assigned_user_id === null || t.assigned_user_id === user.id)
      ),
    );
  }
  hasAdmin() {
    return Promise.resolve(this.users.some((u) => u.role === "admin"));
  }
  staff() {
    return Promise.resolve(this.users.filter((u) => u.role !== "student"));
  }
  createUser(input: Partial<UserRow>) {
    const row = {
      id: this.seq++,
      tg_id: 0,
      role: "student",
      status: "active",
      full_name: null,
      username: null,
      group_name: null,
      phone: null,
      teacher_id: null,
      topic_thread_id: null,
      dm_open: false,
      dm_nudged_at: null,
      onboarded: false,
      approved_at: null,
      ...input,
    } as UserRow;
    this.users.push(row);
    return Promise.resolve(row);
  }
  updateUser(id: number, patch: Partial<UserRow>) {
    const row = this.users.find((u) => u.id === id)!;
    Object.assign(row, patch);
    return Promise.resolve(row);
  }
  upsertTopic(chatId: number, threadId: number, name?: string | null) {
    let row = this.topics.find((t) => t.chat_id === chatId && t.thread_id === threadId);
    if (!row) {
      row = {
        id: this.seq++,
        chat_id: chatId,
        thread_id: threadId,
        name: null,
        type: "ignore",
        track: null,
        last_seen: "",
        announced: false,
      };
      this.topics.push(row);
    }
    if (name) row.name = name;
    return Promise.resolve(row);
  }
  updateTopic(id: number, patch: Partial<TopicRow>) {
    Object.assign(this.topics.find((t) => t.id === id)!, patch);
    return Promise.resolve();
  }
  claimTopicAnnounce(id: number) {
    const row = this.topics.find((t) => t.id === id)!;
    if (row.announced) return Promise.resolve(false);
    row.announced = true;
    return Promise.resolve(true);
  }
  topicById(id: number) {
    return Promise.resolve(this.topics.find((t) => t.id === id) ?? null);
  }
  createTask(input: Partial<TaskRow>) {
    const row = {
      id: this.seq++,
      status: "active",
      created_at: new Date().toISOString(),
      ...input,
    } as TaskRow;
    this.tasks.push(row);
    return Promise.resolve(row);
  }
  taskById(id: number) {
    return Promise.resolve(this.tasks.find((t) => t.id === id) ?? null);
  }
  taskByMessage(chatId: number, messageId: number) {
    return Promise.resolve(
      this.tasks.find((t) => t.chat_id === chatId && t.message_id === messageId) ?? null,
    );
  }
  latestTaskInThread(chatId: number, threadId: number | null) {
    const list = this.tasks.filter((t) =>
      t.chat_id === chatId && (t.thread_id ?? null) === threadId
    );
    return Promise.resolve(list[list.length - 1] ?? null);
  }
  attemptsFor(taskId: number, userId: number) {
    return Promise.resolve(
      this.subs.filter((s) => s.task_id === taskId && s.user_id === userId).length,
    );
  }
  scoredTaskIds(userId: number) {
    return Promise.resolve(
      new Set(this.points.filter((p) => p.user_id === userId).map((p) => p.task_id)),
    );
  }
  createSubmission(input: Record<string, unknown>) {
    const row = { id: this.seq++, status: "pending", ...input };
    this.subs.push(row);
    return Promise.resolve(row);
  }
  updateSubmission(id: number, patch: Record<string, unknown>) {
    Object.assign(this.subs.find((s) => s.id === id)!, patch);
    return Promise.resolve();
  }
  pointsByTask(userId: number, taskIds: number[]) {
    return Promise.resolve(
      new Map(
        this.points.filter((p) => p.user_id === userId && taskIds.includes(p.task_id))
          .map((p) => [p.task_id, p.points]),
      ),
    );
  }
  upsertPointEvent(input: { user_id: number; task_id?: number | null; points: number }) {
    const existing = this.points.find((p) =>
      p.user_id === input.user_id && p.task_id === input.task_id
    );
    if (existing) existing.points = input.points;
    else {this.points.push({
        user_id: input.user_id,
        task_id: input.task_id!,
        points: input.points,
      });}
    return Promise.resolve();
  }
}

// -------------------------------------------------------------- soxta Telegram
interface Sent {
  chatId: number;
  text: string;
  threadId?: number | null;
  markup?: unknown;
}

class FakeTg {
  sent: Sent[] = [];
  reactions: { chatId: number; messageId: number; emoji: string | null }[] = [];
  blockedDms = new Set<number>();
  sendMessage(
    chatId: number,
    text: string,
    options: { threadId?: number | null; markup?: unknown } = {},
  ) {
    if (chatId > 0 && this.blockedDms.has(chatId)) {
      return Promise.reject(new Error("Forbidden: bot can't initiate conversation with a user"));
    }
    this.sent.push({ chatId, text, threadId: options.threadId, markup: options.markup });
    return Promise.resolve(1);
  }
  react(chatId: number, messageId: number, emoji: string | null) {
    this.reactions.push({ chatId, messageId, emoji });
    return Promise.resolve();
  }
  reactSafe(chatId: number, messageId: number | undefined, emoji: string | null) {
    if (messageId) this.reactions.push({ chatId, messageId, emoji });
    return Promise.resolve();
  }
  edits: { chatId: number; messageId: number; text: string }[] = [];
  editMessage(chatId: number, messageId: number, text: string) {
    this.edits.push({ chatId, messageId, text });
    return Promise.resolve();
  }
  photos: { chatId: number; caption?: string }[] = [];
  sendPhoto(chatId: number, _photo: unknown, options: { caption?: string } = {}) {
    this.photos.push({ chatId, caption: options.caption });
    return Promise.resolve({ messageId: 1, fileId: "f" });
  }
  getChatMember() {
    return Promise.resolve({ status: "member" });
  }
  getMe() {
    return Promise.resolve({ id: 1, username: "ascend_test_bot" });
  }
  downloadFile() {
    return Promise.resolve(new Uint8Array([1, 2, 3]));
  }
  copyMessage() {
    return Promise.resolve(1);
  }
  inGroup() {
    return this.sent.filter((m) => m.chatId === GROUP);
  }
  dms(tgId: number) {
    return this.sent.filter((m) => m.chatId === tgId);
  }
}

// Gemini javobini soxtalashtirish
const realFetch = globalThis.fetch;
function stubAi(score: number, confidence = 0.9) {
  Deno.env.set("AI_API_KEY", "test-key");
  Deno.env.set("AI_PROVIDER", "gemini");
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({ score, feedback: "Yaxshi ish!", confidence, done: true }),
            }],
          },
        }],
      })),
    )) as typeof fetch;
}
function restoreAi() {
  globalThis.fetch = realFetch;
  Deno.env.delete("AI_API_KEY");
}
/** Oddiy matnli AI javobi (ustoz rejimi) uchun stub. */
function stubAiText(text: string) {
  Deno.env.set("AI_API_KEY", "test-key");
  Deno.env.set("AI_PROVIDER", "gemini");
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
      })),
    )) as typeof fetch;
}

// ------------------------------------------------------------------ yordamchilar
let messageSeq = 100;

function setup() {
  const db = new FakeDb();
  const tg = new FakeTg();
  const settings: SettingsRow = {
    ...defaultSettings(),
    group_chat_id: GROUP,
    group_title: "Victory club",
  };
  const teacher = db.users[
    db.users.push({
      id: 900,
      tg_id: TEACHER_TG,
      role: "teacher",
      status: "active",
      full_name: "Ustoz",
      username: "ustoz",
      group_name: null,
      phone: null,
      teacher_id: null,
      topic_thread_id: null,
      dm_open: true,
      dm_nudged_at: null,
      onboarded: true,
      approved_at: null,
    } as unknown as UserRow) - 1
  ];

  const ctxFor = (
    from: { id: number; first_name: string; username?: string },
    message: Partial<TgMessage>,
    thread: number | null,
  ): AppContext => {
    const user = db.users.find((u) => u.tg_id === from.id) ?? null;
    const msg = {
      message_id: ++messageSeq,
      date: 0,
      chat: { id: GROUP, type: "supergroup", title: "Victory club", is_forum: true },
      from: { ...from, is_bot: false },
      message_thread_id: thread ?? undefined,
      ...message,
    } as TgMessage;
    return {
      tg: tg as never,
      db: db as never,
      settings,
      update: { update_id: 1, message: msg },
      sender: { ...from, is_bot: false },
      chatId: GROUP,
      threadId: thread,
      message: msg,
      user,
      isGroup: true,
      isChannel: false,
      isTeacher: user?.role === "teacher" || user?.role === "admin",
      isAdmin: false,
      state: null,
      data: {},
    } as unknown as AppContext;
  };
  return { db, tg, teacher, ctxFor, settings };
}

const TEACHER = { id: TEACHER_TG, first_name: "Ustoz", username: "ustoz" };
const topicStart = (name: string) =>
  ({
    message_id: 1,
    date: 0,
    chat: { id: GROUP, type: "supergroup" as const },
    forum_topic_created: { name },
  }) as TgMessage;

// ------------------------------------------------------------------------ testlar
Deno.test("guruh ulanmagan bo'lsa bot jim turadi", async () => {
  const { db, tg, ctxFor, settings } = setup();
  settings.group_chat_id = null;
  await handleGroup(ctxFor(TEACHER, { text: "Bugungi vazifa: 10 ta gap yozing" }, 5));
  assertEquals(db.tasks.length, 0);
  assertEquals(tg.sent.length, 0);
});

Deno.test("yangi 'Writing' bo'limi avtomatik vazifa bo'limi bo'ladi, ustozga bir marta xabar boradi", async () => {
  const { db, tg, ctxFor } = setup();
  const text = "Bugungi vazifa: mavzu bo'yicha 10 ta gap yozing";
  await handleGroup(ctxFor(TEACHER, { text, reply_to_message: topicStart("✍️ Writing") }, 5));
  await handleGroup(
    ctxFor(TEACHER, { text: text + " (2)", reply_to_message: topicStart("✍️ Writing") }, 5),
  );

  const topic = db.topics.find((t) => t.thread_id === 5)!;
  assertEquals(topic.type, "task");
  assertEquals(topic.track, "writing");
  assertEquals(db.tasks.length, 2);
  // Guruhda hech qanday matn yo'q; ustozga faqat bitta "yangi bo'lim" xabari
  assertEquals(tg.inGroup().length, 0);
  const staffMessages = tg.dms(TEACHER_TG);
  assertEquals(staffMessages.filter((m) => m.text.includes("Writing")).length, 1);
  // Muddat yozilmagan har bir vazifa uchun bot ustozdan muddatni so'raydi.
  assertEquals(staffMessages.filter((m) => m.text.includes("muddat")).length, 2);
  // Ustoz vazifasiga 👌 reaksiya
  assertEquals(tg.reactions.filter((r) => r.emoji === "👌").length, 2);
});

Deno.test("ustozning qisqa suhbat xabari yoki javobi vazifa bo'lmaydi", async () => {
  const { db, ctxFor } = setup();
  await handleGroup(
    ctxFor(
      TEACHER,
      { text: "Writing vazifasi: 5 ta gap", reply_to_message: topicStart("Writing") },
      5,
    ),
  );
  const before = db.tasks.length;
  await handleGroup(ctxFor(TEACHER, { text: "yaxshi" }, 5));
  await handleGroup(
    ctxFor(TEACHER, {
      text: "Bu uzun izoh o'quvchiga javob",
      reply_to_message: { message_id: 7 } as TgMessage,
    }, 5),
  );
  assertEquals(db.tasks.length, before);
});

Deno.test("o'quvchi ovozli xabar tashlaydi: avto-ro'yxat, faqat reaksiya, natija DM ga", async () => {
  stubAi(9);
  try {
    const { db, tg, ctxFor } = setup();
    await handleGroup(ctxFor(TEACHER, {
      text: "Speaking: bugungi mavzu haqida gapiring\nJavob: my favourite day is Sunday",
      reply_to_message: topicStart("Speaking"),
    }, 8));
    tg.sent.length = 0;
    tg.reactions.length = 0;

    const student = { id: 555, first_name: "Ali", username: "ali_k" };
    const ctx = ctxFor(student, {
      voice: { file_id: "v1", file_unique_id: "u1", mime_type: "audio/ogg" },
    }, 8);
    await handleGroup(ctx);

    // avtomatik ro'yxat: ID va nik saqlandi
    const user = db.users.find((u) => u.tg_id === 555)!;
    assertEquals(user.username, "ali_k");
    assertEquals(user.full_name, "@ali_k");
    assertEquals(user.status, "active");
    assert(user.approved_at, "approved_at belgilanishi kerak (kunlik jarima uchun)");

    // topshiriq saqlandi va baholandi
    assertEquals(db.subs.length, 1);
    assertEquals(db.points[0].points, 9);

    // guruhda hech qanday matn xabari yo'q — faqat reaksiyalar: 👀 → 🔥
    assertEquals(tg.inGroup().length, 0);
    assertEquals(tg.reactions.map((r) => r.emoji), ["👀", "🔥"]);

    // natija, izoh va to'g'ri javob shaxsiy chatda
    const dm = tg.dms(555);
    assertEquals(dm.length, 1);
    assertStringIncludes(dm[0].text, "9/10");
    assertStringIncludes(dm[0].text, "my favourite day is Sunday");
    assert(dm[0].markup, "qo'shimcha vazifa tugmasi bo'lishi kerak");
    assertEquals(user.dm_open, true);
  } finally {
    restoreAi();
  }
});

Deno.test("10/10 uchun 💯; qayta topshirish ballni faqat oshiradi", async () => {
  stubAi(10);
  try {
    const { db, tg, ctxFor } = setup();
    await handleGroup(
      ctxFor(
        TEACHER,
        { text: "Writing: 8 ta gap yozing", reply_to_message: topicStart("Writing") },
        5,
      ),
    );
    const student = { id: 556, first_name: "Vali", username: "vali" };
    await handleGroup(ctxFor(student, { photo: [{ file_id: "p", file_unique_id: "pu" }] }, 5));
    assertEquals(tg.reactions.at(-1)?.emoji, "💯");
    assertEquals(db.points[0].points, 10);

    stubAi(6); // keyingi urinish yomonroq — ball pasaymaydi
    await handleGroup(ctxFor(student, { photo: [{ file_id: "p2", file_unique_id: "pu2" }] }, 5));
    assertEquals(db.points[0].points, 10);
  } finally {
    restoreAi();
  }
});

Deno.test("botga /start bosmagan o'quvchi: guruhda bir marta 'botni ishga tushiring' tugmasi", async () => {
  stubAi(8);
  try {
    const { tg, ctxFor } = setup();
    await handleGroup(
      ctxFor(TEACHER, {
        text: "Speaking: mavzu haqida gapiring",
        reply_to_message: topicStart("Speaking"),
      }, 8),
    );
    tg.sent.length = 0;
    tg.blockedDms.add(777);
    const student = { id: 777, first_name: "Sardor" };
    await handleGroup(ctxFor(student, { voice: { file_id: "a", file_unique_id: "a1" } }, 8));
    await handleGroup(ctxFor(student, { voice: { file_id: "b", file_unique_id: "b1" } }, 8));

    const groupMessages = tg.inGroup();
    assertEquals(groupMessages.length, 1, "eslatma faqat bir marta bo'lishi kerak");
    assertStringIncludes(JSON.stringify(groupMessages[0].markup), "t.me/ascend_test_bot");
  } finally {
    restoreAi();
  }
});

Deno.test("savollar bo'limida oddiy savolga AI javob beradi, salomlashuvga jim", async () => {
  stubAiText("Present perfect — o'tmishda boshlanib, hozirga aloqasi bor ish-harakat.");
  try {
    const { db, tg, ctxFor } = setup();
    await handleGroup(
      ctxFor(TEACHER, { text: "Savollar", reply_to_message: topicStart("Savollar") }, 3),
    );
    tg.sent.length = 0;
    tg.edits.length = 0;
    const student = { id: 600, first_name: "Zilola", username: "zil" };
    await handleGroup(
      ctxFor(student, { text: "Ustoz, present perfectni tushuntirib bera olasizmi?" }, 3),
    );
    // Guruhda "🤖 O'ylayapman..." xabari AI javobiga tahrirlanadi.
    assertStringIncludes(tg.edits.at(-1)?.text ?? "", "Present perfect");
    assertEquals(db.subs.length, 0);

    const before = tg.sent.length + tg.edits.length;
    await handleGroup(ctxFor(student, { text: "rahmat ustoz" }, 3));
    assertEquals(tg.sent.length + tg.edits.length, before);
  } finally {
    restoreAi();
  }
});

Deno.test("savollar bo'limidagi ovozli savol transkripsiya modeli bilan matnga ko'chiriladi", async () => {
  Deno.env.set("AI_API_KEY", "test-key");
  Deno.env.set("AI_PROVIDER", "gemini");
  Deno.env.delete("AI_MODEL");
  Deno.env.delete("AI_AUDIO_MODEL");
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requests.push({ url, body });
    if (url.includes("/interactions")) {
      return Promise.resolve(
        new Response(JSON.stringify({
          status: "completed",
          output_text: "Present perfect nima?",
        })),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({
        candidates: [{
          content: { parts: [{ text: "Present perfect — hozirga aloqasi bor ish-harakat." }] },
          finishReason: "STOP",
        }],
      })),
    );
  }) as typeof fetch;
  try {
    const { tg, ctxFor } = setup();
    await handleGroup(
      ctxFor(TEACHER, { text: "Savollar", reply_to_message: topicStart("Savollar") }, 3),
    );
    tg.sent.length = 0;
    tg.edits.length = 0;
    const student = { id: 620, first_name: "Dilnoza", username: "dilnoza" };
    await handleGroup(
      ctxFor(student, {
        voice: { file_id: "v9", file_unique_id: "u9", mime_type: "audio/ogg" },
      }, 3),
    );

    // 1) Ovoz maxsus transkripsiya modeliga Interactions API orqali yuboriladi.
    const audio = requests.find((request) => request.url.includes("/interactions"));
    assert(audio, "transkripsiya so'rovi yuborilishi kerak");
    assertEquals(audio!.body.model, "gemini-3.5-transcribe");
    const input = (audio!.body.input as { type: string; data: string; mime_type: string }[])[0];
    assertEquals(input.type, "audio");
    assertEquals(input.mime_type, "audio/ogg");
    assert(input.data.length > 0);
    assertEquals(
      (audio!.body.generation_config as { transcription_config: { mode: string } })
        .transcription_config.mode,
      "smart",
    );

    // 2) Javobni odatiy (asosiy) model tayyorlaydi.
    const answer = requests.at(-1)!;
    assertStringIncludes(answer.url, "models/gemini-4-neon:generateContent");
    assertStringIncludes(tg.edits.at(-1)?.text ?? "", "Present perfect");
  } finally {
    restoreAi();
  }
});

Deno.test("transkripsiya modeli xato bersa, ovoz asosiy model bilan matnga ko'chiriladi", async () => {
  Deno.env.set("AI_API_KEY", "test-key");
  Deno.env.set("AI_PROVIDER", "gemini");
  Deno.env.delete("AI_MODEL");
  Deno.env.delete("AI_AUDIO_MODEL");
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  let fallbackTranscripts = 0;
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requests.push({ url, body });
    if (url.includes("/interactions")) {
      return Promise.resolve(new Response("model overloaded", { status: 503 }));
    }
    const system = ((body.systemInstruction as { parts?: { text?: string }[] })?.parts ?? [])
      .map((part) => part.text ?? "").join("");
    if (system.includes("Audio ichidagi nutqni")) {
      fallbackTranscripts += 1;
      return Promise.resolve(
        new Response(JSON.stringify({
          candidates: [{
            content: { parts: [{ text: "Present perfect nima?" }] },
            finishReason: "STOP",
          }],
        })),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({
        candidates: [{
          content: { parts: [{ text: "Present perfect — hozirga aloqasi bor ish-harakat." }] },
          finishReason: "STOP",
        }],
      })),
    );
  }) as typeof fetch;
  try {
    const { tg, ctxFor } = setup();
    await handleGroup(
      ctxFor(TEACHER, { text: "Savollar", reply_to_message: topicStart("Savollar") }, 3),
    );
    tg.sent.length = 0;
    tg.edits.length = 0;
    await handleGroup(
      ctxFor({ id: 621, first_name: "Sardor", username: "sardor" }, {
        voice: { file_id: "v10", file_unique_id: "u10", mime_type: "audio/ogg" },
      }, 3),
    );

    // 503 bir marta qayta uriniladi, keyin asosiy model bilan transkripsiya qilinadi.
    assertEquals(requests.filter((request) => request.url.includes("/interactions")).length, 2);
    assertEquals(fallbackTranscripts, 1);
    assertStringIncludes(tg.edits.at(-1)?.text ?? "", "Present perfect");
  } finally {
    restoreAi();
  }
});

Deno.test("Gemini o'ylash tokenlari limitni yeb bo'sh javob qaytarsa — kattaroq limit bilan qayta so'raladi", async () => {
  Deno.env.set("AI_API_KEY", "test-key");
  Deno.env.set("AI_PROVIDER", "gemini");
  let calls = 0;
  const budgets: number[] = [];
  const graded = JSON.stringify({ score: 7, feedback: "Yaxshi", confidence: 0.9, done: true });
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    calls += 1;
    const body = JSON.parse(String(init?.body ?? "{}"));
    budgets.push(Number(body.generationConfig?.maxOutputTokens));
    if (calls === 1) {
      return Promise.resolve(
        new Response(JSON.stringify({
          candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }],
        })),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [
              { text: "ichki fikrlash", thought: true },
              { text: graded },
            ],
          },
          finishReason: "STOP",
        }],
      })),
    );
  }) as typeof fetch;
  try {
    const { db, tg, ctxFor } = setup();
    await handleGroup(
      ctxFor(
        TEACHER,
        { text: "Writing: 8 ta gap yozing", reply_to_message: topicStart("Writing") },
        5,
      ),
    );
    await handleGroup(ctxFor({ id: 610, first_name: "Bek" }, {
      text: "I go to school every day.",
    }, 5));
    assertEquals(calls, 2);
    assert(budgets[1] > budgets[0], "ikkinchi urinishda limit kattaroq bo'lishi kerak");
    assertEquals(db.points[0]?.points, 7);
    assertEquals(tg.reactions.at(-1)?.emoji, "👍");
  } finally {
    restoreAi();
  }
});

Deno.test("turi noma'lum bo'limga fayl tashlansa, ustozdan bir marta so'raladi", async () => {
  const { tg, ctxFor } = setup();
  const student = { id: 601, first_name: "Madina" };
  await handleGroup(ctxFor(student, { voice: { file_id: "a", file_unique_id: "a1" } }, 42));
  await handleGroup(ctxFor(student, { voice: { file_id: "b", file_unique_id: "b1" } }, 42));
  const staffMessages = tg.dms(TEACHER_TG);
  assertEquals(staffMessages.length, 1);
  assertStringIncludes(JSON.stringify(staffMessages[0].markup), "tt:");
  assertEquals(tg.inGroup().length, 0);
});

Deno.test("bo'limda vazifa yo'q bo'lsa: 🤷 reaksiya va qisqa tushuntirish", async () => {
  const { tg, ctxFor } = setup();
  await handleGroup(
    ctxFor(TEACHER, { text: "Writing", reply_to_message: topicStart("Writing") }, 5),
  ); // vazifa emas (qisqa)
  tg.sent.length = 0;
  await handleGroup(
    ctxFor({ id: 602, first_name: "Nodira" }, { voice: { file_id: "a", file_unique_id: "a1" } }, 5),
  );
  assertEquals(tg.reactions.at(-1)?.emoji, "🤷");
  // Bot jim qolmaydi: keyingi safar nima qilishni aytadi.
  const groupMessages = tg.inGroup();
  assertEquals(groupMessages.length, 1);
  assertStringIncludes(groupMessages[0].text, "faol vazifa yo'q");
});

Deno.test("shaxsiy /start: ism → telefon (ixtiyoriy) → rasmli qoidalar, bir marta", async () => {
  const { db, tg, settings } = setup();
  await db.createUser({ tg_id: 1, role: "admin", full_name: "Admin" }); // admin bor, shuning uchun Aziza o'quvchi bo'ladi
  const from = { id: 700, first_name: "Aziza", username: "aziza" };
  const privateCtx = (text: string, state: string | null): AppContext => {
    const user = db.users.find((u) => u.tg_id === 700) ?? null;
    const message = {
      message_id: ++messageSeq,
      date: 0,
      chat: { id: 700, type: "private" },
      from: { ...from, is_bot: false },
      text,
    } as TgMessage;
    return {
      tg: tg as never,
      db: db as never,
      settings,
      update: { update_id: 1, message },
      sender: { ...from, is_bot: false },
      chatId: 700,
      threadId: null,
      message,
      user,
      isGroup: false,
      isChannel: false,
      isTeacher: false,
      isAdmin: false,
      state,
      data: {},
    } as unknown as AppContext;
  };

  await startRegistration(privateCtx("/start", null));
  const user = db.users.find((u) => u.tg_id === 700)!;
  assertEquals(user.full_name, "Aziza");
  assertEquals(user.dm_open, true);
  assertStringIncludes(JSON.stringify(tg.dms(700).at(-1)?.markup), "nm:ok");

  // Telefon so'ralganda "O'tkazib yuborish" ishlaydi (avval bu qadamda qotib qolardi)
  const handled = await handleRegistration(privateCtx(BTN.skip, "reg_phone"));
  assertEquals(handled, true);
  assertEquals(user.onboarded, true);
  assertEquals(tg.photos.length, 1, "qoidalar rasm bilan yuborilishi kerak");
  assertStringIncludes(tg.photos[0].caption ?? "", "1/4");

  // Qayta /start: yana onboarding emas, "xush kelibsiz"
  tg.photos.length = 0;
  await startRegistration(privateCtx("/start", null));
  assertEquals(tg.photos.length, 0);
});
