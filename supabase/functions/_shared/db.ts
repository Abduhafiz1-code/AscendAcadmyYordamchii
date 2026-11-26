// Supabase (PostgREST) qatlami. Edge Function service_role kaliti bilan ishlaydi.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { env, requireEnv } from "./env.ts";
import type {
  FeedbackRow,
  InviteRow,
  LeaderboardRow,
  Role,
  SettingsRow,
  SubmissionRow,
  SubmissionStatus,
  TaskKind,
  TaskRow,
  TopicRow,
  TopicType,
  UserRow,
  UserStatus,
} from "./types.ts";

interface ResultLike<T> {
  data: T | null;
  error: { message: string } | null;
}

function unwrapOne<T>(result: ResultLike<T>, label: string): T | null {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

function unwrapMany<T>(result: ResultLike<T[]>, label: string): T[] {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data ?? [];
}

function mustOne<T>(result: ResultLike<T>, label: string): T {
  const value = unwrapOne(result, label);
  if (!value) throw new Error(`${label}: yozuv yaratilmadi`);
  return value;
}

export type TaskPatch = Partial<
  Pick<
    TaskRow,
    | "title"
    | "prompt"
    | "answer_key"
    | "criteria"
    | "chat_id"
    | "thread_id"
    | "message_id"
    | "assigned_user_id"
    | "points_mode"
    | "fixed_points"
    | "attachment_file_id"
    | "attachment_type"
    | "due_at"
    | "reminded_at"
    | "status"
    | "created_by"
  >
>;

export type SubmissionPatch = Partial<
  Pick<
    SubmissionRow,
    | "status"
    | "ai_score"
    | "ai_feedback"
    | "ai_confidence"
    | "ai_model"
    | "final_score"
    | "reviewed_by"
    | "reviewed_at"
    | "graded_at"
  >
>;

export interface CreateTaskInput {
  kind: TaskKind;
  prompt: string;
  title?: string | null;
  answer_key?: string | null;
  criteria?: string | null;
  chat_id?: number | null;
  thread_id?: number | null;
  message_id?: number | null;
  assigned_user_id?: number | null;
  points_mode?: "graded" | "fixed";
  fixed_points?: number | null;
  attachment_file_id?: string | null;
  attachment_type?: string | null;
  due_at?: string | null;
  created_by?: number | null;
}

export interface CreateSubmissionInput {
  task_id: number;
  user_id: number;
  chat_id?: number | null;
  thread_id?: number | null;
  message_id?: number | null;
  content_type: string;
  text_content?: string | null;
  file_id?: string | null;
  file_name?: string | null;
}

export interface PointEventInput {
  user_id: number;
  kind: "task" | "self_study" | "bot_task" | "penalty" | "adjustment" | "bonus";
  points: number;
  task_id?: number | null;
  submission_id?: number | null;
  note?: string | null;
  day?: string | null;
}

export class Db {
  readonly client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client =
      client ??
      createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { "x-application-name": "ascend-academy-bot" } },
      });
  }

  // ------------------------------------------------------------------ settings
  async getSettings(): Promise<SettingsRow> {
    return withSettingsCache(async () => {
      const existing = unwrapOne(
        await this.client.from("app_settings").select("*").eq("id", true).maybeSingle<SettingsRow>(),
        "app_settings",
      );
      if (existing) return normalizeSettings(existing);
      const created = mustOne(
        await this.client.from("app_settings").insert({ id: true }).select("*").single<SettingsRow>(),
        "app_settings insert",
      );
      return normalizeSettings(created);
    });
  }

  async updateSettings(patch: Record<string, unknown>): Promise<void> {
    invalidateSettingsCache();
    const { error } = await this.client
      .from("app_settings")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", true);
    if (error) throw new Error(`app_settings update: ${error.message}`);
  }

  // --------------------------------------------------------------------- users
  async userByTg(tgId: number): Promise<UserRow | null> {
    return unwrapOne(
      await this.client.from("users").select("*").eq("tg_id", tgId).maybeSingle<UserRow>(),
      "users by tg",
    );
  }

  async userById(id: number): Promise<UserRow | null> {
    return unwrapOne(
      await this.client.from("users").select("*").eq("id", id).maybeSingle<UserRow>(),
      "users by id",
    );
  }

  async userByThread(threadId: number): Promise<UserRow | null> {
    return unwrapOne(
      await this.client.from("users").select("*").eq("topic_thread_id", threadId)
        .maybeSingle<UserRow>(),
      "users by thread",
    );
  }

  async userByUsername(username: string): Promise<UserRow | null> {
    return unwrapOne(
      await this.client.from("users").select("*").eq("username", username.replace(/^@/, ""))
        .maybeSingle<UserRow>(),
      "users by username",
    );
  }

  async createUser(input: {
    tg_id: number;
    full_name: string | null;
    username: string | null;
    group_name?: string | null;
    role?: Role;
    status?: UserStatus;
    approved_at?: string | null;
    dm_open?: boolean;
  }): Promise<UserRow> {
    return mustOne(
      await this.client.from("users").insert(input).select("*").single<UserRow>(),
      "users insert",
    );
  }

  async updateUser(id: number, patch: Partial<UserRow>): Promise<UserRow> {
    return mustOne(
      await this.client.from("users").update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id).select("*").single<UserRow>(),
      "users update",
    );
  }

  async pendingUsers(): Promise<UserRow[]> {
    return unwrapMany(
      await this.client.from("users").select("*").eq("status", "pending")
        .order("created_at", { ascending: true }).limit(50),
      "pending users",
    ) as UserRow[];
  }

  async activeStudents(groupName: string | null = null): Promise<UserRow[]> {
    let query = this.client.from("users").select("*").eq("role", "student").eq("status", "active");
    if (groupName) query = query.eq("group_name", groupName);
    return unwrapMany(
      await query.order("full_name", { ascending: true }),
      "active students",
    ) as UserRow[];
  }

  async staff(): Promise<UserRow[]> {
    return unwrapMany(
      await this.client.from("users").select("*").in("role", ["admin", "teacher"])
        .eq("status", "active"),
      "staff",
    ) as UserRow[];
  }

  // -------------------------------------------------------------------- topics
  async topicByThread(chatId: number, threadId: number): Promise<TopicRow | null> {
    return unwrapOne(
      await this.client.from("topics").select("*").eq("chat_id", chatId)
        .eq("thread_id", threadId).maybeSingle<TopicRow>(),
      "topic by thread",
    );
  }

  async topicById(id: number): Promise<TopicRow | null> {
    return unwrapOne(
      await this.client.from("topics").select("*").eq("id", id).maybeSingle<TopicRow>(),
      "topic by id",
    );
  }

  /** Bo'limni yozib qo'yadi/yangilaydi. Yangi bo'lim `ignore` bo'lib qo'shiladi (keyin tur taxmin qilinadi). */
  async upsertTopic(
    chatId: number,
    threadId: number,
    name?: string | null,
  ): Promise<TopicRow> {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      thread_id: threadId,
      last_seen: new Date().toISOString(),
    };
    if (name) payload.name = name;
    return mustOne(
      await this.client.from("topics").upsert(payload, { onConflict: "chat_id,thread_id" })
        .select("*").single<TopicRow>(),
      "topics upsert",
    );
  }

  async updateTopic(
    id: number,
    patch: { type?: TopicType; track?: string | null; name?: string | null; announced?: boolean },
  ): Promise<void> {
    const { error } = await this.client.from("topics")
      .update({ ...patch, last_seen: new Date().toISOString() }).eq("id", id);
    if (error) throw new Error(`topics update: ${error.message}`);
  }

  /**
   * Bo'limni "e'lon qilingan" deb belgilaydi. Faqat birinchi chaqiruvchiga true qaytaradi
   * (parallel update'lar ustozlarga ikki marta xabar yubormasligi uchun).
   */
  async claimTopicAnnounce(id: number): Promise<boolean> {
    const { data, error } = await this.client.from("topics")
      .update({ announced: true }).eq("id", id).eq("announced", false).select("id");
    if (error) throw new Error(`topics announce: ${error.message}`);
    return (data?.length ?? 0) > 0;
  }

  async topicsOfChat(chatId: number): Promise<TopicRow[]> {
    return unwrapMany(
      await this.client.from("topics").select("*").eq("chat_id", chatId)
        .order("thread_id", { ascending: true }).limit(200),
      "topics of chat",
    ) as TopicRow[];
  }

  async announceTopics(chatId: number): Promise<TopicRow[]> {
    return unwrapMany(
      await this.client.from("topics").select("*").eq("chat_id", chatId).eq("type", "announce"),
      "announce topics",
    ) as TopicRow[];
  }

  // ----------------------------------------------------------------- feedback
  async createFeedback(userId: number | null, text: string): Promise<FeedbackRow> {
    return mustOne(
      await this.client.from("feedback").insert({ user_id: userId, text }).select("*")
        .single<FeedbackRow>(),
      "feedback insert",
    );
  }

  async recentFeedback(limit = 10): Promise<(FeedbackRow & { author: string | null })[]> {
    const rows = unwrapMany(
      await this.client.from("feedback").select("*, users(full_name, username)")
        .order("created_at", { ascending: false }).limit(limit),
      "feedback list",
    ) as (FeedbackRow & { users?: { full_name: string | null; username: string | null } | null })[];
    return rows.map((row) => ({
      ...row,
      author: row.users?.full_name ?? row.users?.username ?? null,
    }));
  }

  async newFeedbackCount(): Promise<number> {
    const { count, error } = await this.client.from("feedback")
      .select("id", { count: "exact", head: true }).eq("status", "new");
    if (error) throw new Error(`feedback count: ${error.message}`);
    return count ?? 0;
  }

  // ------------------------------------------------------------------- invites
  async createInvite(
    input: { code: string; role: Role; createdBy: number | null; days?: number },
  ): Promise<void> {
    const expires = new Date(Date.now() + (input.days ?? 2) * 86_400_000).toISOString();
    const { error } = await this.client.from("invites").insert({
      code: input.code,
      role: input.role,
      created_by: input.createdBy,
      expires_at: expires,
    });
    if (error) throw new Error(`invites insert: ${error.message}`);
  }

  /** Bir martalik taklif havolasini tekshiradi va ishlatilgan deb belgilaydi. */
  async redeemInvite(code: string, tgId: number): Promise<InviteRow | null> {
    const row = unwrapOne(
      await this.client.from("invites").select("*").eq("code", code).maybeSingle<InviteRow>(),
      "invite",
    );
    if (!row || row.used_at) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    const { error } = await this.client.from("invites").update({
      used_by: tgId,
      used_at: new Date().toISOString(),
    }).eq("code", code).is("used_at", null);
    if (error) throw new Error(`invites update: ${error.message}`);
    return row;
  }

  /** Botda umuman admin bormi — birinchi adminni aniqlash uchun. */
  async hasAdmin(): Promise<boolean> {
    const { count, error } = await this.client.from("users")
      .select("id", { count: "exact", head: true }).eq("role", "admin");
    if (error) throw new Error(`admin check: ${error.message}`);
    return (count ?? 0) > 0;
  }

  async hasOtherAdmin(userId: number): Promise<boolean> {
    const { count, error } = await this.client.from("users")
      .select("id", { count: "exact", head: true }).eq("role", "admin").neq("id", userId);
    if (error) throw new Error(`admin check: ${error.message}`);
    return (count ?? 0) > 0;
  }

  async findStudent(query: string): Promise<UserRow | null> {
    const needle = query.trim();
    if (!needle) return null;
    if (/^-?\d{5,}$/.test(needle)) {
      const byTg = await this.userByTg(Number(needle));
      if (byTg) return byTg;
    }
    const rows = unwrapMany(
      await this.client.from("users").select("*").eq("role", "student")
        .ilike("full_name", `%${needle}%`).limit(1),
      "find student",
    ) as UserRow[];
    return rows[0] ?? null;
  }

  /** Yangi o'quvchi uchun forum mavzusi nomi: "Ali Valiyev". */
  async createTopicForUser(user: UserRow, threadId: number): Promise<void> {
    await this.updateUser(user.id, { topic_thread_id: threadId });
  }

  // --------------------------------------------------------------------- tasks
  async createTask(input: CreateTaskInput): Promise<TaskRow> {
    return mustOne(
      await this.client.from("tasks").insert(input).select("*").single<TaskRow>(),
      "tasks insert",
    );
  }

  async taskById(id: number): Promise<TaskRow | null> {
    return unwrapOne(
      await this.client.from("tasks").select("*").eq("id", id).maybeSingle<TaskRow>(),
      "tasks by id",
    );
  }

  async taskByMessage(chatId: number, messageId: number): Promise<TaskRow | null> {
    return unwrapOne(
      await this.client.from("tasks").select("*").eq("chat_id", chatId)
        .eq("message_id", messageId).maybeSingle<TaskRow>(),
      "tasks by message",
    );
  }

  async updateTask(id: number, patch: TaskPatch): Promise<void> {
    const { error } = await this.client.from("tasks").update(patch).eq("id", id);
    if (error) throw new Error(`tasks update: ${error.message}`);
  }

  /**
   * O'quvchi javob berishi mumkin bo'lgan eng so'nggi vazifa:
   * shaxsiy → umumiy → bot → self study. Ball olgan vazifalar qaytarilmaydi.
   */
  async answerableTask(
    userId: number,
    kinds: TaskKind[] = ["personal", "class", "bot", "self_study"],
  ): Promise<TaskRow | null> {
    const rows = unwrapMany(
      await this.client.from("tasks").select("*").eq("status", "active")
        .in("kind", kinds)
        .or(`assigned_user_id.is.null,assigned_user_id.eq.${userId}`)
        .order("created_at", { ascending: false }).limit(25),
      "answerable tasks",
    ) as TaskRow[];

    const candidates = rows.filter((task) =>
      task.kind !== "personal" && task.kind !== "bot" ? true : task.assigned_user_id === userId
    );
    if (candidates.length === 0) return null;

    const scored = await this.scoredTaskIds(
      userId,
      candidates.map((task) => task.id),
    );
    const rank: Record<string, number> = { personal: 0, class: 1, bot: 2, self_study: 3 };
    const open = candidates
      .filter((task) => !scored.has(task.id))
      .sort((a, b) => {
        const byKind = (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9);
        if (byKind !== 0) return byKind;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    return open[0] ?? null;
  }

  /** Shu guruhdagi o'quvchiga ochiq barcha vazifalar (bo'limlar aralashib ketmasligi uchun chat bilan cheklanadi). */
  async answerableTasksInChat(userId: number, chatId: number): Promise<TaskRow[]> {
    const rows = unwrapMany(
      await this.client.from("tasks").select("*").eq("status", "active").eq("chat_id", chatId)
        .in("kind", ["personal", "class", "self_study", "bot"])
        .or(`assigned_user_id.is.null,assigned_user_id.eq.${userId}`)
        .order("created_at", { ascending: false }).limit(50),
      "answerable tasks in chat",
    ) as TaskRow[];
    const candidates = rows.filter((task) =>
      task.kind !== "personal" && task.kind !== "bot" || task.assigned_user_id === userId
    );
    const scored = await this.scoredTaskIds(userId, candidates.map((task) => task.id));
    return candidates.filter((task) => !scored.has(task.id));
  }

  /**
   * Shu bo'limdagi (thread) eng so'nggi faol vazifa. Boshqa bo'limdagi vazifalar bilan aralashmaydi:
   * Writing dagi javob Speaking vazifasiga ketmaydi. Eski vazifaga javob berish uchun
   * o'quvchi o'sha vazifa xabariga reply qiladi.
   */
  async latestTaskInThread(
    chatId: number,
    threadId: number | null,
    kinds: TaskKind[] = ["class", "self_study"],
  ): Promise<TaskRow | null> {
    let query = this.client.from("tasks").select("*").eq("status", "active")
      .in("kind", kinds).eq("chat_id", chatId);
    query = threadId === null ? query.is("thread_id", null) : query.eq("thread_id", threadId);
    const rows = unwrapMany(
      await query.order("created_at", { ascending: false }).limit(1),
      "latest task in thread",
    ) as TaskRow[];
    return rows[0] ?? null;
  }

  async pointsByTask(userId: number, taskIds: number[]): Promise<Map<number, number>> {
    if (taskIds.length === 0) return new Map();
    const rows = unwrapMany(
      await this.client.from("point_events").select("task_id, points").eq("user_id", userId)
        .in("task_id", taskIds),
      "task points",
    ) as { task_id: number | null; points: number }[];
    return new Map(rows.map((row) => [Number(row.task_id), Number(row.points)]));
  }

  async scoredTaskIds(userId: number, taskIds: number[]): Promise<Set<number>> {
    if (taskIds.length === 0) return new Set();
    const rows = unwrapMany(
      await this.client.from("point_events").select("task_id").eq("user_id", userId)
        .in("task_id", taskIds),
      "scored tasks",
    ) as { task_id: number | null }[];
    return new Set(rows.map((row) => Number(row.task_id)).filter((id) => id > 0));
  }

  async recentPrompts(limit = 8): Promise<string[]> {
    const rows = unwrapMany(
      await this.client.from("tasks").select("prompt").eq("status", "active")
        .order("created_at", { ascending: false }).limit(limit),
      "recent prompts",
    ) as { prompt: string }[];
    return rows.map((row) => row.prompt);
  }

  async activeTasks(limit = 20): Promise<TaskRow[]> {
    return unwrapMany(
      await this.client.from("tasks").select("*").eq("status", "active")
        .order("created_at", { ascending: false }).limit(limit),
      "active tasks",
    ) as TaskRow[];
  }

  async activeTaskCount(): Promise<number> {
    const { count, error } = await this.client.from("tasks")
      .select("id", { count: "exact", head: true }).eq("status", "active");
    if (error) throw new Error(`active tasks count: ${error.message}`);
    return count ?? 0;
  }

  async activeTasksForStudent(user: UserRow): Promise<TaskRow[]> {
    return unwrapMany(
      await this.client.from("tasks").select("*").eq("status", "active")
        .in("kind", ["personal", "class", "self_study", "bot"])
        .or(`assigned_user_id.is.null,assigned_user_id.eq.${user.id}`)
        .order("created_at", { ascending: false }).limit(30),
      "student active tasks",
    ) as TaskRow[];
  }

  async tasksDueBefore(now: Date): Promise<TaskRow[]> {
    return unwrapMany(
      await this.client.from("tasks").select("*").eq("status", "active")
        .not("due_at", "is", null).lt("due_at", now.toISOString())
        .limit(100),
      "due tasks",
    ) as TaskRow[];
  }

  async tasksDueBetween(from: Date, to: Date): Promise<TaskRow[]> {
    return unwrapMany(
      await this.client.from("tasks").select("*").eq("status", "active")
        .not("due_at", "is", null).gte("due_at", from.toISOString())
        .lt("due_at", to.toISOString()).is("reminded_at", null)
        .limit(100),
      "tasks due soon",
    ) as TaskRow[];
  }

  // --------------------------------------------------------------- submissions
  async createSubmission(input: CreateSubmissionInput): Promise<SubmissionRow> {
    return mustOne(
      await this.client.from("submissions").insert(input).select("*").single<SubmissionRow>(),
      "submissions insert",
    );
  }

  async submissionById(id: number): Promise<SubmissionRow | null> {
    return unwrapOne(
      await this.client.from("submissions").select("*").eq("id", id)
        .maybeSingle<SubmissionRow>(),
      "submission by id",
    );
  }

  async submissionByMessage(chatId: number, messageId: number): Promise<SubmissionRow | null> {
    return unwrapOne(
      await this.client.from("submissions").select("*").eq("chat_id", chatId)
        .eq("message_id", messageId).maybeSingle<SubmissionRow>(),
      "submission by message",
    );
  }

  async updateSubmission(id: number, patch: SubmissionPatch): Promise<void> {
    const { error } = await this.client.from("submissions").update(patch).eq("id", id);
    if (error) throw new Error(`submissions update: ${error.message}`);
  }

  async hasMissedSubmission(taskId: number, userId: number): Promise<boolean> {
    const { count, error } = await this.client.from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("task_id", taskId).eq("user_id", userId).eq("status", "missed");
    if (error) throw new Error(`missed check: ${error.message}`);
    return (count ?? 0) > 0;
  }

  async attemptsFor(taskId: number, userId: number): Promise<number> {
    const { count, error } = await this.client.from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("task_id", taskId).eq("user_id", userId);
    if (error) throw new Error(`attempts: ${error.message}`);
    return count ?? 0;
  }

  async manualQueue(limit = 10): Promise<SubmissionRow[]> {
    return unwrapMany(
      await this.client.from("submissions").select("*").in("status", ["manual", "pending"])
        .order("created_at", { ascending: true }).limit(limit),
      "manual queue",
    ) as SubmissionRow[];
  }

  async userSubmissions(userId: number, limit = 8): Promise<SubmissionRow[]> {
    return unwrapMany(
      await this.client.from("submissions").select("*").eq("user_id", userId)
        .order("created_at", { ascending: false }).limit(limit),
      "user submissions",
    ) as SubmissionRow[];
  }

  async daySubmissions(from: Date, to: Date): Promise<{ user_id: number; task_id: number }[]> {
    return unwrapMany(
      await this.client.from("submissions").select("user_id, task_id").neq("status", "rejected")
        .gte("created_at", from.toISOString()).lt("created_at", to.toISOString()),
      "day submissions",
    ) as { user_id: number; task_id: number }[];
  }

  // -------------------------------------------------------------------- points
  async upsertPointEvent(input: PointEventInput): Promise<void> {
    if (input.task_id) {
      const { error } = await this.client.from("point_events")
        .upsert(
          {
            user_id: input.user_id,
            kind: input.kind,
            points: input.points,
            task_id: input.task_id,
            submission_id: input.submission_id ?? null,
            note: input.note ?? null,
            ...(input.day ? { day: input.day } : {}),
          },
          { onConflict: "user_id,task_id" },
        );
      if (error) throw new Error(`point_events upsert: ${error.message}`);
      return;
    }
    const { error } = await this.client.from("point_events").insert({
      user_id: input.user_id,
      kind: input.kind,
      points: input.points,
      submission_id: input.submission_id ?? null,
      note: input.note ?? null,
      ...(input.day ? { day: input.day } : {}),
    });
    if (error) throw new Error(`point_events insert: ${error.message}`);
  }

  async leaderboard(since: Date | null, groupName: string | null = null): Promise<LeaderboardRow[]> {
    return unwrapMany(
      await this.client.rpc("leaderboard", {
        p_since: since ? since.toISOString() : null,
        p_group_name: groupName,
      }),
      "leaderboard rpc",
    ) as LeaderboardRow[];
  }

  async pointEventsForDay(day: string): Promise<{ user_id: number; kind: string; points: number }[]> {
    return unwrapMany(
      await this.client.from("point_events").select("user_id, kind, points")
        .eq("day", day),
      "point events for day",
    ) as { user_id: number; kind: string; points: number }[];
  }

  async applyDailyPenalties(day?: string): Promise<number> {
    const { data, error } = await this.client.rpc("apply_daily_penalties", {
      p_day: day ?? null,
    });
    if (error) throw new Error(`apply_daily_penalties: ${error.message}`);
    return Number(data ?? 0);
  }

  // ------------------------------------------------------------------ sessions
  async getSession(chatId: number, userId: number): Promise<Record<string, unknown>> {
    const row = unwrapOne(
      await this.client.from("bot_sessions").select("state, data").eq("chat_id", chatId)
        .eq("user_id", userId).maybeSingle<{ state: string; data: Record<string, unknown> }>(),
      "get session",
    );
    if (!row) return {};
    return { __state: row.state, ...(row.data ?? {}) };
  }

  async setSession(
    chatId: number,
    userId: number,
    state: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.client.from("bot_sessions").upsert({
      chat_id: chatId,
      user_id: userId,
      state,
      data,
      updated_at: new Date().toISOString(),
    }, { onConflict: "chat_id,user_id" });
    if (error) throw new Error(`set session: ${error.message}`);
  }

  async clearSession(chatId: number, userId: number): Promise<void> {
    const { error } = await this.client.from("bot_sessions").delete().eq("chat_id", chatId)
      .eq("user_id", userId);
    if (error) throw new Error(`clear session: ${error.message}`);
  }

  // ------------------------------------------------------------------- updates
  /** Telegram qayta yuborgan update'ni bir marta ishlatish uchun. */
  async claimUpdate(updateId: number): Promise<boolean> {
    const { error } = await this.client.from("processed_updates").insert({ update_id: updateId });
    if (!error) return true;
    if (error.code === "23505") return false;
    throw new Error(`claim update: ${error.message}`);
  }

  async cleanup(olderThan: Date): Promise<void> {
    const iso = olderThan.toISOString();
    await this.client.from("processed_updates").delete().lt("created_at", iso);
    await this.client.from("bot_sessions").delete().lt("updated_at", iso);
  }
}

// ---------------------------------------------------------------------------
// Sozlamalar bir so'rov ichida bir necha marta o'qiladi — keshlaymiz.
// ---------------------------------------------------------------------------
let settingsCache: { row: SettingsRow; at: number } | null = null;

function invalidateSettingsCache(): void {
  settingsCache = null;
}

async function withSettingsCache(load: () => Promise<SettingsRow>): Promise<SettingsRow> {
  if (settingsCache && Date.now() - settingsCache.at < 15_000) {
    return settingsCache.row;
  }
  const row = await load();
  settingsCache = { row, at: Date.now() };
  return row;
}

function normalizeSettings(row: SettingsRow): SettingsRow {
  return {
    ...row,
    self_study_points: Number(row.self_study_points ?? 2),
    bot_task_points: Number(row.bot_task_points ?? 3),
    daily_penalty: Number(row.daily_penalty ?? 5),
    default_due_hours: Number(row.default_due_hours ?? 48),
    bot_tasks_per_day: Number(row.bot_tasks_per_day ?? 3),
    ai_tutor_per_day: Number(row.ai_tutor_per_day ?? 20),
  };
}

export function defaultSettings(): SettingsRow {
  return {
    id: true,
    group_chat_id: null,
    group_title: null,
    tasks_thread_id: null,
    self_study_thread_id: null,
    staff_thread_id: null,
    questions_thread_id: null,
    invite_code: null,
    tz: "Asia/Tashkent",
    self_study_points: 2,
    bot_task_points: 3,
    daily_penalty: 5,
    default_due_hours: 48,
    bot_tasks_per_day: 3,
    ai_tutor_per_day: 20,
    ai_enabled: true,
    ai_model: null,
    last_penalty_day: null,
    updated_at: new Date().toISOString(),
  };
}

export function db(): Db {
  if (!dbInstance) dbInstance = new Db();
  return dbInstance;
}

let dbInstance: Db | null = null;

export function hasDbConfig(): boolean {
  return Boolean(env("SUPABASE_URL") && env("SUPABASE_SERVICE_ROLE_KEY"));
}

export function statusOf(submission: SubmissionRow): SubmissionStatus {
  return submission.status;
}
