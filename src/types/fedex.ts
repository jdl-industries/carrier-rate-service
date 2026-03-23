export interface FedExOAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface FedExAddress {
  streetLines?: string[];
  city: string;
  stateOrProvinceCode?: string;
  postalCode: string;
  countryCode: string;
  residential?: boolean;
}

export interface FedExWeight {
  units: "LB" | "KG";
  value: number;
}

export interface FedExDimensions {
  length: number;
  width: number;
  height: number;
  units: "IN" | "CM";
}

export interface FedExDangerousGoodsDetail {
  accessibility: "ACCESSIBLE" | "INACCESSIBLE";
  regulationType: "DOT" | "IATA" | "DOT_IATA";
  cargo?: boolean;
  signatory?: {
    contactName: string;
    title: string;
    place: string;
  };
}

export interface FedExSpecialServicesRequested {
  specialServiceTypes: string[];
  dangerousGoodsDetail?: FedExDangerousGoodsDetail;
}

export interface FedExPackageLineItem {
  weight: FedExWeight;
  dimensions: FedExDimensions;
  groupPackageCount: number;
  packageSpecialServices?: FedExSpecialServicesRequested;
}

export interface FedExRateRequest {
  accountNumber: {
    value: string;
  };
  rateRequestControlParameters?: {
    returnTransitTimes: boolean;
    servicesNeededOnRateFailure: boolean;
    rateSortOrder?: string;
    variableOptions?: string[];
  };
  requestedShipment: {
    shipper: {
      address: FedExAddress;
    };
    recipient: {
      address: FedExAddress;
    };
    shippingChargesPayment?: {
      paymentType: "SENDER" | "RECIPIENT" | "THIRD_PARTY";
      payor?: {
        responsibleParty: {
          accountNumber: {
            value: string;
          };
        };
      };
    };
    preferredCurrency: string;
    shipDateStamp: string;
    pickupType:
      | "DROPOFF_AT_FEDEX_LOCATION"
      | "CONTACT_FEDEX_TO_SCHEDULE"
      | "USE_SCHEDULED_PICKUP";
    packagingType: "YOUR_PACKAGING" | "FEDEX_BOX" | "FEDEX_ENVELOPE";
    rateRequestType: ("LIST" | "ACCOUNT")[];
    requestedPackageLineItems: FedExPackageLineItem[];
  };
}

export interface FedExRatedShipmentDetail {
  // FedEx returns different rate type formats depending on API version/environment
  // Sandbox uses: 'ACCOUNT', 'LIST'
  // Production may use: 'PAYOR_ACCOUNT_PACKAGE', 'PAYOR_LIST_PACKAGE', etc.
  rateType:
    | "ACCOUNT"
    | "LIST"
    | "PAYOR_ACCOUNT_PACKAGE"
    | "PAYOR_LIST_PACKAGE"
    | "PAYOR_ACCOUNT_SHIPMENT"
    | "PAYOR_LIST_SHIPMENT";
  ratedWeightMethod?: string;
  totalDiscounts?: number | FedExMoney[];
  totalBaseCharge?: number | FedExMoney[];
  // Can be a number (sandbox) or array of FedExMoney (production)
  totalNetCharge?: number | FedExMoney[];
  totalNetFedExCharge?: number | FedExMoney[];
  shipmentRateDetail?: {
    totalBillingWeight?: FedExWeight;
    totalDimWeight?: FedExWeight;
  };
  currency?: string;
}

export interface FedExMoney {
  currency: string;
  amount: number;
}

export interface FedExRateReplyDetail {
  serviceType: string;
  serviceName?: string;
  packagingType?: string;
  commit?: {
    dateDetail?: {
      dayOfWeek?: string;
      dayCxsFormat?: string;
    };
    transitDays?: {
      description?: string;
      minimumTransitTime?: string;
    };
    deliveryTimestamp?: string;
    transitTime?: string;
  };
  ratedShipmentDetails?: FedExRatedShipmentDetail[];
  operationalDetail?: {
    originServiceArea?: string;
    destinationServiceArea?: string;
    transitTime?: string;
    deliveryDate?: string;
    deliveryDay?: string;
    publishedDeliveryTime?: string;
  };
}

export interface FedExRateResponse {
  transactionId?: string;
  output?: {
    rateReplyDetails?: FedExRateReplyDetail[];
    quoteDate?: string;
    encrypted?: string;
    alerts?: FedExAlert[];
  };
  errors?: FedExError[];
}

export interface FedExAlert {
  code: string;
  message: string;
  alertType?: string;
}

export interface FedExError {
  code: string;
  message: string;
  parameterList?: { key: string; value: string }[];
}

export interface ParsedFedExRate {
  serviceType: string;
  serviceName: string;
  totalChargeCents: number;
  transitDays: number;
  deliveryDate: string | null;
}
