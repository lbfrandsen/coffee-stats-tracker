import { env } from "cloudflare:workers";

import type { Route } from "./+types/home";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
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

type PersonRow = {
  name: string;
  display_name: string | null;
};

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

type CountRow = {
  total: number;
};

const DRINKS_PAGE_SIZE = 15;

const leaderboardRows = [
  {
    rank: 1,
    name: "Placeholder",
    cups: "N/A",
    lastCup: "No drinks yet.",
  },
];

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
  const requestedDrinksPage = Number.parseInt(
    url.searchParams.get("drinksPage") ?? "1",
    10,
  );
  const drinksPage =
    Number.isFinite(requestedDrinksPage) && requestedDrinksPage > 0
      ? requestedDrinksPage
      : 1;

  try {
    const [peopleResult, drinksCount] = await Promise.all([
      env.DB.prepare(
        "SELECT name, display_name FROM persons ORDER BY name COLLATE NOCASE ASC",
      ).all<PersonRow>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM drinks").first<CountRow>(),
    ]);

    const totalDrinks = drinksCount?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalDrinks / DRINKS_PAGE_SIZE));
    const currentDrinksPage = Math.min(drinksPage, totalPages);
    const drinksOffset = (currentDrinksPage - 1) * DRINKS_PAGE_SIZE;
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
      allDrinksRows: drinksResult.results,
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
      allDrinksRows: [],
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
  const { people, allDrinksRows, drinksPagination } = loaderData;
  const paginationPages = getVisiblePages(
    drinksPagination.page,
    drinksPagination.totalPages,
  );

  return (
    <section className="mx-auto grid max-w-6xl gap-4 px-4 py-8 sm:px-6 lg:grid-cols-4 lg:px-8">
      <Card className="border-zinc-800 bg-zinc-950/80 lg:col-span-3">
        <CardHeader className="border-b border-zinc-800">
          <CardTitle>Leaderboard</CardTitle>
          <CardDescription>
            Who's got the biggest caffeine problem?
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="w-16 text-zinc-400">Rank</TableHead>
                <TableHead className="text-zinc-400">Name</TableHead>
                <TableHead className="text-right text-zinc-400">Cups</TableHead>
                <TableHead className="text-right text-zinc-400">
                  Last cup
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaderboardRows.map((row) => (
                <TableRow key={row.rank} className="border-zinc-800">
                  <TableCell className="font-medium text-zinc-300">
                    {row.rank}
                  </TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="text-right">{row.cups}</TableCell>
                  <TableCell className="text-right text-zinc-400">
                    {row.lastCup}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-950/80 lg:col-span-1">
        <CardHeader className="border-b border-zinc-800">
          <CardTitle>People</CardTitle>
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
          <CardTitle>All Drinks</CardTitle>
          <CardDescription>
            Latest registered drinks from the database.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="w-20 text-zinc-400">ID</TableHead>
                <TableHead className="text-zinc-400">Person</TableHead>
                <TableHead className="text-zinc-400">Cup</TableHead>
                <TableHead className="text-zinc-400">NFC UID</TableHead>
                <TableHead className="text-zinc-400">Consumed at</TableHead>
                <TableHead className="text-zinc-400">Received at</TableHead>
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
                    <TableCell className="font-mono text-xs text-zinc-400">
                      {drink.nfc_uid}
                    </TableCell>
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
                    colSpan={7}
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
              {drinksPagination.total} drinks
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

function getVisiblePages(currentPage: number, totalPages: number) {
  const firstPage = Math.max(1, currentPage - 2);
  const lastPage = Math.min(totalPages, firstPage + 4);

  return Array.from(
    { length: lastPage - firstPage + 1 },
    (_, index) => firstPage + index,
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
