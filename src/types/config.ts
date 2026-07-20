export interface BoxConfig {
  name: string;
  length: number;
  width: number;
  height: number;
  maxWeightLbs: number;
  emptyWeightLbs: number;
  hazmat: boolean;
}

export interface HazmatFees {
  ground_per_order: number;
  air_per_order: number;
}

export interface Env {
  // Production FedEx credentials
  FEDEX_CLIENT_ID: string;
  FEDEX_CLIENT_SECRET: string;
  FEDEX_ACCOUNT_NUMBER: string;
  // Sandbox FedEx credentials (optional - used when FEDEX_SANDBOX=true)
  FEDEX_SANDBOX_CLIENT_ID?: string;
  FEDEX_SANDBOX_CLIENT_SECRET?: string;
  FEDEX_SANDBOX_ACCOUNT_NUMBER?: string;
  // Set to 'true' to use FedEx sandbox/test environment and credentials
  FEDEX_SANDBOX?: string;
  DEFAULT_HANDLING_DAYS?: string;
  LOG?: string; // Set to 'full' to enable verbose request/response logging
  // Cloudflare KV namespace for variant metafield data (fallback for draft orders)
  VARIANT_DATA: KVNamespace;
  // Shopify webhook secret for HMAC verification
  SHOPIFY_WEBHOOK_SECRET?: string;
  // Shopify Admin API credentials (for bulk sync)
  SHOPIFY_STORE_DOMAIN?: string;
  SHOPIFY_ADMIN_TOKEN?: string;
  // Shopify OAuth credentials (for Authorization Code Grant flow)
  SHOPIFY_CLIENT_ID?: string;
  SHOPIFY_CLIENT_SECRET?: string;
}
