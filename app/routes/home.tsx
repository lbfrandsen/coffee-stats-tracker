import { env } from "cloudflare:workers";
import { Check, ChevronDown } from "lucide-react";
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
  const analyticsRange = parseAnalyticsRange(url.searchParams.get("range"));
  const analyticsPeriod = getAnalyticsPeriod(analyticsRange);
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
        "SELECT id, name, display_name FROM persons ORDER BY name COLLATE NOCASE ASC",
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

    const analyticsDrinks =
      selectedPersonIds.length > 0
        ? (await loadAnalyticsDrinks(selectedPersonIds, analyticsPeriod))
            .results
        : [];

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

      <div className="flex flex-col gap-4  py-4 lg:col-span-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-medium uppercase text-zinc-500">
            Period
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
            People
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

      <Card className="border-zinc-800 bg-zinc-950/80 lg:col-span-4">
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
                    width={28}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent />}
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

      <Card className="border-zinc-800 bg-zinc-950/80 lg:col-span-4">
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
  hourCycle: "h23",
});

const copenhagenMonthTitleFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

const shortDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});

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

function getCopenhagenDateParts(date: Date) {
  const parts = copenhagenDatePartsFormatter.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
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
  period: AnalyticsPeriod,
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
      ORDER BY d.consumed_at ASC
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
    const chartBucket: AnalyticsChartBucket = { bucket: bucket.label };
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
