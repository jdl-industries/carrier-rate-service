import type { Context } from "hono";
import type { Env } from "../types";

const SHOPIFY_SCOPES = "write_shipping,read_products";

interface TokenResponse {
  access_token: string;
  scope: string;
}

/**
 * Step 1: Redirect to Shopify OAuth authorization page
 * Usage: GET /auth/install?shop=your-store.myshopify.com
 */
export async function handleInstall(c: Context<{ Bindings: Env }>) {
  const shop = c.req.query("shop");

  if (!shop) {
    return c.json(
      { error: "Missing 'shop' query parameter (e.g., ?shop=your-store.myshopify.com)" },
      400
    );
  }

  const clientId = c.env.SHOPIFY_CLIENT_ID;
  if (!clientId) {
    return c.json({ error: "SHOPIFY_CLIENT_ID not configured" }, 500);
  }

  // Generate a random state for CSRF protection
  const state = crypto.randomUUID();

  // Build the callback URL based on the current request
  const url = new URL(c.req.url);
  const redirectUri = `${url.protocol}//${url.host}/auth/callback`;

  // Build Shopify OAuth URL
  const authUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("scope", SHOPIFY_SCOPES);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);

  // Return HTML with the auth URL and state for reference
  // In production, you'd want to store the state in a session/cookie for verification
  return c.html(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Install App</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; max-width: 600px; margin: 0 auto; }
        .info { background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 20px 0; }
        code { background: #e0e0e0; padding: 2px 6px; border-radius: 4px; }
        a.btn { display: inline-block; background: #5c6ac4; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin-top: 20px; }
        a.btn:hover { background: #4b5ab8; }
      </style>
    </head>
    <body>
      <h1>Shopify App Installation</h1>
      <div class="info">
        <p><strong>Shop:</strong> ${shop}</p>
        <p><strong>Scopes:</strong> ${SHOPIFY_SCOPES}</p>
        <p><strong>State:</strong> <code>${state}</code></p>
      </div>
      <p>Click the button below to authorize the app:</p>
      <a class="btn" href="${authUrl.toString()}">Authorize App</a>
      <p style="margin-top: 20px; color: #666; font-size: 14px;">
        Note: Save the state value above. You'll need to verify it matches in the callback.
      </p>
    </body>
    </html>
  `);
}

/**
 * Step 2: Handle OAuth callback, exchange code for access token
 * Shopify redirects here after merchant authorizes
 */
export async function handleCallback(c: Context<{ Bindings: Env }>) {
  const shop = c.req.query("shop");
  const code = c.req.query("code");
  const state = c.req.query("state");
  const hmac = c.req.query("hmac");

  if (!shop || !code) {
    return c.json({ error: "Missing required parameters (shop, code)" }, 400);
  }

  const clientId = c.env.SHOPIFY_CLIENT_ID;
  const clientSecret = c.env.SHOPIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return c.json({ error: "SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET not configured" }, 500);
  }

  // Exchange authorization code for access token
  const tokenUrl = `https://${shop}/admin/oauth/access_token`;

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code: code,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Token exchange failed:", response.status, errorText);
    return c.json(
      { error: "Failed to exchange code for token", details: errorText },
      500
    );
  }

  const tokenData = (await response.json()) as TokenResponse;

  // Return the token in a nice HTML page
  // IMPORTANT: In production, store this securely and don't display it
  return c.html(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>App Installed Successfully</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
        .success { background: #d4edda; border: 1px solid #c3e6cb; padding: 16px; border-radius: 8px; margin: 20px 0; }
        .token-box { background: #f8f9fa; border: 1px solid #dee2e6; padding: 16px; border-radius: 8px; margin: 20px 0; word-break: break-all; }
        code { background: #e9ecef; padding: 2px 6px; border-radius: 4px; font-family: 'Monaco', 'Menlo', monospace; }
        pre { background: #2d2d2d; color: #f8f8f2; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 13px; }
        .warning { background: #fff3cd; border: 1px solid #ffeeba; padding: 16px; border-radius: 8px; margin: 20px 0; }
        h2 { margin-top: 32px; }
      </style>
    </head>
    <body>
      <h1>App Installed Successfully!</h1>

      <div class="success">
        <strong>Shop:</strong> ${shop}<br>
        <strong>Scopes granted:</strong> ${tokenData.scope}
      </div>

      <div class="warning">
        <strong>Important:</strong> Copy this access token now and store it securely.
        It will not be shown again!
      </div>

      <div class="token-box">
        <strong>Access Token:</strong><br>
        <code>${tokenData.access_token}</code>
      </div>

      <h2>Step 1: Store the token as a Cloudflare secret</h2>
      <pre>wrangler secret put SHOPIFY_ADMIN_TOKEN
# Then paste: ${tokenData.access_token}</pre>

      <h2>Step 2: Register the Carrier Service</h2>
      <p>Run this curl command to register your carrier service:</p>
      <pre>curl -X POST "https://${shop}/admin/api/2024-01/carrier_services.json" \\
  -H "Content-Type: application/json" \\
  -H "X-Shopify-Access-Token: ${tokenData.access_token}" \\
  -d '{
    "carrier_service": {
      "name": "JDL Custom Shipping",
      "callback_url": "https://carrier-rate-service.jdlindustries.workers.dev/rates",
      "service_discovery": true,
      "format": "json"
    }
  }'</pre>

      <h2>Step 3: Verify Registration</h2>
      <p>List existing carrier services to confirm:</p>
      <pre>curl "https://${shop}/admin/api/2024-01/carrier_services.json" \\
  -H "X-Shopify-Access-Token: ${tokenData.access_token}"</pre>

      <p style="margin-top: 32px; color: #666;">
        Once registered, you can close this page. The token has been displayed for one-time setup only.
      </p>
    </body>
    </html>
  `);
}
