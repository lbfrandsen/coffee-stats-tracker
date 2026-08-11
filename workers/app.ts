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

const DMI_STATION_ID = "06188"; // Sjælsmark vejrstation, skud ud til fucking Sjælsmark altså
const DMI_OBSERVATION_URL =
  `https://opendataapi.dmi.dk/v2/metObs/collections/observation/items` +
  `?stationId=${DMI_STATION_ID}` +
  `&period=latest-hour` +
  `&limit=100`;
const DMI_REQUEST_TIMEOUT_MS = 3_000;

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

type RecordedDrinkRow = ScannedCupRow & {
  drink_id: number;
  nfc_uid: string;
  consumed_at: string;
};

type HeartbeatRequest = {
  reportedAt: string;
  serviceStatus: string;
  readerConnected: boolean;
  uptimeSeconds: number | null;
  memoryUsagePercent: number | null;
  diskUsagePercent: number | null;
  cpuTemperatureCelsius: number | null;
  lastScanAt: string | null;
  lastUploadAt: string | null;
  pendingEvents: number;
  appVersion: string | null;
};

type DmiObservationFeature = {
  properties: {
    parameterId: string;
    stationId: string;
    observed: string;
    value: number;
  };
};

type DmiObservationResponse = {
  features: DmiObservationFeature[];
};

type WeatherSnapshot = {
  temperatureC: number | null;
  precipitationMm: number;
  raining: boolean;
  cloudCover: number | null;
  humidityPercent: number | null;
  windSpeedMs: number | null;
  windDirectionDegrees: number | null;
  pressureHpa: number | null;
  visibilityM: number | null;
  weatherCode: number | null;
  stationId: string;
  observedAt: string | null;
};

async function handleScan(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
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

  console.log("About to query cup:", nfcUid);
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
  console.log("Cup query finished:", cup);
  if (!cup) {
    return Response.json(
      {
        error: "unknown_cup",
        nfcUid,
      },
      { status: 404 },
    );
  }

  let drinkId: number;

  try {
    const result = await env.DB.prepare(
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

    drinkId = result.meta.last_row_id;
  } catch (error) {
    try {
      const recordedDrink = await findRecordedDrink(env, eventId);

      if (recordedDrink) {
        if (
          recordedDrink.nfc_uid !== nfcUid ||
          recordedDrink.consumed_at !== consumedAt
        ) {
          return Response.json({ error: "event_id_conflict" }, { status: 409 });
        }

        ctx.waitUntil(attachWeatherToDrink(env, recordedDrink.drink_id));

        return createScanResponse(eventId, recordedDrink);
      }
    } catch (lookupError) {
      console.error("Failed to look up an existing drink:", lookupError);
    }

    console.error("Failed to insert drink:", error);

    return Response.json({ error: "database_error" }, { status: 500 });
  }

  ctx.waitUntil(attachWeatherToDrink(env, drinkId));

  return createScanResponse(eventId, {
    ...cup,
    drink_id: drinkId,
    nfc_uid: nfcUid,
    consumed_at: consumedAt,
  });
}

function createScanResponse(
  eventId: string,
  drink: RecordedDrinkRow,
): Response {
  return Response.json({
    ok: true,
    drink: {
      eventId,
      cupId: drink.cup_id,
      cup: drink.cup_name,
      personId: drink.person_id,
      person: drink.display_name ?? drink.person_name,
      consumedAt: drink.consumed_at,
    },
  });
}

async function findRecordedDrink(
  env: Env,
  eventId: string,
): Promise<RecordedDrinkRow | null> {
  return env.DB.prepare(
    `
      SELECT
        drinks.id AS drink_id,
        drinks.consumed_at,
        cups.id AS cup_id,
        cups.name AS cup_name,
        cups.nfc_uid,
        persons.id AS person_id,
        persons.name AS person_name,
        persons.display_name
      FROM drinks
      JOIN cups ON cups.id = drinks.cup_id
      JOIN persons ON persons.id = drinks.person_id
      WHERE drinks.event_id = ?
      LIMIT 1
    `,
  )
    .bind(eventId)
    .first<RecordedDrinkRow>();
}

async function attachWeatherToDrink(env: Env, drinkId: number): Promise<void> {
  try {
    const existingWeather = await env.DB.prepare(
      "SELECT id FROM weather_records WHERE drink_id = ? LIMIT 1",
    )
      .bind(drinkId)
      .first<{ id: number }>();

    if (existingWeather) {
      return;
    }

    const weather = await fetchWeatherFromDmi();

    await env.DB.prepare(
      `
        INSERT INTO weather_records (
          drink_id,
          temperature_c,
          precipitation_mm,
          raining,
          cloud_cover,
          humidity_percent,
          wind_speed_ms,
          wind_direction_degrees,
          pressure_hpa,
          visibility_m,
          weather_code,
          station_id,
          observed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(drink_id) DO NOTHING
      `,
    )
      .bind(
        drinkId,
        weather.temperatureC,
        weather.precipitationMm,
        weather.raining ? 1 : 0,
        weather.cloudCover,
        weather.humidityPercent,
        weather.windSpeedMs,
        weather.windDirectionDegrees,
        weather.pressureHpa,
        weather.visibilityM,
        weather.weatherCode,
        weather.stationId,
        weather.observedAt,
      )
      .run();
  } catch (error) {
    console.error(`Failed to attach weather to drink ${drinkId}:`, error);
  }
}

async function handleHeartbeat(request: Request, env: Env): Promise<Response> {
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

  let body: HeartbeatRequest;

  try {
    body = await request.json<HeartbeatRequest>();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const {
    reportedAt,
    serviceStatus,
    readerConnected,
    uptimeSeconds,
    memoryUsagePercent,
    diskUsagePercent,
    cpuTemperatureCelsius,
    lastScanAt,
    lastUploadAt,
    pendingEvents,
    appVersion,
  } = body;

  if (
    typeof reportedAt !== "string" ||
    typeof serviceStatus !== "string" ||
    typeof readerConnected !== "boolean" ||
    typeof pendingEvents !== "number"
  ) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const result = await env.DB.prepare(
      `
        INSERT INTO heartbeats (
          reported_at,
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
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
      .bind(
        reportedAt,
        serviceStatus,
        readerConnected ? 1 : 0,
        uptimeSeconds,
        memoryUsagePercent,
        diskUsagePercent,
        cpuTemperatureCelsius,
        lastScanAt,
        lastUploadAt,
        pendingEvents,
        appVersion,
      )
      .run();

    return Response.json({
      ok: true,
      heartbeatId: result.meta.last_row_id,
    });
  } catch (error) {
    console.error("Failed to insert heartbeat:", error);

    return Response.json({ error: "database_error" }, { status: 500 });
  }
}

async function fetchWeatherFromDmi(): Promise<WeatherSnapshot> {
  const response = await fetch(DMI_OBSERVATION_URL, {
    headers: {
      Accept: "application/geo+json",
    },
    signal: AbortSignal.timeout(DMI_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `DMI request failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json<DmiObservationResponse>();

  if (data.features.length === 0) {
    throw new Error("DMI returned 0 features");
  }

  console.log("DMI feature count:", data.features.length);
  console.log("DMI features:", JSON.stringify(data.features, null, 2));

  const latestByParameter = new Map<string, DmiObservationFeature>();

  for (const feature of data.features) {
    const parameterId = feature.properties.parameterId;
    const existing = latestByParameter.get(parameterId);

    if (
      !existing ||
      feature.properties.observed > existing.properties.observed
    ) {
      latestByParameter.set(parameterId, feature);
    }
  }

  const value = (parameterId: string): number | null =>
    latestByParameter.get(parameterId)?.properties.value ?? null;

  const precipitationMm = value("precip_past10min") ?? 0;

  const observedAt =
    [...latestByParameter.values()]
      .map((feature) => feature.properties.observed)
      .sort()
      .at(-1) ?? null;

  return {
    temperatureC: value("temp_dry"),
    precipitationMm,
    raining: precipitationMm > 0,
    cloudCover: value("cloud_cover"),
    humidityPercent: value("humidity"),
    windSpeedMs: value("wind_speed"),
    windDirectionDegrees: value("wind_dir"),
    pressureHpa: value("pressure_at_sea"),
    visibilityM: value("visibility"),
    weatherCode: value("weather"),
    stationId: DMI_STATION_ID,
    observedAt,
  };
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/scans") {
      return handleScan(request, env, ctx);
    }

    if (url.pathname === "/api/heartbeats") {
      return handleHeartbeat(request, env);
    }

    const routerContext = new RouterContextProvider();

    routerContext.set(cloudflareContext, {
      env,
      ctx,
    });

    return requestHandler(request, routerContext);
  },
} satisfies ExportedHandler<Env>;
