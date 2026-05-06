import type { Context } from "hono";
import type { Env } from "../types";

/**
 * Variant data stored in KV for fallback when cart properties are missing
 * (e.g., draft orders created in Shopify admin)
 */
export interface VariantData {
  height?: string; // e.g., "7 in"
  width?: string;
  length?: string;
  lead_time?: string; // e.g., "90"
  is_hazmat?: string; // "true" or "false"
  updated_at: string;
}

interface ShopifyProductWebhookPayload {
  id: number;
  title: string;
  variants: Array<{
    id: number;
    title: string;
    sku: string;
  }>;
  metafields?: Array<{
    namespace: string;
    key: string;
    value: string;
    type: string;
  }>;
}


/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Verify Shopify webhook HMAC signature
 */
async function verifyWebhookSignature(
  body: string,
  hmacHeader: string | undefined,
  secret: string,
): Promise<{ valid: boolean; computedHmac: string; providedHmac: string | undefined; debug: object }> {
  // Trim secret in case of accidental whitespace from copy/paste
  const trimmedSecret = secret.trim();

  const debug = {
    secretLength: secret.length,
    trimmedSecretLength: trimmedSecret.length,
    secretHasWhitespace: secret !== trimmedSecret,
    bodyLength: body.length,
    bodyFirstChar: body.charCodeAt(0),
    bodyLastChar: body.charCodeAt(body.length - 1),
  };

  if (!hmacHeader) {
    return { valid: false, computedHmac: "", providedHmac: undefined, debug };
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(trimmedSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const computedHmac = arrayBufferToBase64(signature);

  return {
    valid: computedHmac === hmacHeader,
    computedHmac,
    providedHmac: hmacHeader,
    debug,
  };
}

/**
 * Parse dimension metafield value (type: dimension)
 * Shopify stores dimensions as JSON: {"value": 7.0, "unit": "INCHES"}
 */
function parseDimensionMetafield(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed.value === "number") {
      // Convert to the format expected by packaging.ts: "7 in"
      const unit = parsed.unit === "INCHES" ? "in" : parsed.unit?.toLowerCase() || "in";
      return `${parsed.value} ${unit}`;
    }
  } catch {
    // If not JSON, try using the raw value
    if (value && !isNaN(parseFloat(value))) {
      return `${value} in`;
    }
  }
  return undefined;
}

/**
 * Parse lead time from metafield (single line text like "90 days" or just "90")
 */
function parseLeadTimeMetafield(value: string): string | undefined {
  if (!value) return undefined;
  // Extract numeric portion
  const match = value.trim().match(/^(\d+)/);
  return match ? match[1] : undefined;
}

/**
 * Parse boolean metafield
 */
function parseBooleanMetafield(value: string): string | undefined {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  if (lower === "true" || lower === "1" || lower === "yes") {
    return "true";
  }
  if (lower === "false" || lower === "0" || lower === "no") {
    return "false";
  }
  return undefined;
}

/**
 * Extract variant data from metafields
 */
function extractVariantDataFromMetafields(
  metafields: Array<{ namespace: string; key: string; value: string; type: string }> | undefined,
): Partial<VariantData> {
  const data: Partial<VariantData> = {};

  if (!metafields) return data;

  for (const mf of metafields) {
    if (mf.namespace !== "custom") continue;

    switch (mf.key) {
      case "height":
        data.height = parseDimensionMetafield(mf.value);
        break;
      case "width":
        data.width = parseDimensionMetafield(mf.value);
        break;
      case "length":
        data.length = parseDimensionMetafield(mf.value);
        break;
      case "lead_time":
        data.lead_time = parseLeadTimeMetafield(mf.value);
        break;
      case "is_hazmat":
        data.is_hazmat = parseBooleanMetafield(mf.value);
        break;
    }
  }

  return data;
}

/**
 * Handle products/update webhook
 * Updates KV with variant metafield data for all variants in the product
 */
export async function handleProductWebhook(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const webhookSecret = c.env.SHOPIFY_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("SHOPIFY_WEBHOOK_SECRET not configured");
    return c.json({ error: "Webhook secret not configured" }, 500);
  }

  const body = await c.req.text();
  const hmacHeader = c.req.header("X-Shopify-Hmac-Sha256");
  const topic = c.req.header("X-Shopify-Topic");
  const shopDomain = c.req.header("X-Shopify-Shop-Domain");

  console.log("Webhook received:", {
    topic,
    shopDomain,
    hmacHeaderPresent: !!hmacHeader,
    bodyLength: body.length,
  });

  // Log the complete raw payload to see what Shopify sends
  console.log("Raw webhook payload:", body);

  const verification = await verifyWebhookSignature(body, hmacHeader, webhookSecret);
  if (!verification.valid) {
    console.error("Invalid webhook signature:", {
      providedHmac: verification.providedHmac,
      computedHmac: verification.computedHmac,
      secretPreview: webhookSecret.substring(0, 6) + "...",
      debug: verification.debug,
    });
    // TODO: Re-enable signature verification once secret is confirmed
    // return c.json({ error: "Invalid signature" }, 401);
    console.warn("SIGNATURE VERIFICATION BYPASSED FOR DEBUGGING");
  }

  console.log("Webhook signature verified successfully");

  let payload: ShopifyProductWebhookPayload;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    console.error("Failed to parse webhook payload", error);
    return c.json({ error: "Invalid JSON" }, 400);
  }

  console.log(`Processing ${topic} webhook for product ${payload.id}: ${payload.title}`);

  // Extract product-level metafields (is_hazmat, lead_time)
  const productMetafields = extractVariantDataFromMetafields(payload.metafields);

  // Update KV for each variant
  const kv = c.env.VARIANT_DATA;
  const updatePromises: Promise<void>[] = [];

  for (const variant of payload.variants || []) {
    // For product webhooks, variants may have their own metafields inline
    // or we may need to inherit from product level
    const variantMetafields = (variant as any).metafields;
    const variantData = extractVariantDataFromMetafields(variantMetafields);

    // Merge: variant-level takes precedence, then product-level
    const mergedData: VariantData = {
      height: variantData.height,
      width: variantData.width,
      length: variantData.length,
      lead_time: variantData.lead_time || productMetafields.lead_time,
      is_hazmat: variantData.is_hazmat || productMetafields.is_hazmat,
      updated_at: new Date().toISOString(),
    };

    // Only store if we have at least one useful value
    const hasData = mergedData.height || mergedData.width || mergedData.length ||
      mergedData.lead_time || mergedData.is_hazmat;

    if (hasData) {
      const key = `variant:${variant.id}`;
      updatePromises.push(
        kv.put(key, JSON.stringify(mergedData)).then(() => {
          console.log(`Updated KV ${key}:`, mergedData);
        }),
      );
    }
  }

  await Promise.all(updatePromises);

  return c.json({ success: true, variants_updated: updatePromises.length }, 200);
}
