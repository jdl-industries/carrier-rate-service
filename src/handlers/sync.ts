import type { Context } from "hono";
import type { Env } from "../types";
import type { VariantData } from "./webhooks";

const PRODUCTS_QUERY = `
  query GetProducts($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          metafields(first: 10, namespace: "custom") {
            edges {
              node {
                namespace
                key
                value
                type
              }
            }
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                metafields(first: 10, namespace: "custom") {
                  edges {
                    node {
                      namespace
                      key
                      value
                      type
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

interface MetafieldNode {
  namespace: string;
  key: string;
  value: string;
  type: string;
}

interface GraphQLResponse {
  data?: {
    products: {
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
      edges: Array<{
        node: {
          id: string;
          title: string;
          metafields: {
            edges: Array<{ node: MetafieldNode }>;
          };
          variants: {
            edges: Array<{
              node: {
                id: string;
                title: string;
                sku: string;
                metafields: {
                  edges: Array<{ node: MetafieldNode }>;
                };
              };
            }>;
          };
        };
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

/**
 * Parse dimension metafield value (type: dimension)
 */
function parseDimensionMetafield(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed.value === "number") {
      const unit = parsed.unit === "INCHES" ? "in" : parsed.unit?.toLowerCase() || "in";
      return `${parsed.value} ${unit}`;
    }
  } catch {
    if (value && !isNaN(parseFloat(value))) {
      return `${value} in`;
    }
  }
  return undefined;
}

/**
 * Parse lead time from metafield
 */
function parseLeadTimeMetafield(value: string): string | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(\d+)/);
  return match ? match[1] : undefined;
}

/**
 * Parse boolean metafield
 */
function parseBooleanMetafield(value: string): string | undefined {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  if (lower === "true" || lower === "1" || lower === "yes") return "true";
  if (lower === "false" || lower === "0" || lower === "no") return "false";
  return undefined;
}

/**
 * Extract variant data from metafield nodes
 */
function extractDataFromMetafields(
  metafields: Array<{ node: MetafieldNode }>,
): Partial<VariantData> {
  const data: Partial<VariantData> = {};

  for (const { node: mf } of metafields) {
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
 * Extract numeric variant ID from GID
 */
function extractVariantId(gid: string): string {
  // gid://shopify/ProductVariant/123456789
  const match = gid.match(/ProductVariant\/(\d+)/);
  return match ? match[1] : gid;
}

/**
 * Sync all products/variants from Shopify to KV
 */
export async function handleSyncRequest(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  // Verify admin secret
  const adminSecret = c.req.header("X-Admin-Secret");
  const expectedSecret = c.env.SHOPIFY_WEBHOOK_SECRET; // Reuse this secret for simplicity

  if (!adminSecret || adminSecret !== expectedSecret) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const shopDomain = c.env.SHOPIFY_STORE_DOMAIN;
  const accessToken = c.env.SHOPIFY_ADMIN_TOKEN;

  if (!shopDomain || !accessToken) {
    return c.json({ error: "SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN must be configured" }, 500);
  }

  const kv = c.env.VARIANT_DATA;
  let cursor: string | null = null;
  let totalProducts = 0;
  let totalVariants = 0;
  let variantsWithData = 0;

  console.log("Starting full product sync...");

  try {
    do {
      const response = await fetch(`https://${shopDomain}/admin/api/2024-10/graphql.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          query: PRODUCTS_QUERY,
          variables: { cursor },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error("Shopify API error:", response.status, text);
        return c.json({ error: "Shopify API error", status: response.status }, 500);
      }

      const result: GraphQLResponse = await response.json();

      if (result.errors) {
        console.error("GraphQL errors:", result.errors);
        return c.json({ error: "GraphQL errors", details: result.errors }, 500);
      }

      const products = result.data?.products;
      if (!products) {
        break;
      }

      // Process each product
      for (const { node: product } of products.edges) {
        totalProducts++;

        // Extract product-level metafields
        const productMetafields = extractDataFromMetafields(product.metafields.edges);

        // Process each variant
        for (const { node: variant } of product.variants.edges) {
          totalVariants++;

          const variantMetafields = extractDataFromMetafields(variant.metafields.edges);

          // Merge: variant-level takes precedence, then product-level
          const mergedData: VariantData = {
            height: variantMetafields.height,
            width: variantMetafields.width,
            length: variantMetafields.length,
            lead_time: variantMetafields.lead_time || productMetafields.lead_time,
            is_hazmat: variantMetafields.is_hazmat || productMetafields.is_hazmat,
            updated_at: new Date().toISOString(),
          };

          // Only store if we have at least one useful value
          const hasData = mergedData.height || mergedData.width || mergedData.length ||
            mergedData.lead_time || mergedData.is_hazmat;

          if (hasData) {
            const variantId = extractVariantId(variant.id);
            const key = `variant:${variantId}`;
            await kv.put(key, JSON.stringify(mergedData));
            variantsWithData++;
          }
        }
      }

      cursor = products.pageInfo.hasNextPage ? products.pageInfo.endCursor : null;
      console.log(`Processed ${totalProducts} products, ${totalVariants} variants so far...`);

    } while (cursor);

    console.log(`Sync complete: ${totalProducts} products, ${totalVariants} variants, ${variantsWithData} stored in KV`);

    return c.json({
      success: true,
      totalProducts,
      totalVariants,
      variantsWithData,
    }, 200);

  } catch (error) {
    console.error("Sync error:", error);
    return c.json({
      error: "Sync failed",
      message: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}
