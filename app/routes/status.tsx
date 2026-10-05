import { env } from "cloudflare:workers";

import type { Route } from "./+types/status";
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
import {
  APP_TIME_ZONE,
  formatDateTime,
  formatRelativeAge,
  getTimestampMilliseconds,
} from "~/lib/date-time";

type HeartbeatRow = {
  id: number;
  reported_at: string;
  received_at: string;
  service_status: string;
  reader_connected: number;
  uptime_seconds: number | null;
  memory_usage_percent: number | null;
  disk_usage_percent: number | null;
  cpu_temperature_celsius: number | null;
  last_scan_at: string | null;
  last_upload_at: string | null;
  pending_events: number;
  app_version: string | null;
};

type CountRow = {
  total: number;
};

type LatestScanRow = {
  received_at: string;
};

type AvailabilityHeartbeatRow = {
  received_at: string;
};

type AvailabilityDay = {
  date: string;
  label: string;
  available: boolean;
};

type DeviceStatus = "online" | "concerning" | "offline";

const HEARTBEATS_PER_PAGE = 20;
const AVAILABILITY_DAYS = 30;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// The Pi sends a heartbeat every four hours.
const ONLINE_THRESHOLD_MS = 9 * HOUR_MS;
const OFFLINE_THRESHOLD_MS = 13 * HOUR_MS;

const availabilityDateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const availabilityDateLabelFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  day: "numeric",
  month: "short",
});

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Raspberry Pi Status | Kaffemændene" },
    {
      name: "description",
      content: "Check the status of the Raspberry Pi in our kitchen.",
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const statusEvaluatedAt = Date.now();
  const availabilityWindowStart =
    statusEvaluatedAt - AVAILABILITY_DAYS * DAY_MS;
  const availabilityQueryStart = availabilityWindowStart - ONLINE_THRESHOLD_MS;
  const url = new URL(request.url);
  const requestedHeartbeatsPage = Number.parseInt(
    url.searchParams.get("heartbeatsPage") ?? "1",
    10,
  );
  const heartbeatsPage =
    Number.isFinite(requestedHeartbeatsPage) && requestedHeartbeatsPage > 0
      ? requestedHeartbeatsPage
      : 1;

  try {
    const [countRow, latestHeartbeat, latestScan, availabilityResult] =
      await Promise.all([
        env.DB.prepare(
          "SELECT COUNT(*) AS total FROM heartbeats",
        ).first<CountRow>(),
        env.DB.prepare(
          `
            SELECT
              id,
              reported_at,
              received_at,
              service_status,
              reader_connected,
              uptime_seconds,
              memory_usage_percent,
              disk_usage_percent,
              cpu_temperature_celsius,
              last_scan_at,
              last_upload_at,
              pending_events,
              app_version
            FROM heartbeats
            ORDER BY received_at DESC, id DESC
            LIMIT 1
          `,
        ).first<HeartbeatRow>(),
        env.DB.prepare(
          `
            SELECT received_at
            FROM drinks
            ORDER BY received_at DESC, id DESC
            LIMIT 1
          `,
        ).first<LatestScanRow>(),
        env.DB.prepare(
          `
            SELECT received_at
            FROM heartbeats
            WHERE received_at >= datetime(?, 'unixepoch')
            ORDER BY received_at ASC, id ASC
          `,
        )
          .bind(Math.floor(availabilityQueryStart / 1000))
          .all<AvailabilityHeartbeatRow>(),
      ]);

    const totalHeartbeats = countRow?.total ?? 0;
    const deviceStatus = getDeviceStatus(
      latestHeartbeat?.received_at ?? null,
      statusEvaluatedAt,
    );
    const totalPages = Math.max(
      1,
      Math.ceil(totalHeartbeats / HEARTBEATS_PER_PAGE),
    );
    const currentHeartbeatsPage = Math.min(heartbeatsPage, totalPages);
    const heartbeatsOffset = (currentHeartbeatsPage - 1) * HEARTBEATS_PER_PAGE;
    const availabilityDays = buildAvailabilityDays(
      availabilityResult.results,
      statusEvaluatedAt,
      availabilityWindowStart,
    );

    const { results } = await env.DB.prepare(
      `
        SELECT
          id,
          reported_at,
          received_at,
          service_status,
          reader_connected,
          uptime_seconds,
          memory_usage_percent,
          disk_usage_percent,
          cpu_temperature_celsius,
          last_scan_at,
          last_upload_at,
          pending_events,
          app_version
        FROM heartbeats
        ORDER BY reported_at DESC, id DESC
        LIMIT ? OFFSET ?
      `,
    )
      .bind(HEARTBEATS_PER_PAGE, heartbeatsOffset)
      .all<HeartbeatRow>();

    return {
      heartbeats: results,
      latestHeartbeat,
      latestScanAt: latestScan?.received_at ?? null,
      availabilityDays,
      deviceStatus,
      statusEvaluatedAt,
      heartbeatsPagination: {
        page: currentHeartbeatsPage,
        pageSize: HEARTBEATS_PER_PAGE,
        total: totalHeartbeats,
        totalPages,
      },
    };
  } catch (error) {
    console.warn("Unable to load heartbeat data from D1", error);

    return {
      heartbeats: [],
      latestHeartbeat: null,
      latestScanAt: null,
      availabilityDays: buildAvailabilityDays(
        [],
        statusEvaluatedAt,
        availabilityWindowStart,
      ),
      deviceStatus: "offline" satisfies DeviceStatus,
      statusEvaluatedAt,
      heartbeatsPagination: {
        page: 1,
        pageSize: HEARTBEATS_PER_PAGE,
        total: 0,
        totalPages: 1,
      },
    };
  }
}

export default function Status({ loaderData }: Route.ComponentProps) {
  const {
    heartbeats,
    heartbeatsPagination,
    latestHeartbeat,
    latestScanAt,
    availabilityDays,
    statusEvaluatedAt,
  } = loaderData;
  const deviceStatus = loaderData.deviceStatus as DeviceStatus;
  const paginationPages = getVisiblePages(
    heartbeatsPagination.page,
    heartbeatsPagination.totalPages,
  );
  const statusStyles = getStatusStyles(deviceStatus);

  return (
    <section className="mx-auto max-w-6xl space-y-4 px-4 py-8 sm:px-6 lg:px-8">
      <Card
        className="border"
        style={{
          backgroundColor: statusStyles.backgroundColor,
          borderColor: statusStyles.borderColor,
          color: statusStyles.foregroundColor,
        }}
      >
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <StatusMetric
              label="Overall status"
              value={statusStyles.label}
              valueClassName={statusStyles.text}
            />
            <StatusMetric
              label="Last heartbeat"
              value={formatRelativeAge(
                latestHeartbeat?.received_at ?? null,
                statusEvaluatedAt,
              )}
            />
            <StatusMetric
              label="NFC reader"
              value={
                latestHeartbeat?.reader_connected === 1
                  ? "CONNECTED"
                  : "DISCONNECTED"
              }
            />
            <StatusMetric
              label="Uptime"
              value={formatUptime(latestHeartbeat?.uptime_seconds ?? null)}
            />
          </div>
        </CardContent>
      </Card>

      <AvailabilityCard days={availabilityDays} />

      <Card className="border-zinc-800 bg-zinc-950/80 ring-0">
        <CardContent>
          <div className="grid items-start gap-6 lg:grid-cols-[1fr_auto_auto_auto] lg:gap-x-12">
            <div className="text-left">
              <StatusMetric
                label="Last scan sent"
                value={formatOptionalDateTime(latestScanAt)}
              />
            </div>

            <div className="text-right">
              <StatusMetric
                label="Memory"
                value={formatPercent(
                  latestHeartbeat?.memory_usage_percent ?? null,
                )}
              />
            </div>

            <div className="text-right">
              <StatusMetric
                label="Disk"
                value={formatPercent(
                  latestHeartbeat?.disk_usage_percent ?? null,
                )}
              />
            </div>

            <div className="text-right">
              <StatusMetric
                label="CPU"
                value={formatTemperature(
                  latestHeartbeat?.cpu_temperature_celsius ?? null,
                )}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-950/80">
        <CardHeader className="border-b border-zinc-800">
          <CardTitle>Heartbeat History</CardTitle>
          <CardDescription>
            Fuld rapportering af Raspberry'ens heartbeats. Sendes hver fjerde
            time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="w-16 text-zinc-400">ID</TableHead>
                <TableHead className="text-zinc-400">Reported</TableHead>
                <TableHead className="text-zinc-400">Received</TableHead>
                <TableHead className="text-zinc-400">Status</TableHead>
                <TableHead className="text-zinc-400">Reader</TableHead>
                <TableHead className="text-right text-zinc-400">
                  Uptime
                </TableHead>
                <TableHead className="text-right text-zinc-400">
                  Memory
                </TableHead>
                <TableHead className="text-right text-zinc-400">Disk</TableHead>
                <TableHead className="text-right text-zinc-400">CPU</TableHead>
                <TableHead className="text-zinc-400">Last scan</TableHead>
                <TableHead className="text-zinc-400">Last upload</TableHead>
                <TableHead className="text-right text-zinc-400">
                  Pending
                </TableHead>
                <TableHead className="text-zinc-400">Version</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {heartbeats.length > 0 ? (
                heartbeats.map((heartbeat) => (
                  <TableRow key={heartbeat.id} className="border-zinc-800">
                    <TableCell className="font-medium text-zinc-300">
                      {heartbeat.id}
                    </TableCell>
                    <TableCell className="text-zinc-400">
                      {formatDateTime(heartbeat.reported_at)}
                    </TableCell>
                    <TableCell className="text-zinc-400">
                      {formatDateTime(heartbeat.received_at)}
                    </TableCell>
                    <TableCell>{heartbeat.service_status}</TableCell>
                    <TableCell>
                      {heartbeat.reader_connected === 1
                        ? "Connected"
                        : "Disconnected"}
                    </TableCell>
                    <TableCell className="text-right text-zinc-400">
                      {formatUptime(heartbeat.uptime_seconds)}
                    </TableCell>
                    <TableCell className="text-right text-zinc-400">
                      {formatPercent(heartbeat.memory_usage_percent)}
                    </TableCell>
                    <TableCell className="text-right text-zinc-400">
                      {formatPercent(heartbeat.disk_usage_percent)}
                    </TableCell>
                    <TableCell className="text-right text-zinc-400">
                      {formatTemperature(heartbeat.cpu_temperature_celsius)}
                    </TableCell>
                    <TableCell className="text-zinc-400">
                      {formatOptionalDateTime(heartbeat.last_scan_at)}
                    </TableCell>
                    <TableCell className="text-zinc-400">
                      {formatOptionalDateTime(heartbeat.last_upload_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      {heartbeat.pending_events}
                    </TableCell>
                    <TableCell className="text-zinc-400">
                      {heartbeat.app_version || "—"}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow className="border-zinc-800">
                  <TableCell
                    colSpan={13}
                    className="h-24 text-center text-zinc-400"
                  >
                    No heartbeat data loaded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
        <CardFooter className="border-t border-zinc-800">
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-zinc-400">
              Page {heartbeatsPagination.page} of{" "}
              {heartbeatsPagination.totalPages} · {heartbeatsPagination.total}{" "}
              heartbeats
            </p>
            <Pagination className="mx-0 w-auto justify-start sm:justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href={getHeartbeatsPageHref(heartbeatsPagination.page - 1)}
                    aria-disabled={heartbeatsPagination.page <= 1}
                    className={
                      heartbeatsPagination.page <= 1
                        ? "pointer-events-none opacity-50"
                        : undefined
                    }
                  />
                </PaginationItem>
                {paginationPages.map((page) => (
                  <PaginationItem key={page}>
                    <PaginationLink
                      href={getHeartbeatsPageHref(page)}
                      isActive={page === heartbeatsPagination.page}
                    >
                      {page}
                    </PaginationLink>
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    href={getHeartbeatsPageHref(heartbeatsPagination.page + 1)}
                    aria-disabled={
                      heartbeatsPagination.page >=
                      heartbeatsPagination.totalPages
                    }
                    className={
                      heartbeatsPagination.page >=
                      heartbeatsPagination.totalPages
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

function AvailabilityCard({ days }: { days: AvailabilityDay[] }) {
  const availableDays = days.filter((day) => day.available).length;

  return (
    <Card className="border-zinc-800 bg-zinc-950/80 ring-0">
      <CardContent>
        <div
          className="flex h-16 items-stretch gap-1 sm:gap-1.5"
          aria-label={`${availableDays} of the last ${days.length} days had no detected downtime`}
        >
          {days.map((day) => (
            <div
              key={day.date}
              className={`min-w-0 flex-1 rounded-sm transition-colors ${
                day.available
                  ? "bg-emerald-500/80 hover:bg-emerald-400"
                  : "bg-red-500/80 hover:bg-red-400"
              }`}
              title={`${day.label}: ${
                day.available ? "No downtime detected" : "Downtime detected"
              }`}
              role="img"
              aria-label={`${day.label}: ${
                day.available ? "no downtime detected" : "downtime detected"
              }`}
            />
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
          <span>{days[0]?.label ?? "30 days ago"}</span>
          <div className="flex items-center gap-4" aria-hidden="true">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-emerald-500" />
              Operational
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-red-500" />
              Downtime
            </span>
          </div>
          <span>Today</span>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusMetric({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-semibold ${valueClassName ?? ""}`}>
        {value}
      </p>
    </div>
  );
}

function getHeartbeatsPageHref(page: number) {
  return `/status?heartbeatsPage=${Math.max(1, page)}`;
}

function getVisiblePages(currentPage: number, totalPages: number) {
  const firstPage = Math.max(1, currentPage - 2);
  const lastPage = Math.min(totalPages, firstPage + 4);

  return Array.from(
    { length: lastPage - firstPage + 1 },
    (_, index) => firstPage + index,
  );
}

function formatOptionalDateTime(value: string | null) {
  return formatDateTime(value);
}

function formatPercent(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function formatTemperature(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)}°C`;
}

function formatUptime(value: number | null) {
  if (value === null) {
    return "—";
  }

  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function getDeviceStatus(
  receivedAt: string | null,
  statusEvaluatedAt: number,
): DeviceStatus {
  const receivedAtMs = getTimestampMilliseconds(receivedAt);

  if (receivedAtMs === null) {
    return "offline";
  }

  const ageMs = statusEvaluatedAt - receivedAtMs;

  if (ageMs < ONLINE_THRESHOLD_MS) {
    return "online";
  }

  if (ageMs < OFFLINE_THRESHOLD_MS) {
    return "concerning";
  }

  return "offline";
}

function getStatusStyles(status: DeviceStatus) {
  if (status === "online") {
    return {
      label: "ONLINE",
      backgroundColor: "oklch(0.262 0.051 172.552)",
      borderColor: "oklch(0.596 0.145 163.225)",
      foregroundColor: "oklch(0.979 0.021 166.113)",
      text: "text-emerald-300",
    };
  }

  if (status === "concerning") {
    return {
      label: "CONCERNING",
      backgroundColor: "oklch(0.286 0.066 53.813)",
      borderColor: "oklch(0.681 0.162 75.834)",
      foregroundColor: "oklch(0.987 0.026 102.212)",
      text: "text-yellow-300",
    };
  }

  return {
    label: "OFFLINE",
    backgroundColor: "oklch(0.258 0.092 26.042)",
    borderColor: "oklch(0.577 0.245 27.325)",
    foregroundColor: "oklch(0.971 0.013 17.38)",
    text: "text-red-300",
  };
}

function buildAvailabilityDays(
  heartbeats: AvailabilityHeartbeatRow[],
  statusEvaluatedAt: number,
  windowStart: number,
): AvailabilityDay[] {
  const daysNewestFirst: AvailabilityDay[] = [];
  const seenDates = new Set<string>();
  let cursor = statusEvaluatedAt;

  while (daysNewestFirst.length < AVAILABILITY_DAYS) {
    const date = getAvailabilityDateKey(cursor);

    if (!seenDates.has(date)) {
      seenDates.add(date);
      daysNewestFirst.push({
        date,
        label: availabilityDateLabelFormatter.format(cursor),
        available: true,
      });
    }

    cursor -= DAY_MS;
  }

  const days = daysNewestFirst.reverse();
  const daysByDate = new Map(days.map((day) => [day.date, day]));
  const heartbeatTimes = heartbeats
    .map((heartbeat) => getTimestampMilliseconds(heartbeat.received_at))
    .filter((timestamp): timestamp is number => timestamp !== null)
    .sort((first, second) => first - second);

  const markDowntime = (start: number, end: number) => {
    const boundedStart = Math.max(start, windowStart);
    const boundedEnd = Math.min(end, statusEvaluatedAt);

    if (boundedStart >= boundedEnd) {
      return;
    }

    const markTimestamp = (timestamp: number) => {
      const day = daysByDate.get(getAvailabilityDateKey(timestamp));

      if (day) {
        day.available = false;
      }
    };

    markTimestamp(boundedStart);
    markTimestamp(boundedEnd - 1);

    for (
      let timestamp = Math.ceil(boundedStart / HOUR_MS) * HOUR_MS;
      timestamp < boundedEnd;
      timestamp += HOUR_MS
    ) {
      markTimestamp(timestamp);
    }
  };

  if (heartbeatTimes.length === 0) {
    markDowntime(windowStart, statusEvaluatedAt);
    return days;
  }

  const firstHeartbeatAt = heartbeatTimes[0];

  if (firstHeartbeatAt > windowStart) {
    markDowntime(windowStart, firstHeartbeatAt);
  }

  for (let index = 1; index < heartbeatTimes.length; index += 1) {
    const previousHeartbeatAt = heartbeatTimes[index - 1];
    const heartbeatAt = heartbeatTimes[index];

    if (heartbeatAt - previousHeartbeatAt > ONLINE_THRESHOLD_MS) {
      markDowntime(previousHeartbeatAt + ONLINE_THRESHOLD_MS, heartbeatAt);
    }
  }

  const latestHeartbeatAt = heartbeatTimes.at(-1)!;

  if (statusEvaluatedAt - latestHeartbeatAt > ONLINE_THRESHOLD_MS) {
    markDowntime(latestHeartbeatAt + ONLINE_THRESHOLD_MS, statusEvaluatedAt);
  }

  return days;
}

function getAvailabilityDateKey(timestamp: number) {
  const parts = availabilityDateKeyFormatter.formatToParts(timestamp);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}
