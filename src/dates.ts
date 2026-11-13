/**
 * Calendar dates as ISO strings ("2026-09-30"). They order correctly under plain string
 * comparison and serialize to JSON as themselves, so no Date objects or time zones are involved.
 */

export type IsoDate = string;

export interface Ymd {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export function isoDate(year: number, month: number, day: number): IsoDate {
  if (!(Number.isInteger(year) && year >= 1 && year <= 9999 && month >= 1 && month <= 12)) {
    throw new RangeError(`no such date: ${year}-${month}-${day}`);
  }
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`no such date: ${year}-${month}-${day}`);
  }
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Parse "YYYY-MM-DD", rejecting dates that don't exist. */
export function parseIsoDate(text: string): Ymd {
  const match = ISO.exec(text);
  if (!match) throw new RangeError(`not an ISO date: ${JSON.stringify(text)}`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  isoDate(year, month, day);
  return { year, month, day };
}

/** The first day of the month `months` away from `day`'s month. */
export function addMonths(day: IsoDate, months: number): IsoDate {
  const { year, month } = parseIsoDate(day);
  const index = year * 12 + month - 1 + months;
  return isoDate(Math.floor(index / 12), (((index % 12) + 12) % 12) + 1, 1);
}

/** The first day of every month from `start`'s month through `end`'s, inclusive. */
export function eachMonth(start: IsoDate, end: IsoDate): IsoDate[] {
  const months: IsoDate[] = [];
  for (let month = addMonths(start, 0); month.slice(0, 7) <= end.slice(0, 7); month = addMonths(month, 1)) {
    months.push(month);
  }
  return months;
}

export function withDayOfMonth(day: IsoDate, dayOfMonth: number): IsoDate {
  const { year, month } = parseIsoDate(day);
  return isoDate(year, month, dayOfMonth);
}

/** "09/30/2026" */
export function usDate(day: IsoDate): string {
  const { year, month, day: dayOfMonth } = parseIsoDate(day);
  return `${pad(month, 2)}/${pad(dayOfMonth, 2)}/${pad(year, 4)}`;
}

/** "September 30, 2026" */
export function longDate(day: IsoDate): string {
  const { year, month, day: dayOfMonth } = parseIsoDate(day);
  return `${MONTH_NAMES[month - 1]} ${dayOfMonth}, ${year}`;
}

export function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
