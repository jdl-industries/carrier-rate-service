import type { Context } from 'hono';
import type {
  Env,
  ShopifyRateRequest,
  ShopifyRate,
  ShopifyRateResponse,
  BoxConfig,
  ShipperAddress,
  HandlingFees,
  FedExAddress,
  ParsedFedExRate,
  FedExPackageLineItem,
} from '../types';
import {
  KV_KEYS,
  DEFAULT_BOX_CONFIGS,
  DEFAULT_SHIPPER_ADDRESS,
  DEFAULT_HANDLING_FEES,
  DEFAULT_PRIORITY_FEE_CENTS,
} from '../config/constants';
import { determineRoute, hasShippableItems } from '../services/routing';
import { getPackagesForCart } from '../services/packaging';
import {
  getFedExAccessToken,
  buildFedExRateRequest,
  callFedExRateAPI,
  parseFedExRateResponse,
  isGroundService,
} from '../services/fedex';
import {
  calculateDeliveryDates,
  addBusinessDays,
  formatDateISO,
  DEFAULT_HANDLING_DAYS,
} from '../services/leadtimes';

interface KVConfig {
  localDeliveryZips: Set<string>;
  shipperAddress: ShipperAddress;
  boxConfigs: BoxConfig[];
  handlingFees: HandlingFees;
  priorityFeeCents: number;
}

async function loadKVConfig(kv: KVNamespace): Promise<KVConfig> {
  const [
    localZipsJson,
    shipperAddressJson,
    boxSizesJson,
    handlingFeesJson,
    priorityFeeJson,
  ] = await Promise.all([
    kv.get(KV_KEYS.LOCAL_DELIVERY_ZIPS),
    kv.get(KV_KEYS.SHIPPER_ADDRESS),
    kv.get(KV_KEYS.BOX_SIZES),
    kv.get(KV_KEYS.HANDLING_FEES),
    kv.get(KV_KEYS.PRIORITY_FEE),
  ]);

  let localDeliveryZips: Set<string>;
  try {
    const zipsArray = localZipsJson ? JSON.parse(localZipsJson) : [];
    localDeliveryZips = new Set(zipsArray);
  } catch {
    console.warn('Failed to parse local delivery zips, using empty set');
    localDeliveryZips = new Set();
  }

  let shipperAddress: ShipperAddress;
  try {
    shipperAddress = shipperAddressJson
      ? JSON.parse(shipperAddressJson)
      : DEFAULT_SHIPPER_ADDRESS;
  } catch {
    console.warn('Failed to parse shipper address, using default');
    shipperAddress = DEFAULT_SHIPPER_ADDRESS;
  }

  let boxConfigs: BoxConfig[];
  try {
    boxConfigs = boxSizesJson ? JSON.parse(boxSizesJson) : DEFAULT_BOX_CONFIGS;
  } catch {
    console.warn('Failed to parse box sizes, using defaults');
    boxConfigs = DEFAULT_BOX_CONFIGS;
  }

  let handlingFees: HandlingFees;
  try {
    handlingFees = handlingFeesJson
      ? JSON.parse(handlingFeesJson)
      : DEFAULT_HANDLING_FEES;
  } catch {
    console.warn('Failed to parse handling fees, using defaults');
    handlingFees = DEFAULT_HANDLING_FEES;
  }

  let priorityFeeCents: number;
  try {
    priorityFeeCents = priorityFeeJson
      ? parseInt(priorityFeeJson, 10)
      : DEFAULT_PRIORITY_FEE_CENTS;
  } catch {
    console.warn('Failed to parse priority fee, using default');
    priorityFeeCents = DEFAULT_PRIORITY_FEE_CENTS;
  }

  return {
    localDeliveryZips,
    shipperAddress,
    boxConfigs,
    handlingFees,
    priorityFeeCents,
  };
}

function getDefaultHandlingDays(env: Env): number {
  if (env.DEFAULT_HANDLING_DAYS) {
    const parsed = parseInt(env.DEFAULT_HANDLING_DAYS, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_HANDLING_DAYS;
}

function buildLocalDeliveryRate(): ShopifyRate {
  const tomorrow = addBusinessDays(new Date(), 1);
  const deliveryDateISO = formatDateISO(tomorrow);

  return {
    service_name: 'Local Delivery',
    service_code: 'LOCAL_DELIVERY',
    total_price: '0',
    description: 'Free local delivery to Miami-Dade and Broward County',
    currency: 'USD',
    min_delivery_date: deliveryDateISO,
    max_delivery_date: deliveryDateISO,
  };
}

function buildFreightForwardingRate(): ShopifyRate {
  const minDate = addBusinessDays(new Date(), 14);
  const maxDate = addBusinessDays(new Date(), 21);

  return {
    service_name: 'International Freight Forwarding',
    service_code: 'FREIGHT_FORWARDING',
    total_price: '0',
    description: 'Our team will contact you to confirm freight details and final shipping cost',
    currency: 'USD',
    min_delivery_date: formatDateISO(minDate),
    max_delivery_date: formatDateISO(maxDate),
  };
}

function buildRecipientAddress(request: ShopifyRateRequest): FedExAddress {
  const dest = request.rate.destination;
  return {
    streetLines: [dest.address1, dest.address2].filter(Boolean),
    city: dest.city,
    stateOrProvinceCode: dest.province,
    postalCode: dest.postal_code,
    countryCode: dest.country,
  };
}

function fedExRatesToShopifyRates(
  fedExRates: ParsedFedExRate[],
  request: ShopifyRateRequest,
  config: KVConfig,
  defaultHandlingDays: number
): ShopifyRate[] {
  const rates: ShopifyRate[] = [];
  const items = request.rate.items;

  for (const fedExRate of fedExRates) {
    const isGround = isGroundService(fedExRate.serviceType);
    const handlingFee = isGround
      ? config.handlingFees.ground_per_order * 100
      : config.handlingFees.air_per_order * 100;

    const totalPriceCents = fedExRate.totalChargeCents + handlingFee;

    const standardDates = calculateDeliveryDates(
      items,
      fedExRate.transitDays,
      defaultHandlingDays,
      false
    );

    rates.push({
      service_name: fedExRate.serviceName,
      service_code: fedExRate.serviceType,
      total_price: totalPriceCents.toString(),
      currency: 'USD',
      min_delivery_date: standardDates.minDeliveryDateISO,
      max_delivery_date: standardDates.maxDeliveryDateISO,
    });

    const priorityDates = calculateDeliveryDates(
      items,
      fedExRate.transitDays,
      defaultHandlingDays,
      true
    );

    const priorityTotalCents = totalPriceCents + config.priorityFeeCents;

    rates.push({
      service_name: `${fedExRate.serviceName} — Priority Handling`,
      service_code: `${fedExRate.serviceType}_PRIORITY`,
      total_price: priorityTotalCents.toString(),
      description: 'Order moved to front of fulfillment queue — ships within 1 business day',
      currency: 'USD',
      min_delivery_date: priorityDates.minDeliveryDateISO,
      max_delivery_date: priorityDates.maxDeliveryDateISO,
    });
  }

  return rates;
}

const TEST_SKU = 'TEST-SHIPPING';
const TEST_PROPERTY_KEY = '_test_mode';

type TestMode = 'static' | 'dynamic' | false;

function getTestMode(queryParam: string | undefined, items?: ShopifyRateRequest['rate']['items']): TestMode {
  // Check query param first
  if (queryParam === 'true' || queryParam === 'static') {
    return 'static';
  }
  if (queryParam === 'dynamic') {
    return 'dynamic';
  }

  // Check cart items for test triggers
  if (items) {
    for (const item of items) {
      if (item.sku?.toUpperCase() === TEST_SKU) {
        return 'static';
      }
      const testProp = item.properties?.[TEST_PROPERTY_KEY];
      if (testProp === 'true' || testProp === 'static') {
        return 'static';
      }
      if (testProp === 'dynamic') {
        return 'dynamic';
      }
    }
  }

  return false;
}

function generateMockFedExRates(
  packages: FedExPackageLineItem[],
  isInternational: boolean
): ParsedFedExRate[] {
  // Calculate base cost from package weights
  const totalWeightLbs = packages.reduce((sum, pkg) => {
    return sum + (pkg.weight?.value || 10);
  }, 0);

  const rates: ParsedFedExRate[] = [];

  if (isInternational) {
    rates.push({
      serviceType: 'INTERNATIONAL_ECONOMY',
      serviceName: 'FedEx International Economy (MOCK)',
      totalChargeCents: Math.round(4500 + totalWeightLbs * 350),
      transitDays: 5,
      deliveryDate: null,
    });
    rates.push({
      serviceType: 'INTERNATIONAL_PRIORITY',
      serviceName: 'FedEx International Priority (MOCK)',
      totalChargeCents: Math.round(7500 + totalWeightLbs * 500),
      transitDays: 3,
      deliveryDate: null,
    });
  } else {
    // Domestic services
    rates.push({
      serviceType: 'FEDEX_GROUND',
      serviceName: 'FedEx Ground (MOCK)',
      totalChargeCents: Math.round(1200 + totalWeightLbs * 45),
      transitDays: 5,
      deliveryDate: null,
    });
    rates.push({
      serviceType: 'FEDEX_EXPRESS_SAVER',
      serviceName: 'FedEx Express Saver (MOCK)',
      totalChargeCents: Math.round(2800 + totalWeightLbs * 85),
      transitDays: 3,
      deliveryDate: null,
    });
    rates.push({
      serviceType: 'FEDEX_2_DAY',
      serviceName: 'FedEx 2Day (MOCK)',
      totalChargeCents: Math.round(4200 + totalWeightLbs * 120),
      transitDays: 2,
      deliveryDate: null,
    });
    rates.push({
      serviceType: 'PRIORITY_OVERNIGHT',
      serviceName: 'FedEx Priority Overnight (MOCK)',
      totalChargeCents: Math.round(6500 + totalWeightLbs * 180),
      transitDays: 1,
      deliveryDate: null,
    });
  }

  return rates;
}

export function handleTestRateRequest(
  c: Context<{ Bindings: Env }>
): Response {
  const testParam = c.req.query('test');
  const testMode = getTestMode(testParam);

  if (!testMode) {
    return c.json({ error: 'GET only allowed with ?test=true or ?test=static or ?test=dynamic (POST required for dynamic)' }, 405);
  }

  if (testMode === 'dynamic') {
    return c.json({ error: 'Dynamic test mode requires POST with Shopify payload' }, 400);
  }

  console.log('Test mode (GET/static) - returning dummy rates');
  return c.json({ rates: buildTestRates() }, 200);
}

function buildTestRates(): ShopifyRate[] {
  const today = new Date();
  const groundDelivery = addBusinessDays(today, 5);
  const expressDelivery = addBusinessDays(today, 2);
  const overnightDelivery = addBusinessDays(today, 1);

  return [
    {
      service_name: 'FedEx Ground (TEST)',
      service_code: 'FEDEX_GROUND_TEST',
      total_price: '5500',
      description: 'Test rate - not a real quote',
      currency: 'USD',
      min_delivery_date: formatDateISO(groundDelivery),
      max_delivery_date: formatDateISO(groundDelivery),
    },
    {
      service_name: 'FedEx 2Day (TEST)',
      service_code: 'FEDEX_2_DAY_TEST',
      total_price: '17000',
      description: 'Test rate - not a real quote',
      currency: 'USD',
      min_delivery_date: formatDateISO(expressDelivery),
      max_delivery_date: formatDateISO(expressDelivery),
    },
    {
      service_name: 'FedEx Priority Overnight (TEST)',
      service_code: 'PRIORITY_OVERNIGHT_TEST',
      total_price: '21000',
      description: 'Test rate - not a real quote',
      currency: 'USD',
      min_delivery_date: formatDateISO(overnightDelivery),
      max_delivery_date: formatDateISO(overnightDelivery),
    },
  ];
}

export async function handleRateRequest(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  const testParam = c.req.query('test');

  // Check for static test mode via query param (no payload needed)
  if (testParam === 'true' || testParam === 'static') {
    console.log('Test mode (static) - returning dummy rates');
    return c.json({ rates: buildTestRates() }, 200);
  }

  let request: ShopifyRateRequest;

  try {
    request = await c.req.json<ShopifyRateRequest>();
  } catch (error) {
    console.error('Failed to parse request body', error);
    return c.json({ rates: [] }, 200);
  }

  const items = request.rate.items;
  const testMode = getTestMode(testParam, items);

  if (testMode === 'static') {
    console.log('Test mode (static) triggered by cart item');
    console.log('Full Shopify payload:', JSON.stringify(request, null, 2));
    return c.json({ rates: buildTestRates() }, 200);
  }

  const isDynamicTest = testMode === 'dynamic';
  if (isDynamicTest) {
    console.log('Test mode (dynamic) - running full logic with mock FedEx rates');
    console.log('Full Shopify payload:', JSON.stringify(request, null, 2));
  }

  if (!hasShippableItems(items)) {
    return c.json({ rates: [] }, 200);
  }

  let config: KVConfig;
  try {
    config = await loadKVConfig(c.env.JDL_CONFIG);
  } catch (error) {
    console.error('Failed to load KV config', error);
    return c.json({ error: 'Internal server error' }, 500);
  }

  const route = determineRoute(request, config.localDeliveryZips);

  console.log('Rate request routing decision', {
    destinationZip: request.rate.destination.postal_code,
    destinationCountry: request.rate.destination.country,
    itemCount: items.length,
    routeType: route.routeType,
    customerType: route.customerType,
  });

  if (route.routeType === 'local_delivery') {
    const rate = buildLocalDeliveryRate();
    return c.json({ rates: [rate] } as ShopifyRateResponse, 200);
  }

  if (route.routeType === 'freight_forwarding') {
    const rate = buildFreightForwardingRate();
    return c.json({ rates: [rate] } as ShopifyRateResponse, 200);
  }

  try {
    const packages = getPackagesForCart(items, config.boxConfigs);

    if (packages.length === 0) {
      return c.json({ rates: [] }, 200);
    }

    let parsedRates: ParsedFedExRate[];

    if (isDynamicTest) {
      // Dynamic test mode: use mock FedEx rates
      console.log('Using mock FedEx rates', {
        packageCount: packages.length,
        isInternational: route.isInternational,
      });
      parsedRates = generateMockFedExRates(packages, route.isInternational);
    } else {
      // Production mode: call real FedEx API
      const accessToken = await getFedExAccessToken(c.env);

      const recipientAddress = buildRecipientAddress(request);

      const rateRequest = buildFedExRateRequest(
        config.shipperAddress,
        recipientAddress,
        packages,
        c.env.FEDEX_ACCOUNT_NUMBER
      );


      const useSandbox = c.env.FEDEX_SANDBOX === 'true';
      const fedExResponse = await callFedExRateAPI(rateRequest, accessToken, useSandbox);

      if (fedExResponse.errors && fedExResponse.errors.length > 0) {
        console.error('FedEx API returned errors', {
          errors: fedExResponse.errors,
          destinationZip: request.rate.destination.postal_code,
        });
        return c.json({ error: 'FedEx API error' }, 500);
      }

      parsedRates = parseFedExRateResponse(fedExResponse, route.isInternational);
    }

    if (parsedRates.length === 0) {
      console.warn('No valid FedEx rates returned', {
        destinationZip: request.rate.destination.postal_code,
        routeType: route.routeType,
      });
      return c.json({ rates: [] }, 200);
    }

    const defaultHandlingDays = getDefaultHandlingDays(c.env);
    const shopifyRates = fedExRatesToShopifyRates(
      parsedRates,
      request,
      config,
      defaultHandlingDays
    );

    return c.json({ rates: shopifyRates } as ShopifyRateResponse, 200);
  } catch (error) {
    console.error('Failed to get FedEx rates', {
      error: error instanceof Error ? error.message : String(error),
      destinationZip: request.rate.destination.postal_code,
      itemCount: items.length,
    });
    return c.json({ error: 'Failed to retrieve shipping rates' }, 500);
  }
}
