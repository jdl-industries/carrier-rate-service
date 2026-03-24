export interface BoxConfig {
  name: string;
  length: number;
  width: number;
  height: number;
  maxWeightLbs: number;
  emptyWeightLbs: number;
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
}
