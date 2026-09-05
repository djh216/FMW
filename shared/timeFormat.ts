/** Format minutes since midnight as "10:00 AM" / "2:30 PM". */
export function formatMinutesAsTime(minutes: number): string {
  const normalized = ((Math.floor(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const h24 = Math.floor(normalized / 60);
  const m = normalized % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** Format "HH:MM" (24h) as "10:00 AM" / "2:30 PM". */
export function formatTimeOfDay(time: string): string {
  const [h, min] = time.split(":").map(Number);
  return formatMinutesAsTime(h * 60 + (min ?? 0));
}

export const DISPLAY_DATETIME: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
};

export function formatDateTime(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleString("en-US", DISPLAY_DATETIME);
}

/** Match formatted times like "10:00 AM" or "2:30 PM". */
export const AM_PM_TIME_PATTERN = /^\d{1,2}:\d{2} (AM|PM)$/;
