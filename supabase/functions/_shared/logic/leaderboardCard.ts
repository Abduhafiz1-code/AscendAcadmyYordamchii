import type { TelegramApi } from "../telegram.ts";
import type { LeaderboardRow, Period, TgReplyMarkup } from "../types.ts";
import { fmtPoints } from "./format.ts";
import { renderLeaderboard } from "./leaderboard.ts";
import { renderLeaderboardPng, safeName } from "./leaderboardImage.ts";
import { periodLabel } from "./period.ts";

export function toImageRows(rows: LeaderboardRow[]) {
  return rows.slice(0, 10).map((row) => ({
    place: row.place,
    name: safeName(row.full_name),
    points: fmtPoints(row.points),
    detail: `${row.tasks_done} vazifa` +
      (row.self_study_done > 0 ? ` · ${row.self_study_done} self study` : "") +
      (row.bot_tasks_done > 0 ? ` · ${row.bot_tasks_done} bot` : ""),
  }));
}

/**
 * Reytingni rasm sifatida yuboradi; rasm yasalmasa (shrift/wasm yuklanmadi va h.k.)
 * matnli reytingga qaytadi. true — rasm yuborildi.
 */
export async function sendLeaderboardCard(
  tg: TelegramApi,
  chatId: number,
  rows: LeaderboardRow[],
  options: {
    period: Period;
    caption?: string;
    subtitle?: string;
    threadId?: number | null;
    replyTo?: number | null;
    markup?: TgReplyMarkup;
    meTgId?: number;
  },
): Promise<boolean> {
  try {
    const png = await renderLeaderboardPng({
      title: options.period === "week" ? "Haftalik reyting" : options.period === "month" ? "Oylik reyting" : "Umumiy reyting",
      subtitle: options.subtitle ?? periodLabel(options.period),
      rows: toImageRows(rows),
      footer: "Ascend Academy · botda /reyting",
    });
    await tg.sendPhoto(chatId, png, {
      caption: options.caption,
      threadId: options.threadId,
      replyTo: options.replyTo,
      markup: options.markup,
    });
    return true;
  } catch (error) {
    console.error("reyting rasmi yasalmadi, matn yuboriladi", error instanceof Error ? error.message : error);
    await tg.sendMessage(chatId, renderLeaderboard(rows, options.period, options.meTgId), {
      threadId: options.threadId,
      replyTo: options.replyTo,
      markup: options.markup,
    });
    return false;
  }
}
