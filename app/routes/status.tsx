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

type DeviceStatus = "online" | "stale" | "offline";

const HEARTBEATS_PER_PAGE = 20;
const ONLINE_THRESHOLD_MS = 90 * 60 * 1000;
const STALE_THRESHOLD_MS = 150 * 60 * 1000;

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
    const [countRow, latestHeartbeat] = await Promise.all([
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
    ]);

    const totalHeartbeats = countRow?.total ?? 0;
    const deviceStatus = getDeviceStatus(latestHeartbeat?.received_at ?? null);
    const totalPages = Math.max(
      1,
      Math.ceil(totalHeartbeats / HEARTBEATS_PER_PAGE),
    );
    const currentHeartbeatsPage = Math.min(heartbeatsPage, totalPages);
    const heartbeatsOffset = (currentHeartbeatsPage - 1) * HEARTBEATS_PER_PAGE;

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
      deviceStatus,
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
      deviceStatus: "offline" satisfies DeviceStatus,
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
  const { heartbeats, heartbeatsPagination, latestHeartbeat } = loaderData;
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
              value={formatRelativeAge(latestHeartbeat?.received_at ?? null)}
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

      <Card className="border-zinc-800 bg-zinc-950/80">
        <CardHeader className="border-b border-zinc-800">
          <CardTitle>Current State</CardTitle>
          <CardDescription>
            Seneste heartbeat modtaget fra Raspberry'en.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <StatusMetric
              label="Status"
              value={capitalize(deviceStatus)}
              valueClassName={statusStyles.text}
            />
            <StatusMetric
              label="Last heartbeat"
              value={formatOptionalDateTime(
                latestHeartbeat?.received_at ?? null,
              )}
            />
            <StatusMetric
              label="Reader"
              value={
                latestHeartbeat?.reader_connected === 1
                  ? "Connected"
                  : "Disconnected"
              }
            />
            <StatusMetric
              label="Scanner service"
              value={formatServiceStatus(latestHeartbeat?.service_status)}
            />
            <StatusMetric
              label="Last scan"
              value={formatOptionalTime(latestHeartbeat?.last_scan_at ?? null)}
            />
            <StatusMetric
              label="Pending uploads"
              value={`${latestHeartbeat?.pending_events ?? 0}`}
            />
            <StatusMetric
              label="Version"
              value={latestHeartbeat?.app_version || "—"}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-950/80">
        <CardHeader className="border-b border-zinc-800">
          <CardTitle>Heartbeat History</CardTitle>
          <CardDescription>
            Fuld rapportering af Raspberry'ens heartbeats.
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
  return value ? formatDateTime(value) : "—";
}

function formatOptionalTime(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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

function getDeviceStatus(receivedAt: string | null): DeviceStatus {
  if (!receivedAt) {
    return "offline";
  }

  const ageMs = Date.now() - new Date(receivedAt).getTime();

  if (ageMs < ONLINE_THRESHOLD_MS) {
    return "online";
  }

  if (ageMs < STALE_THRESHOLD_MS) {
    return "stale";
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

  if (status === "stale") {
    return {
      label: "STALE",
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

function formatRelativeAge(value: string | null) {
  if (!value) {
    return "No heartbeat";
  }

  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 1000),
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

  const elapsedDays = Math.floor(elapsedHours / 24);

  return `${elapsedDays} days ago`;
}

function formatServiceStatus(value: string | undefined) {
  return value ? capitalize(value.replaceAll("_", " ")) : "—";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
