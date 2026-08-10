from __future__ import annotations

import os
import signal
import time
import uuid
from datetime import datetime, timezone
from threading import Event

import httpx
from smartcard.CardMonitoring import CardMonitor, CardObserver
from smartcard.Exceptions import CardConnectionException

GET_UID_COMMAND = [0xFF, 0xCA, 0x00, 0x00, 0x00]

API_URL = os.environ["API_URL"]
DEVICE_TOKEN = os.environ["PI_DEVICE_TOKEN"]

DUPLICATE_WINDOW_SECONDS = 10
MAX_SEND_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 2

shutdown_event = Event()

last_successful_scan: dict[str, float] = {}

def format_uid(uid: list[int]) -> str:
    return ":".join(f"{byte:02X}" for byte in uid)

def is_duplicate_scan(nfc_uid: str) -> bool:
    last_scan = last_successful_scan.get(nfc_uid)

    if last_scan is None:
        return False

    return time.monotonic() - last_scan < DUPLICATE_WINDOW_SECONDS

def send_scan(nfc_uid: str) -> bool:
    event_id = str(uuid.uuid4())
    consumed_at = datetime.now(timezone.utc).isoformat()

    payload = {
        "eventId": event_id,
        "nfcUid": nfc_uid,
        "consumedAt": consumed_at,
    }

    headers = {
        "Authorization": f"Bearer {DEVICE_TOKEN}",
    }

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
                f"DRINK RECORDED uid={nfc_uid} event_id={event_id}",
                flush=True,
            )

            return True

        except httpx.HTTPStatusError as error:
            status = error.response.status_code

            # These are application errors, not transient failures.
            if 400 <= status < 500:
                print(
                    f"SCAN REJECTED uid={nfc_uid} status={status} "
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
                f"NETWORK ERROR attempt={attempt}/{MAX_SEND_ATTEMPTS}: {error}",
                flush=True,
            )

        if attempt < MAX_SEND_ATTEMPTS:
            time.sleep(RETRY_DELAY_SECONDS)

    print(
        f"SCAN FAILED uid={nfc_uid} after {MAX_SEND_ATTEMPTS} attempts",
        flush=True,
    )

    return False

class CoffeeTagObserver(CardObserver):
    def update(self, observable, handlers) -> None:
        added_cards, removed_cards = handlers

        for card in added_cards:
            connection = None

            try:
                connection = card.createConnection()
                connection.connect()

                uid, sw1, sw2 = connection.transmit(GET_UID_COMMAND)

                if sw1 != 0x90 or sw2 != 0x00:
                    print(
                        f"UID READ FAILED status={sw1:02X}{sw2:02X}",
                        flush=True,
                    )
                    continue

                nfc_uid = format_uid(uid)

                if is_duplicate_scan(nfc_uid):
                    print(
                        f"DUPLICATE IGNORED uid={nfc_uid}",
                        flush=True,
                    )
                    continue

                print(
                    f"TAG DETECTED uid={nfc_uid}",
                    flush=True,
                )

                if send_scan(nfc_uid):
                    last_successful_scan[nfc_uid] = time.monotonic()

            except CardConnectionException as error:
                print(
                    f"CARD CONNECTION ERROR: {error}",
                    flush=True,
                )

            finally:
                if connection is not None:
                    try:
                        connection.disconnect()
                    except Exception:
                        pass

        for _card in removed_cards:
            print("TAG REMOVED", flush=True)


def request_shutdown(signum, frame) -> None:
    shutdown_event.set()


def main() -> None:
    signal.signal(signal.SIGINT, request_shutdown)
    signal.signal(signal.SIGTERM, request_shutdown)

    monitor = CardMonitor()
    observer = CoffeeTagObserver()
    monitor.addObserver(observer)

    print("Coffee NFC reader started", flush=True)

    try:
        while not shutdown_event.is_set():
            time.sleep(0.25)
    finally:
        monitor.deleteObserver(observer)
        print("Coffee NFC reader stopped", flush=True)


if __name__ == "__main__":
    main()