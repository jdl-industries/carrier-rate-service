export interface BoxConfig {
  name: string;
  length: number;
  width: number;
  height: number;
  maxWeightLbs: number;
  emptyWeightLbs: number;
}

export interface HandlingFees {
  ground_per_order: number;
  air_per_order: number;
}

export interface Env {
  FEDEX_CLIENT_ID: string;
  FEDEX_CLIENT_SECRET: string;
  FEDEX_ACCOUNT_NUMBER: string;
  FEDEX_SANDBOX?: string; // Set to 'true' to use FedEx sandbox/test environment
  DEFAULT_HANDLING_DAYS?: string;
  LOG?: string; // Set to 'full' to enable verbose request/response logging
}
