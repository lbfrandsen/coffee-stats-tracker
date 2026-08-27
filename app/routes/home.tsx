import { env } from "cloudflare:workers";
import { Tooltip } from "@base-ui/react/tooltip";
import { Check, ChevronDown, Info } from "lucide-react";
import { Link } from "react-router";

import type { Route } from "./+types/home";
import {
  CardAction,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Button, buttonVariants } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
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
  formatTime,
  parseUtcDateTime,
} from "~/lib/date-time";
import { getPersonDisplayColor } from "~/lib/person-colors";
import { cn } from "~/lib/utils";
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
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

// Persons data table
type PersonRow = {
  id: number;
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

type AnalyticsDrinkRow = {
  id: number;
  consumed_at: string;
  person_id: number;
  person_name: string;
  cup_id: number;
  cup_name: string;
};

type AnalyticsChartBucket = {
  bucket: string;
  [personDataKey: string]: string | number;
};

type AnalyticsChartPerson = {
  id: number;
  name: string;
  dataKey: string;
  color: string;
};

type AnalyticsChartCup = {
  id: number;
  name: string;
  ownerName: string;
  total: number;
  color: string;
};

type FastestDoublekill = {
  personId: number;
  personName: string;
  intervalMs: number | null;
  firstConsumedAt: string | null;
  secondConsumedAt: string | null;
};

type TypicalCooldown = {
  personId: number;
  personName: string;
  intervalMs: number | null;
};

type RapidFire = {
  personId: number;
  personName: string;
  averageIntervalMs: number | null;
  dateConsumedAt: string | null;
  cupCount: number;
};

type Loyalist = {
  personId: number;
  personName: string;
  percentage: number | null;
  cupCount: number;
  totalCupCount: number;
  cupName: string | null;
};

type EarlyBird = {
  personId: number;
  personName: string;
  consumedAt: string | null;
};

type NightOwl = {
  personId: number;
  personName: string;
  consumedAt: string | null;
};

type EconomyChartBucket = {
  bucket: string;
  total: number | null;
  [personDataKey: string]: string | number | null;
};

type EconomyPerson = {
  id: number;
  name: string;
  dataKey: string;
  color: string;
};

type EconomyDay = {
  dateKey: string;
  dateConsumedAt: string;
  totalCost: number;
  people: Array<{
    personId: number;
    personName: string;
    cost: number;
    color: string;
  }>;
};

type EconomyAnalytics = {
  people: EconomyPerson[];
  buckets: EconomyChartBucket[];
  drinkCount: number;
  totalCost: number;
  copenhagenEquivalentCost: number;
  estimatedSavings: number;
  averageDailyCost: number;
  elapsedDayCount: number;
  mostExpensiveDay: EconomyDay | null;
  cheapestDay: EconomyDay | null;
};

type MonthlyEconomyOverview = {
  projectedCost: number;
  currentCost: number;
  expectedRemainingCost: number;
  elapsedDayCount: number;
  totalDayCount: number;
  comparisonDayCount: number;
  comparisonCurrentCost: number;
  previousMonthCost: number;
  percentageChange: number | null;
};

type EligibleAnalyticsDrink = {
  drink: AnalyticsDrinkRow;
  consumedAt: Date;
};

type AnalyticsRange = "today" | "week" | "month" | "all";

type AnalyticsPeriod = {
  range: AnalyticsRange;
  title: string;
  subtitle: string;
  localStartMs: number | null;
  localEndMs: number | null;
  queryStart: string | null;
  queryEnd: string | null;
  buckets: Array<{ key: string; label: string }>;
};

const DRINKS_PAGE_SIZE = 15;
const COST_PER_DRINK = 1.38; // Rough average
const PRICE_OF_DRINK_IN_CPH = 40;
const CHART_NAMES = new Set(["paven", "burger lars"]); // Not everyone should be included in the chart
const DEFAULT_ANALYTICS_NAMES = new Set(["paven", "burger lars"]);
const ANALYTICS_RANGES: Array<{ value: AnalyticsRange; label: string }> = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "all", label: "All time" },
];

const leaderboardChartConfig = {
  cups: {
    label: "Cups",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

const analyticsCupsChartConfig = {
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
  const analyticsNow = new Date();
  const analyticsRange = parseAnalyticsRange(url.searchParams.get("range"));
  const analyticsPeriod = getAnalyticsPeriod(analyticsRange, analyticsNow);
  const monthlyEconomyQueryPeriod = getMonthlyEconomyQueryPeriod(analyticsNow);
  const requestedDrinksPage = Number.parseInt(
    url.searchParams.get("drinksPage") ?? "1",
    10,
  );
  const drinksPage =
    Number.isFinite(requestedDrinksPage) && requestedDrinksPage > 0
      ? requestedDrinksPage
      : 1;

  try {
    const [peopleResult, cupsResult, drinksCount] = await Promise.all([
      env.DB.prepare(
        `
          SELECT p.id, p.name, p.display_name
          FROM persons p
          WHERE EXISTS (
            SELECT 1
            FROM cups c
            WHERE c.owner_id = p.id
          )
          ORDER BY p.name COLLATE NOCASE ASC
        `,
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
      env.DB.prepare("SELECT COUNT(*) AS total FROM drinks").first<CountRow>(),
    ]);

    const people = peopleResult.results;
    const validPersonIds = new Set(people.map((person) => person.id));
    const requestedPersonIds = url.searchParams
      .getAll("person")
      .map(Number)
      .filter((id) => Number.isInteger(id) && validPersonIds.has(id));
    const defaultPersonIds = people
      .filter((person) =>
        DEFAULT_ANALYTICS_NAMES.has(
          (person.display_name ?? person.name).trim().toLowerCase(),
        ),
      )
      .map((person) => person.id);
    const selectedPersonIds = [
      ...new Set(
        requestedPersonIds.length > 0
          ? requestedPersonIds
          : defaultPersonIds.length > 0
            ? defaultPersonIds
            : people.map((person) => person.id),
      ),
    ];

    const [analyticsDrinks, monthlyEconomyDrinks] =
      selectedPersonIds.length > 0
        ? await Promise.all([
            loadAnalyticsDrinks(selectedPersonIds, analyticsPeriod).then(
              (result) => result.results,
            ),
            loadAnalyticsDrinks(
              selectedPersonIds,
              monthlyEconomyQueryPeriod,
            ).then((result) => result.results),
          ])
        : [[], []];
    const selectedPeople = people.filter((person) =>
      selectedPersonIds.includes(person.id),
    );
    const eligibleAnalyticsDrinks = getEligibleAnalyticsDrinks(
      analyticsDrinks,
      analyticsPeriod,
    );

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
      people,
      cups: cupsResult.results,
      leaderboardRows: leaderboardResult.results,
      allDrinksRows: drinksResult.results,
      analytics: {
        range: analyticsRange,
        selectedPersonIds,
      },
      analyticsChart: buildAnalyticsChart(analyticsDrinks, analyticsPeriod),
      fastestDoublekills: buildFastestDoublekills(
        eligibleAnalyticsDrinks,
        selectedPeople,
      ),
      typicalCooldowns: buildTypicalCooldowns(
        eligibleAnalyticsDrinks,
        selectedPeople,
      ),
      rapidFires: buildRapidFires(eligibleAnalyticsDrinks, selectedPeople),
      loyalists: buildLoyalists(eligibleAnalyticsDrinks, selectedPeople),
      earlyBirds: buildEarlyBirds(eligibleAnalyticsDrinks, selectedPeople),
      nightOwls: buildNightOwls(eligibleAnalyticsDrinks, selectedPeople),
      economyAnalytics: buildEconomyAnalytics(
        eligibleAnalyticsDrinks,
        selectedPeople,
        analyticsPeriod,
        analyticsNow,
      ),
      monthlyEconomyOverview: buildMonthlyEconomyOverview(
        monthlyEconomyDrinks,
        analyticsNow,
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
      analytics: {
        range: analyticsRange,
        selectedPersonIds: [],
      },
      analyticsChart: buildAnalyticsChart([], analyticsPeriod),
      fastestDoublekills: [],
      typicalCooldowns: [],
      rapidFires: [],
      loyalists: [],
      earlyBirds: [],
      nightOwls: [],
      economyAnalytics: buildEconomyAnalytics(
        [],
        [],
        analyticsPeriod,
        analyticsNow,
      ),
      monthlyEconomyOverview: buildMonthlyEconomyOverview([], analyticsNow),
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
    analytics,
    analyticsChart,
    fastestDoublekills,
    typicalCooldowns,
    rapidFires,
    loyalists,
    earlyBirds,
    nightOwls,
    economyAnalytics,
    monthlyEconomyOverview,
    drinksPagination,
  } = loaderData;
  const paginationPages = getVisiblePages(
    drinksPagination.page,
    drinksPagination.totalPages,
  );

  const leaderboardChartData = leaderboardRows.filter((row) =>
    CHART_NAMES.has(row.name.toLowerCase()),
  );
  const analyticsChartConfig: ChartConfig = Object.fromEntries(
    analyticsChart.people.map((person) => [
      person.dataKey,
      { label: person.name, color: person.color },
    ]),
  );
  const analyticsCupsChartHeight = Math.max(
    120,
    analyticsChart.cups.length * 44 + 24,
  );
  const analyticsTimeChartMinWidth = Math.max(
    760,
    analyticsChart.buckets.length * 32,
  );
  const economyChartConfig: ChartConfig = Object.fromEntries([
    ...economyAnalytics.people.map((person) => [
      person.dataKey,
      { label: person.name, color: person.color },
    ]),
    ["total", { label: "Total", color: "#22c55e" }],
  ]);
  const economyChartMinWidth = Math.max(
    760,
    economyAnalytics.buckets.length * 32,
  );
  const selectedPeople = people.filter((person) =>
    analytics.selectedPersonIds.includes(person.id),
  );
  const allPeopleSelected =
    people.length > 0 && selectedPeople.length === people.length;
  const peopleFilterLabel = allPeopleSelected
    ? "All people"
    : selectedPeople.length === 1
      ? (selectedPeople[0].display_name ?? selectedPeople[0].name)
      : `${selectedPeople.length} people`;

  return (
    <section className="mx-auto grid max-w-6xl gap-4 px-4 py-8 sm:px-6 lg:grid-cols-4 lg:px-8">
      <Card className="ring-0 border-zinc-800 bg-zinc-950/80 lg:col-span-3">
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

      <div className="flex flex-col gap-4  py-4 lg:col-span-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-medium uppercase text-zinc-500">
            Filter
          </span>
          <div className="flex flex-wrap rounded-md border border-zinc-800 bg-zinc-950 p-1">
            {ANALYTICS_RANGES.map((range) => (
              <Link
                key={range.value}
                to={getAnalyticsHref(
                  range.value,
                  analytics.selectedPersonIds,
                  drinksPagination.page,
                )}
                className={buttonVariants({
                  variant:
                    analytics.range === range.value ? "secondary" : "ghost",
                  size: "sm",
                  className: "shadow-none",
                })}
              >
                {range.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="mr-1 text-xs font-medium uppercase text-zinc-500">
            Personer
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="cursor-pointer"
                />
              }
              aria-label="Filter analytics by person"
            >
              {peopleFilterLabel}
              <ChevronDown />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Select people</DropdownMenuLabel>
              <DropdownMenuLinkItem
                href={getAnalyticsHref(
                  analytics.range,
                  people.map((person) => person.id),
                  drinksPagination.page,
                )}
                className={cn(
                  "font-semibold uppercase",
                  allPeopleSelected && "bg-zinc-800 text-zinc-50",
                )}
              >
                <span className="flex size-4 items-center justify-center cursor-pointer">
                  {allPeopleSelected && <Check />}
                </span>
                All people
              </DropdownMenuLinkItem>
              <DropdownMenuSeparator />
              {people.map((person) => {
                const isSelected = analytics.selectedPersonIds.includes(
                  person.id,
                );

                return (
                  <DropdownMenuLinkItem
                    key={person.id}
                    href={getAnalyticsHref(
                      analytics.range,
                      togglePersonFilter(
                        analytics.selectedPersonIds,
                        person.id,
                      ),
                      drinksPagination.page,
                    )}
                  >
                    <span className="flex size-4 items-center justify-center">
                      {isSelected && <Check />}
                    </span>
                    {person.display_name ?? person.name}
                  </DropdownMenuLinkItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Card className="ring-0 border-zinc-800 bg-zinc-950/80 lg:col-span-4">
        <CardHeader className="border-b border-zinc-800">
          <CardTitle className="uppercase">
            {analyticsChart.title}{" "}
            <span className="ml-2 text-zinc-500 normal-case">
              Hvordan ser misbruget ud?
            </span>
          </CardTitle>
          <CardAction className="flex items-baseline gap-2 whitespace-nowrap font-medium">
            <span className="text-base tabular-nums text-zinc-100">
              {analyticsChart.totalCups}
            </span>
            <span className="text-xs uppercase text-zinc-400 sm:text-sm">
              total cups
            </span>
          </CardAction>
        </CardHeader>
        <CardContent>
          {analyticsChart.people.length > 0 ? (
            <div className="overflow-x-auto pb-2">
              <ChartContainer
                config={analyticsChartConfig}
                className="h-96 w-full aspect-auto"
                style={{ minWidth: analyticsTimeChartMinWidth }}
                initialDimension={{ width: 1040, height: 384 }}
              >
                <BarChart
                  accessibilityLayer
                  data={analyticsChart.buckets}
                  margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="bucket"
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
                    domain={[0, "dataMax"]}
                    width={28}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_, payload) =>
                          payload?.[0]?.payload?.tooltipLabel ?? ""
                        }
                      />
                    }
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  {analyticsChart.people.map((person) => (
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
              No drinks recorded for this selection.
            </div>
          )}
        </CardContent>
      </Card>

      <section
        className="grid gap-4 lg:col-span-4 lg:grid-cols-3"
        aria-label="Minor statistics"
      >
        <Card className="border-zinc-800 bg-zinc-950/80">
          <CardHeader className="border-b border-zinc-800">
            <CardTitle className="flex items-center gap-1.5 uppercase">
              Hurtigste doublekill
              <Tooltip.Root>
                <Tooltip.Trigger
                  type="button"
                  delay={150}
                  aria-label="What does fastest doublekill mean?"
                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-full text-zinc-500 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                >
                  <Info className="size-3.5" aria-hidden="true" />
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Positioner sideOffset={8}>
                    <Tooltip.Popup className="z-50 max-w-64 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs leading-5 font-normal tracking-normal text-zinc-200 normal-case shadow-lg transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0">
                      Hurtigste doublekill er ikke så drabligt som det lyder.
                      Det er intervallet mellem de to kopper, som er drukket
                      hurtigst efter hinanden.
                    </Tooltip.Popup>
                  </Tooltip.Positioner>
                </Tooltip.Portal>
              </Tooltip.Root>
            </CardTitle>
            <CardAction className="self-center text-xs font-medium uppercase text-zinc-400">
              {analyticsChart.subtitle}
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-5">
            {fastestDoublekills.map((doublekill) => (
              <div key={doublekill.personId}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{doublekill.personName}</span>
                  <span
                    className="shrink-0 font-medium tabular-nums text-zinc-300"
                    style={
                      doublekill.intervalMs === null
                        ? undefined
                        : {
                            color: getPersonDisplayColor(
                              doublekill.personName,
                              doublekill.personId,
                            ),
                          }
                    }
                  >
                    {doublekill.intervalMs === null
                      ? "—"
                      : formatInterval(doublekill.intervalMs)}
                  </span>
                </div>
                {doublekill.firstConsumedAt && doublekill.secondConsumedAt ? (
                  <div className="mt-1 text-xs text-zinc-500">
                    <p>
                      {formatAnalyticsDate(doublekill.firstConsumedAt)}
                      {" · "}
                      {formatTime(doublekill.firstConsumedAt)} →{" "}
                      {formatTime(doublekill.secondConsumedAt)}
                    </p>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-zinc-500">
                    Not enough drinks in this period.
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/80">
          <CardHeader className="border-b border-zinc-800">
            <CardTitle className="flex items-center gap-1.5 uppercase">
              Median cooldown
              <Tooltip.Root>
                <Tooltip.Trigger
                  type="button"
                  delay={150}
                  aria-label="What does median cooldown mean?"
                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-full text-zinc-500 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                >
                  <Info className="size-3.5" aria-hidden="true" />
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Positioner sideOffset={8}>
                    <Tooltip.Popup className="z-50 max-w-64 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs leading-5 font-normal tracking-normal text-zinc-200 normal-case shadow-lg transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0">
                      Medianen er den midterste observation i et datasæt, så det
                      er det midterste tidsinterval af alle på samme dag, efter
                      intervallerne er sorteret. Den repræsenterer dermed den
                      typiske pause mellem to kopper kaffe. F.eks. med sorterede
                      intervaller på 15min, 18min og 37min, er 18min medianen.
                    </Tooltip.Popup>
                  </Tooltip.Positioner>
                </Tooltip.Portal>
              </Tooltip.Root>
            </CardTitle>
            <CardAction className="self-center text-xs font-medium uppercase text-zinc-400">
              {analyticsChart.subtitle}
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-5">
            {typicalCooldowns.map((cooldown) => (
              <div key={cooldown.personId}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{cooldown.personName}</span>
                  <span
                    className="shrink-0 font-medium tabular-nums text-zinc-300"
                    style={
                      cooldown.intervalMs === null
                        ? undefined
                        : {
                            color: getPersonDisplayColor(
                              cooldown.personName,
                              cooldown.personId,
                            ),
                          }
                    }
                  >
                    {cooldown.intervalMs === null
                      ? "—"
                      : formatInterval(cooldown.intervalMs)}
                  </span>
                </div>
                {cooldown.intervalMs === null && (
                  <p className="mt-1 text-xs text-zinc-500">
                    No same-day interval in this period.
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/80">
          <CardHeader className="border-b border-zinc-800">
            <CardTitle className="uppercase">A-mennesket</CardTitle>
            <CardAction className="self-center text-xs font-medium uppercase text-zinc-400">
              {analyticsChart.subtitle}
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-5">
            {earlyBirds.map((earlyBird) => (
              <div key={earlyBird.personId}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{earlyBird.personName}</span>
                  <span
                    className="shrink-0 font-medium tabular-nums text-zinc-300"
                    style={
                      earlyBird.consumedAt
                        ? {
                            color: getPersonDisplayColor(
                              earlyBird.personName,
                              earlyBird.personId,
                            ),
                          }
                        : undefined
                    }
                  >
                    {earlyBird.consumedAt
                      ? formatTime(earlyBird.consumedAt)
                      : "—"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {earlyBird.consumedAt
                    ? formatAnalyticsDate(earlyBird.consumedAt)
                    : "No drinks in this period."}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/80">
          <CardHeader className="border-b border-zinc-800">
            <CardTitle className="flex items-center gap-1.5 uppercase">
              Rapid fire
              <Tooltip.Root>
                <Tooltip.Trigger
                  type="button"
                  delay={150}
                  aria-label="Hvad betyder Rapid fire?"
                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-full text-zinc-500 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                >
                  <Info className="size-3.5" aria-hidden="true" />
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Positioner sideOffset={8}>
                    <Tooltip.Popup className="z-50 max-w-64 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs leading-5 font-normal tracking-normal text-zinc-200 normal-case shadow-lg transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0">
                      Rapid fire viser personens laveste gennemsnitlige tid
                      mellem sammenhængende kopper på én kalenderdag inden for
                      det valgte filter. Hver dag beregnes separat, og dage med
                      færre end to kopper tæller ikke med.
                    </Tooltip.Popup>
                  </Tooltip.Positioner>
                </Tooltip.Portal>
              </Tooltip.Root>
            </CardTitle>
            <CardAction className="self-center text-xs font-medium uppercase text-zinc-400">
              {analyticsChart.subtitle}
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-5">
            {rapidFires.map((rapidFire) => (
              <div key={rapidFire.personId}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{rapidFire.personName}</span>
                  <span
                    className="shrink-0 font-medium tabular-nums text-zinc-300"
                    style={
                      rapidFire.averageIntervalMs === null
                        ? undefined
                        : {
                            color: getPersonDisplayColor(
                              rapidFire.personName,
                              rapidFire.personId,
                            ),
                          }
                    }
                  >
                    {rapidFire.averageIntervalMs === null
                      ? "—"
                      : formatInterval(rapidFire.averageIntervalMs)}
                  </span>
                </div>
                {rapidFire.dateConsumedAt ? (
                  <p className="mt-1 text-xs text-zinc-500">
                    {formatAnalyticsDate(rapidFire.dateConsumedAt)} ·{" "}
                    {rapidFire.cupCount} kopper
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-zinc-500">
                    Not enough drinks in this period.
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/80">
          <CardHeader className="border-b border-zinc-800">
            <CardTitle className="uppercase">Loyalisten</CardTitle>
            <CardAction className="self-center text-xs font-medium uppercase text-zinc-400">
              {analyticsChart.subtitle}
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-5">
            {loyalists.map((loyalist) => (
              <div key={loyalist.personId}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{loyalist.personName}</span>

                  <span
                    className="shrink-0 font-medium tabular-nums text-zinc-300"
                    style={
                      loyalist.percentage === null
                        ? undefined
                        : {
                            color: getPersonDisplayColor(
                              loyalist.personName,
                              loyalist.personId,
                            ),
                          }
                    }
                  >
                    {loyalist.percentage === null
                      ? "—"
                      : formatPercentage(loyalist.percentage)}
                  </span>
                </div>

                <p className="mt-1">
                  {loyalist.cupName ? (
                    <>
                      <span className="font-medium text-zinc-300">
                        {loyalist.cupName}
                      </span>
                      <span className="ml-2 text-xs text-zinc-500">
                        {loyalist.cupCount} af {loyalist.totalCupCount} kopper
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-zinc-500">
                      No drinks in this period.
                    </span>
                  )}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/80">
          <CardHeader className="border-b border-zinc-800">
            <CardTitle className="uppercase">Natteravnen</CardTitle>
            <CardAction className="self-center text-xs font-medium uppercase text-zinc-400">
              {analyticsChart.subtitle}
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-5">
            {nightOwls.map((nightOwl) => (
              <div key={nightOwl.personId}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{nightOwl.personName}</span>
                  <span
                    className="shrink-0 font-medium tabular-nums text-zinc-300"
                    style={
                      nightOwl.consumedAt
                        ? {
                            color: getPersonDisplayColor(
                              nightOwl.personName,
                              nightOwl.personId,
                            ),
                          }
                        : undefined
                    }
                  >
                    {nightOwl.consumedAt
                      ? formatTime(nightOwl.consumedAt)
                      : "—"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {nightOwl.consumedAt
                    ? formatAnalyticsDate(nightOwl.consumedAt)
                    : "No drinks in this period."}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <Card className="ring-0 border-zinc-800 bg-zinc-950/80 lg:col-span-4">
        <CardHeader className="border-b border-zinc-800">
          <CardTitle className="uppercase">
            Stats by mug{" "}
            <span className="ml-2 text-zinc-500 normal-case">
              Hvilke kopper er mest populære?
            </span>
          </CardTitle>
          <CardAction className="text-sm font-medium uppercase text-zinc-400">
            {analyticsChart.subtitle}
          </CardAction>
        </CardHeader>
        <CardContent>
          {analyticsChart.cups.length > 0 ? (
            <ChartContainer
              config={analyticsCupsChartConfig}
              className="w-full aspect-auto"
              style={{ height: analyticsCupsChartHeight }}
              initialDimension={{
                width: 1040,
                height: analyticsCupsChartHeight,
              }}
            >
              <BarChart
                accessibilityLayer
                data={analyticsChart.cups}
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
                  {analyticsChart.cups.map((cup) => (
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
              No cups used for this selection.
            </div>
          )}
        </CardContent>
      </Card>

      <section className="space-y-4 lg:col-span-4" aria-label="Økonomi">
        <Card className="ring-0 border-zinc-800 bg-zinc-950/80">
          <CardHeader className="border-b border-zinc-800">
            <CardTitle className="flex items-center gap-1.5 uppercase">
              Økonomi{" "}
              <Tooltip.Root>
                <Tooltip.Trigger
                  type="button"
                  delay={150}
                  aria-label="What does økonomi mean, how is it calculated?"
                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-full text-zinc-500 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                >
                  <Info className="size-3.5" aria-hidden="true" />
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Positioner sideOffset={8}>
                    <Tooltip.Popup className="z-50 max-w-64 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs leading-5 font-normal tracking-normal text-zinc-200 normal-case shadow-lg transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0">
                      Prisen pr. kop er fastlagt til 1,38kr.
                      <br />
                      <br />
                      Økonomien er tæt på umulig at kortlægge helt præcist, da
                      prisen pr. kop er tæt på umulig at estimere præcist. Vi
                      laver både kaffe med friskkværnede bønner og kapsler, og
                      prisen varierer dermed rigtig meget alt efter typen af
                      bønner og kapsler — og prisen på samme bønner og kapsler
                      varierer ligeledes. Det varierer også meget om vi bruger
                      mælk, fløde eller sirup i kaffen (eller hvad man nu er
                      til), men det er ikke medregnet her.
                      <br />
                      <br />
                      Vi køber både bønner og kapsler fra{" "}
                      <a
                        href="https://kaffek.dk/"
                        target="_blank"
                        rel="noreferrer"
                        className="text-zinc-100 underline underline-offset-2 hover:text-white"
                      >
                        KaffeK, tidligere Kaffekapslen.dk
                      </a>
                      , hvor prisen kan kontrolleres.
                    </Tooltip.Popup>
                  </Tooltip.Positioner>
                </Tooltip.Portal>
              </Tooltip.Root>
              <span className="ml-2 text-zinc-500 normal-case">
                Gode tider på SU
              </span>
            </CardTitle>
            <CardAction className="text-sm font-medium uppercase text-zinc-400">
              {analyticsChart.subtitle}
            </CardAction>
          </CardHeader>
          <CardContent>
            {economyAnalytics.totalCost > 0 ? (
              <div className="overflow-x-auto pb-2">
                <ChartContainer
                  config={economyChartConfig}
                  className="h-80 w-full aspect-auto"
                  style={{ minWidth: economyChartMinWidth }}
                  initialDimension={{ width: 1040, height: 320 }}
                >
                  <LineChart
                    accessibilityLayer
                    data={economyAnalytics.buckets}
                    margin={{ top: 12, right: 12, left: 8, bottom: 0 }}
                  >
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="bucket"
                      axisLine={false}
                      tickLine={false}
                      tickMargin={10}
                      interval={0}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tickMargin={8}
                      domain={[0, "dataMax"]}
                      tickFormatter={(value: number) => `${value} kr.`}
                      width={64}
                    />
                    <ChartTooltip
                      cursor={false}
                      content={
                        <ChartTooltipContent
                          labelFormatter={(_, payload) =>
                            payload?.[0]?.payload?.tooltipLabel ?? ""
                          }
                          formatter={(value, name, item) => (
                            <>
                              <div
                                className="size-2.5 shrink-0 rounded-xs"
                                style={{ backgroundColor: item.color }}
                              />
                              <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                                <span className="text-muted-foreground">
                                  {economyChartConfig[String(name)]?.label ??
                                    name}
                                </span>
                                <span className="font-mono font-medium text-foreground tabular-nums">
                                  {formatCurrency(Number(value))}
                                </span>
                              </div>
                            </>
                          )}
                        />
                      }
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                    {economyAnalytics.people.map((person) => (
                      <Line
                        key={person.id}
                        type="linear"
                        dataKey={person.dataKey}
                        stroke={`var(--color-${person.dataKey})`}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    ))}
                    {economyAnalytics.people.length > 1 && (
                      <Line
                        type="linear"
                        dataKey="total"
                        stroke="var(--color-total)"
                        strokeWidth={3}
                        dot={false}
                        activeDot={{ r: 5 }}
                      />
                    )}
                  </LineChart>
                </ChartContainer>
              </div>
            ) : (
              <div className="flex h-64 items-center justify-center text-sm text-zinc-400">
                No drinks recorded for this selection.
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="border-zinc-800 bg-zinc-950/80">
            <CardHeader className="border-b border-zinc-800">
              <CardTitle className="uppercase">Gennemsnit pr. dag</CardTitle>
              <CardAction className="self-center text-xs font-medium uppercase text-zinc-400">
                {analyticsChart.subtitle}
              </CardAction>
            </CardHeader>
            <CardContent>
              {economyAnalytics.elapsedDayCount > 0 ? (
                <>
                  <p className="text-2xl font-semibold tabular-nums text-green-500">
                    {formatCurrency(economyAnalytics.averageDailyCost)}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Fordelt over {economyAnalytics.elapsedDayCount}{" "}
                    {economyAnalytics.elapsedDayCount === 1
                      ? "kalenderdag"
                      : "kalenderdage"}
                  </p>
                </>
              ) : (
                <p className="text-sm text-zinc-500">
                  No drinks in this period.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-950/80">
            <CardHeader className="border-b border-zinc-800">
              <CardTitle className="uppercase">Dyreste dag</CardTitle>
              <CardAction className="self-center text-xs font-medium uppercase text-zinc-400">
                {economyAnalytics.mostExpensiveDay
                  ? formatAnalyticsDate(
                      economyAnalytics.mostExpensiveDay.dateConsumedAt,
                    )
                  : "—"}
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-2">
              {economyAnalytics.mostExpensiveDay ? (
                <>
                  {economyAnalytics.mostExpensiveDay.people.map((person) => (
                    <div
                      key={person.personId}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <span className="font-medium">{person.personName}</span>
                      <span
                        className="shrink-0 font-medium tabular-nums"
                        style={{ color: person.color }}
                      >
                        {formatCurrency(person.cost)}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-baseline justify-between gap-3 border-t border-zinc-800 pt-2">
                    <span className="font-semibold">Total</span>
                    <span className="shrink-0 font-semibold tabular-nums text-green-500">
                      {formatCurrency(
                        economyAnalytics.mostExpensiveDay.totalCost,
                      )}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-zinc-500">
                  No drinks in this period.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-950/80">
            <CardHeader className="border-b border-zinc-800">
              <CardTitle className="flex items-center gap-1.5 uppercase">
                Billigste dag
                <Tooltip.Root>
                  <Tooltip.Trigger
                    type="button"
                    delay={150}
                    aria-label="What does cheapest day mean?"
                    className="inline-flex size-5 cursor-pointer items-center justify-center rounded-full text-zinc-500 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                  >
                    <Info className="size-3.5" aria-hidden="true" />
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Positioner sideOffset={8}>
                      <Tooltip.Popup className="z-50 max-w-64 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs leading-5 font-normal tracking-normal text-zinc-200 normal-case shadow-lg transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0">
                        Billigste dag er udregnet for dage, hvor mindst én kop
                        er registreret. Det betyder, at der også inkluderes dage
                        hvor en person har drukket for 0kr., men dage, hvor
                        ingen har drukket kaffe bliver ignoreret - selvom en
                        samlet pris på 0kr. ellers ville være billigst.
                      </Tooltip.Popup>
                    </Tooltip.Positioner>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </CardTitle>
              <CardAction className="self-center text-xs font-medium uppercase text-zinc-400">
                {economyAnalytics.cheapestDay
                  ? formatAnalyticsDate(
                      economyAnalytics.cheapestDay.dateConsumedAt,
                    )
                  : "—"}
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-2">
              {economyAnalytics.cheapestDay ? (
                <>
                  {economyAnalytics.cheapestDay.people.map((person) => (
                    <div
                      key={person.personId}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <span className="font-medium">{person.personName}</span>
                      <span
                        className="shrink-0 font-medium tabular-nums"
                        style={{ color: person.color }}
                      >
                        {formatCurrency(person.cost)}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-baseline justify-between gap-3 border-t border-zinc-800 pt-2">
                    <span className="font-semibold">Total</span>
                    <span className="shrink-0 font-semibold tabular-nums text-green-500">
                      {formatCurrency(economyAnalytics.cheapestDay.totalCost)}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-zinc-500">
                  No drinks in this period.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-950/80">
            <CardHeader className="border-b border-zinc-800">
              <CardTitle className="flex items-center gap-1.5 uppercase">
                Estimeret total
                <Tooltip.Root>
                  <Tooltip.Trigger
                    type="button"
                    delay={150}
                    aria-label="What does estimated total mean?"
                    className="inline-flex size-5 cursor-pointer items-center justify-center rounded-full text-zinc-500 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                  >
                    <Info className="size-3.5" aria-hidden="true" />
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Positioner sideOffset={8}>
                      <Tooltip.Popup className="z-50 max-w-64 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs leading-5 font-normal tracking-normal text-zinc-200 normal-case shadow-lg transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0">
                        Estimeret total er en projektion af, hvad vi forventer
                        at hele måneden kommer til at koste Den er udregnet ud
                        fra det nuværende daglige gennemsnit, og bliver dermed
                        mere og mere præcis, som måneden skrider frem.
                        <br />
                        <br />
                        Det estimerede total respekterer ikke filtre, og vil
                        atid vise den nuværende måned.
                      </Tooltip.Popup>
                    </Tooltip.Positioner>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </CardTitle>
              <CardAction className="self-center text-xs font-medium uppercase text-zinc-400">
                This month
              </CardAction>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums text-green-500">
                {formatCurrency(monthlyEconomyOverview.projectedCost)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {formatCurrency(monthlyEconomyOverview.currentCost)} brugt ·{" "}
                {formatCurrency(monthlyEconomyOverview.expectedRemainingCost)}{" "}
                forventet resten af måneden
              </p>
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-950/80">
            <CardHeader className="border-b border-zinc-800">
              <CardTitle className="flex items-center gap-1.5 uppercase">
                Mod sidste måned
                <Tooltip.Root>
                  <Tooltip.Trigger
                    type="button"
                    delay={150}
                    aria-label="What does mod sidste måned mean?"
                    className="inline-flex size-5 cursor-pointer items-center justify-center rounded-full text-zinc-500 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                  >
                    <Info className="size-3.5" aria-hidden="true" />
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Positioner sideOffset={8}>
                      <Tooltip.Popup className="z-50 max-w-64 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs leading-5 font-normal tracking-normal text-zinc-200 normal-case shadow-lg transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0">
                        Sammenligning af det nuværende forbrug efter samme antal
                        dage i sidste måned.
                        <br />
                        <br />
                        Sammenligningen respekterer ikke filtre, og vil atid
                        vise den nuværende måned mod sidste måned.
                      </Tooltip.Popup>
                    </Tooltip.Positioner>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </CardTitle>
              <CardAction className="self-center text-xs font-medium uppercase text-zinc-400">
                This month
              </CardAction>
            </CardHeader>
            <CardContent>
              <p
                className={cn(
                  "text-2xl font-semibold tabular-nums",
                  monthlyEconomyOverview.percentageChange === null ||
                    monthlyEconomyOverview.percentageChange === 0
                    ? "text-zinc-300"
                    : monthlyEconomyOverview.percentageChange > 0
                      ? "text-red-400"
                      : "text-green-500",
                )}
              >
                {monthlyEconomyOverview.percentageChange === null
                  ? "N/A"
                  : formatSignedPercentage(
                      monthlyEconomyOverview.percentageChange,
                    )}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {formatCurrency(monthlyEconomyOverview.comparisonCurrentCost)}{" "}
                mod {formatCurrency(monthlyEconomyOverview.previousMonthCost)}{" "}
                efter {monthlyEconomyOverview.comparisonDayCount} dage
              </p>
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-950/80">
            <CardHeader className="border-b border-zinc-800">
              <CardTitle className="flex items-center gap-1.5 uppercase">
                Penge sparet
                <Tooltip.Root>
                  <Tooltip.Trigger
                    type="button"
                    delay={150}
                    aria-label="What does penge sparet mean mean?"
                    className="inline-flex size-5 cursor-pointer items-center justify-center rounded-full text-zinc-500 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                  >
                    <Info className="size-3.5" aria-hidden="true" />
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Positioner sideOffset={8}>
                      <Tooltip.Popup className="z-50 max-w-64 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs leading-5 font-normal tracking-normal text-zinc-200 normal-case shadow-lg transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0">
                        Udregning af, hvor mange penge vi har sparet ift. at
                        købe vores kaffe ude på en café i København.
                        <br />
                        <br />
                        Prisen på en kaffe fra en Københavnercafé er svær at
                        fastlægge, men vi har regnet med 20kr. for en
                        filterkaffe og 50kr. for en latte (fuldstændig
                        vanvittigt, velkommen til København). Dermed har vi
                        fastlagt prisen pr. kaffe fra en café til 40kr., da vi
                        bruger vores espressomaskine betydeligt mere, end vi
                        bruger vores kapsler.
                      </Tooltip.Popup>
                    </Tooltip.Positioner>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </CardTitle>
              <CardAction className="self-center text-xs font-medium uppercase text-zinc-400">
                {analyticsChart.subtitle}
              </CardAction>
            </CardHeader>
            <CardContent>
              <p
                className={cn(
                  "text-2xl font-semibold tabular-nums",
                  economyAnalytics.estimatedSavings >= 0
                    ? "text-green-500"
                    : "text-red-400",
                )}
              >
                {formatCurrency(economyAnalytics.estimatedSavings)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Sammenlignet med {economyAnalytics.drinkCount}{" "}
                {economyAnalytics.drinkCount === 1 ? "kop" : "kopper"} á{" "}
                {formatCurrency(PRICE_OF_DRINK_IN_CPH)}
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <Card className="border-zinc-800 bg-zinc-950/80 lg:col-span-4 mt-30">
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
                    href={getDrinksPageHref(
                      drinksPagination.page - 1,
                      analytics.range,
                      analytics.selectedPersonIds,
                    )}
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
                      href={getDrinksPageHref(
                        page,
                        analytics.range,
                        analytics.selectedPersonIds,
                      )}
                      isActive={page === drinksPagination.page}
                    >
                      {page}
                    </PaginationLink>
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    href={getDrinksPageHref(
                      drinksPagination.page + 1,
                      analytics.range,
                      analytics.selectedPersonIds,
                    )}
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

function getAnalyticsHref(
  range: AnalyticsRange,
  personIds: number[],
  drinksPage = 1,
) {
  const searchParams = new URLSearchParams({ range });

  for (const personId of personIds) {
    searchParams.append("person", String(personId));
  }

  if (drinksPage > 1) {
    searchParams.set("drinksPage", String(drinksPage));
  }

  return `/?${searchParams.toString()}`;
}

function getDrinksPageHref(
  page: number,
  range: AnalyticsRange,
  personIds: number[],
) {
  return getAnalyticsHref(range, personIds, Math.max(1, page));
}

function togglePersonFilter(selectedPersonIds: number[], personId: number) {
  if (!selectedPersonIds.includes(personId)) {
    return [...selectedPersonIds, personId];
  }

  if (selectedPersonIds.length === 1) {
    return selectedPersonIds;
  }

  return selectedPersonIds.filter((selectedId) => selectedId !== personId);
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
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const copenhagenMonthTitleFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

const analyticsDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  dateStyle: "medium",
});

const shortDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});

const monthDayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
});

function getChartBucketTooltipLabel(
  bucket: { key: string; label: string },
  range: AnalyticsRange,
) {
  return range === "month"
    ? monthDayFormatter.format(new Date(`${bucket.key}T00:00:00.000Z`))
    : bucket.label;
}

const weekdayFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
});

const allTimeBucketFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  month: "short",
  year: "numeric",
});

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function parseAnalyticsRange(value: string | null): AnalyticsRange {
  return value === "today" ||
    value === "week" ||
    value === "month" ||
    value === "all"
    ? value
    : "month";
}

function getAnalyticsPeriod(
  range: AnalyticsRange,
  now = new Date(),
): AnalyticsPeriod {
  const parts = getCopenhagenDateParts(now);
  const todayMs = Date.UTC(parts.year, parts.month - 1, parts.day);

  if (range === "all") {
    return {
      range,
      title: "All time",
      subtitle: "All recorded data",
      localStartMs: null,
      localEndMs: null,
      queryStart: null,
      queryEnd: null,
      buckets: [],
    };
  }

  let localStartMs: number;
  let localEndMs: number;
  let title: string;
  let subtitle: string;
  let buckets: AnalyticsPeriod["buckets"];

  if (range === "today") {
    localStartMs = todayMs;
    localEndMs = todayMs + ONE_DAY_MS;
    title = "Today";
    subtitle = shortDateFormatter.format(new Date(todayMs));
    buckets = Array.from({ length: 24 }, (_, hour) => ({
      key: `hour_${hour}`,
      label: `${String(hour).padStart(2, "0")}:00`,
    }));
  } else if (range === "week") {
    const mondayOffset = (new Date(todayMs).getUTCDay() + 6) % 7;
    localStartMs = todayMs - mondayOffset * ONE_DAY_MS;
    localEndMs = localStartMs + 7 * ONE_DAY_MS;
    title = "This week";
    subtitle = `${shortDateFormatter.format(new Date(localStartMs))}–${shortDateFormatter.format(new Date(localEndMs - ONE_DAY_MS))}`;
    buckets = Array.from({ length: 7 }, (_, index) => {
      const dateMs = localStartMs + index * ONE_DAY_MS;

      return {
        key: getLocalDateKey(new Date(dateMs)),
        label: weekdayFormatter.format(new Date(dateMs)),
      };
    });
  } else {
    localStartMs = Date.UTC(parts.year, parts.month - 1, 1);
    localEndMs = Date.UTC(parts.year, parts.month, 1);
    title = copenhagenMonthTitleFormatter.format(new Date(localStartMs));
    subtitle = "This month";
    const daysInMonth = Math.round((localEndMs - localStartMs) / ONE_DAY_MS);
    buckets = Array.from({ length: daysInMonth }, (_, index) => {
      const dateMs = localStartMs + index * ONE_DAY_MS;

      return {
        key: getLocalDateKey(new Date(dateMs)),
        label: String(index + 1),
      };
    });
  }

  return {
    range,
    title,
    subtitle,
    localStartMs,
    localEndMs,
    queryStart: new Date(localStartMs - ONE_DAY_MS).toISOString(),
    queryEnd: new Date(localEndMs + ONE_DAY_MS).toISOString(),
    buckets,
  };
}

function getMonthlyEconomyQueryPeriod(now: Date) {
  const date = getCopenhagenDateParts(now);
  const previousMonthStartMs = Date.UTC(date.year, date.month - 2, 1);
  const nextMonthStartMs = Date.UTC(date.year, date.month, 1);

  return {
    queryStart: new Date(previousMonthStartMs - ONE_DAY_MS).toISOString(),
    queryEnd: new Date(nextMonthStartMs + ONE_DAY_MS).toISOString(),
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
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function getLocalDateKey(date: Date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

async function loadAnalyticsDrinks(
  selectedPersonIds: number[],
  period: Pick<AnalyticsPeriod, "queryStart" | "queryEnd">,
) {
  const personPlaceholders = selectedPersonIds.map(() => "?").join(", ");
  const dateClause =
    period.queryStart && period.queryEnd
      ? `
          AND datetime(d.consumed_at) >= datetime(?)
          AND datetime(d.consumed_at) < datetime(?)
        `
      : "";
  const bindings: Array<number | string> = [...selectedPersonIds];

  if (period.queryStart && period.queryEnd) {
    bindings.push(period.queryStart, period.queryEnd);
  }

  return env.DB.prepare(
    `
      SELECT
        d.id,
        d.consumed_at,
        p.id AS person_id,
        COALESCE(p.display_name, p.name) AS person_name,
        c.id AS cup_id,
        c.name AS cup_name
      FROM drinks d
      JOIN persons p ON p.id = d.person_id
      JOIN cups c ON c.id = d.cup_id
      WHERE p.id IN (${personPlaceholders})
      ${dateClause}
      ORDER BY d.consumed_at ASC, d.id ASC
    `,
  )
    .bind(...bindings)
    .all<AnalyticsDrinkRow>();
}

function getAnalyticsBucket(
  date: ReturnType<typeof getCopenhagenDateParts>,
  period: AnalyticsPeriod,
) {
  const localDateMs = Date.UTC(date.year, date.month - 1, date.day);

  if (
    period.localStartMs !== null &&
    period.localEndMs !== null &&
    (localDateMs < period.localStartMs || localDateMs >= period.localEndMs)
  ) {
    return null;
  }

  if (period.range === "today") {
    return { key: `hour_${date.hour}`, label: `${date.hour}:00` };
  }

  if (period.range === "all") {
    const monthMs = Date.UTC(date.year, date.month - 1, 1);

    return {
      key: `${date.year}-${String(date.month).padStart(2, "0")}`,
      label: allTimeBucketFormatter.format(new Date(monthMs)),
    };
  }

  const dateMs = new Date(localDateMs);

  return {
    key: getLocalDateKey(dateMs),
    label:
      period.range === "week"
        ? weekdayFormatter.format(dateMs)
        : String(date.day),
  };
}

function getEligibleAnalyticsDrinks(
  drinks: AnalyticsDrinkRow[],
  period: AnalyticsPeriod,
): EligibleAnalyticsDrink[] {
  return drinks
    .map((drink) => ({
      drink,
      consumedAt: parseUtcDateTime(drink.consumed_at),
    }))
    .filter(
      (item): item is { drink: AnalyticsDrinkRow; consumedAt: Date } =>
        item.consumedAt !== null &&
        getAnalyticsBucket(getCopenhagenDateParts(item.consumedAt), period) !==
          null,
    )
    .sort(
      (a, b) =>
        a.consumedAt.getTime() - b.consumedAt.getTime() ||
        a.drink.id - b.drink.id,
    );
}

function buildFastestDoublekills(
  eligibleDrinks: EligibleAnalyticsDrink[],
  people: PersonRow[],
): FastestDoublekill[] {
  const previousByPerson = new Map<
    number,
    { consumedAt: string; timestampMs: number }
  >();
  const fastestByPerson = new Map<
    number,
    {
      intervalMs: number;
      firstConsumedAt: string;
      secondConsumedAt: string;
    }
  >();

  for (const { drink, consumedAt } of eligibleDrinks) {
    const timestampMs = consumedAt.getTime();
    const previous = previousByPerson.get(drink.person_id);

    if (previous) {
      const intervalMs = timestampMs - previous.timestampMs;
      const fastest = fastestByPerson.get(drink.person_id);

      if (intervalMs >= 0 && (!fastest || intervalMs < fastest.intervalMs)) {
        fastestByPerson.set(drink.person_id, {
          intervalMs,
          firstConsumedAt: previous.consumedAt,
          secondConsumedAt: drink.consumed_at,
        });
      }
    }

    previousByPerson.set(drink.person_id, {
      consumedAt: drink.consumed_at,
      timestampMs,
    });
  }

  return [...people]
    .sort((a, b) => a.id - b.id)
    .map((person) => {
      const fastest = fastestByPerson.get(person.id);

      return {
        personId: person.id,
        personName: person.display_name ?? person.name,
        intervalMs: fastest?.intervalMs ?? null,
        firstConsumedAt: fastest?.firstConsumedAt ?? null,
        secondConsumedAt: fastest?.secondConsumedAt ?? null,
      };
    });
}

function buildTypicalCooldowns(
  eligibleDrinks: EligibleAnalyticsDrink[],
  people: PersonRow[],
): TypicalCooldown[] {
  const previousByPersonAndDay = new Map<string, number>();
  const intervalsByPerson = new Map<number, number[]>();

  for (const { drink, consumedAt } of eligibleDrinks) {
    const date = getCopenhagenDateParts(consumedAt);
    const dayKey = `${drink.person_id}:${date.year}-${date.month}-${date.day}`;
    const timestampMs = consumedAt.getTime();
    const previousTimestampMs = previousByPersonAndDay.get(dayKey);

    if (previousTimestampMs !== undefined) {
      const intervalMs = timestampMs - previousTimestampMs;

      if (intervalMs >= 0) {
        const intervals = intervalsByPerson.get(drink.person_id) ?? [];
        intervals.push(intervalMs);
        intervalsByPerson.set(drink.person_id, intervals);
      }
    }

    previousByPersonAndDay.set(dayKey, timestampMs);
  }

  return [...people]
    .sort((a, b) => a.id - b.id)
    .map((person) => {
      const intervals = intervalsByPerson.get(person.id)?.sort((a, b) => a - b);
      let intervalMs: number | null = null;

      if (intervals && intervals.length > 0) {
        const middle = Math.floor(intervals.length / 2);
        intervalMs =
          intervals.length % 2 === 1
            ? intervals[middle]
            : (intervals[middle - 1] + intervals[middle]) / 2;
      }

      return {
        personId: person.id,
        personName: person.display_name ?? person.name,
        intervalMs,
      };
    });
}

function buildRapidFires(
  eligibleDrinks: EligibleAnalyticsDrink[],
  people: PersonRow[],
): RapidFire[] {
  const days = new Map<
    string,
    {
      personId: number;
      dateConsumedAt: string;
      previousTimestampMs: number;
      totalIntervalMs: number;
      intervalCount: number;
      cupCount: number;
    }
  >();

  for (const { drink, consumedAt } of eligibleDrinks) {
    const date = getCopenhagenDateParts(consumedAt);
    const dayKey = `${drink.person_id}:${date.year}-${date.month}-${date.day}`;
    const timestampMs = consumedAt.getTime();
    const day = days.get(dayKey);

    if (!day) {
      days.set(dayKey, {
        personId: drink.person_id,
        dateConsumedAt: drink.consumed_at,
        previousTimestampMs: timestampMs,
        totalIntervalMs: 0,
        intervalCount: 0,
        cupCount: 1,
      });
      continue;
    }

    const intervalMs = timestampMs - day.previousTimestampMs;

    if (intervalMs >= 0) {
      day.totalIntervalMs += intervalMs;
      day.intervalCount += 1;
    }

    day.previousTimestampMs = timestampMs;
    day.cupCount += 1;
  }

  const fastestByPerson = new Map<
    number,
    {
      averageIntervalMs: number;
      dateConsumedAt: string;
      cupCount: number;
    }
  >();

  for (const day of days.values()) {
    if (day.intervalCount === 0) continue;

    const averageIntervalMs = day.totalIntervalMs / day.intervalCount;
    const fastest = fastestByPerson.get(day.personId);

    if (!fastest || averageIntervalMs < fastest.averageIntervalMs) {
      fastestByPerson.set(day.personId, {
        averageIntervalMs,
        dateConsumedAt: day.dateConsumedAt,
        cupCount: day.cupCount,
      });
    }
  }

  return [...people]
    .sort((a, b) => a.id - b.id)
    .map((person) => {
      const fastest = fastestByPerson.get(person.id);

      return {
        personId: person.id,
        personName: person.display_name ?? person.name,
        averageIntervalMs: fastest?.averageIntervalMs ?? null,
        dateConsumedAt: fastest?.dateConsumedAt ?? null,
        cupCount: fastest?.cupCount ?? 0,
      };
    });
}

function buildLoyalists(
  eligibleDrinks: EligibleAnalyticsDrink[],
  people: PersonRow[],
): Loyalist[] {
  const totalByPerson = new Map<number, number>();
  const cupsByPerson = new Map<
    number,
    Map<
      number,
      {
        cupName: string;
        cupCount: number;
        lastConsumedAtMs: number;
      }
    >
  >();

  for (const { drink, consumedAt } of eligibleDrinks) {
    totalByPerson.set(
      drink.person_id,
      (totalByPerson.get(drink.person_id) ?? 0) + 1,
    );

    const cups = cupsByPerson.get(drink.person_id) ?? new Map();
    const cup = cups.get(drink.cup_id) ?? {
      cupName: drink.cup_name,
      cupCount: 0,
      lastConsumedAtMs: 0,
    };

    cup.cupCount += 1;
    cup.lastConsumedAtMs = Math.max(cup.lastConsumedAtMs, consumedAt.getTime());
    cups.set(drink.cup_id, cup);
    cupsByPerson.set(drink.person_id, cups);
  }

  return [...people]
    .sort((a, b) => a.id - b.id)
    .map((person) => {
      const totalCupCount = totalByPerson.get(person.id) ?? 0;
      const favorite = [...(cupsByPerson.get(person.id)?.values() ?? [])].sort(
        (a, b) =>
          b.cupCount - a.cupCount ||
          b.lastConsumedAtMs - a.lastConsumedAtMs ||
          a.cupName.localeCompare(b.cupName),
      )[0];

      return {
        personId: person.id,
        personName: person.display_name ?? person.name,
        percentage:
          favorite && totalCupCount > 0
            ? (favorite.cupCount / totalCupCount) * 100
            : null,
        cupCount: favorite?.cupCount ?? 0,
        totalCupCount,
        cupName: favorite?.cupName ?? null,
      };
    });
}

function buildEarlyBirds(
  eligibleDrinks: EligibleAnalyticsDrink[],
  people: PersonRow[],
): EarlyBird[] {
  const earliestByPerson = new Map<
    number,
    { consumedAt: string; localTimeMs: number }
  >();

  for (const { drink, consumedAt } of eligibleDrinks) {
    const date = getCopenhagenDateParts(consumedAt);
    const localTimeMs =
      ((date.hour * 60 + date.minute) * 60 + date.second) * 1000 +
      consumedAt.getUTCMilliseconds();
    const earliest = earliestByPerson.get(drink.person_id);

    if (!earliest || localTimeMs < earliest.localTimeMs) {
      earliestByPerson.set(drink.person_id, {
        consumedAt: drink.consumed_at,
        localTimeMs,
      });
    }
  }

  return [...people]
    .sort((a, b) => a.id - b.id)
    .map((person) => ({
      personId: person.id,
      personName: person.display_name ?? person.name,
      consumedAt: earliestByPerson.get(person.id)?.consumedAt ?? null,
    }));
}

function buildNightOwls(
  eligibleDrinks: EligibleAnalyticsDrink[],
  people: PersonRow[],
): NightOwl[] {
  const latestByPerson = new Map<
    number,
    { consumedAt: string; localTimeMs: number }
  >();

  for (const { drink, consumedAt } of eligibleDrinks) {
    const date = getCopenhagenDateParts(consumedAt);
    const localTimeMs =
      ((date.hour * 60 + date.minute) * 60 + date.second) * 1000 +
      consumedAt.getUTCMilliseconds();
    const latest = latestByPerson.get(drink.person_id);

    if (!latest || localTimeMs > latest.localTimeMs) {
      latestByPerson.set(drink.person_id, {
        consumedAt: drink.consumed_at,
        localTimeMs,
      });
    }
  }

  return [...people]
    .sort((a, b) => a.id - b.id)
    .map((person) => ({
      personId: person.id,
      personName: person.display_name ?? person.name,
      consumedAt: latestByPerson.get(person.id)?.consumedAt ?? null,
    }));
}

function buildEconomyAnalytics(
  eligibleDrinks: EligibleAnalyticsDrink[],
  selectedPeople: PersonRow[],
  period: AnalyticsPeriod,
  now = new Date(),
): EconomyAnalytics {
  const people: EconomyPerson[] = [...selectedPeople]
    .sort((a, b) => a.id - b.id)
    .map((person) => {
      const name = person.display_name ?? person.name;

      return {
        id: person.id,
        name,
        dataKey: `economy_person_${person.id}`,
        color: getPersonDisplayColor(name, person.id),
      };
    });
  const countsByBucket = new Map<string, Map<number, number>>();
  const dynamicBuckets = new Map<string, string>();
  const days = new Map<
    string,
    { dateConsumedAt: string; countsByPerson: Map<number, number> }
  >();

  for (const { drink, consumedAt } of eligibleDrinks) {
    const date = getCopenhagenDateParts(consumedAt);
    const bucket = getAnalyticsBucket(date, period);

    if (!bucket) continue;

    dynamicBuckets.set(bucket.key, bucket.label);
    const bucketCounts = countsByBucket.get(bucket.key) ?? new Map();
    bucketCounts.set(
      drink.person_id,
      (bucketCounts.get(drink.person_id) ?? 0) + 1,
    );
    countsByBucket.set(bucket.key, bucketCounts);

    const dateKey = `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
    const day = days.get(dateKey) ?? {
      dateConsumedAt: drink.consumed_at,
      countsByPerson: new Map<number, number>(),
    };
    day.countsByPerson.set(
      drink.person_id,
      (day.countsByPerson.get(drink.person_id) ?? 0) + 1,
    );
    days.set(dateKey, day);
  }

  const chartBuckets =
    period.range === "all"
      ? [...dynamicBuckets.entries()]
          .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
          .map(([key, label]) => ({ key, label }))
      : period.buckets;
  const currentDate = getCopenhagenDateParts(now);
  const buckets: EconomyChartBucket[] = chartBuckets.map((bucket) => {
    const isFutureBucket =
      period.range === "today"
        ? Number(bucket.key.replace("hour_", "")) > currentDate.hour
        : period.range === "week" || period.range === "month"
          ? bucket.key >
            `${currentDate.year}-${String(currentDate.month).padStart(2, "0")}-${String(currentDate.day).padStart(2, "0")}`
          : false;

    if (isFutureBucket) {
      const chartBucket: EconomyChartBucket = {
        bucket: bucket.label,
        tooltipLabel: getChartBucketTooltipLabel(bucket, period.range),
        total: null,
      };

      for (const person of people) {
        chartBucket[person.dataKey] = null;
      }

      return chartBucket;
    }

    const counts = countsByBucket.get(bucket.key);
    const chartBucket: EconomyChartBucket = {
      bucket: bucket.label,
      tooltipLabel: getChartBucketTooltipLabel(bucket, period.range),
      total: roundCurrency(
        [...(counts?.values() ?? [])].reduce(
          (total, count) => total + count,
          0,
        ) * COST_PER_DRINK,
      ),
    };

    for (const person of people) {
      chartBucket[person.dataKey] = roundCurrency(
        (counts?.get(person.id) ?? 0) * COST_PER_DRINK,
      );
    }

    return chartBucket;
  });
  const dailyStats: EconomyDay[] = [...days.entries()]
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([dateKey, day]) => {
      const dayPeople = people.map((person) => ({
        personId: person.id,
        personName: person.name,
        cost: roundCurrency(
          (day.countsByPerson.get(person.id) ?? 0) * COST_PER_DRINK,
        ),
        color: person.color,
      }));

      return {
        dateKey,
        dateConsumedAt: day.dateConsumedAt,
        totalCost: roundCurrency(
          [...day.countsByPerson.values()].reduce(
            (total, count) => total + count,
            0,
          ) * COST_PER_DRINK,
        ),
        people: dayPeople,
      };
    });
  const totalCost = roundCurrency(eligibleDrinks.length * COST_PER_DRINK);
  const copenhagenEquivalentCost = roundCurrency(
    eligibleDrinks.length * PRICE_OF_DRINK_IN_CPH,
  );
  const elapsedDayCount = getEconomyElapsedDayCount(dailyStats, period, now);
  const byHighestCost = [...dailyStats].sort(
    (a, b) => b.totalCost - a.totalCost || b.dateKey.localeCompare(a.dateKey),
  );
  const byLowestCost = [...dailyStats].sort(
    (a, b) => a.totalCost - b.totalCost || b.dateKey.localeCompare(a.dateKey),
  );

  return {
    people,
    buckets,
    drinkCount: eligibleDrinks.length,
    totalCost,
    copenhagenEquivalentCost,
    estimatedSavings: roundCurrency(copenhagenEquivalentCost - totalCost),
    averageDailyCost:
      elapsedDayCount > 0 ? roundCurrency(totalCost / elapsedDayCount) : 0,
    elapsedDayCount,
    mostExpensiveDay: byHighestCost[0] ?? null,
    cheapestDay: byLowestCost[0] ?? null,
  };
}

function buildMonthlyEconomyOverview(
  drinks: AnalyticsDrinkRow[],
  now: Date,
): MonthlyEconomyOverview {
  const currentDate = getCopenhagenDateParts(now);
  const previousMonthDate = new Date(
    Date.UTC(currentDate.year, currentDate.month - 2, 1),
  );
  const previousMonthYear = previousMonthDate.getUTCFullYear();
  const previousMonth = previousMonthDate.getUTCMonth() + 1;
  const totalDayCount = new Date(
    Date.UTC(currentDate.year, currentDate.month, 0),
  ).getUTCDate();
  const previousMonthDayCount = new Date(
    Date.UTC(previousMonthYear, previousMonth, 0),
  ).getUTCDate();
  const comparisonDayCount = Math.min(currentDate.day, previousMonthDayCount);
  let currentDrinkCount = 0;
  let comparisonCurrentDrinkCount = 0;
  let previousMonthDrinkCount = 0;

  for (const drink of drinks) {
    const consumedAt = parseUtcDateTime(drink.consumed_at);

    if (!consumedAt) continue;

    const date = getCopenhagenDateParts(consumedAt);
    const isCurrentMonth =
      date.year === currentDate.year && date.month === currentDate.month;
    const isPreviousMonth =
      date.year === previousMonthYear && date.month === previousMonth;

    if (isCurrentMonth && date.day <= currentDate.day) {
      currentDrinkCount += 1;

      if (date.day <= comparisonDayCount) {
        comparisonCurrentDrinkCount += 1;
      }
    } else if (isPreviousMonth && date.day <= comparisonDayCount) {
      previousMonthDrinkCount += 1;
    }
  }

  const currentCost = roundCurrency(currentDrinkCount * COST_PER_DRINK);
  const comparisonCurrentCost = roundCurrency(
    comparisonCurrentDrinkCount * COST_PER_DRINK,
  );
  const previousMonthCost = roundCurrency(
    previousMonthDrinkCount * COST_PER_DRINK,
  );
  const projectedCost = roundCurrency(
    (currentCost / currentDate.day) * totalDayCount,
  );

  return {
    projectedCost,
    currentCost,
    expectedRemainingCost: roundCurrency(projectedCost - currentCost),
    elapsedDayCount: currentDate.day,
    totalDayCount,
    comparisonDayCount,
    comparisonCurrentCost,
    previousMonthCost,
    percentageChange:
      previousMonthCost > 0
        ? ((comparisonCurrentCost - previousMonthCost) / previousMonthCost) *
          100
        : comparisonCurrentCost === 0
          ? 0
          : null,
  };
}

function getEconomyElapsedDayCount(
  dailyStats: EconomyDay[],
  period: AnalyticsPeriod,
  now: Date,
) {
  const nowParts = getCopenhagenDateParts(now);
  const todayMs = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day);

  if (period.range === "all") {
    const firstDateKey = dailyStats[0]?.dateKey;

    if (!firstDateKey) return 0;

    const [year, month, day] = firstDateKey.split("-").map(Number);
    const firstDayMs = Date.UTC(year, month - 1, day);

    return Math.max(1, Math.floor((todayMs - firstDayMs) / ONE_DAY_MS) + 1);
  }

  if (period.localStartMs === null || period.localEndMs === null) return 0;

  const periodDayCount = Math.round(
    (period.localEndMs - period.localStartMs) / ONE_DAY_MS,
  );
  const elapsedDayCount =
    Math.floor((todayMs - period.localStartMs) / ONE_DAY_MS) + 1;

  return Math.max(1, Math.min(periodDayCount, elapsedDayCount));
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatInterval(intervalMs: number) {
  const totalSeconds = Math.floor(intervalMs / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return [
    days > 0 ? `${days}d` : null,
    hours > 0 ? `${hours}h` : null,
    minutes > 0 ? `${minutes}m` : null,
    `${seconds}s`,
  ]
    .filter(Boolean)
    .join(" ");
}

function formatPercentage(percentage: number) {
  return `${percentage.toLocaleString("da-DK", {
    maximumFractionDigits: 1,
  })}%`;
}

function formatSignedPercentage(percentage: number) {
  const sign = percentage > 0 ? "+" : "";

  return `${sign}${formatPercentage(percentage)}`;
}

function formatCurrency(value: number) {
  return value.toLocaleString("da-DK", {
    style: "currency",
    currency: "DKK",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatAnalyticsDate(value: string) {
  const date = parseUtcDateTime(value);

  return date ? analyticsDateFormatter.format(date) : "—";
}

function buildAnalyticsChart(
  drinks: AnalyticsDrinkRow[],
  period: AnalyticsPeriod,
) {
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
  const countsByBucket = new Map<string, Map<string, number>>();
  const dynamicBuckets = new Map<string, string>();
  let totalCups = 0;

  for (const drink of drinks) {
    const consumedAt = parseUtcDateTime(drink.consumed_at);

    if (!consumedAt) continue;

    const bucket = getAnalyticsBucket(
      getCopenhagenDateParts(consumedAt),
      period,
    );

    if (!bucket) continue;

    totalCups += 1;
    dynamicBuckets.set(bucket.key, bucket.label);

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

    const bucketCounts =
      countsByBucket.get(bucket.key) ?? new Map<string, number>();
    bucketCounts.set(dataKey, (bucketCounts.get(dataKey) ?? 0) + 1);
    countsByBucket.set(bucket.key, bucketCounts);
  }

  const people: AnalyticsChartPerson[] = [...peopleById.values()]
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
  const cups: AnalyticsChartCup[] = [...cupsById.values()]
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

  const periodBuckets =
    period.range === "all"
      ? [...dynamicBuckets.entries()]
          .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
          .map(([key, label]) => ({ key, label }))
      : period.buckets;
  const buckets: AnalyticsChartBucket[] = periodBuckets.map((bucket) => {
    const chartBucket: AnalyticsChartBucket = {
      bucket: bucket.label,
      tooltipLabel: getChartBucketTooltipLabel(bucket, period.range),
    };
    const bucketCounts = countsByBucket.get(bucket.key);

    for (const person of people) {
      chartBucket[person.dataKey] = bucketCounts?.get(person.dataKey) ?? 0;
    }

    return chartBucket;
  });

  return {
    title: period.title,
    subtitle: period.subtitle,
    totalCups,
    people,
    cups,
    buckets,
  };
}
