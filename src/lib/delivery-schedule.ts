/* Orders are dispatched every day until 7pm, and until 2pm on Colombian holidays. Anything
   received after the cutoff is scheduled for the next day. The app decides this, not the
   agent, so a late order is never promised for the same day. */

const TIME_ZONE = "America/Bogota";
const REGULAR_CUTOFF_HOUR = 19;
const HOLIDAY_CUTOFF_HOUR = 14;

/** YYYY-MM-DD for a calendar date, built in UTC so it never shifts with the server's zone. */
function isoDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/* Ley Emiliani: these holidays move to the following Monday when they fall on another day. */
function nextMonday(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday === 1 ? date : addDays(date, (8 - weekday) % 7);
}

function easterSunday(year: number): string {
  // Anonymous Gregorian algorithm.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(year, month, day);
}

const holidayCache = new Map<number, Set<string>>();

export function colombianHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const easter = easterSunday(year);
  const holidays = new Set<string>([
    isoDate(year, 1, 1),
    isoDate(year, 5, 1),
    isoDate(year, 7, 20),
    isoDate(year, 8, 7),
    isoDate(year, 12, 8),
    isoDate(year, 12, 25),
    ...[
      [1, 6],
      [3, 19],
      [6, 29],
      [8, 15],
      [10, 12],
      [11, 1],
      [11, 11],
    ].map(([month, day]) => nextMonday(isoDate(year, month, day))),
    addDays(easter, -3), // Jueves Santo
    addDays(easter, -2), // Viernes Santo
    addDays(easter, 43), // Ascensión
    addDays(easter, 64), // Corpus Christi
    addDays(easter, 71), // Sagrado Corazón
  ]);
  holidayCache.set(year, holidays);
  return holidays;
}

export function isColombianHoliday(date: string): boolean {
  return colombianHolidays(Number(date.slice(0, 4))).has(date);
}

function bogotaDateAndHour(instant: Date): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, hour: Number(part("hour")) };
}

export type DeliverySchedule = {
  /** Day the order goes out, YYYY-MM-DD in Bogota. */
  scheduledFor: string;
  /** True when it arrived after that day's cutoff and moved to the next day. */
  afterCutoff: boolean;
  /** Cutoff hour that applied on the day it was received (24h clock). */
  cutoffHour: number;
};

export function deliverySchedule(receivedAt: Date | string = new Date()): DeliverySchedule {
  const { date, hour } = bogotaDateAndHour(new Date(receivedAt));
  const cutoffHour = isColombianHoliday(date) ? HOLIDAY_CUTOFF_HOUR : REGULAR_CUTOFF_HOUR;
  const afterCutoff = hour >= cutoffHour;
  return { scheduledFor: afterCutoff ? addDays(date, 1) : date, afterCutoff, cutoffHour };
}

/** "martes, 13 de octubre", for messages to the customer and the panel. */
export function formatScheduledDay(date: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${date}T00:00:00Z`));
}

export function todayInBogota(now = new Date()): string {
  return bogotaDateAndHour(now).date;
}
