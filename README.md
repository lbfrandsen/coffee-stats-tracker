# Coffee Stats Tracker

A small end-to-end system for answering an unnecessarily important question:

**How much coffee do we actually drink?**

Coffee mugs are fitted with NFC tags. When a mug is scanned, a Raspberry Pi identifies the tag and sends the event to a Cloudflare-hosted backend. The data is stored in Cloudflare D1 and presented through a web dashboard with leaderboards and statistics.

Production site: [kaffe.lucasfrandsen.dk](https://kaffe.lucasfrandsen.dk)

## How it works

```text
NFC-tagged mug
      │
      ▼
ACR122U NFC reader
      │
      ▼
Raspberry Pi
      │
      │ POST /api/scans
      ▼
Cloudflare Worker
      │
      ▼
Cloudflare D1
      │
      ▼
React Router dashboard
```

Each NFC tag is associated with a specific mug, and each mug belongs to a person.

A successful scan records:

* the person
* the mug
* the time the coffee was consumed
* a unique event ID

The Raspberry Pi also periodically reports its health to the backend, including reader connectivity, uptime, memory usage, disk usage and CPU temperature.

## Stack

### Web application

* React 19
* React Router 8
* TypeScript
* Tailwind CSS
* shadcn
* Cloudflare Workers
* Cloudflare D1
* Wrangler
* pnpm

### Raspberry Pi

* Raspberry Pi 3 Model B+
* ACR122U USB NFC reader
* NTAG215 NFC tags
* Python
* `pyscard`
* `httpx`
* systemd

## Repository structure

```text
.
├── app/                 # React Router application
├── migrations/          # Cloudflare D1 migrations
├── pi/
│   ├── src/
│   │   ├── reader.py    # NFC reader and scan uploader
│   │   └── heartbeat.py # Raspberry Pi health reporting
│   └── systemd/         # Raspberry Pi systemd services
├── workers/
│   └── app.ts           # Cloudflare Worker and API endpoints
├── public/              # Static assets
├── wrangler.jsonc       # Cloudflare configuration
└── package.json
```

## API

The Raspberry Pi communicates with two authenticated endpoints.

### `POST /api/scans`

Records a coffee event.

```json
{
  "eventId": "uuid",
  "nfcUid": "04:XX:XX:XX:XX:XX:XX",
  "consumedAt": "2026-08-11T08:30:00Z"
}
```

### `POST /api/heartbeats`

Reports the current state of the Raspberry Pi and NFC reader.

Both endpoints require:

```http
Authorization: Bearer <PI_DEVICE_TOKEN>
```

## Raspberry Pi

The Raspberry Pi runs two Python services:

**Reader service**

Listens for NFC tags, reads the UID from the ACR122U, suppresses immediate duplicate scans, and sends successful scans to the API.

**Heartbeat service**

Periodically reports whether the reader and Pi are operating normally.

Python dependencies are defined in:

```text
pi/requirements.txt
```

The production services are managed through systemd so the tracker starts automatically when the Raspberry Pi boots.

## Hardware

* Raspberry Pi 3 Model B+
* ACR122U ISO 14443 A/B NFC reader
* NTAG215 NFC tags attached to the mugs

No data is stored on the NFC tag beyond its UID being used as the mug identifier.

## License

MIT



---

> **Disclaimer:** This README was generated with assistance from a large language model.
