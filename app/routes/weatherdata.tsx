import { env } from "cloudflare:workers";
import { Cloud, CloudRain, CloudSun } from "lucide-react";
import { useLoaderData } from "react-router";

import type { Route } from "./+types/weatherdata";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
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
  person_id: number;
  person_name: string;
  person_cup_count: number;
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

type WeatherLoaderData = {
  latestCupWeather: LatestCupWeatherRow | null;
  weatherCategoryStats: WeatherCategoryStat[];
};

const WEATHER_CATEGORY_ORDER: WeatherCategory[] = ["sunny", "cloudy", "rainy"];

const WEATHER_CATEGORY_DETAILS = {
  sunny: { label: "Solskin", Icon: CloudSun },
  cloudy: { label: "Overskyet", Icon: Cloud },
  rainy: { label: "Regnvejr", Icon: CloudRain },
} as const;

const TEMPERATURE_FORMATTER = new Intl.NumberFormat("da-DK", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

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
    url: "https://assets.kaffe.lucasfrandsen.dk/weather-backdrops/rainy.webp",
    objectPosition: "50% 60%",
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
    const [latestCupWeather, weatherCategoryResult] = await Promise.all([
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
          all_people AS (
            SELECT
              p.id AS person_id,
              COALESCE(p.display_name, p.name) AS person_name
            FROM persons p
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
              categorized.person_id,
              COUNT(*) AS cup_count
            FROM categorized
            GROUP BY categorized.category, categorized.person_id
          ),
          weather_total AS (
            SELECT COUNT(*) AS cup_count
            FROM categorized
          )
          SELECT
            categories.category,
            COALESCE(category_totals.cup_count, 0) AS cup_count,
            weather_total.cup_count AS weather_total,
            all_people.person_id,
            all_people.person_name,
            COALESCE(person_totals.cup_count, 0) AS person_cup_count
          FROM categories
          CROSS JOIN all_people
          CROSS JOIN weather_total
          LEFT JOIN category_totals
            ON category_totals.category = categories.category
          LEFT JOIN person_totals
            ON person_totals.category = categories.category
            AND person_totals.person_id = all_people.person_id
          ORDER BY
            CASE categories.category
              WHEN 'sunny' THEN 1
              WHEN 'cloudy' THEN 2
              ELSE 3
            END,
            all_people.person_name COLLATE NOCASE ASC,
            all_people.person_id ASC
        `,
      ).all<WeatherCategoryStatRow>(),
    ]);

    return {
      latestCupWeather,
      weatherCategoryStats: buildWeatherCategoryStats(
        weatherCategoryResult.results,
      ),
    };
  } catch (error) {
    console.warn("Unable to load the latest cup weather from D1", error);

    return {
      latestCupWeather: null,
      weatherCategoryStats: buildWeatherCategoryStats([]),
    };
  }
}

export default function WeatherData() {
  const { latestCupWeather, weatherCategoryStats } =
    useLoaderData<typeof loader>();
  const weatherBackdrop = latestCupWeather
    ? getWeatherBackdrop(latestCupWeather)
    : null;

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
            <CardTitle className="text-center text-2xl uppercase tracking-widest text-cyan-300 [text-shadow:0_2px_3px_rgba(0,0,0,0.9)]">
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
        className="grid gap-3 lg:grid-cols-3"
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
                      Personerne blev ikke fundet.
                    </p>
                  )}
                </div>
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
      people: categoryRows.map((personRow) => ({
        personId: personRow.person_id,
        personName: personRow.person_name,
        cupCount: personRow.person_cup_count,
      })),
    };
  });
}

function formatPercentage(value: number) {
  return `${Math.round(value)}%`;
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
