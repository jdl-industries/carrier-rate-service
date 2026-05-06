import type { ShopifyCartItem, Env } from "../types";
import type { VariantData } from "../handlers/webhooks";

/**
 * Check if an item is missing required dimension properties
 */
function isMissingDimensions(item: ShopifyCartItem): boolean {
  const props = item.properties || {};
  return !props._height || !props._width || !props._length;
}

/**
 * Check if an item is missing any metafield-derived properties
 */
function isMissingMetafieldProperties(item: ShopifyCartItem): boolean {
  const props = item.properties || {};
  // Missing dimensions, lead_time, or is_hazmat
  return !props._height || !props._width || !props._length ||
    props._lead_time === undefined || props._is_hazmat === undefined;
}

/**
 * Fetch variant data from KV for items missing properties
 * Returns a map of variant_id -> VariantData
 */
export async function fetchVariantDataFromKV(
  items: ShopifyCartItem[],
  kv: KVNamespace,
): Promise<Map<number, VariantData>> {
  const result = new Map<number, VariantData>();

  // Find items that need fallback data
  const variantIdsNeedingData = new Set<number>();
  for (const item of items) {
    if (isMissingMetafieldProperties(item)) {
      variantIdsNeedingData.add(item.variant_id);
    }
  }

  if (variantIdsNeedingData.size === 0) {
    return result;
  }

  // Batch fetch from KV
  const fetchPromises = Array.from(variantIdsNeedingData).map(async (variantId) => {
    const key = `variant:${variantId}`;
    const data = await kv.get<VariantData>(key, "json");
    if (data) {
      result.set(variantId, data);
    }
  });

  await Promise.all(fetchPromises);

  return result;
}

/**
 * Enrich cart items with variant data from KV when properties are missing
 * Returns new item objects with enriched properties (does not mutate originals)
 */
export function enrichItemsWithVariantData(
  items: ShopifyCartItem[],
  variantDataMap: Map<number, VariantData>,
): ShopifyCartItem[] {
  return items.map((item) => {
    const variantData = variantDataMap.get(item.variant_id);
    if (!variantData) {
      return item;
    }

    const props = item.properties || {};
    const newProps = { ...props };
    let enriched = false;

    // Only fill in missing properties
    if (!props._height && variantData.height) {
      newProps._height = variantData.height;
      enriched = true;
    }
    if (!props._width && variantData.width) {
      newProps._width = variantData.width;
      enriched = true;
    }
    if (!props._length && variantData.length) {
      newProps._length = variantData.length;
      enriched = true;
    }
    if (props._lead_time === undefined && variantData.lead_time) {
      newProps._lead_time = variantData.lead_time;
      enriched = true;
    }
    if (props._is_hazmat === undefined && variantData.is_hazmat) {
      newProps._is_hazmat = variantData.is_hazmat;
      enriched = true;
    }

    if (enriched) {
      return { ...item, properties: newProps };
    }
    return item;
  });
}

/**
 * Main function: fetch and enrich items with KV data
 */
export async function enrichItemsFromKV(
  items: ShopifyCartItem[],
  env: Env,
): Promise<ShopifyCartItem[]> {
  if (!env.VARIANT_DATA) {
    // KV not configured, return items as-is
    return items;
  }

  const variantDataMap = await fetchVariantDataFromKV(items, env.VARIANT_DATA);

  if (variantDataMap.size === 0) {
    return items;
  }

  console.log(`Enriched ${variantDataMap.size} items with KV fallback data`);
  return enrichItemsWithVariantData(items, variantDataMap);
}
