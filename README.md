# JDL Shipping Rates - Shopify Carrier Service

A Cloudflare Worker that implements a Shopify carrier rate service to provide customm shipping rates for JDL's Shopify store. Handles hazardous materials, accounts for boxing using using the Fedex (Class 3, UN1263/UN1210) shipping via FedEx with proper dangerous goods declarations.

## Features

- **Local Delivery**: Free delivery for Miami-Dade and Broward County zip codes
- **US Domestic Shipping**: FedEx Ground and Express services with negotiated rates
- **International Military**: FedEx International services for military customers
- **Freight Forwarding**: Placeholder rates for non-military international orders
- **Dangerous Goods Handling**: All shipments flagged with proper DG parameters
- **Priority Handling**: Optional expedited fulfillment for all FedEx services
- **Dynamic Box Packing**: Greedy bin-packing algorithm for optimal packaging

## Prerequisites

- Node.js 18+
- Wrangler CLI (`npm install -g wrangler`)
- FedEx Developer Account with REST API credentials
- Shopify store with Carrier Service API access

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Wrangler

Update `wrangler.toml` with your KV namespace IDs:

```toml
[[kv_namespaces]]
binding = "JDL_CONFIG"
id = "your-production-kv-namespace-id"
preview_id = "your-preview-kv-namespace-id"
```

Create the KV namespace if needed:

```bash
npx wrangler kv:namespace create JDL_CONFIG
npx wrangler kv:namespace create JDL_CONFIG --preview
```

### 3. Set Secrets

```bash
npx wrangler secret put FEDEX_CLIENT_ID
npx wrangler secret put FEDEX_CLIENT_SECRET
npx wrangler secret put FEDEX_ACCOUNT_NUMBER
```

### 4. Seed KV Configuration

```bash
# Seed preview/development KV
npm run seed-kv

# Seed production KV
npm run seed-kv:prod
```

### 5. Update Shipper Address

Edit the shipper address in `scripts/seed-kv.ts` to match JDL's warehouse address before seeding.

## Development

### Run Locally

```bash
npm run dev
```

This starts the worker at `http://localhost:8787`.

### Test the Endpoint

```bash
curl -X POST http://localhost:8787/rates \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Hmac-Sha256: $(echo -n '{"rate":...}' | openssl dgst -sha256 -hmac 'your-secret' -binary | base64)" \
  -d '{"rate":{"origin":{},"destination":{"country":"US","postal_code":"90210","province":"CA","city":"Beverly Hills","name":"Test","address1":"123 Test St","address2":"","phone":""},"items":[{"name":"Test","sku":"TEST","quantity":1,"grams":1000,"price":5000,"vendor":"JDL","requires_shipping":true,"taxable":true,"fulfillment_service":"manual","properties":{},"product_id":1,"variant_id":1}],"currency":"USD","locale":"en"}}'
```

### Run Tests

```bash
# Run tests in watch mode
npm test

# Run tests once
npm run test:run
```

## Deployment

```bash
npm run deploy
```

## Register Carrier Service with Shopify

After deploying, register the carrier service with Shopify using the Admin API:

```bash
curl -X POST "https://YOUR-STORE.myshopify.com/admin/api/2024-01/carrier_services.json" \
  -H "X-Shopify-Access-Token: YOUR_ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "carrier_service": {
      "name": "JDL Shipping",
      "callback_url": "https://carrier-rate-service.YOUR-SUBDOMAIN.workers.dev/rates",
      "service_discovery": true,
      "carrier_service_type": "api",
      "format": "json"
    }
  }'
```

## Configuration

All configuration is stored in Cloudflare KV under the `JDL_CONFIG` namespace:

| Key                        | Description                              |
| -------------------------- | ---------------------------------------- |
| `zip_codes:local_delivery` | JSON array of local delivery zip codes   |
| `config:shipper_address`   | JDL warehouse address for FedEx          |
| `config:box_sizes`         | Box configurations for packing algorithm |
| `config:handling_fees`     | Ground and air handling fees             |
| `config:lead_times`        | SKU-specific fulfillment lead times      |
| `config:priority_fee`      | Priority handling surcharge (cents)      |

## Routing Logic

1. **Local Delivery**: Destination zip in Miami-Dade/Broward list → Free local delivery
2. **US Domestic**: US destinations → FedEx rates with handling fees
3. **International Military**: Non-US + `_customer_type=international_military` → FedEx International
4. **Freight Forwarding**: All other international → Placeholder rate for manual follow-up

## API Endpoints

### `POST /rates`

Shopify carrier service callback. Requires `X-Shopify-Hmac-Sha256` header for authentication.

### `GET /health`

Health check endpoint. Returns `{ "status": "ok", "timestamp": "..." }`.

## Project Structure

```
/src
  index.ts                 # Hono app entry point
  /handlers
    rates.ts               # Main rate handler
  /services
    fedex.ts               # FedEx OAuth + Rate API
    packaging.ts           # Box packing algorithm
    routing.ts             # Routing decision tree
    leadtimes.ts           # Lead time calculations
    *.test.ts              # Unit tests
  /types
    shopify.ts             # Shopify types
    fedex.ts               # FedEx API types
    config.ts              # Configuration types
  /config
    constants.ts           # Service codes, defaults
/scripts
  seed-kv.ts               # KV seeding script
```

## Handling Fees

- **Ground Services** (FEDEX_GROUND, GROUND_HOME_DELIVERY): $30 per order
- **Air/Express Services**: $125 per order
- **Priority Handling**: +$30 for expedited fulfillment (ships within 1 business day)

## Error Handling

- FedEx API errors or timeouts → HTTP 500 (triggers Shopify fallback rates)
- Invalid HMAC signature → HTTP 401
- No shippable items → HTTP 200 with empty rates array
- KV config errors → Uses hardcoded defaults with logged warning
