export interface BoxConfig {
  name: string;
  length: number;
  width: number;
  height: number;
  maxWeightLbs: number;
  emptyWeightLbs: number;
}

export interface ShipperAddress {
  streetLines: string[];
  city: string;
  stateOrProvinceCode: string;
  postalCode: string;
  countryCode: string;
}

export interface HandlingFees {
  ground_per_order: number;
  air_per_order: number;
}

export interface LeadTimes {
  default: number;
  [sku: string]: number;
}

export interface Env {
  JDL_CONFIG: KVNamespace;
  FEDEX_CLIENT_ID: string;
  FEDEX_CLIENT_SECRET: string;
  FEDEX_ACCOUNT_NUMBER: string;
  DEFAULT_HANDLING_DAYS?: string;
}
