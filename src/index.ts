import { Hono } from "hono";
import type { Env } from "./types";
import { handleRateRequest, handleTestRateRequest } from "./handlers/rates";
import { handleProductWebhook } from "./handlers/webhooks";
import { handleSyncRequest } from "./handlers/sync";
import { handleInstall, handleCallback } from "./handlers/oauth";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/rates", handleTestRateRequest);
app.post("/rates", handleRateRequest);

// Shopify webhook for syncing variant metafield data to KV
app.post("/webhooks/products", handleProductWebhook);

// Admin endpoint to bulk sync all variants to KV (requires X-Admin-Secret header)
app.post("/admin/sync", handleSyncRequest);

// OAuth endpoints for Shopify Authorization Code Grant flow
app.get("/auth/install", handleInstall);
app.get("/auth/callback", handleCallback);

app.onError((err, c) => {
  console.error("Unhandled error:", err.message, err.stack);
  return c.json({ error: "Internal server error" }, 500);
});

app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

export default app;
