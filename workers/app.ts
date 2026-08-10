import {
  createContext,
  createRequestHandler,
  RouterContextProvider,
} from "react-router";

export const cloudflareContext = createContext<{
  env: Env;
  ctx: ExecutionContext;
}>();

const SCAN_AUTH_SCHEME = "Bearer";

type ScanRequest = {
  eventId: string;
  nfcUid: string;
  consumedAt: string;
};

type ScannedCupRow = {
  cup_id: number;
  cup_name: string;
  person_id: number;
  person_name: string;
  display_name: string | null;
};

async function handleScan(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json(
      { error: "method_not_allowed" },
      {
        status: 405,
        headers: {
          Allow: "POST",
        },
      },
    );
  }

  const authorization = request.headers.get("Authorization");

  if (authorization !== `Bearer ${env.PI_DEVICE_TOKEN}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: ScanRequest;

  try {
    body = await request.json<ScanRequest>();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const { eventId, nfcUid, consumedAt } = body;

  if (
    typeof eventId !== "string" ||
    typeof nfcUid !== "string" ||
    typeof consumedAt !== "string" ||
    !eventId ||
    !nfcUid ||
    !consumedAt
  ) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const cup = await env.DB.prepare(
    `
      SELECT
        cups.id AS cup_id,
        cups.name AS cup_name,
        persons.id AS person_id,
        persons.name AS person_name,
        persons.display_name
      FROM cups
      JOIN persons ON persons.id = cups.owner_id
      WHERE cups.nfc_uid = ?
        AND cups.active = 1
        AND persons.active = 1
      LIMIT 1
    `,
  )
    .bind(nfcUid)
    .first<ScannedCupRow>();

  if (!cup) {
    return Response.json(
      {
        error: "unknown_cup",
        nfcUid,
      },
      { status: 404 },
    );
  }

  try {
    await env.DB.prepare(
      `
        INSERT INTO drinks (
          event_id,
          cup_id,
          person_id,
          consumed_at
        )
        VALUES (?, ?, ?, ?)
      `,
    )
      .bind(eventId, cup.cup_id, cup.person_id, consumedAt)
      .run();
  } catch (error) {
    console.error("Failed to insert drink:", error);

    return Response.json({ error: "database_error" }, { status: 500 });
  }

  return Response.json({
    ok: true,
    drink: {
      eventId,
      cupId: cup.cup_id,
      cup: cup.cup_name,
      personId: cup.person_id,
      person: cup.display_name ?? cup.person_name,
      consumedAt,
    },
  });
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/scans") {
      return handleScan(request, env);
    }

    const routerContext = new RouterContextProvider();

    routerContext.set(cloudflareContext, {
      env,
      ctx,
    });

    return requestHandler(request, routerContext);
  },
} satisfies ExportedHandler<Env>;
