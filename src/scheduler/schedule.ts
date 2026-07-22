const DATE_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

export interface DigestScheduleSlot {
  readonly key: string;
  readonly scheduledFor: Date;
  readonly localDate: string;
  readonly localTime: string;
}

export function findLatestEligibleSlot(options: {
  readonly now: Date;
  readonly timeZone: string;
  readonly times: readonly string[];
  readonly missedRunGraceMs: number;
}): DigestScheduleSlot | null {
  if (
    !Number.isInteger(options.missedRunGraceMs) ||
    options.missedRunGraceMs <= 0
  ) {
    throw new RangeError("missedRunGraceMs must be a positive integer");
  }
  const times = [...new Set(options.times)].sort();
  times.forEach(parseTime);
  const localToday = zonedParts(options.now, options.timeZone);
  const candidates: DigestScheduleSlot[] = [];

  // A grace period can cross a local date boundary. Seven days is a defensive
  // ceiling; configuration rejects operationally accidental unbounded backfill.
  if (options.missedRunGraceMs > 7 * 24 * 60 * 60 * 1_000) {
    throw new RangeError("missedRunGraceMs must not exceed seven days");
  }
  for (let offset = -7; offset <= 0; offset += 1) {
    const date = addUtcDays(
      localToday.year,
      localToday.month,
      localToday.day,
      offset,
    );
    for (const time of times) {
      const { hour, minute } = parseTime(time);
      const scheduledFor = localDateTimeToUtc(
        { ...date, hour, minute },
        options.timeZone,
      );
      const age = options.now.getTime() - scheduledFor.getTime();
      if (age >= 0 && age <= options.missedRunGraceMs) {
        const localDate = formatDate(date);
        candidates.push({
          key: `${options.timeZone}|${localDate}|${time}`,
          scheduledFor,
          localDate,
          localTime: time,
        });
      }
    }
  }
  return (
    candidates.sort(
      (left, right) =>
        right.scheduledFor.getTime() - left.scheduledFor.getTime(),
    )[0] ?? null
  );
}

export function localDateTimeToUtc(
  parts: {
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly hour: number;
    readonly minute: number;
  },
  timeZone: string,
): Date {
  const desiredWallTime = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
  let instant = desiredWallTime;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const actual = zonedParts(new Date(instant), timeZone);
    const actualWallTime = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    );
    const adjustment = desiredWallTime - actualWallTime;
    if (adjustment === 0) return new Date(instant);
    instant += adjustment;
  }
  throw new RangeError(
    "local schedule time does not exist in the configured time zone",
  );
}

function zonedParts(date: Date, timeZone: string) {
  if (Number.isNaN(date.getTime())) throw new RangeError("date must be valid");
  let formatter = DATE_FORMATTERS.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    DATE_FORMATTERS.set(timeZone, formatter);
  }
  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
  return {
    year: values.year!,
    month: values.month!,
    day: values.day!,
    hour: values.hour!,
    minute: values.minute!,
  };
}

function parseTime(value: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/u.exec(value);
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (!match || hour > 23 || minute > 59) {
    throw new RangeError(`invalid schedule time: ${value}`);
  }
  return { hour, minute };
}

function addUtcDays(year: number, month: number, day: number, offset: number) {
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function formatDate(parts: { year: number; month: number; day: number }) {
  return `${parts.year.toString().padStart(4, "0")}-${parts.month
    .toString()
    .padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}
