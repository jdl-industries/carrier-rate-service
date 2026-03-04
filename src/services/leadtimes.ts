import type { ShopifyCartItem } from '../types';

export const DEFAULT_HANDLING_DAYS = 1;

export function parseInStockProperty(value: string | undefined): boolean {
  if (!value) return true; // Default to in stock if not specified
  const lower = value.toLowerCase().trim();
  return lower === 'true' || lower === '1' || lower === 'yes';
}

export function parseLeadTimeProperty(value: string | undefined): number {
  if (!value) return 0;
  const trimmed = value.trim();
  const parsed = parseInt(trimmed, 10);
  return isNaN(parsed) || parsed < 0 ? 0 : parsed;
}

export function getItemHandlingDays(
  item: ShopifyCartItem,
  defaultHandlingDays: number = DEFAULT_HANDLING_DAYS
): number {
  const props = item.properties || {};
  const inStock = parseInStockProperty(props['_in_stock']);
  const leadTime = parseLeadTimeProperty(props['_lead_time']);

  if (inStock) {
    return defaultHandlingDays;
  }

  // Out of stock: default handling + lead time
  return defaultHandlingDays + leadTime;
}

export function getMaxHandlingDays(
  items: ShopifyCartItem[],
  defaultHandlingDays: number = DEFAULT_HANDLING_DAYS
): number {
  if (items.length === 0) {
    return defaultHandlingDays;
  }

  let maxHandlingDays = 0;

  for (const item of items) {
    // Handle quantity - each unit has the same handling time, but we take max across items
    const itemHandlingDays = getItemHandlingDays(item, defaultHandlingDays);
    if (itemHandlingDays > maxHandlingDays) {
      maxHandlingDays = itemHandlingDays;
    }
  }

  return maxHandlingDays || defaultHandlingDays;
}

export function getPriorityHandlingDays(standardHandlingDays: number): number {
  // Priority handling reduces time by 2 days, minimum 1 day
  return Math.max(1, standardHandlingDays - 2);
}

export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function addBusinessDays(startDate: Date, businessDays: number): Date {
  const result = new Date(startDate);
  let daysAdded = 0;

  while (daysAdded < businessDays) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (!isWeekend(result)) {
      daysAdded++;
    }
  }

  return result;
}

export function getNextBusinessDay(date: Date): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + 1);

  while (isWeekend(result)) {
    result.setUTCDate(result.getUTCDate() + 1);
  }

  return result;
}

export function calculateShipDate(handlingDays: number, fromDate: Date = new Date()): Date {
  if (handlingDays <= 0) {
    return getNextBusinessDay(fromDate);
  }

  return addBusinessDays(fromDate, handlingDays);
}

export function calculateDeliveryDate(
  shipDate: Date,
  transitDays: number
): Date {
  if (transitDays <= 0) {
    return shipDate;
  }

  return addBusinessDays(shipDate, transitDays);
}

export function formatDateISO(date: Date): string {
  return date.toISOString().split('T')[0];
}

export interface DeliveryDateResult {
  shipDate: Date;
  deliveryDate: Date;
  minDeliveryDateISO: string;
  maxDeliveryDateISO: string;
}

export function calculateDeliveryDates(
  items: ShopifyCartItem[],
  transitDays: number,
  defaultHandlingDays: number = DEFAULT_HANDLING_DAYS,
  isPriority: boolean = false,
  fromDate: Date = new Date()
): DeliveryDateResult {
  const standardHandlingDays = getMaxHandlingDays(items, defaultHandlingDays);
  const handlingDays = isPriority
    ? getPriorityHandlingDays(standardHandlingDays)
    : standardHandlingDays;

  const shipDate = calculateShipDate(handlingDays, fromDate);
  const deliveryDate = calculateDeliveryDate(shipDate, transitDays);

  const deliveryDateISO = formatDateISO(deliveryDate);

  return {
    shipDate,
    deliveryDate,
    minDeliveryDateISO: deliveryDateISO,
    maxDeliveryDateISO: deliveryDateISO,
  };
}
