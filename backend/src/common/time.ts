// 时间工具：共享时段按“日期 + 当日分钟数”表达，夜间可跨午夜（endMinute 可 >1440）
// 统一使用 UTC，避免时区歧义。

export function slotDateToDate(date: string, minute: number): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + minute * 60000);
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

export function hoursBetween(a: Date, b: Date): number {
  return minutesBetween(a, b) / 60;
}

export function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

export function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

export function overlapMinutes(s1: Date, e1: Date, s2: Date, e2: Date): number {
  const s = maxDate(s1, s2);
  const e = minDate(e1, e2);
  return Math.max(0, minutesBetween(s, e));
}

export function fmtClock(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function fmtDateTime(d: Date): string {
  return `${d.toISOString().slice(0, 10)} ${fmtClock(d)} UTC`;
}
