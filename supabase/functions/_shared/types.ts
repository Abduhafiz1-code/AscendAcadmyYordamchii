// Telegram Bot API va ma'lumotlar bazasi uchun minimal turlar.

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  is_forum?: boolean;
}

export interface TgFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  duration?: number;
  mime_type?: string;
  file_name?: string;
  width?: number;
  height?: number;
}

export interface TgMessage {
  message_id: number;
  message_thread_id?: number;
  is_topic_message?: boolean;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  caption?: string;
  reply_to_message?: TgMessage;
  contact?: { phone_number: string; user_id?: number; first_name: string };
  photo?: TgFile[];
  media_group_id?: string;
  media_group_file_ids?: string[];
  media_group_message_ids?: number[];
  voice?: TgFile;
  audio?: TgFile;
  video?: TgFile;
  video_note?: TgFile;
  document?: TgFile;
  sticker?: TgFile;
  forum_topic_created?: { name: string; icon_color?: number };
  forum_topic_edited?: { name?: string };
  new_chat_members?: TgUser[];
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
  chat_instance: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export interface TgInlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TgReplyMarkup {
  inline_keyboard?: TgInlineButton[][];
  keyboard?: { text: string; request_contact?: boolean }[][];
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  is_persistent?: boolean;
}

// ---------------------------------------------------------------------------

export type Role = "admin" | "teacher" | "student";
export type UserStatus = "pending" | "active" | "rejected" | "blocked";
export type TaskKind = "personal" | "class" | "self_study" | "bot";
export type PointsMode = "graded" | "fixed";
export type SubmissionStatus =
  | "pending"
  | "ai_graded"
  | "manual"
  | "graded"
  | "missed"
  | "rejected";
export type Period = "week" | "month" | "all";
export type TopicKind = "tasks" | "self_study" | "staff" | "questions";
/** Guruh bo'limi turi: bot shunga qarab ish tutadi. */
export type TopicType = "task" | "questions" | "announce" | "ignore";

export interface UserRow {
  id: number;
  tg_id: number;
  role: Role;
  admin_opt_out?: boolean;
  status: UserStatus;
  full_name: string | null;
  username: string | null;
  group_name: string | null;
  phone: string | null;
  teacher_id: number | null;
  topic_thread_id: number | null;
  /** O'quvchiga shaxsiy xabar yuborish mumkin (botga /start bosgan). */
  dm_open: boolean;
  dm_nudged_at: string | null;
  onboarded: boolean;
  bot_tasks_date: string | null;
  bot_tasks_count: number;
  ai_date: string | null;
  ai_count: number;
  approved_at: string | null;
  approved_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface SettingsRow {
  id: boolean;
  group_chat_id: number | null;
  group_title: string | null;
  tasks_thread_id: number | null;
  self_study_thread_id: number | null;
  staff_thread_id: number | null;
  questions_thread_id: number | null;
  invite_code: string | null;
  tz: string;
  self_study_points: number;
  bot_task_points: number;
  daily_penalty: number;
  default_due_hours: number;
  /** Shu foizdan past ball - jarima (qo'shimcha vazifa). */
  penalty_min_percent: number;
  /** Qo'shimcha vazifa uchun muddat (soat). */
  remedial_due_hours: number;
  bot_tasks_per_day: number;
  ai_tutor_per_day: number;
  ai_enabled: boolean;
  ai_model: string | null;
  last_penalty_day: string | null;
  updated_at: string;
}

export interface TaskRow {
  id: number;
  kind: TaskKind;
  prompt: string;
  title: string | null;
  answer_key: string | null;
  criteria: string | null;
  chat_id: number | null;
  thread_id: number | null;
  message_id: number | null;
  assigned_user_id: number | null;
  points_mode: PointsMode;
  fixed_points: number | null;
  attachment_file_id: string | null;
  attachment_type: string | null;
  due_at: string | null;
  status: "active" | "closed" | "deleted";
  reminded_at: string | null;
  created_by: number | null;
  created_at: string;
}

export interface SubmissionRow {
  id: number;
  task_id: number;
  user_id: number;
  chat_id: number | null;
  thread_id: number | null;
  message_id: number | null;
  content_type: string;
  text_content: string | null;
  file_id: string | null;
  media_file_ids?: string[];
  media_message_ids?: number[];
  file_name: string | null;
  status: SubmissionStatus;
  ai_score: number | null;
  ai_feedback: string | null;
  ai_confidence: number | null;
  ai_model: string | null;
  final_score: number | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  created_at: string;
  graded_at: string | null;
}

export interface LeaderboardRow {
  user_id: number;
  tg_id: number;
  full_name: string;
  group_name: string;
  points: number;
  tasks_done: number;
  self_study_done: number;
  bot_tasks_done: number;
  penalties: number;
  place: number;
}

export interface TopicRow {
  id: number;
  chat_id: number;
  thread_id: number;
  name: string | null;
  type: TopicType;
  track: string | null;
  last_seen: string;
  /** Ustozlarga "yangi bo'lim" xabari yuborilganmi. */
  announced: boolean;
}

export interface FeedbackRow {
  id: number;
  user_id: number | null;
  text: string;
  status: "new" | "seen" | "done";
  created_at: string;
}

export interface InviteRow {
  code: string;
  role: Role;
  created_by: number | null;
  expires_at: string;
  used_by: number | null;
  used_at: string | null;
  created_at: string;
}

export interface BotSession {
  chat_id: number;
  user_id: number;
  state: string;
  data: Record<string, unknown>;
  updated_at: string;
}
