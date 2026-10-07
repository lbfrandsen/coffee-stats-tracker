import { env } from "cloudflare:workers";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import type { Route } from "./+types/health";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "~/components/ui/chart";
import { APP_TIME_ZONE, parseUtcDateTime } from "~/lib/date-time";
import { getPersonDisplayColor } from "~/lib/person-colors";
import { cn } from "~/lib/utils";

const CAFFEINE_PER_CUP = 90; // mg
const RECOMMENDED_MAX_CAFFEINE_DAILY = 400; // mg
const CAFFEINE_HALF_LIFE = 5; // hours
const CAFFEINE_WARNING_THRESHOLD = RECOMMENDED_MAX_CAFFEINE_DAILY;
const CAFFEINE_DANGER_THRESHOLD = 500; // mg
const CAFFEINE_EFFECTIVELY_ZERO_THRESHOLD = 10; // mg
const LOOKBACK_HOURS = 48;
const SAMPLE_INTERVAL_MINUTES = 5;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

type CaffeineDrinkRow = {
  id: number;
  person_id: number;
  person_name: string;
  consumed_at: string;
};

type ParsedCaffeineDrink = CaffeineDrinkRow & {
  consumedAtMs: number;
};

type HealthCardPersonRow = {
  id: number;
  name: string;
};

type CaffeinePerson = {
  id: number;
  name: string;
  dataKey: string;
  color: string;
};

type CaffeineChartPoint = {
  minute: number;
  tooltipLabel: string;
  [personDataKey: string]: string | number;
};

type CaffeineSummary = {
  id: number;
  name: string;
  color: string;
  currentAmount: number;
  effectivelyZeroAt: string | null;
};

type HealthLoaderData = {
  dateLabel: string;
  people: CaffeinePerson[];
  points: CaffeineChartPoint[];
  yAxisMaximum: number;
  summaries: CaffeineSummary[];
};

const HEALTH_CARD_PERSON_ORDER = ["paven", "burger lars"] as const;

const datePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const dateTitleFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  day: "numeric",
  month: "long",
  year: "numeric",
});

const chartTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const forecastDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  dateStyle: "medium",
  timeStyle: "short",
});

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Health | Kaffemændene" },
    {
      name: "description",
      content: "Estimated caffeine remaining throughout the day.",
    },
  ];
}

export async function loader(): Promise<HealthLoaderData> {
  const now = new Date();
  const localDate = getZonedDateParts(now);
  const dayStartMs = zonedDateTimeToUtcMs(
    localDate.year,
    localDate.month,
    localDate.day,
  );
  const nextDate = addLocalDays(localDate, 1);
  const dayEndMs = zonedDateTimeToUtcMs(
    nextDate.year,
    nextDate.month,
    nextDate.day,
  );
  const chartEndMs = Math.min(now.getTime(), dayEndMs);
  const queryStartMs = dayStartMs - LOOKBACK_HOURS * HOUR_MS;

  const [drinksResult, healthCardPeopleResult] = await Promise.all([
    env.DB.prepare(
      `
        SELECT
          d.id,
          d.person_id,
          COALESCE(p.display_name, p.name) AS person_name,
          d.consumed_at
        FROM drinks d
        JOIN persons p ON p.id = d.person_id
        WHERE datetime(d.consumed_at) >= datetime(?)
          AND datetime(d.consumed_at) <= datetime(?)
        ORDER BY d.consumed_at ASC, d.id ASC
      `,
    )
      .bind(
        new Date(queryStartMs).toISOString(),
        new Date(chartEndMs).toISOString(),
      )
      .all<CaffeineDrinkRow>(),
    env.DB.prepare(
      `
        SELECT
          p.id,
          COALESCE(p.display_name, p.name) AS name
        FROM persons p
        WHERE lower(COALESCE(p.display_name, p.name)) IN (?, ?)
      `,
    )
      .bind(...HEALTH_CARD_PERSON_ORDER)
      .all<HealthCardPersonRow>(),
  ]);

  const drinks: ParsedCaffeineDrink[] = drinksResult.results.flatMap(
    (drink) => {
      const consumedAt = parseUtcDateTime(drink.consumed_at);

      return consumedAt
        ? [{ ...drink, consumedAtMs: consumedAt.getTime() }]
        : [];
    },
  );
  const people = buildPeople(drinks, dayStartMs, chartEndMs);
  const points = buildCaffeineChartPoints(
    drinks,
    people,
    dayStartMs,
    chartEndMs,
  );
  const highestValue = Math.max(
    0,
    ...points.flatMap((point) =>
      people.map((person) => Number(point[person.dataKey] ?? 0)),
    ),
  );

  return {
    dateLabel: dateTitleFormatter.format(now).toUpperCase(),
    people,
    points,
    summaries: buildCaffeineSummaries(
      healthCardPeopleResult.results,
      drinks,
      chartEndMs,
    ),
    yAxisMaximum: Math.max(
      RECOMMENDED_MAX_CAFFEINE_DAILY + 100,
      Math.ceil(highestValue / 100) * 100,
    ),
  };
}

export default function Health({ loaderData }: Route.ComponentProps) {
  const { dateLabel, people, points, summaries, yAxisMaximum } = loaderData;
  const chartConfig: ChartConfig = Object.fromEntries(
    people.map((person) => [
      person.dataKey,
      { label: person.name, color: person.color },
    ]),
  );
  const yAxisTicks = Array.from(
    { length: yAxisMaximum / 100 + 1 },
    (_, index) => index * 100,
  );
  const hourTicks = Array.from({ length: 25 }, (_, hour) => hour * 60);

  return (
    <section className="mx-auto grid max-w-6xl gap-4 px-4 py-8 sm:px-6 lg:px-8">
      <Card className="border-zinc-800 bg-zinc-950/80 ring-0">
        <CardHeader className="border-zinc-800">
          <CardTitle className="uppercase">{dateLabel}</CardTitle>
        </CardHeader>
        <CardContent>
          {people.length > 0 ? (
            <div className="overflow-x-auto pb-2">
              <ChartContainer
                config={chartConfig}
                className="h-148 w-full aspect-auto"
                style={{ minWidth: 1040 }}
                initialDimension={{ width: 1040, height: 768 }}
              >
                <LineChart
                  accessibilityLayer
                  data={points}
                  margin={{ top: 24, right: 24, left: 12, bottom: 8 }}
                >
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="minute"
                    domain={[0, 24 * 60]}
                    ticks={hourTicks}
                    axisLine={false}
                    tickLine={false}
                    tickMargin={10}
                    tickFormatter={formatChartMinute}
                  />
                  <YAxis
                    domain={[0, yAxisMaximum]}
                    ticks={yAxisTicks}
                    axisLine={false}
                    tickLine={false}
                    tickMargin={8}
                    allowDecimals={false}
                    width={68}
                    tickFormatter={(value: number) => `${value} mg`}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        indicator="line"
                        labelFormatter={(_, payload) =>
                          payload?.[0]?.payload?.tooltipLabel ?? ""
                        }
                        formatter={(value, name, item) => (
                          <>
                            <div
                              className="h-3 w-1 shrink-0 rounded-full"
                              style={{ backgroundColor: item.color }}
                            />
                            <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                              <span className="text-muted-foreground">
                                {chartConfig[String(name)]?.label ?? name}
                              </span>
                              <span className="font-mono font-medium text-foreground tabular-nums">
                                {Math.round(Number(value))} mg
                              </span>
                            </div>
                          </>
                        )}
                      />
                    }
                  />
                  <ReferenceLine
                    y={RECOMMENDED_MAX_CAFFEINE_DAILY}
                    stroke="#ef4444"
                    strokeDasharray="6 6"
                    strokeWidth={2}
                    label={{
                      value: "400mg anbefalet dagligt maksimum",
                      position: "insideTopRight",
                      fill: "#ef4444",
                      fontSize: 12,
                    }}
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  {people.map((person) => (
                    <Line
                      key={person.id}
                      type="linear"
                      dataKey={person.dataKey}
                      stroke={`var(--color-${person.dataKey})`}
                      strokeWidth={3}
                      dot={false}
                      activeDot={{ r: 5 }}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ChartContainer>
            </div>
          ) : (
            <div className="flex h-148 items-center justify-center text-sm text-zinc-400">
              No caffeine recorded for this day or the preceding 48 hours.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {summaries.map((summary) => {
          const isEffectivelyZero =
            summary.currentAmount <= CAFFEINE_EFFECTIVELY_ZERO_THRESHOLD;

          return (
            <Card
              key={summary.id}
              className={cn(
                "border-4 ring-0",
                getCaffeineStatusClasses(summary.currentAmount),
              )}
            >
              <CardHeader className="border-b border-white/15">
                <CardTitle
                  className="font-heading text-base! leading-normal font-medium uppercase"
                  style={{ color: summary.color }}
                >
                  {summary.name}
                </CardTitle>
                <CardAction
                  className="font-mono text-2xl font-bold tabular-nums"
                  style={{ color: summary.color }}
                >
                  {isEffectivelyZero ? 0 : Math.round(summary.currentAmount)} mg
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Vil være &lt;10 mg:
                </p>
                <p className="mt-1 text-lg font-semibold text-zinc-50">
                  {summary.effectivelyZeroAt ?? "Now"}
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  Hvis ingen koffein indtages fra nu af
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function buildPeople(
  drinks: ParsedCaffeineDrink[],
  dayStartMs: number,
  chartEndMs: number,
) {
  const peopleById = new Map<
    number,
    { id: number; name: string; drinksToday: number }
  >();

  for (const drink of drinks) {
    const person = peopleById.get(drink.person_id) ?? {
      id: drink.person_id,
      name: drink.person_name,
      drinksToday: 0,
    };

    if (drink.consumedAtMs >= dayStartMs && drink.consumedAtMs <= chartEndMs) {
      person.drinksToday += 1;
    }

    peopleById.set(drink.person_id, person);
  }

  return [...peopleById.values()]
    .sort(
      (personA, personB) =>
        personB.drinksToday - personA.drinksToday ||
        personA.name.localeCompare(personB.name),
    )
    .map((person) => ({
      id: person.id,
      name: person.name,
      dataKey: `person_${person.id}`,
      color: getPersonDisplayColor(person.name),
    }));
}

function buildCaffeineSummaries(
  people: HealthCardPersonRow[],
  drinks: ParsedCaffeineDrink[],
  timestamp: number,
) {
  return people
    .sort(
      (personA, personB) =>
        getHealthCardPersonOrder(personA.name) -
        getHealthCardPersonOrder(personB.name),
    )
    .map((person) => {
      const currentAmount = calculateCaffeineAmount(
        drinks,
        person.id,
        timestamp,
      );
      const hoursUntilEffectivelyZero =
        currentAmount > CAFFEINE_EFFECTIVELY_ZERO_THRESHOLD
          ? CAFFEINE_HALF_LIFE *
            Math.log2(currentAmount / CAFFEINE_EFFECTIVELY_ZERO_THRESHOLD)
          : null;

      return {
        id: person.id,
        name: person.name,
        color: getPersonDisplayColor(person.name),
        currentAmount,
        effectivelyZeroAt:
          hoursUntilEffectivelyZero === null
            ? null
            : forecastDateTimeFormatter.format(
                new Date(timestamp + hoursUntilEffectivelyZero * HOUR_MS),
              ),
      };
    });
}

function getHealthCardPersonOrder(name: string) {
  const order = HEALTH_CARD_PERSON_ORDER.indexOf(
    name.trim().toLowerCase() as (typeof HEALTH_CARD_PERSON_ORDER)[number],
  );

  return order === -1 ? HEALTH_CARD_PERSON_ORDER.length : order;
}

function getCaffeineStatusClasses(amount: number) {
  if (amount >= CAFFEINE_DANGER_THRESHOLD) {
    return "border-red-500 bg-red-500/15";
  }

  if (amount >= CAFFEINE_WARNING_THRESHOLD) {
    return "border-yellow-400 bg-yellow-400/15";
  }

  return "border-green-400 bg-green-400/15";
}

function buildCaffeineChartPoints(
  drinks: ParsedCaffeineDrink[],
  people: CaffeinePerson[],
  dayStartMs: number,
  chartEndMs: number,
) {
  const sampleTimes = new Set<number>([dayStartMs, chartEndMs]);
  const scanTimes = new Set<number>();

  for (
    let timestamp = dayStartMs + SAMPLE_INTERVAL_MINUTES * MINUTE_MS;
    timestamp < chartEndMs;
    timestamp += SAMPLE_INTERVAL_MINUTES * MINUTE_MS
  ) {
    sampleTimes.add(timestamp);
  }

  for (const drink of drinks) {
    if (drink.consumedAtMs >= dayStartMs && drink.consumedAtMs <= chartEndMs) {
      sampleTimes.add(drink.consumedAtMs);
      scanTimes.add(drink.consumedAtMs);
    }
  }

  return [...sampleTimes]
    .sort((timeA, timeB) => timeA - timeB)
    .flatMap((timestamp) => {
      const points: CaffeineChartPoint[] = [];

      if (scanTimes.has(timestamp)) {
        points.push(
          buildCaffeinePoint(drinks, people, dayStartMs, timestamp, false),
        );
      }

      points.push(
        buildCaffeinePoint(drinks, people, dayStartMs, timestamp, true),
      );

      return points;
    });
}

function buildCaffeinePoint(
  drinks: ParsedCaffeineDrink[],
  people: CaffeinePerson[],
  dayStartMs: number,
  timestamp: number,
  includeScansAtTimestamp: boolean,
) {
  const point: CaffeineChartPoint = {
    minute: getChartMinute(timestamp, dayStartMs),
    tooltipLabel: chartTimeFormatter.format(new Date(timestamp)),
  };

  for (const person of people) {
    const amount = calculateCaffeineAmount(
      drinks,
      person.id,
      timestamp,
      includeScansAtTimestamp,
    );

    point[person.dataKey] = Math.round(amount * 10) / 10;
  }

  return point;
}

function calculateCaffeineAmount(
  drinks: ParsedCaffeineDrink[],
  personId: number,
  timestamp: number,
  includeScansAtTimestamp = true,
) {
  return drinks.reduce((total, drink) => {
    const isEligible = includeScansAtTimestamp
      ? drink.consumedAtMs <= timestamp
      : drink.consumedAtMs < timestamp;

    if (drink.person_id !== personId || !isEligible) {
      return total;
    }

    const elapsedHours = (timestamp - drink.consumedAtMs) / HOUR_MS;

    return (
      total +
      CAFFEINE_PER_CUP * Math.pow(0.5, elapsedHours / CAFFEINE_HALF_LIFE)
    );
  }, 0);
}

function getZonedDateParts(date: Date) {
  const parts = datePartsFormatter.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function zonedDateTimeToUtcMs(year: number, month: number, day: number) {
  const desiredAsUtcMs = Date.UTC(year, month - 1, day);
  let utcMs = desiredAsUtcMs;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = getZonedDateParts(new Date(utcMs));
    const actualAsUtcMs = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    utcMs += desiredAsUtcMs - actualAsUtcMs;
  }

  return utcMs;
}

function addLocalDays(
  date: Pick<ReturnType<typeof getZonedDateParts>, "year" | "month" | "day">,
  days: number,
) {
  const shiftedDate = new Date(
    Date.UTC(date.year, date.month - 1, date.day + days),
  );

  return {
    year: shiftedDate.getUTCFullYear(),
    month: shiftedDate.getUTCMonth() + 1,
    day: shiftedDate.getUTCDate(),
  };
}

function getChartMinute(timestamp: number, dayStartMs: number) {
  if (timestamp === dayStartMs) return 0;

  const parts = getZonedDateParts(new Date(timestamp));

  return parts.hour * 60 + parts.minute + parts.second / 60;
}

function formatChartMinute(value: number) {
  if (value === 24 * 60) return "24:00";

  return `${String(Math.floor(value / 60)).padStart(2, "0")}:00`;
}
