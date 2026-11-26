/** "Javob: ..." qatorini matndan ajratib oladi (AI uchun kalit bo'lib qoladi). */
export function splitAnswerKey(text: string): { prompt: string; answerKey: string | null } {
  const lines = text.split("\n");
  const index = lines.findIndex((line) => /^\s*(?:javob|answer|kalit)\s*[:\-]/i.test(line));
  if (index < 0) return { prompt: text.trim(), answerKey: null };
  const answerKey = lines[index].replace(/^\s*(?:javob|answer|kalit)\s*[:\-]\s*/i, "").trim();
  const prompt = [...lines.slice(0, index), ...lines.slice(index + 1)].join("\n").trim();
  return { prompt, answerKey: answerKey || null };
}

const UNIT_MS: Record<string, number> = {
  soat: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  kun: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  hafta: 7 * 86_400_000,
  week: 7 * 86_400_000,
};

/** Muddat: "3", "3 kun", "6 soat", "1 hafta" yoki ISO sana ("2026-11-20", Toshkent 20:00). */
export function parseDue(raw: string, now = new Date()): Date | null {
  const value = raw.trim().toLowerCase();
  const relative = value.match(/^(\d{1,3})\s*(soat|kun|hafta|hour|hours|day|days|week)?$/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2] ?? "kun";
    const ms = (UNIT_MS[unit] ?? 86_400_000) * amount;
    if (amount < 1 || ms > 60 * 86_400_000) return null;
    return new Date(now.getTime() + ms);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T20:00:00+05:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function tidy(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Vazifa matnidan muddatni topadi. Ustoz muddatni gap ichida yozsa ham tushunadi:
 * "Muddat: 3 kun", "3 kungacha", "2 soat ichida", "1 hafta", "2026-12-01".
 */
export function extractDue(text: string, now = new Date()): { text: string; due: Date | null } {
  const date = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (date) {
    const due = parseDue(date[1], now);
    if (due) return { text: tidy(text.replace(date[0], " ")), due };
  }

  const labeled = text.match(
    /\b(?:muddat[ai]?|deadline|due)\s*[:\-–—]?\s*(\d{1,3})\s*(soat|kun|hafta|hour|hours|day|days|week)?/i,
  );
  if (labeled) {
    const due = parseDue(`${labeled[1]}${labeled[2] ? ` ${labeled[2]}` : ""}`, now);
    if (due) return { text: tidy(text.replace(labeled[0], " ")), due };
  }

  const relative = text.match(/\b(\d{1,3})\s*(soat|kun|hafta)(?:dan|ga|gacha|kungacha|ichida)?\b/i);
  if (relative) {
    const due = parseDue(`${relative[1]} ${relative[2]}`, now);
    if (due) return { text: tidy(text.replace(relative[0], " ")), due };
  }

  return { text: text.trim(), due: null };
}
