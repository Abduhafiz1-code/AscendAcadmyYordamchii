import type { SettingsRow, TopicRow, TopicType } from "../types.ts";

export type ThreadRoute =
  | { type: "not_group" }
  | { type: "group_root" }
  | { type: "unknown_topic" }
  | { type: "ignored" }
  | { type: "tasks"; track: string | null }
  | { type: "self_study" }
  | { type: "questions" }
  | { type: "staff" }
  | { type: "student"; userId: number; tgId: number };

type GroupSettings = Pick<
  SettingsRow,
  | "group_chat_id"
  | "tasks_thread_id"
  | "self_study_thread_id"
  | "staff_thread_id"
  | "questions_thread_id"
>;

/**
 * Qaysi bo'limda yozilganini aniqlaydi.
 * Asosiy manba — `topics` jadvali (bot o'zi o'rganadi, admin /bolim bilan to'g'rilaydi).
 * Eski `app_settings` dagi thread ID lar faqat zaxira sifatida qoladi.
 */
export function routeThread(input: {
  chatId: number;
  threadId: number | null;
  settings: GroupSettings;
  student?: { userId: number; tgId: number } | null;
  topic?: Pick<TopicRow, "type" | "track"> | null;
}): ThreadRoute {
  const { settings, threadId } = input;
  if (!settings.group_chat_id || input.chatId !== Number(settings.group_chat_id)) {
    return { type: "not_group" };
  }
  if (input.student) {
    return { type: "student", userId: input.student.userId, tgId: input.student.tgId };
  }
  if (input.topic) {
    if (input.topic.type === "task") {
      return input.topic.track === "self_study"
        ? { type: "self_study" }
        : { type: "tasks", track: input.topic.track };
    }
    if (input.topic.type === "questions") return { type: "questions" };
    return { type: "ignored" }; // ignore | announce
  }
  if (threadId === null) return { type: "group_root" };
  if (settings.tasks_thread_id && threadId === Number(settings.tasks_thread_id)) {
    return { type: "tasks", track: null };
  }
  if (settings.self_study_thread_id && threadId === Number(settings.self_study_thread_id)) {
    return { type: "self_study" };
  }
  if (settings.questions_thread_id && threadId === Number(settings.questions_thread_id)) {
    return { type: "questions" };
  }
  if (settings.staff_thread_id && threadId === Number(settings.staff_thread_id)) {
    return { type: "staff" };
  }
  return { type: "unknown_topic" };
}

export interface TopicGuess {
  type: TopicType;
  track: string | null;
  /** Nomdan aniq tushunildimi (aks holda ustozdan so'raladi). */
  confident: boolean;
}

const SKILL_WORDS: [RegExp, string][] = [
  [/speak|gapir/, "speaking"],
  [/writ|yoz/, "writing"],
  [/listen|eshit/, "listening"],
  [/read|o'?qish/, "reading"],
  [/gramm/, "grammar"],
  [/vocab|lug'?at/, "vocabulary"],
  [/pronun|talaff/, "pronunciation"],
  [/translat|tarjima/, "translation"],
];

/** Mavzu nomini normallashtiradi: emoji, tinish belgilari olib tashlanadi. */
export function normalizeTopicName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[ʻʼ’‘`´]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Bo'lim nomidan turini taxmin qiladi. Kodda hech qanday ID qotirilmagan:
 * "Writing", "Speaking", "Self study", "Savollar" kabi nomlar o'zgarsa ham ishlaydi.
 */
export function classifyTopicName(rawName: string | null | undefined): TopicGuess {
  const name = normalizeTopicName(rawName ?? "");
  if (!name) return { type: "ignore", track: null, confident: false };

  if (/\bself\b|o'?z[- ]?o'?zini|mustaqil/.test(name)) {
    return { type: "task", track: "self_study", confident: true };
  }
  if (/savol|question|\bsavol-javob|\bfaq\b|\bask\b/.test(name)) {
    return { type: "questions", track: null, confident: true };
  }
  if (/reyting|natija|e'?lon|leaderboard|announce|yangilik|\btop\b/.test(name)) {
    return { type: "announce", track: null, confident: true };
  }
  if (/ustoz|teacher|staff|admin|hisobot|log\b/.test(name)) {
    return { type: "ignore", track: null, confident: true };
  }
  if (/offline|online|dars|lesson|mavzu|material|chat|suhbat|umumiy|general/.test(name)) {
    return { type: "ignore", track: null, confident: true };
  }
  for (const [pattern, track] of SKILL_WORDS) {
    if (pattern.test(name)) return { type: "task", track, confident: true };
  }
  if (/vazifa|topshiriq|task|homework|\bhw\b|kunlik|daily|assignment|\buy\b/.test(name)) {
    return { type: "task", track: null, confident: true };
  }
  return { type: "ignore", track: null, confident: false };
}

/** Eski nom: guruhni ulashdagi qadimgi taxmin (testlar uchun saqlangan). */
export function guessTopicKind(name: string): "tasks" | "self_study" | "staff" | "questions" | null {
  const lower = name.toLowerCase();
  if (lower.includes("self")) return "self_study";
  if (lower.includes("savol") || lower.includes("question")) return "questions";
  if (lower.includes("ustoz") || lower.includes("staff") || lower.includes("teacher")) {
    return "staff";
  }
  if (lower.includes("vazifa") || lower.includes("task")) return "tasks";
  return null;
}

/** Bo'lim turi uchun odam o'qiydigan nom. */
export function topicTypeLabel(type: TopicType): string {
  switch (type) {
    case "task":
      return "📝 Vazifa";
    case "questions":
      return "❓ Savollar";
    case "announce":
      return "🏆 Reyting / e'lon";
    default:
      return "🚫 E'tiborsiz";
  }
}

/** Yo'nalish (track) uchun chiroyli nom. */
export function trackLabel(track: string | null | undefined): string {
  if (!track) return "";
  const map: Record<string, string> = {
    self_study: "Self study",
    speaking: "Speaking",
    writing: "Writing",
    listening: "Listening",
    reading: "Reading",
    grammar: "Grammar",
    vocabulary: "Vocabulary",
    pronunciation: "Pronunciation",
    translation: "Translation",
  };
  return map[track] ?? track;
}
