from __future__ import annotations

import signal
import time
from threading import Event

from smartcard.CardMonitoring import CardMonitor, CardObserver
from smartcard.Exceptions import CardConnectionException
from smartcard.util import toHexString


GET_UID_COMMAND = [0xFF, 0xCA, 0x00, 0x00, 0x00]
shutdown_event = Event()


def format_uid(uid: list[int]) -> str:
    return ":".join(f"{byte:02X}" for byte in uid)


class CoffeeTagObserver(CardObserver):
    def update(self, observable, handlers) -> None:
        added_cards, removed_cards = handlers

        for card in added_cards:
            try:
                connection = card.createConnection()
                connection.connect()

                uid, sw1, sw2 = connection.transmit(GET_UID_COMMAND)

                if sw1 == 0x90 and sw2 == 0x00:
                    print(
                        f"TAG DETECTED uid={format_uid(uid)}",
                        flush=True,
                    )
                else:
                    print(
                        f"UID READ FAILED status={sw1:02X}{sw2:02X}",
                        flush=True,
                    )

            except CardConnectionException as error:
                print(f"CARD CONNECTION ERROR: {error}", flush=True)

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