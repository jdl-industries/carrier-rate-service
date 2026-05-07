# JDL Carrier Rate Service

A Cloudflare Worker that implements a Shopify carrier rate service to provide custom shipping rates for JDL's Shopify store.

## Features

- **Local Delivery**: Free delivery for Miami-Dade and Broward County zip codes
- **US Domestic Shipping**: FedEx Ground and Express services with negotiated rates
- **International Military**: FedEx International services for military customers
- **Freight Forwarding**: Placeholder rates for non-military international orders
- **Dangerous Goods Handling**: All shipments flagged with proper Dangerous Goods (DG) parameters
- **Dynamic Box Packing**: Greedy bin-packing algorithm for optimal packaging
- **Draft Order Support**: KV-based fallback for variant metafields when cart properties are missing (e.g., draft orders created in Shopify Admin)

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

**FedEx API credentials:**

```bash
npx wrangler secret put FEDEX_CLIENT_ID
npx wrangler secret put FEDEX_CLIENT_SECRET
npx wrangler secret put FEDEX_ACCOUNT_NUMBER
npx wrangler secret put FEDEX_SANDBOX_CLIENT_ID
npx wrangler secret put FEDEX_SANDBOX_CLIENT_SECRET
npx wrangler secret put FEDEX_SANDBOX_ACCOUNT_NUMBER
```

**Shopify credentials (for webhooks and bulk sync):**

```bash
npx wrangler secret put SHOPIFY_WEBHOOK_SECRET   # API secret key (shpss_...) for HMAC verification
npx wrangler secret put SHOPIFY_STORE_DOMAIN     # e.g., your-store.myshopify.com
npx wrangler secret put SHOPIFY_ADMIN_TOKEN      # Admin API access token (shpat_...) - see instructions below
```

**Control behavior:**

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
- scope(s): `write_shipping`, `read_products`

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

## Webhook Setup for Draft Order Support

Draft orders created in Shopify Admin don't include the custom cart line item properties that the storefront adds via JavaScript. To support accurate shipping rates for draft orders, variant metafield data is cached in Cloudflare KV and used as a fallback.

### Register the Products Update Webhook

Run this in Shopify Admin GraphiQL (Settings → Apps → Develop apps → [App] → GraphiQL):

```graphql
mutation {
  webhookSubscriptionCreate(
    topic: PRODUCTS_UPDATE
    webhookSubscription: {
      callbackUrl: "https://carrier-rate-service.jdlindustries.workers.dev/webhooks/products"
      format: JSON
      metafieldNamespaces: ["custom"]
    }
  ) {
    webhookSubscription {
      id
      topic
      metafieldNamespaces
    }
    userErrors {
      field
      message
    }
  }
}
```

This webhook fires when products or variants are updated, syncing metafield data to KV.

### Bulk Sync Existing Products

To populate KV with all existing variant data (one-time or as needed):

```bash
curl -X POST https://carrier-rate-service.jdlindustries.workers.dev/admin/sync \
  -H "X-Admin-Secret: YOUR_SHOPIFY_WEBHOOK_SECRET"
```

Response:

```json
{
  "success": true,
  "totalProducts": 150,
  "totalVariants": 420,
  "variantsWithData": 385
}
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

Shopify carrier service callback. Accepts Shopify rate request payload, returns shipping rates.

### `GET /health`

Health check endpoint. Returns `{ "status": "ok", "timestamp": "..." }`.

### `POST /webhooks/products`

Shopify webhook endpoint for `products/update` topic. Syncs variant metafield data to KV.

### `POST /admin/sync`

Bulk sync all products/variants to KV. Requires `X-Admin-Secret` header matching `SHOPIFY_WEBHOOK_SECRET`.

## Project Structure

```
/src
  index.ts                 # Hono app entry point
  config.ts                # App configuration (fees, zip codes, FedEx settings)
  /handlers
    rates.ts               # Main rate handler
    webhooks.ts            # Shopify webhook handler (products/update)
    sync.ts                # Bulk sync handler for KV population
  /services
    fedex.ts               # FedEx OAuth + Rate API
    packaging.ts           # Box packing algorithm
    routing.ts             # Routing decision tree
    leadtimes.ts           # Lead time calculations
    variant-data.ts        # KV lookup and item enrichment
    *.test.ts              # Unit tests
  /types
    shopify.ts             # Shopify types
    fedex.ts               # FedEx API types
    config.ts              # Configuration types (includes Env with KV binding)
```

## Variant Metafield Fallback (KV)

When cart items are missing required properties (e.g., draft orders from Shopify Admin), the service falls back to Cloudflare KV for variant data.

**Metafields synced to KV:**

| Shopify Metafield            | KV Field    | Cart Property |
| ---------------------------- | ----------- | ------------- |
| `custom.height` (variant)    | `height`    | `_height`     |
| `custom.width` (variant)     | `width`     | `_width`      |
| `custom.length` (variant)    | `length`    | `_length`     |
| `custom.lead_time` (product) | `lead_time` | `_lead_time`  |
| `custom.is_hazmat` (product) | `is_hazmat` | `_is_hazmat`  |

KV key format: `variant:{variant_id}`

## Hazmat Fees

Hazmat handling fees are added when cart items have `_is_hazmat: "true"` property:

- **Ground Services** (FEDEX_GROUND, GROUND_HOME_DELIVERY): $30 per order
- **Air/Express Services**: $125 per order

## Error Handling

- FedEx API errors or timeouts → HTTP 500 (triggers Shopify fallback rates)
- Invalid HMAC signature → HTTP 401
- No shippable items → HTTP 200 with empty rates array
- KV config errors → Uses hardcoded defaults with logged warning
