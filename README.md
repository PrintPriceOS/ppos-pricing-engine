# ppos-pricing-engine

Deterministic Book Pricing Engine for PrintPrice OS — v3.0

## Role

Pricing engine for PrintPrice OS. Exposes a Fastify HTTP server with a `/api/estimates` endpoint and can also be used as a library by any consumer that needs deterministic book cost estimates. Print house data is loaded from MongoDB at startup and cached in memory. It has no side-effects; it is a pure computational kernel with an HTTP entry point.

## Key responsibilities

- **Normalisation** — converts varied EN/ES inputs (binding methods, finishing options, print modes, paper types, book sizes) to canonical values
- **Pricing calculations** — computes per-house cost breakdowns from a structured rate matrix
- **Multi-house comparison** — runs all available print houses and returns results sorted by total cost

## Requirements

- Node.js
- MongoDB running and accessible (collection: `printhouses`, database: `control_plane`)

## Setup

```bash
npm install
cp .env.example .env   # then set MONGODB_URI if needed
```

`.env` variables:

| Variable | Default | Description |
|---|---|---|
| `PPOS_PRICING_PORT` | `8004` | HTTP port |
| `MONGODB_URI` | — | MongoDB connection string |

## Running the server

```bash
npm start
# Listens on port 8004 by default (override with PPOS_PRICING_PORT)
```

### HTTP endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/estimates` | Run the full pricing pipeline |
| `GET`  | `/health`        | Service health check |

#### POST /api/estimates

Send a JSON body with any subset of the pricing parameters. All fields are optional and fall back to engine defaults.

```bash
curl -X POST http://localhost:8004/api/estimates \
  -H 'Content-Type: application/json' \
  -d '{
    "copies": 1000,
    "interior_pages": 128,
    "book_size": "A5",
    "binding_method": "hardcover",
    "finishing_options": "matt lamination",
    "interior_print": "1/1",
    "cover_print": "4/0",
    "delivery_country": "NL",
    "paper_weight_interior": 135,
    "paper_weight_cover": 250
  }'
```

Response shape:

```json
{
  "ok": true,
  "engine": "v3.0",
  "count": 3,
  "params": { "...normalised input..." },
  "selected_print_house": { "print_house": "...", "total_cost": 1234.56, "lines": [] },
  "print_houses": []
}
```

## Library usage

```js
require('dotenv').config();
const { Repository, EstimatesService } = require('@ppos/pricing-engine');

const repo = new Repository();
await repo.init();                        // connects to MongoDB, loads & caches houses

const service = new EstimatesService(repo);

const result = service.estimate({
    copies:                1000,
    interior_pages:        128,
    book_size:             'A5',
    binding_method:        'hardcover',
    finishing_options:     'matt lamination',
    interior_print:        '1/1',
    cover_print:           '4/0',
    delivery_country:      'NL',
    paper_weight_interior: 135,
    paper_weight_cover:    250,
});

console.log(result.selected_print_house);
// { print_house, total_cost, delivery_time, lines: [...] }
```

## Running tests

```bash
npm test
```

## Marketplace Offers API

**Endpoint:** `POST /api/marketplace/offers`

**Purpose:**
Generate Control Plane-compatible marketplace offers from deterministic Pricing Engine calculations.

**Important:**
This endpoint is **side-effect-free**. It does not create orders, sessions, offers, events, or dispatches. Control Plane remains responsible for persistence and selection.

**Example request:**

```json
{
  "source": "BPE",
  "source_ref": "bpe_order_177879",
  "tenant_id": "default",
  "trace_id": "trace_1778791664236",
  "order_id": "17",
  "job_id": "17",
  "currency": "EUR",
  "target_margin_pct": 30,

  "product_type": "book",
  "quantity": 1000,
  "copies": 1000,
  "format": "170x240",
  "book_size": "A5",
  "pages": 240,
  "interior_pages": 240,
  "binding": "softcover",
  "binding_method": "softcover",
  "paper": "90gsm offset",
  "paper_weight_interior": 90,
  "cover": "300gsm gloss",
  "paper_weight_cover": 300,
  "interior_print": "4/4",
  "cover_print": "4/0",
  "delivery_country": "ES"
}
```

**Example response:**

```json
{
  "ok": true,
  "engine": "v3.0",
  "source": "BPE",
  "source_ref": "bpe_order_177879",
  "tenant_id": "default",
  "trace_id": "trace_1778791664236",
  "order_id": "17",
  "job_id": "17",
  "currency": "EUR",
  "params": {},
  "selected_offer": {
    "printer_id": "adv-2025",
    "printer_name": "Adv 2025",
    "production_cost": 1825.07,
    "suggested_price": 2607.2429,
    "estimated_margin": 782.1729,
    "margin_pct": 30,
    "lead_time_days": 7,
    "offer_rank": 1,
    "offer_priority_score": 100,
    "offer_status": "SENT",
    "offer_selected": false
  },
  "offers": [],
  "count": 3,
  "warnings": [],
  "errors": {}
}
```

> [!NOTE]
> `selected_offer` is a recommendation based on cost and capability. Control Plane remains the authoritative owner of final selection and operational state.

---

Copyright 2026 PrintPrice OS
