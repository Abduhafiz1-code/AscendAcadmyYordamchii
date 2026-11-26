import { env } from "./env.ts";
import type { TgInlineButton, TgReplyMarkup, TgUpdate } from "./types.ts";

const API_ROOT = "https://api.telegram.org";
const MAX_MEDIA_BYTES = 14 * 1024 * 1024; // Gemini inline limitiga sig'ishi uchun

/**
 * Botlar qo'ya oladigan reaksiyalar (Telegram ruxsat etgan ro'yxatdan).
 * Eslatma: "✅" ruxsat etilmagan, shuning uchun 👍 / 🔥 / 💯 ishlatiladi.
 */
export const REACTION = {
  /** Topshiriq qabul qilindi. */
  ok: "👍",
  /** Qabul qilindi, tekshirilmoqda. */
  seen: "👀",
  /** Yaxshi natija (8–9). */
  great: "🔥",
  /** A'lo natija (10). */
  perfect: "💯",
  /** Ustoz tekshiradi yoki qayta topshirish kerak. */
  think: "🤔",
  /** Ustoz vazifa tashladi (bot qabul qildi). */
  taskPosted: "👌",
  /** Mos vazifa topilmadi. */
  nothing: "🤷",
} as const;

/** Ball bo'yicha reaksiya: 10 → 💯, 8–9 → 🔥, qolgani → 👍. */
export function reactionForScore(score: number): string {
  if (score >= 10) return REACTION.perfect;
  if (score >= 8) return REACTION.great;
  return REACTION.ok;
}

export class TelegramError extends Error {
  constructor(
    public method: string,
    public description: string,
    public code?: number,
  ) {
    super(`${method}: ${description}`);
  }
}

export class MediaTooLargeError extends Error {
  constructor(public size: number) {
    super(`Fayl juda katta: ${size} bayt`);
  }
}

export interface SendOptions {
  parseMode?: "HTML" | "MarkdownV2" | null;
  threadId?: number | null;
  replyTo?: number | null;
  markup?: TgReplyMarkup;
  disablePreview?: boolean;
}

let meCache: { id: number; username?: string } | null = null;

export class TelegramApi {
  constructor(public readonly token: string) {}

  async call<T = unknown>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${API_ROOT}/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({})) as {
        ok?: boolean;
        result?: T;
        description?: string;
        error_code?: number;
        parameters?: { retry_after?: number };
      };
      if (data.ok) return data.result as T;
      if (res.status === 429 && attempt < 2) {
        const wait = Math.min(data.parameters?.retry_after ?? 1, 5);
        await new Promise((resolve) => setTimeout(resolve, wait * 1000));
        continue;
      }
      throw new TelegramError(method, data.description ?? `HTTP ${res.status}`, data.error_code);
    }
    throw new Error(`${method}: urinishlar tugadi`);
  }

  async sendMessage(chatId: number, text: string, options: SendOptions = {}): Promise<number> {
    const result = await this.call<{ message_id: number }>("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: options.parseMode === null ? undefined : (options.parseMode ?? "HTML"),
      disable_web_page_preview: options.disablePreview ?? true,
      message_thread_id: options.threadId ?? undefined,
      reply_parameters: options.replyTo
        ? { message_id: options.replyTo, allow_sending_without_reply: true }
        : undefined,
      reply_markup: options.markup,
    });
    return result.message_id;
  }

  async editMessage(
    chatId: number,
    messageId: number,
    text: string,
    markup?: TgReplyMarkup,
  ): Promise<void> {
    await this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: markup,
    });
  }

  async deleteMessage(chatId: number, messageId: number): Promise<void> {
    await this.call("deleteMessage", { chat_id: chatId, message_id: messageId });
  }

  async answerCallback(callbackId: string, text?: string, alert = false): Promise<void> {
    await this.call("answerCallbackQuery", {
      callback_query_id: callbackId,
      text,
      show_alert: alert,
    });
  }

  /**
   * Xabarga reaksiya qo'yadi (avvalgisi almashadi). `null` — reaksiyani olib tashlaydi.
   * Telegram faqat ruxsat etilgan emojilarni qabul qiladi (qarang: REACTION).
   */
  async react(chatId: number, messageId: number, emoji: string | null = REACTION.ok): Promise<void> {
    await this.call("setMessageReaction", {
      chat_id: chatId,
      message_id: messageId,
      reaction: emoji ? [{ type: "emoji", emoji }] : [],
      is_big: false,
    });
  }

  /** Reaksiya xatosi hech qachon asosiy ishni to'xtatmasligi kerak. */
  async reactSafe(chatId: number, messageId: number | undefined, emoji: string | null): Promise<void> {
    if (!messageId) return;
    try {
      await this.react(chatId, messageId, emoji);
    } catch (error) {
      console.error("reaksiya qo'yilmadi", emoji, error instanceof Error ? error.message : error);
    }
  }

  /** Rasmni baytlardan yuboradi (multipart). file_id yoki URL bo'lsa ham ishlaydi. */
  async sendPhoto(
    chatId: number,
    photo: Uint8Array | string,
    options: SendOptions & { caption?: string } = {},
  ): Promise<{ messageId: number; fileId: string | null }> {
    const form = new FormData();
    form.set("chat_id", String(chatId));
    if (options.caption) {
      form.set("caption", options.caption);
      form.set("parse_mode", "HTML");
    }
    if (options.threadId) form.set("message_thread_id", String(options.threadId));
    if (options.replyTo) {
      form.set(
        "reply_parameters",
        JSON.stringify({ message_id: options.replyTo, allow_sending_without_reply: true }),
      );
    }
    if (options.markup) form.set("reply_markup", JSON.stringify(options.markup));
    if (typeof photo === "string") form.set("photo", photo);
    else form.set("photo", new Blob([photo as unknown as BlobPart], { type: "image/png" }), "photo.png");

    const res = await fetch(`${API_ROOT}/bot${this.token}/sendPhoto`, { method: "POST", body: form });
    const data = await res.json().catch(() => ({})) as {
      ok?: boolean;
      description?: string;
      error_code?: number;
      result?: { message_id: number; photo?: { file_id: string }[] };
    };
    if (!data.ok || !data.result) {
      throw new TelegramError("sendPhoto", data.description ?? `HTTP ${res.status}`, data.error_code);
    }
    const sizes = data.result.photo ?? [];
    return {
      messageId: data.result.message_id,
      fileId: sizes.length ? sizes[sizes.length - 1].file_id : null,
    };
  }

  /** Mavjud rasm xabarini boshqa rasm bilan almashtiradi (onboarding slaydlari). */
  async editPhoto(
    chatId: number,
    messageId: number,
    photo: Uint8Array,
    caption: string,
    markup?: TgReplyMarkup,
  ): Promise<void> {
    const form = new FormData();
    form.set("chat_id", String(chatId));
    form.set("message_id", String(messageId));
    form.set(
      "media",
      JSON.stringify({ type: "photo", media: "attach://file", caption, parse_mode: "HTML" }),
    );
    form.set("file", new Blob([photo as unknown as BlobPart], { type: "image/png" }), "slide.png");
    if (markup) form.set("reply_markup", JSON.stringify(markup));
    const res = await fetch(`${API_ROOT}/bot${this.token}/editMessageMedia`, {
      method: "POST",
      body: form,
    });
    const data = await res.json().catch(() => ({})) as { ok?: boolean; description?: string };
    if (!data.ok) throw new TelegramError("editMessageMedia", data.description ?? `HTTP ${res.status}`);
  }

  async copyMessage(
    toChatId: number,
    fromChatId: number,
    messageId: number,
    threadId?: number | null,
  ): Promise<number> {
    const res = await this.call<{ message_id: number }>("copyMessage", {
      chat_id: toChatId,
      from_chat_id: fromChatId,
      message_id: messageId,
      message_thread_id: threadId ?? undefined,
    });
    return res.message_id;
  }

  async copyMessages(
    toChatId: number,
    fromChatId: number,
    messageIds: number[],
    threadId?: number | null,
  ): Promise<void> {
    await this.call("copyMessages", {
      chat_id: toChatId,
      from_chat_id: fromChatId,
      message_ids: messageIds,
      message_thread_id: threadId ?? undefined,
    });
  }

  async createForumTopic(chatId: number, name: string): Promise<number> {
    const res = await this.call<{ message_thread_id: number }>("createForumTopic", {
      chat_id: chatId,
      name: name.slice(0, 128),
    });
    return res.message_thread_id;
  }

  /**
   * Foydalanuvchi guruh a'zosimi. null — aniqlab bo'lmadi (bot admin emas va h.k.).
   * A'zolik: creator / administrator / member yoki restricted + is_member.
   */
  async getChatMember(
    chatId: number,
    userId: number,
  ): Promise<{ status: string; is_member?: boolean } | null> {
    try {
      return await this.call<{ status: string; is_member?: boolean }>("getChatMember", {
        chat_id: chatId,
        user_id: userId,
      });
    } catch (error) {
      console.error("getChatMember xatosi", error);
      return null;
    }
  }

  /** Bot ma'lumotlari (taklif havolasi uchun username). Instansiyalar orasida keshlanadi. */
  async getMe(): Promise<{ id: number; username?: string }> {
    if (!meCache) meCache = await this.call<{ id: number; username?: string }>("getMe");
    return meCache;
  }

  async setMyCommands(commands: { command: string; description: string }[]): Promise<void> {
    await this.call("setMyCommands", { commands });
  }

  async downloadFile(fileId: string): Promise<Uint8Array> {
    const info = await this.call<{ file_path?: string; file_size?: number }>("getFile", {
      file_id: fileId,
    });
    if (info.file_size && info.file_size > MAX_MEDIA_BYTES) {
      throw new MediaTooLargeError(info.file_size);
    }
    if (!info.file_path) throw new Error("getFile: file_path qaytmadi");
    const res = await fetch(`${API_ROOT}/file/bot${this.token}/${info.file_path}`);
    if (!res.ok) throw new Error(`Faylni yuklab bo'lmadi: HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_MEDIA_BYTES) throw new MediaTooLargeError(buffer.byteLength);
    return new Uint8Array(buffer);
  }
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function botApi(): TelegramApi {
  const token = env("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN sozlanmagan.");
  return new TelegramApi(token);
}

// ---------------------------------------------------------------------------
// Xabar tarkibini aniqlash: matn, rasm, ovoz, audio, video, fayl, stiker.
// ---------------------------------------------------------------------------

export type ContentType =
  | "text"
  | "photo"
  | "voice"
  | "audio"
  | "video"
  | "video_note"
  | "document"
  | "sticker";

export interface ExtractedContent {
  contentType: ContentType;
  text: string;
  fileId: string | null;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  mediaFileIds?: string[];
}

export function extractContent(message: {
  text?: string;
  caption?: string;
  photo?: { file_id: string; file_size?: number }[];
  media_group_file_ids?: string[];
  voice?: { file_id: string; mime_type?: string; file_size?: number };
  audio?: { file_id: string; mime_type?: string; file_name?: string; file_size?: number };
  video?: { file_id: string; mime_type?: string; file_name?: string; file_size?: number };
  video_note?: { file_id: string; file_size?: number };
  document?: { file_id: string; mime_type?: string; file_name?: string; file_size?: number };
  sticker?: { file_id: string; file_size?: number; is_animated?: boolean; is_video?: boolean };
}): ExtractedContent | null {
  const text = (message.text ?? message.caption ?? "").trim();
  if (message.photo?.length) {
    const largest = message.photo[message.photo.length - 1];
    return {
      contentType: "photo",
      text,
      fileId: largest.file_id,
      mediaFileIds: message.media_group_file_ids ?? [largest.file_id],
      fileName: null,
      mimeType: "image/jpeg",
      fileSize: largest.file_size ?? null,
    };
  }
  if (message.voice) {
    return {
      contentType: "voice",
      text,
      fileId: message.voice.file_id,
      fileName: null,
      mimeType: message.voice.mime_type ?? "audio/ogg",
      fileSize: message.voice.file_size ?? null,
    };
  }
  if (message.audio) {
    return {
      contentType: "audio",
      text,
      fileId: message.audio.file_id,
      fileName: message.audio.file_name ?? null,
      mimeType: message.audio.mime_type ?? "audio/mpeg",
      fileSize: message.audio.file_size ?? null,
    };
  }
  if (message.video) {
    return {
      contentType: "video",
      text,
      fileId: message.video.file_id,
      fileName: message.video.file_name ?? null,
      mimeType: message.video.mime_type ?? "video/mp4",
      fileSize: message.video.file_size ?? null,
    };
  }
  if (message.video_note) {
    return {
      contentType: "video_note",
      text,
      fileId: message.video_note.file_id,
      fileName: null,
      mimeType: "video/mp4",
      fileSize: message.video_note.file_size ?? null,
    };
  }
  if (message.document) {
    return {
      contentType: "document",
      text,
      fileId: message.document.file_id,
      fileName: message.document.file_name ?? null,
      mimeType: message.document.mime_type ?? "application/octet-stream",
      fileSize: message.document.file_size ?? null,
    };
  }
  if (message.sticker) {
    return {
      contentType: "sticker",
      text,
      fileId: message.sticker.file_id,
      fileName: null,
      mimeType: message.sticker.is_video ? "video/webm" : "image/webp",
      fileSize: message.sticker.file_size ?? null,
    };
  }
  if (text) {
    return {
      contentType: "text",
      text,
      fileId: null,
      fileName: null,
      mimeType: null,
      fileSize: null,
    };
  }
  return null;
}

function textOf(message: string | { text?: string }): string {
  return typeof message === "string" ? message : (message.text ?? "");
}

/** "/cmd", "/cmd matn" va "/cmd@BotNomi matn" mos keladi; "/cmdx" mos kelmaydi. */
export function isCommand(message: string | { text?: string }, command: string): boolean {
  const text = textOf(message).trim().toLowerCase();
  const cmd = command.toLowerCase();
  if (!text.startsWith(cmd)) return false;
  const rest = text.slice(cmd.length);
  return rest === "" || /^(@\w+)?(\s|$)/.test(rest);
}

export function commandArgs(message: string | { text?: string }, command: string): string {
  return textOf(message).trim().slice(command.length).replace(/^@\w+/, "").trim();
}

export function inline(rows: TgInlineButton[][]): TgReplyMarkup {
  return { inline_keyboard: rows };
}

export function replyKeyboard(rows: { text: string; request_contact?: boolean }[][]): TgReplyMarkup {
  return {
    keyboard: rows,
    resize_keyboard: true,
    is_persistent: true,
    one_time_keyboard: false,
  };
}

export type { TgUpdate };
