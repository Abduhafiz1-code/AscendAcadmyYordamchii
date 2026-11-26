import { inline, replyKeyboard } from "./telegram.ts";
import { BTN } from "./texts.ts";
import type { TgReplyMarkup } from "./types.ts";

export function mainMenu(isStaff: boolean): TgReplyMarkup {
  const rows: { text: string }[][] = [
    [{ text: BTN.tasks }, { text: BTN.results }],
    [{ text: BTN.daily }, { text: BTN.rating }],
    [{ text: BTN.question }, { text: BTN.feedback }],
  ];
  if (isStaff) rows.push([{ text: BTN.panel }]);
  return replyKeyboard(rows);
}

export function registerKeyboard(): TgReplyMarkup {
  return replyKeyboard([[{ text: BTN.code }], [{ text: BTN.cancel }]]);
}

/** /start ekranidagi tugmalar. */
export function startKeyboard(): TgReplyMarkup {
  return replyKeyboard([
    [{ text: BTN.daily }, { text: BTN.rating }],
    [{ text: BTN.howto }],
  ]);
}

export function pendingUserKeyboard(): TgReplyMarkup {
  return replyKeyboard([
    [{ text: BTN.status }, { text: BTN.code }],
    [{ text: BTN.howto }],
  ]);
}

/** Ustozni tanlash: har bir faol ustoz alohida tugma. */
export function teacherKeyboard(
  teachers: { id: number; full_name: string | null }[],
): TgReplyMarkup {
  const rows = teachers.slice(0, 10).map((teacher) => [{
    text: teacher.full_name?.trim() || "Ustoz",
    callback_data: `th:${teacher.id}`,
  }]);
  rows.push([{ text: BTN.skip, callback_data: "th:skip" }]);
  return inline(rows);
}

/** Ismni tasdiqlash: Telegram ismi laqab bo'lishi mumkin. */
export function nameConfirmKeyboard(): TgReplyMarkup {
  return inline([[
    { text: "✅ Ha, to'g'ri", callback_data: "nm:ok" },
    { text: "✏️ O'zgartirish", callback_data: "nm:edit" },
  ]]);
}

export function phoneKeyboard(): TgReplyMarkup {
  return replyKeyboard([
    [{ text: "📱 Telefon raqamni yuborish", request_contact: true }],
    [{ text: BTN.skip }],
  ]);
}

export function periodKeyboard(current: string, prefix = "lb"): TgReplyMarkup {
  const label = (value: string, text: string) => ({
    text: current === value ? `· ${text} ·` : text,
    callback_data: `${prefix}:${value}`,
  });
  return inline([[
    label("week", "Hafta"),
    label("month", "Oy"),
    label("all", "Umumiy"),
  ]]);
}

const SCORES = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0.5];

export function gradeKeyboard(submissionId: number): TgReplyMarkup {
  const rows = [];
  for (let i = 0; i < SCORES.length; i += 4) {
    rows.push(
      SCORES.slice(i, i + 4).map((score) => ({
        text: String(score),
        callback_data: `g:${submissionId}:${score}`,
      })),
    );
  }
  rows.push([
    { text: "🔁 Qayta topshirish", callback_data: `g:${submissionId}:retry` },
    { text: "🚫 Rad etish", callback_data: `g:${submissionId}:reject` },
  ]);
  return inline(rows);
}

export function pendingKeyboard(userId: number): TgReplyMarkup {
  return inline([[
    { text: "✅ Tasdiqlash", callback_data: `ap:${userId}` },
    { text: "❌ Rad etish", callback_data: `rj:${userId}` },
  ]]);
}

export function panelKeyboard(isAdmin = false): TgReplyMarkup {
  const rows: { text: string; callback_data: string }[][] = [
    [{ text: "⏳ Tekshirish navbati", callback_data: "p:queue" }],
    [{ text: "👥 Yangi so'rovlar", callback_data: "p:pending" }],
    [{ text: "🎓 O'quvchilar", callback_data: "p:students" }],
    [{ text: "📚 Vazifalar", callback_data: "p:tasks" }],
    [{ text: "🧩 Bo'limlar", callback_data: "p:topics" }, {
      text: "💬 Fikrlar",
      callback_data: "p:feedback",
    }],
    [{ text: "📈 Statistika", callback_data: "p:stats" }],
    [{ text: "⚙️ Sozlamalar", callback_data: "p:settings" }],
    [{ text: "📢 Hammaga xabar", callback_data: "p:broadcast" }],
  ];
  if (isAdmin) {
    rows.push([
      { text: "👑 Admin qo'shish", callback_data: "aa:add" },
      { text: "🚪 Adminlikdan chiqish", callback_data: "aa:out" },
    ]);
  }
  return inline(rows);
}

export function settingsKeyboard(): TgReplyMarkup {
  return inline([
    [{ text: "🔑 O'quv kodi", callback_data: "s:invite" }],
    [{ text: "📖 Self study balli", callback_data: "s:self" }],
    [{ text: "🤖 Bot vazifa balli", callback_data: "s:bot" }],
    [{ text: "⚠️ Kunlik jarima", callback_data: "s:penalty" }],
    [{ text: "⏰ Vazifa muddati (soat)", callback_data: "s:due" }],
    [{ text: "🎯 Kunlik bot vazifalari", callback_data: "s:limit" }],
    [{ text: "📉 Jarima chegarasi (%)", callback_data: "s:minpct" }],
    [{ text: "🧾 Qo'shimcha vazifa muddati (soat)", callback_data: "s:remedial" }],
    [{ text: "⬅️ Panel", callback_data: "p:root" }],
  ]);
}

/** /bolim — bo'lim turini tanlash. */
export function topicTypeKeyboard(topicId: number): TgReplyMarkup {
  return inline([
    [{ text: "📝 Vazifa", callback_data: `tt:${topicId}:task` }],
    [{ text: "❓ Savollar", callback_data: `tt:${topicId}:questions` }],
    [{ text: "🏆 Reyting / e'lon", callback_data: `tt:${topicId}:announce` }],
    [{ text: "🚫 E'tiborsiz", callback_data: `tt:${topicId}:ignore` }],
  ]);
}

/** Guruh bo'limlari ro'yxati: har biri alohida tugma (tp:<id>). */
export function topicsListKeyboard(
  topics: { id: number; name: string | null; thread_id: number; type: string }[],
): TgReplyMarkup {
  const icon: Record<string, string> = {
    task: "📝",
    questions: "❓",
    announce: "🏆",
    ignore: "🚫",
  };
  return inline(
    topics.slice(0, 40).map((topic) => [{
      text: `${icon[topic.type] ?? "•"} ${topic.name ?? `#${topic.thread_id}`}`.slice(0, 60),
      callback_data: `tp:${topic.id}`,
    }]),
  );
}

/** Bot vazifasini olish tugmasi (erta tugatganlar uchun). */
export function bonusTaskKeyboard(): TgReplyMarkup {
  return inline([[{ text: "🎯 Qo'shimcha vazifa olish", callback_data: "dt:new" }]]);
}

/** Guruhda "botni ishga tushiring" tugmasi. */
export function startBotKeyboard(botUsername: string, label: string): TgReplyMarkup {
  return inline([[{ text: label, url: `https://t.me/${botUsername}?start=n` }]]);
}

export function taskKeyboard(taskId: number): TgReplyMarkup {
  return inline([[
    { text: "🔒 Yopish", callback_data: `t:close:${taskId}` },
    { text: "🗑 O'chirish", callback_data: `t:del:${taskId}` },
  ]]);
}

export function manualKeyboard(submissionId: number): TgReplyMarkup {
  return inline([[
    { text: "👨‍🏫 Baholash", callback_data: `g:${submissionId}:ask` },
    { text: "📂 Topshiriqni ko'rish", callback_data: `g:${submissionId}:show` },
  ]]);
}
