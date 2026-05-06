import { Hono } from "hono";
import type { Env } from "./types";
import { handleRateRequest, handleTestRateRequest } from "./handlers/rates";
import { handleProductWebhook } from "./handlers/webhooks";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/rates", handleTestRateRequest);
app.post("/rates", handleRateRequest);

// Shopify webhook for syncing variant metafield data to KV
app.post("/webhooks/products", handleProductWebhook);

app.onError((err, c) => {
  console.error("Unhandled error:", err.message, err.stack);
  return c.json({ error: "Internal server error" }, 500);
});

app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

export default app;
