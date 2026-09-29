/**
 * Every time on the platform is shown in UTC and every amount in USD, so two people
 * in different places never read a deadline or a prize differently.
 */

type When = string | number | Date;

const DATE: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };

/** A calendar date, counted in UTC. */
export function utcDate(when: When, opts: Intl.DateTimeFormatOptions = DATE): string {
  return new Date(when).toLocaleDateString(undefined, { ...opts, timeZone: "UTC" });
}

/** A clock time, "14:55 UTC". */
export function utcTime(when: When): string {
  const time = new Date(when).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
  return `${time} UTC`;
}

/** A date and time, "Oct 6, 2026, 14:55 UTC". */
export function utcDateTime(when: When, opts: Intl.DateTimeFormatOptions = DATE): string {
  return `${utcDate(when, opts)}, ${utcTime(when)}`;
}

export function utcYear(when: When): number {
  return new Date(when).getUTCFullYear();
}

/** A whole-dollar amount, "$5,000 USD". */
export function usd(cents: number): string {
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
  return `${amount} USD`;
}

/** A stored instant as the value of a datetime-local input that is read as UTC. */
export function toUtcInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 16);
}

/** A datetime-local value, typed as UTC, back to an instant. */
export function fromUtcInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
