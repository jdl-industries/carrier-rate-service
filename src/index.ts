import { Hono } from "hono";
import type { Env } from "./types";
import { handleRateRequest, handleTestRateRequest } from "./handlers/rates";
import {
  handleStagedUploadUrl,
  handleCustomerMetafields,
  handleCustomerTags,
} from "./routes/b2b";
import { cors } from "hono/cors";

const app = new Hono<{ Bindings: Env; Variables: { rawBody: string } }>();

// Configure CORS for your Shopify Extension
app.use(
  "/b2b/*", // Or '*' to apply to all routes
  cors({
    origin: "https://extensions.shopifycdn.com",
    allowMethods: ["POST", "GET", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
    credentials: true,
  }),
);

app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/rates", handleTestRateRequest);
app.post("/rates", handleRateRequest);

// B2B tax exemption routes
app.post("/b2b/staged-upload-url", handleStagedUploadUrl);
app.post("/b2b/customer-metafields", handleCustomerMetafields);
app.post("/b2b/customer-tags", handleCustomerTags);

app.onError((err, c) => {
  console.error("Unhandled error", {
    message: err.message,
    stack: err.stack,
  });
  return c.json({ error: "Internal server error" }, 500);
});

app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

export default app;
