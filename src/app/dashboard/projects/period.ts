export function periodStart(value: unknown, period: "week" | "month" | "year") {
  const format = typeof value === "string" && /^[1-9]\d{3}-\d{2}-\d{2}$/.test(value);
  const candidate = format ? new Date(value + "T00:00:00Z") : null;
  const now = new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Lagos" }).format(new Date());
  const date = candidate && !Number.isNaN(candidate.valueOf()) && candidate.toISOString().slice(0, 10) === value
    ? candidate : new Date(now + "T00:00:00Z");
  if (period === "week") date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  if (period === "month") date.setUTCDate(1);
  if (period === "year") date.setUTCMonth(0, 1);
  return date.toISOString().slice(0, 10);
}
