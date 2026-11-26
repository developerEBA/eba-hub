export type RecognitionCadence = "month";
export const recognitionTimeZone = "Africa/Lagos";
const lagosDay = new Intl.DateTimeFormat("en-CA", { timeZone: recognitionTimeZone, year: "numeric", month: "2-digit", day: "2-digit" });
export function recognitionPeriodStart(cadence: RecognitionCadence, now = new Date()) {
  const date = lagosDay.format(now);
  return `${date.slice(0, 7)}-01`;
}
export function latestCompletedRecognitionPeriod(now = new Date()) {
  return nextRecognitionPeriod("month", recognitionPeriodStart("month", now), -1);
}
export function isRecognitionPeriod(cadence: RecognitionCadence, value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return false;
  return /^\d{4}-\d{2}-01$/.test(value);
}
export function nextRecognitionPeriod(cadence: RecognitionCadence, start: string, amount: number) {
  const date = new Date(start + "T00:00:00Z");
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 10);
}
export function recognitionPeriodEnd(cadence: RecognitionCadence, start: string) {
  return nextRecognitionPeriod(cadence, start, 1);
}
export function recognitionPeriodClosed(cadence: RecognitionCadence, start: string, now = new Date()) {
  return start < recognitionPeriodStart("month", now);
}
export function recognitionPeriodLabel(cadence: RecognitionCadence, start: string) {
  const from = new Date(start + "T00:00:00Z");
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", year: "numeric", month: "long" }).format(from);
}
