import { env } from "cloudflare:workers";

import type { Route } from "./+types/home";
import {
  CardAction,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "~/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import {
  APP_TIME_ZONE,
  formatDateTime,
  parseUtcDateTime,
} from "~/lib/date-time";
import { getPersonDisplayColor } from "~/lib/person-colors";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "~/components/ui/chart";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  XAxis,
  YAxis,
} from "recharts";

// Persons data table
type PersonRow = {
  name: string;
  display_name: string | null;
};

// Cups popup data table
type CupRow = {
  id: number;
  name: string;
  owner_name: string;
  total_uses: number;
};

// All drinks data table
type DrinkRow = {
  id: number;
  event_id: string;
  person_name: string;
  person_display_name: string | null;
  cup_name: string;
  nfc_uid: string;
  consumed_at: string;
  received_at: string;
};

// Leaderboard data table
type LeaderboardRow = {
  rank: number;
  name: string;
  cups: number;
  last_cup: string | null;
};

// Count data table, to show total number of drinks in the database
type CountRow = {
  total: number;
};

type MonthlyDrinkRow = {
  consumed_at: string;
  person_id: number;
  person_name: string;
  cup_id: number;
  cup_name: string;
};

type MonthlyChartDay = {
  date: string;
  day: number;
  [personDataKey: string]: string | number;
};

type MonthlyChartPerson = {
  id: number;
  name: string;
  dataKey: string;
  color: string;
};

type MonthlyChartCup = {
  id: number;
  name: string;
  ownerName: string;
  total: number;
  color: string;
};

type CopenhagenMonth = {
  year: number;
  month: number;
  daysInMonth: number;
  title: string;
  queryStart: string;
  queryEnd: string;
};

const DRINKS_PAGE_SIZE = 15;
const CHART_NAMES = new Set(["paven", "burger lars"]); // Not everyone should be included in the chart

const leaderboardChartConfig = {
  cups: {
    label: "Cups",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

const monthlyCupsChartConfig = {
  total: {
    label: "Drinks",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Leaderboard | Kaffemændene" },
    {
      name: "description",
      content: "Coffee leaderboard.",
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const currentMonth = getCurrentCopenhagenMonth();
  const requestedDrinksPage = Number.parseInt(
    url.searchParams.get("drinksPage") ?? "1",
    10,
  );
  const drinksPage =
    Number.isFinite(requestedDrinksPage) && requestedDrinksPage > 0
      ? requestedDrinksPage
      : 1;

  try {
    const [peopleResult, cupsResult, drinksCount, monthlyDrinksResult] =
      await Promise.all([
        env.DB.prepare(
          "SELECT name, display_name FROM persons ORDER BY name COLLATE NOCASE ASC",
        ).all<PersonRow>(),
        env.DB.prepare(
          `
          SELECT
            c.id,
            c.name,
            COALESCE(p.display_name, p.name) AS owner_name,
            COUNT(d.id) AS total_uses
          FROM cups c
          JOIN persons p ON p.id = c.owner_id
          LEFT JOIN drinks d ON d.cup_id = c.id
          GROUP BY c.id, c.name, p.name, p.display_name
          ORDER BY total_uses DESC, c.id ASC
        `,
        ).all<CupRow>(),
        env.DB.prepare(
          "SELECT COUNT(*) AS total FROM drinks",
        ).first<CountRow>(),
        env.DB.prepare(
          `
          SELECT
            d.consumed_at,
            p.id AS person_id,
            COALESCE(p.display_name, p.name) AS person_name,
            c.id AS cup_id,
            c.name AS cup_name
          FROM drinks d
          JOIN persons p ON p.id = d.person_id
          JOIN cups c ON c.id = d.cup_id
          WHERE datetime(d.consumed_at) >= datetime(?)
            AND datetime(d.consumed_at) < datetime(?)
          ORDER BY d.consumed_at ASC
        `,
        )
          .bind(currentMonth.queryStart, currentMonth.queryEnd)
          .all<MonthlyDrinkRow>(),
      ]);

    const totalDrinks = drinksCount?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalDrinks / DRINKS_PAGE_SIZE));
    const currentDrinksPage = Math.min(drinksPage, totalPages);
    const drinksOffset = (currentDrinksPage - 1) * DRINKS_PAGE_SIZE;

    const leaderboardResult = await env.DB.prepare(
      `
        SELECT
          ROW_NUMBER() OVER (
            ORDER BY COUNT(d.id) DESC, MAX(d.consumed_at) DESC, p.name COLLATE NOCASE ASC
          ) AS rank,
          COALESCE(p.display_name, p.name) AS name,
          COUNT(d.id) AS cups,
          MAX(d.consumed_at) AS last_cup
        FROM persons p
        LEFT JOIN drinks d ON d.person_id = p.id
        WHERE p.active = 1
        GROUP BY p.id, p.name, p.display_name
        HAVING COUNT(d.id) > 0
        ORDER BY rank ASC
      `,
    ).all<LeaderboardRow>();

    const drinksResult = await env.DB.prepare(
      `
        SELECT
          d.id,
          d.event_id,
          d.consumed_at,
          d.received_at,
          p.name AS person_name,
          p.display_name AS person_display_name,
          c.name AS cup_name,
          c.nfc_uid
        FROM drinks d
        JOIN persons p ON p.id = d.person_id
        JOIN cups c ON c.id = d.cup_id
        ORDER BY d.consumed_at DESC, d.id DESC
        LIMIT ? OFFSET ?
      `,
    )
      .bind(DRINKS_PAGE_SIZE, drinksOffset)
      .all<DrinkRow>();

    return {
      people: peopleResult.results,
      cups: cupsResult.results,
      leaderboardRows: leaderboardResult.results,
      allDrinksRows: drinksResult.results,
      monthlyChart: buildMonthlyChart(
        monthlyDrinksResult.results,
        currentMonth,
      ),
      drinksPagination: {
        page: currentDrinksPage,
        pageSize: DRINKS_PAGE_SIZE,
        total: totalDrinks,
        totalPages,
      },
    };
  } catch (error) {
    console.warn("Unable to load leaderboard data from D1", error);

    return {
      people: [],
      cups: [],
      leaderboardRows: [],
      allDrinksRows: [],
      monthlyChart: buildMonthlyChart([], currentMonth),
      drinksPagination: {
        page: 1,
        pageSize: DRINKS_PAGE_SIZE,
        total: 0,
        totalPages: 1,
      },
    };
  }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const {
    people,
    cups,
    leaderboardRows,
    allDrinksRows,
    monthlyChart,
    drinksPagination,
  } = loaderData;
  const paginationPages = getVisiblePages(
    drinksPagination.page,
    drinksPagination.totalPages,
  );

  const leaderboardChartData = leaderboardRows.filter((row) =>
    CHART_NAMES.has(row.name.toLowerCase()),
  );
  const monthlyChartConfig: ChartConfig = Object.fromEntries(
    monthlyChart.people.map((person) => [
      person.dataKey,
      { label: person.name, color: person.color },
    ]),
  );
  const monthlyCupsChartHeight = Math.max(
    120,
    monthlyChart.cups.length * 44 + 24,
  );

  return (
    <section className="mx-auto grid max-w-6xl gap-4 px-4 py-8 sm:px-6 lg:grid-cols-4 lg:px-8">
      <Card className="border-zinc-800 bg-zinc-950/80 lg:col-span-3">
        <CardHeader className="border-b border-zinc-800">
          <CardTitle>
            Leaderboard
            <span className="ml-2 text-zinc-500 normal-case">
              Hvem har det største koffeinproblem?
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="w-16 text-zinc-400">Rank</TableHead>
                <TableHead className="text-zinc-400">Name</TableHead>
                <TableHead className="text-right text-zinc-400">
                  Total cups
                </TableHead>
                <TableHead className="text-right text-zinc-400">
                  Last cup
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaderboardRows.length > 0 ? (
                leaderboardRows.map((row) => (
                  <TableRow key={row.rank} className="border-zinc-800">
                    <TableCell
                      className={`font-medium ${getRankTextColor(row.rank)}`}
                    >
                      {row.rank}
                    </TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell className="text-right">{row.cups}</TableCell>
                    <TableCell className="text-right text-zinc-400">
                      {row.last_cup ? formatDateTime(row.last_cup) : "-"}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow className="border-zinc-800">
                  <TableCell
                    colSpan={4}
                    className="h-24 text-center text-zinc-400"
                  >
                    No leaderboard data yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {leaderboardChartData.length > 0 && (
            <div className="mt-4">
              <ChartContainer
                config={leaderboardChartConfig}
                className="h-15 w-full aspect-auto"
                initialDimension={{ width: 720, height: 160 }}
              >
                <BarChart
                  accessibilityLayer
                  data={leaderboardChartData}
                  layout="vertical"
                  margin={{ left: 0, right: 28 }}
                >
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="cups"
                    hide
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tickMargin={8}
                    width={88}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent hideLabel />}
                  />
                  <Bar dataKey="cups" barSize={10} radius={[0, 4, 4, 0]}>
                    {leaderboardChartData.map((row, index) => (
                      <Cell
                        key={row.rank}
                        fill={getPersonDisplayColor(row.name, index)}
                      />
                    ))}
                    <LabelList
                      dataKey="cups"
                      position="right"
                      className="fill-zinc-300"
                      fontSize={12}
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-950/80 lg:col-span-1">
        <CardHeader className="border-b border-zinc-800">
          <CardTitle>People</CardTitle>
          <CardAction>
            <Dialog>
              <DialogTrigger
                render={
                  <Button
                    variant="secondary"
                    size="sm"
                    className="cursor-pointer bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
                  />
                }
              >
                Cups
              </DialogTrigger>
              <DialogContent className="border border-zinc-800 bg-zinc-950 text-zinc-50 sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Cups</DialogTitle>
                  <DialogDescription>
                    <p>
                      Her er alle vores kopper. Hver mand har sin egen, så vi
                      kan stole på statistikken.
                    </p>
                    <p>
                      Det er en dødssynd, at drikke af en anden mands kop. Det
                      er fucking ikke for sjov det her.
                    </p>
                  </DialogDescription>
                </DialogHeader>
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-transparent">
                      <TableHead className="w-20 text-zinc-400">ID</TableHead>
                      <TableHead className="text-zinc-400">Cup name</TableHead>
                      <TableHead className="w-20 text-zinc-400">
                        Total uses
                      </TableHead>
                      <TableHead className="text-zinc-400">Owner</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cups.length > 0 ? (
                      cups.map((cup) => (
                        <TableRow key={cup.id} className="border-zinc-800">
                          <TableCell className="font-medium text-zinc-300">
                            {cup.id}
                          </TableCell>
                          <TableCell>{cup.name}</TableCell>
                          <TableCell className="text-right text-zinc-400">
                            {cup.total_uses}
                          </TableCell>
                          <TableCell className="text-zinc-400">
                            {cup.owner_name}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow className="border-zinc-800">
                        <TableCell
                          colSpan={3}
                          className="h-24 text-center text-zinc-400"
                        >
                          No cups loaded yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </DialogContent>
            </Dialog>
          </CardAction>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-400">Name</TableHead>
                <TableHead className="text-zinc-400">Nickname</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.length > 0 ? (
                people.map((person) => (
                  <TableRow key={person.name} className="border-zinc-800">
                    <TableCell className="font-medium">{person.name}</TableCell>
                    <TableCell className="text-zinc-400">
                      {person.display_name || "—"}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow className="border-zinc-800">
                  <TableCell
                    colSpan={2}
                    className="h-24 text-center text-zinc-400"
                  >
                    No people loaded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-950/80 lg:col-span-4">
        <CardHeader className="border-b border-zinc-800">
          <CardTitle className="uppercase">
            {monthlyChart.title}{" "}
            <span className="ml-2 text-zinc-500 normal-case">
              Hvordan ser misbruget ud denne måned?
            </span>
          </CardTitle>
          <CardAction className="flex items-baseline gap-2 whitespace-nowrap font-medium">
            <span className="text-base tabular-nums text-zinc-100">
              {monthlyChart.totalCups}
            </span>
            <span className="text-xs uppercase text-zinc-400 sm:text-sm">
              total cups this month
            </span>
          </CardAction>
        </CardHeader>
        <CardContent>
          {monthlyChart.people.length > 0 ? (
            <div className="overflow-x-auto pb-2">
              <ChartContainer
                config={monthlyChartConfig}
                className="h-96 min-w-190 w-full aspect-auto"
                initialDimension={{ width: 1040, height: 384 }}
              >
                <BarChart
                  accessibilityLayer
                  data={monthlyChart.days}
                  margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tickMargin={10}
                    interval={0}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tickMargin={8}
                    allowDecimals={false}
                    width={28}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent />}
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  {monthlyChart.people.map((person) => (
                    <Bar
                      key={person.id}
                      dataKey={person.dataKey}
                      fill={`var(--color-${person.dataKey})`}
                      barSize={8}
                      radius={[3, 3, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ChartContainer>
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center text-sm text-zinc-400">
              No drinks recorded this month.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-950/80 lg:col-span-4">
        <CardHeader className="border-b border-zinc-800">
          <CardTitle className="uppercase">
            Stats by mug{" "}
            <span className="ml-2 text-zinc-500 normal-case">
              Hvilke kopper er mest populære?
            </span>
          </CardTitle>
          <CardAction className="text-sm font-medium uppercase text-zinc-400">
            {monthlyChart.title}
          </CardAction>
        </CardHeader>
        <CardContent>
          {monthlyChart.cups.length > 0 ? (
            <ChartContainer
              config={monthlyCupsChartConfig}
              className="w-full aspect-auto"
              style={{ height: monthlyCupsChartHeight }}
              initialDimension={{
                width: 1040,
                height: monthlyCupsChartHeight,
              }}
            >
              <BarChart
                accessibilityLayer
                data={monthlyChart.cups}
                layout="vertical"
                margin={{ top: 4, right: 36, left: 0, bottom: 4 }}
              >
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  axisLine={false}
                  tickLine={false}
                  tickMargin={8}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tickMargin={10}
                  width={160}
                />
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent hideLabel />}
                />
                <Bar dataKey="total" barSize={18} radius={[0, 4, 4, 0]}>
                  {monthlyChart.cups.map((cup) => (
                    <Cell key={cup.id} fill={cup.color} />
                  ))}
                  <LabelList
                    dataKey="total"
                    position="right"
                    className="fill-zinc-300"
                    fontSize={12}
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
          ) : (
            <div className="flex h-32 items-center justify-center text-sm text-zinc-400">
              No cups used this month.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-950/80 lg:col-span-4">
        <CardHeader className="border-b border-zinc-800">
          <CardTitle>All Drinks</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="w-20 text-zinc-400">ID</TableHead>
                <TableHead className="text-zinc-400">Person</TableHead>
                <TableHead className="text-zinc-400">Mug</TableHead>
                {/* Everywhere else, the following is named "consumed_at" and "received_at" respectively, and it's too tedious to change. "Scanned at" is ONLY for the string representation!! */}
                <TableHead className="text-zinc-400">Scanned</TableHead>
                <TableHead className="text-zinc-400">Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allDrinksRows.length > 0 ? (
                allDrinksRows.map((drink) => (
                  <TableRow key={drink.id} className="border-zinc-800">
                    <TableCell className="font-medium text-zinc-300">
                      {drink.id}
                    </TableCell>
                    <TableCell>
                      {drink.person_display_name || drink.person_name}
                    </TableCell>
                    <TableCell>{drink.cup_name}</TableCell>
                    <TableCell className="text-zinc-400">
                      {formatDateTime(drink.consumed_at)}
                    </TableCell>
                    <TableCell className="text-zinc-400">
                      {formatDateTime(drink.received_at)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow className="border-zinc-800">
                  <TableCell
                    colSpan={5}
                    className="h-24 text-center text-zinc-400"
                  >
                    No drinks loaded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
        <CardFooter className="border-t border-zinc-800">
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-zinc-400">
              Page {drinksPagination.page} of {drinksPagination.totalPages} ·{" "}
              {drinksPagination.total} drinks total · showing{" "}
              {drinksPagination.pageSize} drinks per page
            </p>
            <Pagination className="mx-0 w-auto justify-start sm:justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href={getDrinksPageHref(drinksPagination.page - 1)}
                    aria-disabled={drinksPagination.page <= 1}
                    className={
                      drinksPagination.page <= 1
                        ? "pointer-events-none opacity-50"
                        : undefined
                    }
                  />
                </PaginationItem>
                {paginationPages.map((page) => (
                  <PaginationItem key={page}>
                    <PaginationLink
                      href={getDrinksPageHref(page)}
                      isActive={page === drinksPagination.page}
                    >
                      {page}
                    </PaginationLink>
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    href={getDrinksPageHref(drinksPagination.page + 1)}
                    aria-disabled={
                      drinksPagination.page >= drinksPagination.totalPages
                    }
                    className={
                      drinksPagination.page >= drinksPagination.totalPages
                        ? "pointer-events-none opacity-50"
                        : undefined
                    }
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        </CardFooter>
      </Card>
    </section>
  );
}

function getDrinksPageHref(page: number) {
  return `/?drinksPage=${Math.max(1, page)}`;
}

function getRankTextColor(rank: number) {
  if (rank === 1) return "text-[#d4af37]";
  if (rank === 2) return "text-[#c0c0c0]";
  if (rank === 3) return "text-[#cd7f32]";

  return "text-zinc-300";
}

function getVisiblePages(currentPage: number, totalPages: number) {
  const firstPage = Math.max(1, currentPage - 2);
  const lastPage = Math.min(totalPages, firstPage + 4);

  return Array.from(
    { length: lastPage - firstPage + 1 },
    (_, index) => firstPage + index,
  );
}

const copenhagenDatePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const copenhagenMonthTitleFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  month: "long",
  year: "numeric",
});

function getCurrentCopenhagenMonth(now = new Date()): CopenhagenMonth {
  const parts = getCopenhagenDateParts(now);
  const daysInMonth = new Date(
    Date.UTC(parts.year, parts.month, 0),
  ).getUTCDate();
  const oneDayMs = 24 * 60 * 60 * 1000;

  return {
    year: parts.year,
    month: parts.month,
    daysInMonth,
    title: copenhagenMonthTitleFormatter.format(
      new Date(Date.UTC(parts.year, parts.month - 1, 15, 12)),
    ),
    queryStart: new Date(
      Date.UTC(parts.year, parts.month - 1, 1) - oneDayMs,
    ).toISOString(),
    queryEnd: new Date(
      Date.UTC(parts.year, parts.month, 1) + oneDayMs,
    ).toISOString(),
  };
}

function getCopenhagenDateParts(date: Date) {
  const parts = copenhagenDatePartsFormatter.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
  };
}

function buildMonthlyChart(drinks: MonthlyDrinkRow[], month: CopenhagenMonth) {
  const peopleById = new Map<
    number,
    { id: number; name: string; dataKey: string; total: number }
  >();
  const cupsById = new Map<
    number,
    {
      id: number;
      name: string;
      ownerName: string;
      ownerId: number;
      total: number;
    }
  >();
  const countsByDay = new Map<number, Map<string, number>>();
  let totalCups = 0;

  for (const drink of drinks) {
    const consumedAt = parseUtcDateTime(drink.consumed_at);

    if (!consumedAt) continue;

    const date = getCopenhagenDateParts(consumedAt);

    if (date.year !== month.year || date.month !== month.month) continue;

    totalCups += 1;

    const dataKey = `person_${drink.person_id}`;
    const person = peopleById.get(drink.person_id) ?? {
      id: drink.person_id,
      name: drink.person_name,
      dataKey,
      total: 0,
    };

    person.total += 1;
    peopleById.set(drink.person_id, person);

    const cup = cupsById.get(drink.cup_id) ?? {
      id: drink.cup_id,
      name: drink.cup_name,
      ownerName: drink.person_name,
      ownerId: drink.person_id,
      total: 0,
    };

    cup.total += 1;
    cupsById.set(drink.cup_id, cup);

    const dayCounts = countsByDay.get(date.day) ?? new Map<string, number>();
    dayCounts.set(dataKey, (dayCounts.get(dataKey) ?? 0) + 1);
    countsByDay.set(date.day, dayCounts);
  }

  const people: MonthlyChartPerson[] = [...peopleById.values()]
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .map((person, index) => ({
      id: person.id,
      name: person.name,
      dataKey: person.dataKey,
      color: getPersonDisplayColor(person.name, index),
    }));

  const personColorById = new Map(
    people.map((person) => [person.id, person.color]),
  );
  const cups: MonthlyChartCup[] = [...cupsById.values()]
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .map((cup) => ({
      id: cup.id,
      name: cup.name,
      ownerName: cup.ownerName,
      total: cup.total,
      color:
        personColorById.get(cup.ownerId) ??
        getPersonDisplayColor(cup.ownerName, cup.ownerId),
    }));

  const days: MonthlyChartDay[] = Array.from(
    { length: month.daysInMonth },
    (_, index) => {
      const day = index + 1;
      const chartDay: MonthlyChartDay = { date: String(day), day };
      const dayCounts = countsByDay.get(day);

      for (const person of people) {
        chartDay[person.dataKey] = dayCounts?.get(person.dataKey) ?? 0;
      }

      return chartDay;
    },
  );

  return {
    title: month.title,
    totalCups,
    people,
    cups,
    days,
  };
}
