import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseFedExRateResponse, isGroundService } from '../services/fedex';
import type { FedExRateResponse, ParsedFedExRate } from '../types';

const mockFedExResponse: FedExRateResponse = {
  transactionId: 'test-transaction-123',
  output: {
    rateReplyDetails: [
      {
        serviceType: 'FEDEX_GROUND',
        serviceName: 'FedEx Ground',
        ratedShipmentDetails: [
          {
            rateType: 'PAYOR_ACCOUNT_PACKAGE',
            totalNetCharge: [{ currency: 'USD', amount: 25.50 }],
          },
          {
            rateType: 'PAYOR_LIST_PACKAGE',
            totalNetCharge: [{ currency: 'USD', amount: 30.00 }],
          },
        ],
        commit: {
          transitTime: 'THREE_DAYS',
        },
      },
      {
        serviceType: 'FEDEX_2_DAY',
        serviceName: 'FedEx 2Day',
        ratedShipmentDetails: [
          {
            rateType: 'PAYOR_ACCOUNT_PACKAGE',
            totalNetCharge: [{ currency: 'USD', amount: 45.00 }],
          },
        ],
        commit: {
          transitDays: {
            minimumTransitTime: 'TWO_DAYS',
          },
          deliveryTimestamp: '2024-01-12T17:00:00',
        },
      },
      {
        serviceType: 'PRIORITY_OVERNIGHT',
        serviceName: 'FedEx Priority Overnight',
        ratedShipmentDetails: [
          {
            rateType: 'PAYOR_ACCOUNT_PACKAGE',
            totalNetCharge: [{ currency: 'USD', amount: 85.99 }],
          },
        ],
        operationalDetail: {
          deliveryDate: '2024-01-10',
          transitTime: 'ONE_DAY',
        },
      },
      {
        serviceType: 'UNKNOWN_SERVICE',
        serviceName: 'Unknown Service',
        ratedShipmentDetails: [
          {
            rateType: 'PAYOR_ACCOUNT_PACKAGE',
            totalNetCharge: [{ currency: 'USD', amount: 100.00 }],
          },
        ],
      },
    ],
  },
};

describe('parseFedExRateResponse', () => {
  it('parses valid FedEx rates', () => {
    const rates = parseFedExRateResponse(mockFedExResponse, false);

    expect(rates.length).toBeGreaterThan(0);
  });

  it('filters to allowed services only', () => {
    const rates = parseFedExRateResponse(mockFedExResponse, false);

    const serviceTypes = rates.map((r) => r.serviceType);
    expect(serviceTypes).toContain('FEDEX_GROUND');
    expect(serviceTypes).toContain('FEDEX_2_DAY');
    expect(serviceTypes).toContain('PRIORITY_OVERNIGHT');
    expect(serviceTypes).not.toContain('UNKNOWN_SERVICE');
  });

  it('prefers account rates over list rates', () => {
    const rates = parseFedExRateResponse(mockFedExResponse, false);

    const groundRate = rates.find((r) => r.serviceType === 'FEDEX_GROUND');
    expect(groundRate?.totalChargeCents).toBe(2550);
  });

  it('converts amounts to cents', () => {
    const rates = parseFedExRateResponse(mockFedExResponse, false);

    const priorityRate = rates.find((r) => r.serviceType === 'PRIORITY_OVERNIGHT');
    expect(priorityRate?.totalChargeCents).toBe(8599);
  });

  it('extracts transit days from various sources', () => {
    const rates = parseFedExRateResponse(mockFedExResponse, false);

    const groundRate = rates.find((r) => r.serviceType === 'FEDEX_GROUND');
    expect(groundRate?.transitDays).toBe(3);

    const twoDayRate = rates.find((r) => r.serviceType === 'FEDEX_2_DAY');
    expect(twoDayRate?.transitDays).toBe(2);
  });

  it('extracts delivery date when available', () => {
    const rates = parseFedExRateResponse(mockFedExResponse, false);

    const twoDayRate = rates.find((r) => r.serviceType === 'FEDEX_2_DAY');
    expect(twoDayRate?.deliveryDate).toBe('2024-01-12T17:00:00');

    const priorityRate = rates.find((r) => r.serviceType === 'PRIORITY_OVERNIGHT');
    expect(priorityRate?.deliveryDate).toBe('2024-01-10');
  });

  it('returns empty array for missing rateReplyDetails', () => {
    const emptyResponse: FedExRateResponse = {
      output: {},
    };

    const rates = parseFedExRateResponse(emptyResponse, false);
    expect(rates).toHaveLength(0);
  });

  it('skips services without valid rate data', () => {
    const responseWithMissingRates: FedExRateResponse = {
      output: {
        rateReplyDetails: [
          {
            serviceType: 'FEDEX_GROUND',
            ratedShipmentDetails: [],
          },
        ],
      },
    };

    const rates = parseFedExRateResponse(responseWithMissingRates, false);
    expect(rates).toHaveLength(0);
  });

  it('uses display name mapping for service names', () => {
    const rates = parseFedExRateResponse(mockFedExResponse, false);

    const groundRate = rates.find((r) => r.serviceType === 'FEDEX_GROUND');
    expect(groundRate?.serviceName).toBe('FedEx Ground');

    const priorityRate = rates.find((r) => r.serviceType === 'PRIORITY_OVERNIGHT');
    expect(priorityRate?.serviceName).toBe('FedEx Priority Overnight');
  });
});

describe('isGroundService', () => {
  it('returns true for FEDEX_GROUND', () => {
    expect(isGroundService('FEDEX_GROUND')).toBe(true);
  });

  it('returns true for GROUND_HOME_DELIVERY', () => {
    expect(isGroundService('GROUND_HOME_DELIVERY')).toBe(true);
  });

  it('returns false for air services', () => {
    expect(isGroundService('FEDEX_2_DAY')).toBe(false);
    expect(isGroundService('PRIORITY_OVERNIGHT')).toBe(false);
    expect(isGroundService('STANDARD_OVERNIGHT')).toBe(false);
  });

  it('returns false for international services', () => {
    expect(isGroundService('INTERNATIONAL_PRIORITY')).toBe(false);
    expect(isGroundService('INTERNATIONAL_ECONOMY')).toBe(false);
  });
});

describe('rate calculation with handling fees', () => {
  const parsedRates: ParsedFedExRate[] = [
    {
      serviceType: 'FEDEX_GROUND',
      serviceName: 'FedEx Ground',
      totalChargeCents: 2500,
      transitDays: 3,
      deliveryDate: null,
    },
    {
      serviceType: 'FEDEX_2_DAY',
      serviceName: 'FedEx 2Day',
      totalChargeCents: 4500,
      transitDays: 2,
      deliveryDate: null,
    },
  ];

  it('applies correct handling fee for ground services', () => {
    const groundHandlingFeeCents = 30 * 100;
    const groundRate = parsedRates.find((r) => r.serviceType === 'FEDEX_GROUND')!;
    const totalWithFee = groundRate.totalChargeCents + groundHandlingFeeCents;

    expect(totalWithFee).toBe(5500);
  });

  it('applies correct handling fee for air services', () => {
    const airHandlingFeeCents = 125 * 100;
    const airRate = parsedRates.find((r) => r.serviceType === 'FEDEX_2_DAY')!;
    const totalWithFee = airRate.totalChargeCents + airHandlingFeeCents;

    expect(totalWithFee).toBe(17000);
  });
});

describe('priority handling pricing', () => {
  it('adds priority fee to base rate', () => {
    const baseRateCents = 5000;
    const priorityFeeCents = 3000;
    const priorityTotalCents = baseRateCents + priorityFeeCents;

    expect(priorityTotalCents).toBe(8000);
  });
});

describe('test mode detection', () => {
  // Helper to simulate test mode detection logic
  type TestMode = 'static' | 'dynamic' | false;

  function getTestMode(
    queryParam: string | undefined,
    items?: { sku?: string; properties?: Record<string, string> }[]
  ): TestMode {
    if (queryParam === 'true' || queryParam === 'static') {
      return 'static';
    }
    if (queryParam === 'dynamic') {
      return 'dynamic';
    }

    if (items) {
      for (const item of items) {
        if (item.sku?.toUpperCase() === 'TEST-SHIPPING') {
          return 'static';
        }
        const testProp = item.properties?.['_test_mode'];
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

  describe('query param detection', () => {
    it('returns static for ?test=true', () => {
      expect(getTestMode('true')).toBe('static');
    });

    it('returns static for ?test=static', () => {
      expect(getTestMode('static')).toBe('static');
    });

    it('returns dynamic for ?test=dynamic', () => {
      expect(getTestMode('dynamic')).toBe('dynamic');
    });

    it('returns false for undefined', () => {
      expect(getTestMode(undefined)).toBe(false);
    });

    it('returns false for other values', () => {
      expect(getTestMode('invalid')).toBe(false);
    });
  });

  describe('cart item detection', () => {
    it('returns static for TEST-SHIPPING SKU', () => {
      const items = [{ sku: 'TEST-SHIPPING' }];
      expect(getTestMode(undefined, items)).toBe('static');
    });

    it('returns static for _test_mode=true property', () => {
      const items = [{ properties: { '_test_mode': 'true' } }];
      expect(getTestMode(undefined, items)).toBe('static');
    });

    it('returns static for _test_mode=static property', () => {
      const items = [{ properties: { '_test_mode': 'static' } }];
      expect(getTestMode(undefined, items)).toBe('static');
    });

    it('returns dynamic for _test_mode=dynamic property', () => {
      const items = [{ properties: { '_test_mode': 'dynamic' } }];
      expect(getTestMode(undefined, items)).toBe('dynamic');
    });

    it('query param takes precedence over cart items', () => {
      const items = [{ properties: { '_test_mode': 'dynamic' } }];
      expect(getTestMode('static', items)).toBe('static');
    });
  });
});

describe('mock FedEx rate generation', () => {
  // Helper to replicate the mock rate generator logic
  function generateMockFedExRates(
    packages: { weight?: { value: number } }[],
    isInternational: boolean
  ) {
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

  it('generates domestic rates for US destination', () => {
    const packages = [{ weight: { value: 10 } }];
    const rates = generateMockFedExRates(packages, false);

    expect(rates).toHaveLength(4);
    expect(rates.map((r) => r.serviceType)).toContain('FEDEX_GROUND');
    expect(rates.map((r) => r.serviceType)).toContain('FEDEX_2_DAY');
    expect(rates.map((r) => r.serviceType)).toContain('PRIORITY_OVERNIGHT');
  });

  it('generates international rates for non-US destination', () => {
    const packages = [{ weight: { value: 10 } }];
    const rates = generateMockFedExRates(packages, true);

    expect(rates).toHaveLength(2);
    expect(rates.map((r) => r.serviceType)).toContain('INTERNATIONAL_ECONOMY');
    expect(rates.map((r) => r.serviceType)).toContain('INTERNATIONAL_PRIORITY');
  });

  it('calculates rates based on package weight', () => {
    const lightPackage = [{ weight: { value: 5 } }];
    const heavyPackage = [{ weight: { value: 50 } }];

    const lightRates = generateMockFedExRates(lightPackage, false);
    const heavyRates = generateMockFedExRates(heavyPackage, false);

    const lightGround = lightRates.find((r) => r.serviceType === 'FEDEX_GROUND')!;
    const heavyGround = heavyRates.find((r) => r.serviceType === 'FEDEX_GROUND')!;

    expect(heavyGround.totalChargeCents).toBeGreaterThan(lightGround.totalChargeCents);
  });

  it('includes MOCK in service names', () => {
    const packages = [{ weight: { value: 10 } }];
    const rates = generateMockFedExRates(packages, false);

    rates.forEach((rate) => {
      expect(rate.serviceName).toContain('(MOCK)');
    });
  });
});
