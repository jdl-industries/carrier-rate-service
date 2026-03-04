import { describe, it, expect } from 'vitest';
import {
  parseInStockProperty,
  parseLeadTimeProperty,
  getItemHandlingDays,
  getMaxHandlingDays,
  getPriorityHandlingDays,
  isWeekend,
  addBusinessDays,
  getNextBusinessDay,
  calculateShipDate,
  calculateDeliveryDate,
  formatDateISO,
  calculateDeliveryDates,
  DEFAULT_HANDLING_DAYS,
} from './leadtimes';
import type { ShopifyCartItem } from '../types';

function createCartItem(
  properties: Record<string, string> = {}
): ShopifyCartItem {
  return {
    name: 'Test Product',
    sku: 'TEST-SKU',
    quantity: 1,
    grams: 1000,
    price: 5000,
    vendor: 'JDL',
    requires_shipping: true,
    taxable: true,
    fulfillment_service: 'manual',
    properties,
    product_id: 12345,
    variant_id: 67890,
  };
}

describe('parseInStockProperty', () => {
  it('returns true when undefined', () => {
    expect(parseInStockProperty(undefined)).toBe(true);
  });

  it('returns true for "true"', () => {
    expect(parseInStockProperty('true')).toBe(true);
    expect(parseInStockProperty('True')).toBe(true);
    expect(parseInStockProperty('TRUE')).toBe(true);
  });

  it('returns true for "1"', () => {
    expect(parseInStockProperty('1')).toBe(true);
  });

  it('returns true for "yes"', () => {
    expect(parseInStockProperty('yes')).toBe(true);
    expect(parseInStockProperty('Yes')).toBe(true);
  });

  it('returns false for "false"', () => {
    expect(parseInStockProperty('false')).toBe(false);
    expect(parseInStockProperty('False')).toBe(false);
  });

  it('returns false for "0"', () => {
    expect(parseInStockProperty('0')).toBe(false);
  });

  it('returns false for other values', () => {
    expect(parseInStockProperty('no')).toBe(false);
    expect(parseInStockProperty('random')).toBe(false);
  });

  it('handles whitespace', () => {
    expect(parseInStockProperty(' true ')).toBe(true);
    expect(parseInStockProperty(' false ')).toBe(false);
  });
});

describe('parseLeadTimeProperty', () => {
  it('returns 0 when undefined', () => {
    expect(parseLeadTimeProperty(undefined)).toBe(0);
  });

  it('parses integer values', () => {
    expect(parseLeadTimeProperty('5')).toBe(5);
    expect(parseLeadTimeProperty('14')).toBe(14);
  });

  it('returns 0 for negative values', () => {
    expect(parseLeadTimeProperty('-5')).toBe(0);
  });

  it('returns 0 for non-numeric values', () => {
    expect(parseLeadTimeProperty('invalid')).toBe(0);
    expect(parseLeadTimeProperty('abc')).toBe(0);
  });

  it('handles whitespace', () => {
    expect(parseLeadTimeProperty(' 7 ')).toBe(7);
  });
});

describe('getItemHandlingDays', () => {
  it('returns default handling days when in stock', () => {
    const item = createCartItem({ '_in_stock': 'true' });
    expect(getItemHandlingDays(item, 1)).toBe(1);
  });

  it('returns default handling days when no properties', () => {
    const item = createCartItem({});
    expect(getItemHandlingDays(item, 1)).toBe(1);
  });

  it('adds lead time when out of stock', () => {
    const item = createCartItem({
      '_in_stock': 'false',
      '_lead_time': '5',
    });
    expect(getItemHandlingDays(item, 1)).toBe(6); // 1 + 5
  });

  it('uses custom default handling days', () => {
    const item = createCartItem({ '_in_stock': 'true' });
    expect(getItemHandlingDays(item, 3)).toBe(3);
  });

  it('adds lead time to custom default when out of stock', () => {
    const item = createCartItem({
      '_in_stock': 'false',
      '_lead_time': '10',
    });
    expect(getItemHandlingDays(item, 2)).toBe(12); // 2 + 10
  });

  it('returns default when out of stock but no lead time', () => {
    const item = createCartItem({ '_in_stock': 'false' });
    expect(getItemHandlingDays(item, 1)).toBe(1); // 1 + 0
  });
});

describe('getMaxHandlingDays', () => {
  it('returns default for empty array', () => {
    expect(getMaxHandlingDays([], 1)).toBe(1);
  });

  it('returns max handling days across items', () => {
    const items = [
      createCartItem({ '_in_stock': 'true' }), // 1 day
      createCartItem({ '_in_stock': 'false', '_lead_time': '5' }), // 6 days
      createCartItem({ '_in_stock': 'false', '_lead_time': '3' }), // 4 days
    ];
    expect(getMaxHandlingDays(items, 1)).toBe(6);
  });

  it('uses custom default handling days', () => {
    const items = [createCartItem({ '_in_stock': 'true' })];
    expect(getMaxHandlingDays(items, 3)).toBe(3);
  });
});

describe('getPriorityHandlingDays', () => {
  it('reduces handling days by 2', () => {
    expect(getPriorityHandlingDays(5)).toBe(3);
  });

  it('caps minimum at 1 day', () => {
    expect(getPriorityHandlingDays(1)).toBe(1);
    expect(getPriorityHandlingDays(2)).toBe(1);
  });

  it('returns 1 for 3 day handling', () => {
    expect(getPriorityHandlingDays(3)).toBe(1);
  });

  it('handles large handling times', () => {
    expect(getPriorityHandlingDays(14)).toBe(12);
  });
});

describe('isWeekend', () => {
  it('returns true for Saturday', () => {
    const saturday = new Date('2024-01-06T00:00:00Z');
    expect(isWeekend(saturday)).toBe(true);
  });

  it('returns true for Sunday', () => {
    const sunday = new Date('2024-01-07T00:00:00Z');
    expect(isWeekend(sunday)).toBe(true);
  });

  it('returns false for Monday', () => {
    const monday = new Date('2024-01-08T00:00:00Z');
    expect(isWeekend(monday)).toBe(false);
  });

  it('returns false for Friday', () => {
    const friday = new Date('2024-01-05T00:00:00Z');
    expect(isWeekend(friday)).toBe(false);
  });
});

describe('addBusinessDays', () => {
  it('adds business days skipping weekends', () => {
    const friday = new Date('2024-01-05T00:00:00Z');
    const result = addBusinessDays(friday, 1);
    expect(result.toISOString().split('T')[0]).toBe('2024-01-08');
  });

  it('adds multiple business days', () => {
    const monday = new Date('2024-01-08T00:00:00Z');
    const result = addBusinessDays(monday, 5);
    expect(result.toISOString().split('T')[0]).toBe('2024-01-15');
  });

  it('handles starting on weekend', () => {
    const saturday = new Date('2024-01-06T00:00:00Z');
    const result = addBusinessDays(saturday, 1);
    expect(result.toISOString().split('T')[0]).toBe('2024-01-08');
  });
});

describe('getNextBusinessDay', () => {
  it('returns Monday for Friday', () => {
    const friday = new Date('2024-01-05T00:00:00Z');
    const result = getNextBusinessDay(friday);
    expect(result.toISOString().split('T')[0]).toBe('2024-01-08');
  });

  it('returns Monday for Saturday', () => {
    const saturday = new Date('2024-01-06T00:00:00Z');
    const result = getNextBusinessDay(saturday);
    expect(result.toISOString().split('T')[0]).toBe('2024-01-08');
  });

  it('returns Monday for Sunday', () => {
    const sunday = new Date('2024-01-07T00:00:00Z');
    const result = getNextBusinessDay(sunday);
    expect(result.toISOString().split('T')[0]).toBe('2024-01-08');
  });

  it('returns next day for weekday', () => {
    const wednesday = new Date('2024-01-10T00:00:00Z');
    const result = getNextBusinessDay(wednesday);
    expect(result.toISOString().split('T')[0]).toBe('2024-01-11');
  });
});

describe('calculateShipDate', () => {
  it('returns next business day for 0 handling days', () => {
    const monday = new Date('2024-01-08T00:00:00Z');
    const result = calculateShipDate(0, monday);
    expect(result.toISOString().split('T')[0]).toBe('2024-01-09');
  });

  it('calculates ship date with handling time', () => {
    const monday = new Date('2024-01-08T00:00:00Z');
    const result = calculateShipDate(3, monday);
    expect(result.toISOString().split('T')[0]).toBe('2024-01-11');
  });
});

describe('calculateDeliveryDate', () => {
  it('returns ship date for 0 transit days', () => {
    const shipDate = new Date('2024-01-10T00:00:00Z');
    const result = calculateDeliveryDate(shipDate, 0);
    expect(result.toISOString().split('T')[0]).toBe('2024-01-10');
  });

  it('adds transit days skipping weekends', () => {
    const friday = new Date('2024-01-12T00:00:00Z');
    const result = calculateDeliveryDate(friday, 2);
    expect(result.toISOString().split('T')[0]).toBe('2024-01-16');
  });
});

describe('formatDateISO', () => {
  it('formats date as YYYY-MM-DD', () => {
    const date = new Date('2024-01-15T12:00:00Z');
    expect(formatDateISO(date)).toBe('2024-01-15');
  });
});

describe('calculateDeliveryDates', () => {
  it('calculates standard delivery dates for in-stock items', () => {
    const items = [createCartItem({ '_in_stock': 'true' })];
    const fromDate = new Date('2024-01-08T00:00:00Z');
    const result = calculateDeliveryDates(items, 2, 1, false, fromDate);

    // 1 handling day + 2 transit days = delivery on Jan 11
    expect(result.shipDate.toISOString().split('T')[0]).toBe('2024-01-09');
    expect(result.deliveryDate.toISOString().split('T')[0]).toBe('2024-01-11');
  });

  it('calculates delivery dates for out-of-stock items with lead time', () => {
    const items = [
      createCartItem({
        '_in_stock': 'false',
        '_lead_time': '5',
      }),
    ];
    const fromDate = new Date('2024-01-08T00:00:00Z');
    const result = calculateDeliveryDates(items, 2, 1, false, fromDate);

    // 1 handling + 5 lead time = 6 handling days + 2 transit
    expect(result.shipDate.toISOString().split('T')[0]).toBe('2024-01-16');
    expect(result.deliveryDate.toISOString().split('T')[0]).toBe('2024-01-18');
  });

  it('calculates priority delivery dates with reduced handling time', () => {
    const items = [
      createCartItem({
        '_in_stock': 'false',
        '_lead_time': '5',
      }),
    ];
    const fromDate = new Date('2024-01-08T00:00:00Z');
    const result = calculateDeliveryDates(items, 2, 1, true, fromDate);

    // Priority: max(1, 6 - 2) = 4 handling days + 2 transit
    expect(result.shipDate.toISOString().split('T')[0]).toBe('2024-01-12');
    expect(result.deliveryDate.toISOString().split('T')[0]).toBe('2024-01-16');
  });

  it('uses max handling days across all items', () => {
    const items = [
      createCartItem({ '_in_stock': 'true' }), // 1 day
      createCartItem({ '_in_stock': 'false', '_lead_time': '7' }), // 8 days
    ];
    const fromDate = new Date('2024-01-08T00:00:00Z');
    const result = calculateDeliveryDates(items, 1, 1, false, fromDate);

    // Max is 8 handling days + 1 transit
    expect(result.shipDate.toISOString().split('T')[0]).toBe('2024-01-18');
    expect(result.deliveryDate.toISOString().split('T')[0]).toBe('2024-01-19');
  });

  it('returns ISO formatted dates', () => {
    const items = [createCartItem({ '_in_stock': 'true' })];
    const fromDate = new Date('2024-01-08T00:00:00Z');
    const result = calculateDeliveryDates(items, 1, 1, false, fromDate);

    expect(result.minDeliveryDateISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.maxDeliveryDateISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.minDeliveryDateISO).toBe(result.maxDeliveryDateISO);
  });
});

describe('DEFAULT_HANDLING_DAYS', () => {
  it('is set to 1', () => {
    expect(DEFAULT_HANDLING_DAYS).toBe(1);
  });
});
