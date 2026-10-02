// 共享时段匹配与预约冲突检测

export interface ShareWindow {
  weekday: number; // 0=周日..6=周六
  start_time: string; // HH:MM:SS
  end_time: string; // 与 start 相等或更早表示跨天，如 19:00 -> 08:00
}

function toMinutes(t: string) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** 某个时刻是否落在共享窗口内（支持跨天窗口） */
export function isInWindow(weekday: number, minutesOfDay: number, w: ShareWindow) {
  const s = toMinutes(w.start_time);
  const e = toMinutes(w.end_time);
  if (s === e) return false;
  if (e > s) {
    return weekday === w.weekday && minutesOfDay >= s && minutesOfDay < e;
  }
  // 跨天：当天 s..24:00，或次日 00:00..e
  if (weekday === w.weekday && minutesOfDay >= s) return true;
  if (weekday === (w.weekday + 1) % 7 && minutesOfDay < e) return true;
  return false;
}

/** 整个预约区间必须被共享窗口覆盖（按 15 分钟步进校验） */
export function isIntervalCovered(start: Date, end: Date, windows: ShareWindow[]) {
  if (end <= start || windows.length === 0) return false;
  const stepMs = 15 * 60000;
  for (let t = start.getTime(); t < end.getTime(); t += stepMs) {
    const d = new Date(t);
    const weekday = d.getDay();
    const mins = d.getHours() * 60 + d.getMinutes();
    if (!windows.some((w) => isInWindow(weekday, mins, w))) return false;
  }
  return true;
}

export function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** 预估费用：按小时单价 × 时长，应用夜间封顶 */
export function estimateFee(start: Date, end: Date, hourlyRate: number, cap?: number | null) {
  const hours = Math.max(0, (end.getTime() - start.getTime()) / 3600000);
  let fee = Math.round(hours * hourlyRate * 100) / 100;
  if (cap && fee > cap) fee = cap;
  return fee;
}
