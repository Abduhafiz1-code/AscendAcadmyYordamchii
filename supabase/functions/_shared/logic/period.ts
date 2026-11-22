import type { Period } from "../types.ts";

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(date: Date, tz: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string): number => {
    const value = parts.find((part) => part.type === type)?.value ?? "0";
    return Number(value);
  };
  let hour = get("hour");
  if (hour === 24) hour = 0;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

function zoneOffsetMs(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

export function localMidnight(date: Date, tz: string): Date {
  const p = zonedParts(date, tz);
  const offset = zoneOffsetMs(date, tz);
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - offset);
}

export function localDayKey(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function startOfWeek(date: Date, tz: string): Date {
  const midnight = localMidnight(date, tz);
  const p = zonedParts(midnight, tz);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const sinceMonday = (weekday + 6) % 7;
  return new Date(midnight.getTime() - sinceMonday * 86_400_000);
}

export function startOfMonth(date: Date, tz: string): Date {
  const midnight = localMidnight(date, tz);
  const p = zonedParts(midnight, tz);
  const offset = zoneOffsetMs(midnight, tz);
  return new Date(Date.UTC(p.year, p.month - 1, 1) - offset);
}

export function periodSince(period: Period, now: Date, tz: string): Date | null {
  if (period === "week") return startOfWeek(now, tz);
  if (period === "month") return startOfMonth(now, tz);
  return null;
}

export function periodLabel(period: Period): string {
  if (period === "week") return "shu hafta";
  if (period === "month") return "shu oy";
  return "umumiy";
}

export function parsePeriod(raw: string | undefined): Period {
  if (raw === "week" || raw === "month") return raw;
  return "all";
}
