import type {
  Env,
  FedExOAuthResponse,
  FedExRateRequest,
  FedExRateResponse,
  FedExPackageLineItem,
  FedExAddress,
  ParsedFedExRate,
} from "../types";
import {
  FEDEX_TOKEN_EXPIRY_BUFFER_SECONDS,
  FEDEX_API_TIMEOUT_MS,
  ALL_ALLOWED_SERVICES,
  GROUND_SERVICE_SET,
  SERVICE_DISPLAY_NAMES,
  getFedExApiBase,
} from "../config";

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

// Separate token caches for sandbox and production
const tokenCaches: {
  sandbox: CachedToken | null;
  production: CachedToken | null;
} = {
  sandbox: null,
  production: null,
};

export function getFedExCredentials(env: Env): {
  clientId: string;
  clientSecret: string;
  accountNumber: string;
  useSandbox: boolean;
} {
  const useSandbox = env.FEDEX_SANDBOX === "true";

  if (useSandbox) {
    return {
      clientId: env.FEDEX_SANDBOX_CLIENT_ID || env.FEDEX_CLIENT_ID,
      clientSecret: env.FEDEX_SANDBOX_CLIENT_SECRET || env.FEDEX_CLIENT_SECRET,
      accountNumber:
        env.FEDEX_SANDBOX_ACCOUNT_NUMBER || env.FEDEX_ACCOUNT_NUMBER,
      useSandbox: true,
    };
  }

  return {
    clientId: env.FEDEX_CLIENT_ID,
    clientSecret: env.FEDEX_CLIENT_SECRET,
    accountNumber: env.FEDEX_ACCOUNT_NUMBER,
    useSandbox: false,
  };
}

export async function getFedExAccessToken(env: Env): Promise<string> {
  const now = Date.now();
  const { clientId, clientSecret, useSandbox } = getFedExCredentials(env);
  const cacheKey = useSandbox ? "sandbox" : "production";
  const cachedToken = tokenCaches[cacheKey];

  if (cachedToken && cachedToken.expiresAt > now) {
    return cachedToken.accessToken;
  }

  const oauthEndpoint = `${getFedExApiBase(useSandbox)}/oauth/token`;

  const response = await fetch(oauthEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`FedEx OAuth failed: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as FedExOAuthResponse;

  tokenCaches[cacheKey] = {
    accessToken: data.access_token,
    expiresAt:
      now + (data.expires_in - FEDEX_TOKEN_EXPIRY_BUFFER_SECONDS) * 1000,
  };

  return data.access_token;
}

export type HazmatMode = "none" | "ground" | "air";

function applyHazmatToPackages(
  packages: FedExPackageLineItem[],
  mode: HazmatMode,
): FedExPackageLineItem[] {
  if (mode === "none") {
    return packages;
  }

  return packages.map((pkg) => {
    if (mode === "ground") {
      // FedEx Ground hazmat uses options array (no specialServiceTypes)
      return {
        ...pkg,
        packageSpecialServices: {
          dangerousGoodsDetail: {
            options: ["HAZARDOUS_MATERIALS"],
          },
        },
      };
    } else {
      // FedEx Air/Express hazmat uses DANGEROUS_GOODS with IATA regulation
      return {
        ...pkg,
        packageSpecialServices: {
          specialServiceTypes: ["DANGEROUS_GOODS"],
          dangerousGoodsDetail: {
            accessibility: "ACCESSIBLE",
          },
        },
      };
    }
  });
}

export function buildFedExRateRequest(
  shipperAddress: FedExAddress,
  recipientAddress: FedExAddress,
  packages: FedExPackageLineItem[],
  accountNumber: string,
  shipDate: Date = new Date(),
  hazmatMode: HazmatMode = "none",
): FedExRateRequest {
  const shipDateStamp = shipDate.toISOString().split("T")[0];
  const requestPackages = applyHazmatToPackages(packages, hazmatMode);

  return {
    accountNumber: {
      value: accountNumber,
    },
    rateRequestControlParameters: {
      returnTransitTimes: true,
      servicesNeededOnRateFailure: true,
    },
    requestedShipment: {
      shipper: {
        address: {
          city: shipperAddress.city,
          stateOrProvinceCode: shipperAddress.stateOrProvinceCode,
          postalCode: shipperAddress.postalCode,
          countryCode: shipperAddress.countryCode,
        },
      },
      recipient: {
        address: {
          city: recipientAddress.city,
          stateOrProvinceCode: recipientAddress.stateOrProvinceCode,
          postalCode: recipientAddress.postalCode,
          countryCode: recipientAddress.countryCode,
        },
      },
      shippingChargesPayment: {
        paymentType: "SENDER",
        payor: {
          responsibleParty: {
            accountNumber: {
              value: accountNumber,
            },
          },
        },
      },
      preferredCurrency: "USD",
      shipDateStamp,
      pickupType: "USE_SCHEDULED_PICKUP",
      packagingType: "YOUR_PACKAGING",
      rateRequestType: ["ACCOUNT"],
      requestedPackageLineItems: requestPackages,
    },
  };
}

export async function callFedExRateAPI(
  rateRequest: FedExRateRequest,
  accessToken: string,
  useSandbox: boolean = false,
): Promise<FedExRateResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FEDEX_API_TIMEOUT_MS);
  const rateEndpoint = `${getFedExApiBase(useSandbox)}/rate/v1/rates/quotes`;

  try {
    const response = await fetch(rateEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(rateRequest),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `FedEx Rate API failed: ${response.status} - ${errorText}`,
      );
    }

    return (await response.json()) as FedExRateResponse;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("FedEx Rate API request timed out");
    }
    throw error;
  }
}

export function parseFedExRateResponse(
  response: FedExRateResponse,
  isInternational: boolean,
): ParsedFedExRate[] {
  const rates: ParsedFedExRate[] = [];

  if (!response.output?.rateReplyDetails) {
    console.log("[FedEx] No rateReplyDetails in response");
    return rates;
  }

  const allowedServices = new Set<string>(ALL_ALLOWED_SERVICES);

  // Log all services returned by FedEx for debugging
  const returnedServices = response.output.rateReplyDetails.map(
    (d) => d.serviceType,
  );
  console.log("[FedEx] Services returned by API:", returnedServices.join(", "));

  for (const detail of response.output.rateReplyDetails) {
    if (!allowedServices.has(detail.serviceType)) {
      console.log(
        `[FedEx] Filtering out service: ${detail.serviceType} (not in allowed list)`,
      );
      continue;
    }

    const ratedDetails = detail.ratedShipmentDetails || [];
    // FedEx returns different rate type formats depending on API version/environment
    // Sandbox uses: 'ACCOUNT', 'LIST'
    // Production may use: 'PAYOR_ACCOUNT_PACKAGE', 'PAYOR_LIST_PACKAGE', etc.
    const accountRate = ratedDetails.find(
      (r) =>
        r.rateType === "ACCOUNT" ||
        r.rateType === "PAYOR_ACCOUNT_PACKAGE" ||
        r.rateType === "PAYOR_ACCOUNT_SHIPMENT",
    );
    const listRate = ratedDetails.find(
      (r) =>
        r.rateType === "LIST" ||
        r.rateType === "PAYOR_LIST_PACKAGE" ||
        r.rateType === "PAYOR_LIST_SHIPMENT",
    );

    const selectedRate = accountRate || listRate;
    if (!selectedRate) {
      console.log(
        `[FedEx] Skipping ${detail.serviceType}: no ACCOUNT or LIST rate found`,
      );
      continue;
    }

    // FedEx returns totalNetCharge as either a number or array of {currency, amount}
    let totalChargeCents: number;
    const netCharge = selectedRate.totalNetCharge;
    const fedExCharge = selectedRate.totalNetFedExCharge;

    if (typeof netCharge === "number") {
      totalChargeCents = Math.round(netCharge * 100);
    } else if (typeof fedExCharge === "number") {
      totalChargeCents = Math.round(fedExCharge * 100);
    } else if (Array.isArray(netCharge) && netCharge[0]?.amount) {
      totalChargeCents = Math.round(netCharge[0].amount * 100);
    } else if (Array.isArray(fedExCharge) && fedExCharge[0]?.amount) {
      totalChargeCents = Math.round(fedExCharge[0].amount * 100);
    } else {
      console.log(
        `[FedEx] Skipping ${detail.serviceType}: could not extract charge amount`,
      );
      continue;
    }

    let transitDays = 1;
    let deliveryDate: string | null = null;
    let deliveryTimestamp: string | null = null;
    let deliveryDayOfWeek: string | null = null;

    // Extract delivery date/time from commit.dateDetail (preferred) or fallback sources
    // FedEx API uses different field names: dayFormat or dayCxsFormat
    const dateDetailTimestamp =
      detail.commit?.dateDetail?.dayFormat ||
      detail.commit?.dateDetail?.dayCxsFormat;
    if (dateDetailTimestamp) {
      deliveryTimestamp = dateDetailTimestamp;
      deliveryDayOfWeek = detail.commit?.dateDetail?.dayOfWeek || null;
      deliveryDate = deliveryTimestamp.split("T")[0];
    } else if (detail.commit?.deliveryTimestamp) {
      deliveryTimestamp = detail.commit.deliveryTimestamp;
      deliveryDate = deliveryTimestamp.split("T")[0];
    } else if (detail.operationalDetail?.deliveryDate) {
      deliveryDate = detail.operationalDetail.deliveryDate;
    }

    if (detail.commit?.transitTime) {
      transitDays = parseTransitTime(detail.commit.transitTime);
    } else if (detail.commit?.transitDays?.minimumTransitTime) {
      transitDays = parseTransitTime(
        detail.commit.transitDays.minimumTransitTime,
      );
    } else if (detail.operationalDetail?.transitTime) {
      transitDays = parseTransitTime(detail.operationalDetail.transitTime);
    }

    const serviceName =
      SERVICE_DISPLAY_NAMES[detail.serviceType] ||
      detail.serviceName ||
      detail.serviceType;

    rates.push({
      serviceType: detail.serviceType,
      serviceName,
      totalChargeCents,
      transitDays,
      deliveryDate,
      deliveryTimestamp,
      deliveryDayOfWeek,
    });
  }

  return rates;
}

export function isGroundService(serviceType: string): boolean {
  return GROUND_SERVICE_SET.has(serviceType);
}

const TRANSIT_TIME_WORDS: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  SIX: 6,
  SEVEN: 7,
  EIGHT: 8,
  NINE: 9,
  TEN: 10,
};

function parseTransitTime(transitTime: string): number {
  const digitMatch = transitTime.match(/(\d+)/);
  if (digitMatch) {
    return parseInt(digitMatch[1], 10);
  }

  const upperTime = transitTime.toUpperCase();
  for (const [word, days] of Object.entries(TRANSIT_TIME_WORDS)) {
    if (upperTime.includes(word)) {
      return days;
    }
  }

  return 1;
}
