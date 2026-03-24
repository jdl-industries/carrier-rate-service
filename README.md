# JDL Carrier Rate Service

A Cloudflare Worker that implements a Shopify carrier rate service to provide customm shipping rates for JDL's Shopify store.

## Features

- **Local Delivery**: Free delivery for Miami-Dade and Broward County zip codes
- **US Domestic Shipping**: FedEx Ground and Express services with negotiated rates
- **International Military**: FedEx International services for military customers
- **Freight Forwarding**: Placeholder rates for non-military international orders
- **Dangerous Goods Handling**: All shipments flagged with proper Dangerous Goods (DG) parameters
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

### 2. Set Secrets

```bash
npx wrangler secret put FEDEX_CLIENT_ID
npx wrangler secret put FEDEX_CLIENT_SECRET
npx wrangler secret put FEDEX_ACCOUNT_NUMBER
npx wrangler secret put FEDEX_SANDBOX_CLIENT_ID
npx wrangler secret put FEDEX_SANDBOX_CLIENT_SECRET
npx wrangler secret put FEDEX_SANDBOX_ACCOUNT_NUMBER
```

Control behavior using these:

```bash
npx wrangler secret put FEDEX_SANDBOX
npx wrangler secret put LOG
```

Set `FEDEX_SANDBOX` to `true` to use sandbox, otherwise production credentials/APIs will be used.

Set `LOG` to `full` to capture all requests/responses

### 3. Update Configuration (if needed)

Edit `src/config/config.ts` to update box sizes, handling fees, or local delivery zip codes.

## Development

### Run Locally

```bash
npm run dev
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

## Register an App and the Carrier Service with Shopify

A Shopify app needs to be created and installed in the JDL store in order to get the admin api token needed to register this custom carrier service using the admin api. This is best done in the [Shopify dev dashboard](https://dev.shopify.com/dashboard). Use the "Start from Dev Dashboard" option and specify:

- App name: JDL Custom Shipping
- scope(s): write_shipping

After creating the app, select the distribution method using the link in the right sidebar (opt for one store only). Then install the app in the JDL store.

Once the app has been installed, fetch an admin api access token using the [client credential grant flow](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant) as follows:

```bash
curl -X POST \
  "https://jdl-industries-inc-aviation.myshopify.com/admin/oauth/access_token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=CLIENT_ID_FROM_DEV_DASHBOARD" \
  -d "client_secret=CLIENT_SECRET_FROM_DEV_DASHBOARD"
```

After deploying, register the carrier service with Shopify using the Admin API:

```bash
curl -X POST "https://jdl-industries-inc-aviation.myshopify.com/admin/api/2024-01/carrier_services.json" \
  -H "X-Shopify-Access-Token: ADMIN_API_TOKEN_FROM_RESPONSE_ABOVE" \
  -H "Content-Type: application/json" \
  -d '{
    "carrier_service": {
      "name": "JDL Custom Shipping",
      "callback_url": "https://carrier-rate-service.jdlindustries.workers.dev/rates",
      "service_discovery": true,
      "carrier_service_type": "api",
      "format": "json"
    }
  }'
```

## Configuration

All configuration is stored in `src/config.ts`:

| Export                | Description                                    |
| --------------------- | ---------------------------------------------- |
| `LOCAL_DELIVERY_ZIPS` | Set of Miami-Dade and Broward County zip codes |
| `BOX_CONFIGS`         | Box configurations for packing algorithm       |
| `HAZMAT_FEES_CENTS`   | Hazmat handling fees (ground and air)          |

## Routing Logic

1. **Local Delivery**: Destination zip in Miami-Dade/Broward list → Free local delivery
2. **US Domestic**: US destinations → FedEx rates (+ hazmat fees if applicable)
3. **International Military**: Non-US + `_customer_type=international_military` → FedEx International
4. **Freight Forwarding**: All other international → Placeholder rate for manual follow-up

## API Endpoints

### `POST /rates`

Shopify carrier service callback.

### `GET /health`

Health check endpoint. Returns `{ "status": "ok", "timestamp": "..." }`.

## Project Structure

```
/src
  index.ts                 # Hono app entry point
  config.ts                # App configuration (fees, zip codes, FedEx settings)
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
```

## Hazmat Fees

Hazmat handling fees are added when cart items have `_is_hazmat: "true"` property:

- **Ground Services** (FEDEX_GROUND, GROUND_HOME_DELIVERY): $30 per order
- **Air/Express Services**: $125 per order

## Error Handling

- FedEx API errors or timeouts → HTTP 500 (triggers Shopify fallback rates)
- Invalid HMAC signature → HTTP 401
- No shippable items → HTTP 200 with empty rates array
- KV config errors → Uses hardcoded defaults with logged warning
