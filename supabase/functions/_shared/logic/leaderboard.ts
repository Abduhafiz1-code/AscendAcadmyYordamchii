import type { LeaderboardRow, Period } from "../types.ts";
import { esc, fmtPoints, medal } from "./format.ts";
import { periodLabel } from "./period.ts";

export function renderLeaderboard(
  rows: LeaderboardRow[],
  period: Period,
  meTgId?: number,
): string {
  const top = rows.slice(0, 10);
  const lines = [`🏆 <b>Leaderboard — ${periodLabel(period)}</b>`, ""];

  if (top.length === 0) {
    lines.push("Hali natijalar yo'q. Birinchi vazifani bajarib, reytingni boshlang!");
    return lines.join("\n");
  }

  for (const row of top) {
    lines.push(
      `${medal(row.place)} ${esc(row.full_name)} — <b>${fmtPoints(row.points)}</b> ball` +
        ` · ${row.tasks_done} vazifa` +
        (row.self_study_done > 0 ? ` · ${row.self_study_done} self study` : ""),
    );
  }

  const groups = new Map<string, { points: number; members: number }>();
  for (const row of rows) {
    if (!row.group_name || row.group_name === "—") continue;
    const current = groups.get(row.group_name) ?? { points: 0, members: 0 };
    current.points += Number(row.points);
    current.members += 1;
    groups.set(row.group_name, current);
  }
  const groupRanking = [...groups.entries()]
    .map(([name, value]) => ({ name, ...value, avg: value.points / Math.max(1, value.members) }))
    .sort((a, b) => b.avg - a.avg);

  if (groupRanking.length > 0) {
    lines.push("", "📚 <b>Guruhlar</b>");
    groupRanking.slice(0, 5).forEach((group, index) => {
      lines.push(
        `${index + 1}. ${esc(group.name)} — <b>${fmtPoints(group.avg)}</b> o'rtacha` +
          ` (${group.members} o'quvchi)`,
      );
    });
  }

  if (meTgId) {
    const me = rows.find((row) => Number(row.tg_id) === Number(meTgId));
    lines.push("");
    if (me) {
      lines.push(
        `🎯 Sizning o'rningiz: <b>${me.place}/${rows.length}</b> · ` +
          `<b>${fmtPoints(me.points)}</b> ball`,
      );
      if (me.penalties > 0) lines.push(`⚠️ Jarima: ${me.penalties} kun`);
    } else {
      lines.push("🎯 Siz hali reytingda yo'qsiz — birinchi vazifani bajaring!");
    }
  }

  return lines.join("\n");
}
