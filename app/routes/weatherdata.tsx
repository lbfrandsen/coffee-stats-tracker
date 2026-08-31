import { env } from "cloudflare:workers";
import { Cloud, CloudRain, CloudSun } from "lucide-react";
import { useLoaderData } from "react-router";
import {
  CartesianGrid,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from "recharts";

import type { Route } from "./+types/weatherdata";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "~/components/ui/chart";
import { formatDateTime } from "~/lib/date-time";
import { getPersonDisplayColor } from "~/lib/person-colors";

type LatestCupWeatherRow = {
  drink_id: number;
  consumed_at: string;
  cup_name: string;
  person_id: number;
  person_name: string;
  temperature_c: number | null;
  precipitation_mm: number | null;
  raining: number | null;
  cloud_cover: number | null;
  humidity_percent: number | null;
  wind_speed_ms: number | null;
  observed_at: string | null;
  station_id: string | null;
};

type WeatherCategory = "sunny" | "cloudy" | "rainy";

type WeatherCategoryStatRow = {
  category: WeatherCategory;
  cup_count: number;
  weather_total: number;
  person_id: number | null;
  person_name: string | null;
  person_cup_count: number | null;
};

type WeatherCategoryStat = {
  category: WeatherCategory;
  cupCount: number;
  percentage: number;
  people: Array<{
    personId: number;
    personName: string;
    cupCount: number;
  }>;
};

type TemperatureCupDayRow = {
  day: string;
  average_temperature: number;
  cup_count: number;
};

type TemperatureCupPoint = {
  date: string;
  dateLabel: string;
  temperature: number;
  cups: number;
};

type WeatherExtremeKind = "coldest" | "warmest" | "wettest" | "windiest";

type WeatherExtremeRow = {
  kind: WeatherExtremeKind;
  value: number;
  drink_id: number;
  consumed_at: string;
  cup_name: string;
  person_id: number;
  person_name: string;
};

type WeatherLoaderData = {
  latestCupWeather: LatestCupWeatherRow | null;
  weatherCategoryStats: WeatherCategoryStat[];
  temperatureCupPoints: TemperatureCupPoint[];
  weatherExtremes: WeatherExtremeRow[];
};

const WEATHER_CATEGORY_ORDER: WeatherCategory[] = ["sunny", "cloudy", "rainy"];

const WEATHER_CATEGORY_DETAILS = {
  sunny: { label: "Solskin", Icon: CloudSun },
  cloudy: { label: "Overskyet", Icon: Cloud },
  rainy: { label: "Regnvejr", Icon: CloudRain },
} as const;

const WEATHER_EXTREME_ORDER: WeatherExtremeKind[] = [
  "coldest",
  "warmest",
  "wettest",
  "windiest",
];

const WEATHER_EXTREME_DETAILS = {
  coldest: { label: "Koldeste kop" },
  warmest: { label: "Varmeste kop" },
  wettest: { label: "Vådeste kop" },
  windiest: { label: "Mest blæsende kop" },
} as const;

const TEMPERATURE_FORMATTER = new Intl.NumberFormat("da-DK", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const CHART_DATE_FORMATTER = new Intl.DateTimeFormat("da-DK", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const temperatureCupsChartConfig = {
  cups: {
    label: "Kopper pr. dag",
    color: "var(--color-cyan-300)",
  },
  trend: {
    label: "Trend",
    color: "var(--color-teal-300)",
  },
} satisfies ChartConfig;

const WEATHER_BACKDROPS = {
  sunny: {
    url: "https://assets.kaffe.lucasfrandsen.dk/weather-backdrops/sunny.webp",
    objectPosition: "50% 25%",
  },
  cloudy: {
    url: "https://assets.kaffe.lucasfrandsen.dk/weather-backdrops/cloudy.webp",
    objectPosition: "50% 18%",
  },
  rainy: {
    url: "https://assets.kaffe.lucasfrandsen.dk/weather-backdrops/rainy2.webp",
    objectPosition: "50% 45%",
  },
} as const;

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Vejrdata | Kaffemændene" },
    {
      name: "description",
      content: "Vejret da den seneste kop kaffe blev registreret.",
    },
  ];
}

export async function loader(
  _args: Route.LoaderArgs,
): Promise<WeatherLoaderData> {
  try {
    const [
      latestCupWeather,
      weatherCategoryResult,
      temperatureCupResult,
      weatherExtremeResult,
    ] = await Promise.all([
      env.DB.prepare(
        `
          SELECT
            d.id AS drink_id,
            d.consumed_at,
            c.name AS cup_name,
            p.id AS person_id,
            COALESCE(p.display_name, p.name) AS person_name,
            w.temperature_c,
            w.precipitation_mm,
            w.raining,
            w.cloud_cover,
            w.humidity_percent,
            w.wind_speed_ms,
            w.observed_at,
            w.station_id
          FROM drinks d
          JOIN persons p ON p.id = d.person_id
          JOIN cups c ON c.id = d.cup_id
          LEFT JOIN weather_records w ON w.drink_id = d.id
          ORDER BY d.consumed_at DESC, d.id DESC
          LIMIT 1
        `,
      ).first<LatestCupWeatherRow>(),
      env.DB.prepare(
        `
          WITH categories(category) AS (
            VALUES ('sunny'), ('cloudy'), ('rainy')
          ),
          categorized AS (
            SELECT
              d.id AS drink_id,
              d.person_id,
              CASE
                WHEN w.raining = 1 THEN 'rainy'
                WHEN w.cloud_cover >= 60 THEN 'cloudy'
                ELSE 'sunny'
              END AS category
            FROM drinks d
            JOIN weather_records w ON w.drink_id = d.id
          ),
          category_totals AS (
            SELECT category, COUNT(*) AS cup_count
            FROM categorized
            GROUP BY category
          ),
          person_totals AS (
            SELECT
              categorized.category,
              p.id AS person_id,
              COALESCE(p.display_name, p.name) AS person_name,
              COUNT(*) AS cup_count
            FROM categorized
            JOIN persons p ON p.id = categorized.person_id
            GROUP BY
              categorized.category,
              p.id,
              p.display_name,
              p.name
          ),
          weather_total AS (
            SELECT COUNT(*) AS cup_count
            FROM categorized
          )
          SELECT
            categories.category,
            COALESCE(category_totals.cup_count, 0) AS cup_count,
            weather_total.cup_count AS weather_total,
            person_totals.person_id,
            person_totals.person_name,
            person_totals.cup_count AS person_cup_count
          FROM categories
          CROSS JOIN weather_total
          LEFT JOIN category_totals
            ON category_totals.category = categories.category
          LEFT JOIN person_totals
            ON person_totals.category = categories.category
          ORDER BY
            CASE categories.category
              WHEN 'sunny' THEN 1
              WHEN 'cloudy' THEN 2
              ELSE 3
            END,
            person_totals.person_name COLLATE NOCASE ASC,
            person_totals.person_id ASC
        `,
      ).all<WeatherCategoryStatRow>(),
      env.DB.prepare(
        `
          WITH daily_weather AS (
            SELECT
              date(d.consumed_at) AS day,
              AVG(w.temperature_c) AS average_temperature
            FROM drinks d
            JOIN weather_records w ON w.drink_id = d.id
            WHERE w.temperature_c IS NOT NULL
            GROUP BY date(d.consumed_at)
          ),
          daily_cups AS (
            SELECT
              date(consumed_at) AS day,
              COUNT(*) AS cup_count
            FROM drinks
            GROUP BY date(consumed_at)
          )
          SELECT
            daily_weather.day,
            daily_weather.average_temperature,
            daily_cups.cup_count
          FROM daily_weather
          JOIN daily_cups ON daily_cups.day = daily_weather.day
          ORDER BY daily_weather.day ASC
        `,
      ).all<TemperatureCupDayRow>(),
      env.DB.prepare(
        `
          WITH ranked AS (
            SELECT
              d.id AS drink_id,
              d.consumed_at,
              c.name AS cup_name,
              p.id AS person_id,
              COALESCE(p.display_name, p.name) AS person_name,
              w.temperature_c,
              w.precipitation_mm,
              w.wind_speed_ms,
              ROW_NUMBER() OVER (
                ORDER BY
                  w.temperature_c IS NULL,
                  w.temperature_c ASC,
                  d.consumed_at DESC,
                  d.id DESC
              ) AS coldest_rank,
              ROW_NUMBER() OVER (
                ORDER BY
                  w.temperature_c IS NULL,
                  w.temperature_c DESC,
                  d.consumed_at DESC,
                  d.id DESC
              ) AS warmest_rank,
              ROW_NUMBER() OVER (
                ORDER BY
                  w.precipitation_mm IS NULL,
                  w.precipitation_mm DESC,
                  d.consumed_at DESC,
                  d.id DESC
              ) AS wettest_rank,
              ROW_NUMBER() OVER (
                ORDER BY
                  w.wind_speed_ms IS NULL,
                  w.wind_speed_ms DESC,
                  d.consumed_at DESC,
                  d.id DESC
              ) AS windiest_rank
            FROM drinks d
            JOIN weather_records w ON w.drink_id = d.id
            JOIN cups c ON c.id = d.cup_id
            JOIN persons p ON p.id = d.person_id
          )
          SELECT
            'coldest' AS kind,
            temperature_c AS value,
            drink_id,
            consumed_at,
            cup_name,
            person_id,
            person_name
          FROM ranked
          WHERE coldest_rank = 1 AND temperature_c IS NOT NULL
          UNION ALL
          SELECT
            'warmest',
            temperature_c,
            drink_id,
            consumed_at,
            cup_name,
            person_id,
            person_name
          FROM ranked
          WHERE warmest_rank = 1 AND temperature_c IS NOT NULL
          UNION ALL
          SELECT
            'wettest',
            precipitation_mm,
            drink_id,
            consumed_at,
            cup_name,
            person_id,
            person_name
          FROM ranked
          WHERE wettest_rank = 1 AND precipitation_mm IS NOT NULL
          UNION ALL
          SELECT
            'windiest',
            wind_speed_ms,
            drink_id,
            consumed_at,
            cup_name,
            person_id,
            person_name
          FROM ranked
          WHERE windiest_rank = 1 AND wind_speed_ms IS NOT NULL
        `,
      ).all<WeatherExtremeRow>(),
    ]);

    return {
      latestCupWeather,
      weatherCategoryStats: buildWeatherCategoryStats(
        weatherCategoryResult.results,
      ),
      temperatureCupPoints: temperatureCupResult.results.map((row) => ({
        date: row.day,
        dateLabel: CHART_DATE_FORMATTER.format(
          new Date(`${row.day}T00:00:00Z`),
        ),
        temperature: row.average_temperature,
        cups: row.cup_count,
      })),
      weatherExtremes: weatherExtremeResult.results,
    };
  } catch (error) {
    console.warn("Unable to load the latest cup weather from D1", error);

    return {
      latestCupWeather: null,
      weatherCategoryStats: buildWeatherCategoryStats([]),
      temperatureCupPoints: [],
      weatherExtremes: [],
    };
  }
}

export default function WeatherData() {
  const {
    latestCupWeather,
    weatherCategoryStats,
    temperatureCupPoints,
    weatherExtremes,
  } = useLoaderData<typeof loader>();
  const weatherBackdrop = latestCupWeather
    ? getWeatherBackdrop(latestCupWeather)
    : null;
  const temperatureTrend = getLinearTrend(temperatureCupPoints);

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-8 sm:px-6 lg:px-8">
      <section aria-label="Vejret ved seneste kop">
        <Card className="relative isolate border border-cyan-400/25 bg-zinc-950/90 ring-1 ring-cyan-400/35 shadow-[0_0_28px_-22px_rgba(34,211,238,0.65)]">
          {weatherBackdrop && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-0"
            >
              <img
                src={weatherBackdrop.url}
                alt=""
                className="absolute inset-0 size-full object-cover"
                style={{ objectPosition: weatherBackdrop.objectPosition }}
              />
              <div className="absolute inset-0 bg-black/40" />
            </div>
          )}

          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-10 -top-14 z-2 size-36 rounded-full bg-sky-500/10 blur-3xl"
          />

          <CardHeader className="relative z-10 border-b border-transparent">
            <CardTitle className="bg-linear-to-b from-white via-cyan-100 to-cyan-300 bg-clip-text  text-center text-2xl font-black uppercase tracking-[0.18em] text-cyan-300 antialiased [text-shadow:0_2px_3px_rgba(0,0,0,0.9)]">
              Vejret ved seneste kop
            </CardTitle>
          </CardHeader>
          {latestCupWeather && (
            <CardContent className="relative z-10 text-zinc-400 [text-shadow:0_2px_3px_rgba(0,0,0,0.9)]">
              <span
                className="font-medium"
                style={{
                  color: getPersonDisplayColor(
                    latestCupWeather.person_name,
                    latestCupWeather.person_id,
                  ),
                }}
              >
                {latestCupWeather.person_name}
              </span>{" "}
              · {latestCupWeather.cup_name} ·{" "}
              <span className="tabular-nums text-cyan-300">
                {formatDateTime(latestCupWeather.consumed_at)}
              </span>
            </CardContent>
          )}

          <CardContent className="relative z-10 [text-shadow:0_2px_3px_rgba(0,0,0,0.9)]">
            {latestCupWeather ? (
              <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
                <div className="flex items-center gap-3">
                  <WeatherIconForHeroCard
                    raining={latestCupWeather.raining === 1}
                    cloudCover={latestCupWeather.cloud_cover}
                  />
                  <p className="text-4xl font-semibold tabular-nums tracking-tight text-sky-300">
                    {formatTemperature(latestCupWeather.temperature_c)}
                  </p>
                  <p className="text-xs font-medium uppercase tracking-wider text-teal-300">
                    {getWeatherSummary(latestCupWeather)}
                  </p>
                </div>

                <dl className="flex flex-wrap gap-x-8 gap-y-3">
                  <WeatherMetric
                    label="Nedbør"
                    value={formatMeasurement(
                      latestCupWeather.precipitation_mm,
                      "mm",
                    )}
                  />
                  <WeatherMetric
                    label="Luftfugtighed"
                    value={formatMeasurement(
                      latestCupWeather.humidity_percent,
                      "%",
                      0,
                    )}
                  />
                  <WeatherMetric
                    label="Vind"
                    value={formatMeasurement(
                      latestCupWeather.wind_speed_ms,
                      "m/s",
                    )}
                  />
                </dl>
              </div>
            ) : (
              <div className="py-3">
                <p className="font-medium text-zinc-200">
                  Ingen vejrdata endnu
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  Kortet udfyldes, når den første kop med vejrdata registreres.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section
        className="grid gap-3 lg:grid-cols-3 py-3"
        aria-label="Kaffe efter vejret"
      >
        {weatherCategoryStats.map((stat) => {
          const { label, Icon } = WEATHER_CATEGORY_DETAILS[stat.category];

          return (
            <Card
              key={stat.category}
              size="sm"
              className="gap-2 border-cyan-400/25 bg-zinc-950/80 text-center ring-0"
            >
              <CardHeader className="justify-items-center">
                <CardTitle className="flex items-center gap-1.5 uppercase">
                  <Icon
                    className="size-6 shrink-0 text-teal-300"
                    aria-hidden="true"
                  />
                  <span className="text-xl">{label}</span>
                </CardTitle>
                <p className="text-2xl font-semibold tabular-nums text-cyan-300">
                  {formatPercentage(stat.percentage)}
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 items-baseline gap-2">
                  <span className="text-right font-medium tabular-nums text-sky-300">
                    {stat.cupCount}
                  </span>
                  <span className="text-left font-medium text-zinc-400">
                    kopper i alt
                  </span>
                </div>

                <div className="space-y-1">
                  {stat.people.map((person) => (
                    <div
                      key={person.personId}
                      className="grid grid-cols-2 items-baseline gap-2"
                    >
                      <span
                        className="text-right font-medium"
                        style={{
                          color: getPersonDisplayColor(
                            person.personName,
                            person.personId,
                          ),
                        }}
                      >
                        {person.personName}
                      </span>
                      <span className="text-left font-medium tabular-nums text-zinc-300">
                        {person.cupCount} kopper
                      </span>
                    </div>
                  ))}
                  {stat.people.length === 0 && (
                    <p className="mt-1 text-sm text-zinc-500">
                      Ingen kopper registreret.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section aria-label="Temperatur og kaffeforbrug">
        <Card className="border-cyan-400/25 bg-zinc-950/80 ring-0">
          <CardHeader className="border-b border-zinc-800">
            <CardTitle className="uppercase">
              Temperatur og kaffeforbrug
            </CardTitle>
            <CardAction className="text-sm font-medium uppercase text-zinc-400">
              {temperatureCupPoints.length} dage med vejrdata
            </CardAction>
          </CardHeader>
          <CardContent>
            {temperatureCupPoints.length > 0 ? (
              <ChartContainer
                config={temperatureCupsChartConfig}
                className="h-96 w-full aspect-auto [&_.recharts-cartesian-axis-tick-value]:fill-white! [&_.recharts-cartesian-axis-tick_text]:fill-white!"
                initialDimension={{ width: 1040, height: 384 }}
              >
                <ScatterChart
                  accessibilityLayer
                  margin={{ top: 12, right: 20, left: 12, bottom: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="temperature"
                    name="Temperatur"
                    unit="°"
                    tick={{ fill: "white" }}
                    axisLine={false}
                    tickLine={false}
                    tickMargin={10}
                    domain={[
                      (dataMin: number) => Math.floor(dataMin) - 1,
                      (dataMax: number) => Math.ceil(dataMax) + 1,
                    ]}
                    tickFormatter={(value: number) =>
                      `${TEMPERATURE_FORMATTER.format(value)}`
                    }
                    label={{
                      value: "Temperatur",
                      position: "insideBottom",
                      offset: -12,
                      fill: "white",
                    }}
                  />
                  <YAxis
                    type="number"
                    dataKey="cups"
                    name="Kopper"
                    tick={{ fill: "white" }}
                    axisLine={false}
                    tickLine={false}
                    tickMargin={8}
                    allowDecimals={false}
                    domain={[
                      0,
                      (dataMax: number) => Math.max(1, Math.ceil(dataMax) + 1),
                    ]}
                    width={36}
                    label={{
                      value: "Kopper pr. dag",
                      angle: -90,
                      position: "insideLeft",
                      offset: -4,
                      fill: "white",
                    }}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={({ active, payload }) => {
                      const point = payload?.[0]?.payload as
                        | TemperatureCupPoint
                        | undefined;

                      if (!active || !point) {
                        return null;
                      }

                      return (
                        <div className="grid min-w-40 gap-2 rounded-lg border border-zinc-800/80 bg-zinc-950 px-3 py-2 text-xs shadow-xl">
                          <p className="font-medium text-zinc-100">
                            {point.dateLabel}
                          </p>
                          <div className="grid gap-1.5">
                            <div className="flex items-center justify-between gap-5">
                              <span className="flex items-center gap-2 text-zinc-400">
                                <span className="size-2 rounded-full bg-cyan-300" />
                                Kopper
                              </span>
                              <span className="font-mono font-medium tabular-nums text-zinc-100">
                                {point.cups}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-5">
                              <span className="flex items-center gap-2 text-zinc-400">
                                <span className="size-2 rounded-full bg-teal-300" />
                                Gns. temperatur
                              </span>
                              <span className="font-mono font-medium tabular-nums text-zinc-100">
                                {TEMPERATURE_FORMATTER.format(
                                  point.temperature,
                                )}
                                °
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  />
                  {temperatureTrend && (
                    <ReferenceLine
                      segment={temperatureTrend}
                      stroke="var(--color-trend)"
                      strokeWidth={3}
                      strokeLinecap="round"
                      ifOverflow="extendDomain"
                    />
                  )}
                  <Scatter
                    name="cups"
                    data={temperatureCupPoints}
                    fill="var(--color-cups)"
                    fillOpacity={0.85}
                  />
                </ScatterChart>
              </ChartContainer>
            ) : (
              <div className="flex h-64 items-center justify-center text-sm text-zinc-400">
                Ikke nok vejrdata til at vise grafen endnu.
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Vejrrekorder"
      >
        {WEATHER_EXTREME_ORDER.map((kind) => {
          const { label } = WEATHER_EXTREME_DETAILS[kind];
          const extreme = weatherExtremes.find((row) => row.kind === kind);

          return (
            <Card
              key={kind}
              size="sm"
              className="gap-2 border border-cyan-400/25 bg-zinc-950/80 ring-1 ring-cyan-400/35"
            >
              <CardHeader>
                <CardTitle className="text-base! uppercase">{label}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {extreme ? (
                  <>
                    <p className="text-2xl font-semibold tabular-nums tracking-tight text-cyan-300">
                      {formatWeatherExtremeValue(kind, extreme.value)}
                    </p>
                    <div className="space-y-0.5 text-xs text-zinc-500">
                      <p className="truncate text-zinc-400">
                        <span
                          className="font-medium"
                          style={{
                            color: getPersonDisplayColor(
                              extreme.person_name,
                              extreme.person_id,
                            ),
                          }}
                        >
                          {extreme.person_name}
                        </span>{" "}
                        · {extreme.cup_name}
                      </p>
                      <p className="tabular-nums">
                        {formatDateTime(extreme.consumed_at)}
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="py-3 text-sm text-zinc-500">
                    Ingen vejrdata endnu.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </section>
    </main>
  );
}

function WeatherIconForHeroCard({
  raining,
  cloudCover,
}: {
  raining: boolean;
  cloudCover: number | null;
}) {
  const className = "size-10 shrink-0 text-teal-300";

  if (raining) {
    return <CloudRain className={className} aria-hidden="true" />;
  }

  if (cloudCover !== null && cloudCover >= 60) {
    return <Cloud className={className} aria-hidden="true" />;
  }

  return <CloudSun className={className} aria-hidden="true" />;
}

function WeatherMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-1 font-medium tabular-nums text-zinc-200">{value}</dd>
    </div>
  );
}

function getWeatherSummary(weather: LatestCupWeatherRow) {
  if (weather.temperature_c === null && weather.observed_at === null) {
    return "Afventer vejrdata";
  }

  if (weather.raining === 1) {
    return "Regnvejr";
  }

  if (weather.cloud_cover !== null && weather.cloud_cover >= 60) {
    return "Overskyet";
  }

  return "Solskin og tørt";
}

function getWeatherBackdrop(weather: LatestCupWeatherRow) {
  if (weather.temperature_c === null && weather.observed_at === null) {
    return null;
  }

  if (weather.raining === 1) {
    return WEATHER_BACKDROPS.rainy;
  }

  if (weather.cloud_cover !== null && weather.cloud_cover >= 60) {
    return WEATHER_BACKDROPS.cloudy;
  }

  return WEATHER_BACKDROPS.sunny;
}

function buildWeatherCategoryStats(
  rows: WeatherCategoryStatRow[],
): WeatherCategoryStat[] {
  return WEATHER_CATEGORY_ORDER.map((category) => {
    const categoryRows = rows.filter((row) => row.category === category);
    const row = categoryRows[0];
    const cupCount = row?.cup_count ?? 0;
    const weatherTotal = row?.weather_total ?? 0;

    return {
      category,
      cupCount,
      percentage: weatherTotal > 0 ? (cupCount / weatherTotal) * 100 : 0,
      people: categoryRows.flatMap((personRow) =>
        personRow.person_id !== null &&
        personRow.person_name !== null &&
        personRow.person_cup_count !== null &&
        personRow.person_cup_count > 0
          ? [
              {
                personId: personRow.person_id,
                personName: personRow.person_name,
                cupCount: personRow.person_cup_count,
              },
            ]
          : [],
      ),
    };
  });
}

function getLinearTrend(
  points: TemperatureCupPoint[],
): readonly [{ x: number; y: number }, { x: number; y: number }] | null {
  if (points.length < 2) {
    return null;
  }

  const meanTemperature =
    points.reduce((sum, point) => sum + point.temperature, 0) / points.length;
  const meanCups =
    points.reduce((sum, point) => sum + point.cups, 0) / points.length;
  const temperatureVariance = points.reduce(
    (sum, point) => sum + (point.temperature - meanTemperature) ** 2,
    0,
  );

  if (temperatureVariance === 0) {
    return null;
  }

  const covariance = points.reduce(
    (sum, point) =>
      sum + (point.temperature - meanTemperature) * (point.cups - meanCups),
    0,
  );
  const slope = covariance / temperatureVariance;
  const intercept = meanCups - slope * meanTemperature;
  const temperatures = points.map((point) => point.temperature);
  const minimumTemperature = Math.min(...temperatures);
  const maximumTemperature = Math.max(...temperatures);

  return [
    {
      x: minimumTemperature,
      y: Math.max(0, slope * minimumTemperature + intercept),
    },
    {
      x: maximumTemperature,
      y: Math.max(0, slope * maximumTemperature + intercept),
    },
  ];
}

function formatPercentage(value: number) {
  return `${Math.round(value)}%`;
}

function formatWeatherExtremeValue(kind: WeatherExtremeKind, value: number) {
  const formattedValue = TEMPERATURE_FORMATTER.format(value);

  if (kind === "coldest" || kind === "warmest") {
    return `${formattedValue}°`;
  }

  if (kind === "wettest") {
    return `${formattedValue} mm`;
  }

  return `${formattedValue} m/s`;
}

function formatTemperature(value: number | null) {
  return value === null ? "—" : `${TEMPERATURE_FORMATTER.format(value)}°`;
}

function formatMeasurement(
  value: number | null,
  unit: string,
  fractionDigits = 1,
) {
  return value === null ? "—" : `${value.toFixed(fractionDigits)} ${unit}`;
}
