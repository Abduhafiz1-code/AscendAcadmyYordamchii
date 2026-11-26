/** "Javob: ..." qatorini matndan ajratib oladi (AI uchun kalit bo'lib qoladi). */
export function splitAnswerKey(text: string): { prompt: string; answerKey: string | null } {
  const lines = text.split("\n");
  const index = lines.findIndex((line) => /^\s*(?:javob|answer|kalit)\s*[:\-]/i.test(line));
  if (index < 0) return { prompt: text.trim(), answerKey: null };
  const answerKey = lines[index].replace(/^\s*(?:javob|answer|kalit)\s*[:\-]\s*/i, "").trim();
  const prompt = [...lines.slice(0, index), ...lines.slice(index + 1)].join("\n").trim();
  return { prompt, answerKey: answerKey || null };
}

/** Muddat: kun soni ("3") yoki ISO sana ("2026-11-20", Toshkent 20:00). */
export function parseDue(raw: string, now = new Date()): Date | null {
  const days = raw.trim().match(/^(\d{1,2})$/);
  if (days) {
    const value = Number(days[1]);
    if (value < 1 || value > 60) return null;
    return new Date(now.getTime() + value * 86_400_000);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    const date = new Date(`${raw.trim()}T20:00:00+05:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/** Vazifa matnidan muddatni topadi: "Muddat: 3 kun", "2 kun ichida" yoki ISO sana. */
export function extractDue(text: string, now = new Date()): { text: string; due: Date | null } {
  const lines = text.split("\n");
  const patterns = [
    /^\s*(?:muddat|deadline|due)\s*[:\-]?\s*(\d{1,2})(?:\s*(?:kun|days?))?\s*$/i,
    /^\s*(?:muddat|deadline|due)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})\s*$/i,
    /^\s*(\d{1,2})\s*(?:kun|days?)\s*(?:ichida|within)?\s*$/i,
  ];
  for (let i = 0; i < lines.length; i++) {
    const match = patterns.map((pattern) => lines[i].match(pattern)).find(Boolean);
    if (!match) continue;
    const due = parseDue(match[1], now);
    if (!due) continue;
    lines.splice(i, 1);
    return { text: lines.join("\n").trim(), due };
  }
  const date = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (date) {
    const due = parseDue(date[1], now);
    if (due) return { text: text.replace(date[0], "").trim(), due };
  }
  return { text: text.trim(), due: null };
}
