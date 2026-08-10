const APP_LOCALE = "en-GB";
const APP_TIME_ZONE = "Europe/Copenhagen";
const EMPTY_DATE = "—";

const SQLITE_UTC_DATE_TIME =
  /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)?$/;
const ISO_DATE_TIME_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;

const dateTimeFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: APP_TIME_ZONE,
});

const timeFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: APP_TIME_ZONE,
});

export function parseUtcDateTime(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const sqliteMatch = SQLITE_UTC_DATE_TIME.exec(value);
  const normalizedValue = sqliteMatch
    ? `${sqliteMatch[1]}T${sqliteMatch[2]}${sqliteMatch[3] ?? ""}Z`
    : ISO_DATE_TIME_WITH_ZONE.test(value)
      ? value
      : null;

  if (!normalizedValue) {
    return null;
  }

  const date = new Date(normalizedValue);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function getTimestampMilliseconds(value: string | null) {
  return parseUtcDateTime(value)?.getTime() ?? null;
}

export function formatDateTime(value: string | null) {
  const date = parseUtcDateTime(value);

  return date ? dateTimeFormatter.format(date) : EMPTY_DATE;
}

export function formatTime(value: string | null) {
  const date = parseUtcDateTime(value);

  return date ? timeFormatter.format(date) : EMPTY_DATE;
}

export function formatRelativeAge(value: string | null, nowMs: number) {
  const timestampMs = getTimestampMilliseconds(value);

  if (timestampMs === null) {
    return "No heartbeat";
  }

  const elapsedSeconds = Math.max(
    0,
    Math.floor((nowMs - timestampMs) / 1000),
  );

  if (elapsedSeconds < 60) {
    return `${elapsedSeconds} seconds ago`;
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);

  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} minutes ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);

  if (elapsedHours < 24) {
    return `${elapsedHours} hours ago`;
  }

  return `${Math.floor(elapsedHours / 24)} days ago`;
}
