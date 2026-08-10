from __future__ import annotations

import os
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from smartcard.System import readers


API_URL = os.environ["API_URL"].replace("/api/scans", "/api/heartbeats")
DEVICE_TOKEN = os.environ["PI_DEVICE_TOKEN"]

MAX_SEND_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 2


def get_uptime_seconds() -> int:
    with open("/proc/uptime", "r", encoding="utf-8") as file:
        uptime = float(file.read().split()[0])

    return int(uptime)


def get_memory_usage_percent() -> float:
    memory_values: dict[str, int] = {}

    with open("/proc/meminfo", "r", encoding="utf-8") as file:
        for line in file:
            key, value = line.split(":", 1)
            memory_values[key] = int(value.strip().split()[0])

    total = memory_values["MemTotal"]
    available = memory_values["MemAvailable"]
    used = total - available

    return round((used / total) * 100, 1)


def get_disk_usage_percent() -> float:
    disk = shutil.disk_usage("/")

    return round((disk.used / disk.total) * 100, 1)


def get_cpu_temperature_celsius() -> float | None:
    thermal_file = Path("/sys/class/thermal/thermal_zone0/temp")

    if not thermal_file.exists():
        return None

    try:
        millidegrees = int(thermal_file.read_text(encoding="utf-8").strip())
        return round(millidegrees / 1000, 1)
    except (OSError, ValueError):
        return None


def get_service_status() -> str:
    result = subprocess.run(
        ["systemctl", "is-active", "coffee-reader.service"],
        capture_output=True,
        text=True,
        check=False,
    )

    status = result.stdout.strip()

    return status or "unknown"


def is_reader_connected() -> bool:
    try:
        connected_readers = readers()

        return any("ACR122" in str(reader) for reader in connected_readers)
    except Exception:
        return False


def send_heartbeat() -> bool:
    reported_at = datetime.now(timezone.utc).isoformat()

    payload = {
        "reportedAt": reported_at,
        "serviceStatus": get_service_status(),
        "readerConnected": is_reader_connected(),
        "uptimeSeconds": get_uptime_seconds(),
        "memoryUsagePercent": get_memory_usage_percent(),
        "diskUsagePercent": get_disk_usage_percent(),
        "cpuTemperatureCelsius": get_cpu_temperature_celsius(),
        "lastScanAt": None,
        "lastUploadAt": None,
        "pendingEvents": 0,
        "appVersion": None,
    }

    headers = {
        "Authorization": f"Bearer {DEVICE_TOKEN}",
    }

    print(
        "HEARTBEAT "
        f"service={payload['serviceStatus']} "
        f"reader={payload['readerConnected']} "
        f"memory={payload['memoryUsagePercent']}% "
        f"disk={payload['diskUsagePercent']}% "
        f"cpu={payload['cpuTemperatureCelsius']}°C",
        flush=True,
    )

    for attempt in range(1, MAX_SEND_ATTEMPTS + 1):
        try:
            response = httpx.post(
                API_URL,
                headers=headers,
                json=payload,
                timeout=5.0,
            )

            response.raise_for_status()

            print(
                f"HEARTBEAT SENT reported_at={reported_at}",
                flush=True,
            )

            return True

        except httpx.HTTPStatusError as error:
            status = error.response.status_code

            if 400 <= status < 500:
                print(
                    f"HEARTBEAT REJECTED status={status} "
                    f"response={error.response.text}",
                    flush=True,
                )
                return False

            print(
                f"SERVER ERROR attempt={attempt}/{MAX_SEND_ATTEMPTS} "
                f"status={status}",
                flush=True,
            )

        except httpx.RequestError as error:
            print(
                f"NETWORK ERROR attempt={attempt}/{MAX_SEND_ATTEMPTS}: "
                f"{error}",
                flush=True,
            )

        if attempt < MAX_SEND_ATTEMPTS:
            time.sleep(RETRY_DELAY_SECONDS)

    print(
        f"HEARTBEAT FAILED after {MAX_SEND_ATTEMPTS} attempts",
        flush=True,
    )

    return False


def main() -> None:
    success = send_heartbeat()

    if not success:
        raise SystemExit(1)


if __name__ == "__main__":
    main()