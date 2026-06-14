import { describe, it, expect } from 'vitest';
import {
  generateCreditNote,
  generateTaxInvoice,
  validateProductRestrictions,
  getTaxRatesForCategory,
  buildTaxDetails,
  OrderInfo,
  BuyerDetails,
  TaxDetails,
  ProductInfo,
  BuyerEligibility,
  GSTCreditNote,
  GSTTaxInvoice,
  RestrictionValidationResult,
} from './gstService';

// --- Test Fixtures ---

const mockOrderInfo: OrderInfo = {
  orderId: 'order-001',
  customerId: 'customer-001',
  customerName: 'John Doe',
  customerGstin: '29AABCU9603R1ZM',
  sku: 'SKU-001',
  productCategory: 'electronics',
  price: 10000,
  hsnCode: '8471',
  placedAt: '2024-01-10T10:00:00Z',
};

const mockBuyerDetails: BuyerDetails = {
  buyerId: 'buyer-001',
  name: 'Jane Smith',
  gstin: '27AAPFU0939F1ZV',
  address: {
    line1: '456 Park Ave',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411001',
  },
};

const mockTaxDetails: TaxDetails = {
  gstin: '29AABCU9603R1ZM',
  hsnCode: '8471',
  taxableValue: 10000,
  cgstRate: 9,
  sgstRate: 9,
  igstRate: 0,
};

describe('gstService', () => {
  describe('generateCreditNote()', () => {
    it('should generate a credit note with valid GSTIN, HSN code, taxable value, and tax rates', () => {
      const creditNote = generateCreditNote(mockOrderInfo, mockTaxDetails);

      expect(creditNote.creditNoteId).toMatch(/^CN-/);
      expect(creditNote.originalOrderId).toBe('order-001');
      expect(creditNote.gstin).toBe('29AABCU9603R1ZM');
      expect(creditNote.hsnCode).toBe('8471');
      expect(creditNote.taxableValue).toBe(10000);
      expect(creditNote.cgstRate).toBe(9);
      expect(creditNote.sgstRate).toBe(9);
      expect(creditNote.igstRate).toBe(0);
      expect(creditNote.generatedAt).toBeDefined();
    });

    it('should correctly compute CGST and SGST amounts for intra-state', () => {
      const creditNote = generateCreditNote(mockOrderInfo, mockTaxDetails);

      expect(creditNote.cgstAmount).toBe(900); // 10000 * 9%
      expect(creditNote.sgstAmount).toBe(900); // 10000 * 9%
      expect(creditNote.igstAmount).toBe(0);
      expect(creditNote.totalTaxAmount).toBe(1800);
    });

    it('should correctly compute IGST amount for inter-state', () => {
      const interStateTaxDetails: TaxDetails = {
        gstin: '29AABCU9603R1ZM',
        hsnCode: '8471',
        taxableValue: 10000,
        cgstRate: 0,
        sgstRate: 0,
        igstRate: 18,
      };

      const creditNote = generateCreditNote(mockOrderInfo, interStateTaxDetails);

      expect(creditNote.cgstAmount).toBe(0);
      expect(creditNote.sgstAmount).toBe(0);
      expect(creditNote.igstAmount).toBe(1800); // 10000 * 18%
      expect(creditNote.totalTaxAmount).toBe(1800);
    });

    it('should include the reallocation reason in the credit note', () => {
      const creditNote = generateCreditNote(mockOrderInfo, mockTaxDetails);

      expect(creditNote.reason).toContain('reallocation');
    });

    it('should throw an error if GSTIN is missing', () => {
      const invalidTaxDetails = { ...mockTaxDetails, gstin: '' };

      expect(() => generateCreditNote(mockOrderInfo, invalidTaxDetails)).toThrow(
        'GSTIN is required for credit note generation'
      );
    });

    it('should throw an error if HSN code is missing', () => {
      const invalidTaxDetails = { ...mockTaxDetails, hsnCode: '' };

      expect(() => generateCreditNote(mockOrderInfo, invalidTaxDetails)).toThrow(
        'HSN code is required for credit note generation'
      );
    });

    it('should throw an error if taxable value is zero or negative', () => {
      const invalidTaxDetails = { ...mockTaxDetails, taxableValue: 0 };

      expect(() => generateCreditNote(mockOrderInfo, invalidTaxDetails)).toThrow(
        'Taxable value must be positive'
      );

      const negativeTaxDetails = { ...mockTaxDetails, taxableValue: -100 };

      expect(() => generateCreditNote(mockOrderInfo, negativeTaxDetails)).toThrow(
        'Taxable value must be positive'
      );
    });

    it('should handle fractional tax amounts with proper rounding', () => {
      const fractionalTaxDetails: TaxDetails = {
        gstin: '29AABCU9603R1ZM',
        hsnCode: '8471',
        taxableValue: 999.99,
        cgstRate: 9,
        sgstRate: 9,
        igstRate: 0,
      };

      const creditNote = generateCreditNote(mockOrderInfo, fractionalTaxDetails);

      // 999.99 * 9% = 89.9991 → rounded to 90.00
      expect(creditNote.cgstAmount).toBe(90);
      expect(creditNote.sgstAmount).toBe(90);
      expect(creditNote.totalTaxAmount).toBe(180);
    });
  });

  describe('generateTaxInvoice()', () => {
    it('should generate a tax invoice with valid fields', () => {
      const invoice = generateTaxInvoice('new-order-001', mockBuyerDetails, mockTaxDetails);

      expect(invoice.invoiceId).toMatch(/^INV-/);
      expect(invoice.newOrderId).toBe('new-order-001');
      expect(invoice.buyerGstin).toBe('27AAPFU0939F1ZV');
      expect(invoice.sellerGstin).toBe('29AABCU9603R1ZM');
      expect(invoice.hsnCode).toBe('8471');
      expect(invoice.taxableValue).toBe(10000);
      expect(invoice.generatedAt).toBeDefined();
    });

    it('should compute correct tax amounts and total', () => {
      const invoice = generateTaxInvoice('new-order-001', mockBuyerDetails, mockTaxDetails);

      expect(invoice.cgstAmount).toBe(900);
      expect(invoice.sgstAmount).toBe(900);
      expect(invoice.igstAmount).toBe(0);
      expect(invoice.totalTaxAmount).toBe(1800);
      expect(invoice.totalAmount).toBe(11800); // 10000 + 1800
    });

    it('should use "UNREGISTERED" when buyer has no GSTIN', () => {
      const buyerNoGstin: BuyerDetails = {
        ...mockBuyerDetails,
        gstin: undefined,
      };

      const invoice = generateTaxInvoice('new-order-001', buyerNoGstin, mockTaxDetails);

      expect(invoice.buyerGstin).toBe('UNREGISTERED');
    });

    it('should throw an error if HSN code is missing', () => {
      const invalidTaxDetails = { ...mockTaxDetails, hsnCode: '' };

      expect(() => generateTaxInvoice('new-order-001', mockBuyerDetails, invalidTaxDetails)).toThrow(
        'HSN code is required for invoice generation'
      );
    });

    it('should throw an error if taxable value is zero or negative', () => {
      const invalidTaxDetails = { ...mockTaxDetails, taxableValue: 0 };

      expect(() => generateTaxInvoice('new-order-001', mockBuyerDetails, invalidTaxDetails)).toThrow(
        'Taxable value must be positive'
      );
    });

    it('should compute correct IGST for inter-state transactions', () => {
      const interStateTaxDetails: TaxDetails = {
        gstin: '29AABCU9603R1ZM',
        hsnCode: '8471',
        taxableValue: 5000,
        cgstRate: 0,
        sgstRate: 0,
        igstRate: 18,
      };

      const invoice = generateTaxInvoice('new-order-001', mockBuyerDetails, interStateTaxDetails);

      expect(invoice.cgstAmount).toBe(0);
      expect(invoice.sgstAmount).toBe(0);
      expect(invoice.igstAmount).toBe(900);
      expect(invoice.totalTaxAmount).toBe(900);
      expect(invoice.totalAmount).toBe(5900);
    });
  });

  describe('validateProductRestrictions()', () => {
    it('should return eligible=true when product has no restrictions', () => {
      const product: ProductInfo = {
        sku: 'SKU-001',
        category: 'electronics',
        restrictions: [],
      };

      const buyer: BuyerEligibility = {
        buyerId: 'buyer-001',
        age: 25,
        region: 'Maharashtra',
      };

      const result = validateProductRestrictions(product, buyer);

      expect(result.eligible).toBe(true);
      expect(result.failedRestrictions).toHaveLength(0);
    });

    it('should reject buyer without hazmat license for hazardous product', () => {
      const product: ProductInfo = {
        sku: 'SKU-HAZ',
        category: 'chemicals',
        restrictions: [{ type: 'hazardous' }],
      };

      const buyer: BuyerEligibility = {
        buyerId: 'buyer-001',
        age: 30,
        region: 'Maharashtra',
        hasHazmatLicense: false,
      };

      const result = validateProductRestrictions(product, buyer);

      expect(result.eligible).toBe(false);
      expect(result.failedRestrictions).toHaveLength(1);
      expect(result.failedRestrictions[0].type).toBe('hazardous');
      expect(result.failedRestrictions[0].reason).toContain('hazardous materials');
    });

    it('should allow buyer with hazmat license for hazardous product', () => {
      const product: ProductInfo = {
        sku: 'SKU-HAZ',
        category: 'chemicals',
        restrictions: [{ type: 'hazardous' }],
      };

      const buyer: BuyerEligibility = {
        buyerId: 'buyer-001',
        age: 30,
        region: 'Maharashtra',
        hasHazmatLicense: true,
      };

      const result = validateProductRestrictions(product, buyer);

      expect(result.eligible).toBe(true);
      expect(result.failedRestrictions).toHaveLength(0);
    });

    it('should reject buyer below minimum age for age-restricted product', () => {
      const product: ProductInfo = {
        sku: 'SKU-ALCOHOL',
        category: 'beverages',
        restrictions: [{ type: 'age_restricted', metadata: { minimumAge: 21 } }],
      };

      const buyer: BuyerEligibility = {
        buyerId: 'buyer-001',
        age: 19,
        region: 'Maharashtra',
      };

      const result = validateProductRestrictions(product, buyer);

      expect(result.eligible).toBe(false);
      expect(result.failedRestrictions).toHaveLength(1);
      expect(result.failedRestrictions[0].type).toBe('age_restricted');
      expect(result.failedRestrictions[0].reason).toContain('19');
      expect(result.failedRestrictions[0].reason).toContain('21');
    });

    it('should use default minimum age of 18 when not specified', () => {
      const product: ProductInfo = {
        sku: 'SKU-RESTRICTED',
        category: 'misc',
        restrictions: [{ type: 'age_restricted' }],
      };

      const buyer17: BuyerEligibility = {
        buyerId: 'buyer-001',
        age: 17,
        region: 'Maharashtra',
      };

      const buyer18: BuyerEligibility = {
        buyerId: 'buyer-002',
        age: 18,
        region: 'Maharashtra',
      };

      expect(validateProductRestrictions(product, buyer17).eligible).toBe(false);
      expect(validateProductRestrictions(product, buyer18).eligible).toBe(true);
    });

    it('should reject buyer with unverified age for age-restricted product', () => {
      const product: ProductInfo = {
        sku: 'SKU-RESTRICTED',
        category: 'misc',
        restrictions: [{ type: 'age_restricted', metadata: { minimumAge: 18 } }],
      };

      const buyer: BuyerEligibility = {
        buyerId: 'buyer-001',
        age: undefined,
        region: 'Maharashtra',
      };

      const result = validateProductRestrictions(product, buyer);

      expect(result.eligible).toBe(false);
      expect(result.failedRestrictions[0].reason).toContain('not verified');
    });

    it('should reject buyer in wrong region for region-locked product (allowedRegions)', () => {
      const product: ProductInfo = {
        sku: 'SKU-REGIONAL',
        category: 'food',
        restrictions: [{
          type: 'region_locked',
          metadata: { allowedRegions: ['Maharashtra', 'Karnataka', 'Tamil Nadu'] },
        }],
      };

      const buyer: BuyerEligibility = {
        buyerId: 'buyer-001',
        age: 25,
        region: 'West Bengal',
      };

      const result = validateProductRestrictions(product, buyer);

      expect(result.eligible).toBe(false);
      expect(result.failedRestrictions).toHaveLength(1);
      expect(result.failedRestrictions[0].type).toBe('region_locked');
      expect(result.failedRestrictions[0].reason).toContain('West Bengal');
    });

    it('should allow buyer in correct region for region-locked product (allowedRegions)', () => {
      const product: ProductInfo = {
        sku: 'SKU-REGIONAL',
        category: 'food',
        restrictions: [{
          type: 'region_locked',
          metadata: { allowedRegions: ['Maharashtra', 'Karnataka', 'Tamil Nadu'] },
        }],
      };

      const buyer: BuyerEligibility = {
        buyerId: 'buyer-001',
        age: 25,
        region: 'Maharashtra',
      };

      const result = validateProductRestrictions(product, buyer);

      expect(result.eligible).toBe(true);
    });

    it('should reject buyer in blocked region for region-locked product (blockedRegions)', () => {
      const product: ProductInfo = {
        sku: 'SKU-REGIONAL',
        category: 'food',
        restrictions: [{
          type: 'region_locked',
          metadata: { blockedRegions: ['Jammu & Kashmir', 'Nagaland'] },
        }],
      };

      const buyer: BuyerEligibility = {
        buyerId: 'buyer-001',
        age: 25,
        region: 'Jammu & Kashmir',
      };

      const result = validateProductRestrictions(product, buyer);

      expect(result.eligible).toBe(false);
      expect(result.failedRestrictions[0].reason).toContain('Jammu & Kashmir');
    });

    it('should allow buyer not in blocked region', () => {
      const product: ProductInfo = {
        sku: 'SKU-REGIONAL',
        category: 'food',
        restrictions: [{
          type: 'region_locked',
          metadata: { blockedRegions: ['Jammu & Kashmir', 'Nagaland'] },
        }],
      };

      const buyer: BuyerEligibility = {
        buyerId: 'buyer-001',
        age: 25,
        region: 'Maharashtra',
      };

      const result = validateProductRestrictions(product, buyer);

      expect(result.eligible).toBe(true);
    });

    it('should check multiple restrictions and fail on all that apply', () => {
      const product: ProductInfo = {
        sku: 'SKU-MULTI',
        category: 'chemicals',
        restrictions: [
          { type: 'hazardous' },
          { type: 'age_restricted', metadata: { minimumAge: 21 } },
          { type: 'region_locked', metadata: { allowedRegions: ['Maharashtra'] } },
        ],
      };

      const buyer: BuyerEligibility = {
        buyerId: 'buyer-001',
        age: 19,
        region: 'Karnataka',
        hasHazmatLicense: false,
      };

      const result = validateProductRestrictions(product, buyer);

      expect(result.eligible).toBe(false);
      expect(result.failedRestrictions).toHaveLength(3);
      const types = result.failedRestrictions.map((r) => r.type);
      expect(types).toContain('hazardous');
      expect(types).toContain('age_restricted');
      expect(types).toContain('region_locked');
    });

    it('should pass all restrictions when buyer meets all criteria', () => {
      const product: ProductInfo = {
        sku: 'SKU-MULTI',
        category: 'chemicals',
        restrictions: [
          { type: 'hazardous' },
          { type: 'age_restricted', metadata: { minimumAge: 21 } },
          { type: 'region_locked', metadata: { allowedRegions: ['Maharashtra'] } },
        ],
      };

      const buyer: BuyerEligibility = {
        buyerId: 'buyer-001',
        age: 25,
        region: 'Maharashtra',
        hasHazmatLicense: true,
      };

      const result = validateProductRestrictions(product, buyer);

      expect(result.eligible).toBe(true);
      expect(result.failedRestrictions).toHaveLength(0);
    });
  });

  describe('getTaxRatesForCategory()', () => {
    it('should return intra-state rates (CGST+SGST) when seller and buyer are in same state', () => {
      const rates = getTaxRatesForCategory('electronics', 'Maharashtra', 'Maharashtra');

      expect(rates.cgstRate).toBe(9);
      expect(rates.sgstRate).toBe(9);
      expect(rates.igstRate).toBe(0);
    });

    it('should return inter-state rates (IGST) when seller and buyer are in different states', () => {
      const rates = getTaxRatesForCategory('electronics', 'Karnataka', 'Maharashtra');

      expect(rates.cgstRate).toBe(0);
      expect(rates.sgstRate).toBe(0);
      expect(rates.igstRate).toBe(18);
    });

    it('should return intra-state rates when states are not provided', () => {
      const rates = getTaxRatesForCategory('electronics');

      expect(rates.cgstRate).toBe(9);
      expect(rates.sgstRate).toBe(9);
      expect(rates.igstRate).toBe(0);
    });

    it('should return correct rates for different product categories', () => {
      expect(getTaxRatesForCategory('clothing').cgstRate).toBe(2.5);
      expect(getTaxRatesForCategory('food').cgstRate).toBe(0);
      expect(getTaxRatesForCategory('books').cgstRate).toBe(0);
      expect(getTaxRatesForCategory('pharmaceuticals').cgstRate).toBe(6);
    });

    it('should return default rates for unknown categories', () => {
      const rates = getTaxRatesForCategory('unknown_category');

      expect(rates.cgstRate).toBe(9);
      expect(rates.sgstRate).toBe(9);
      expect(rates.igstRate).toBe(0);
    });

    it('should be case-insensitive for category matching', () => {
      const rates = getTaxRatesForCategory('Electronics');

      expect(rates.cgstRate).toBe(9);
      expect(rates.sgstRate).toBe(9);
    });
  });

  describe('buildTaxDetails()', () => {
    it('should build a complete TaxDetails object with correct rates', () => {
      const details = buildTaxDetails(
        '29AABCU9603R1ZM',
        '8471',
        10000,
        'electronics',
        'Maharashtra',
        'Maharashtra'
      );

      expect(details.gstin).toBe('29AABCU9603R1ZM');
      expect(details.hsnCode).toBe('8471');
      expect(details.taxableValue).toBe(10000);
      expect(details.cgstRate).toBe(9);
      expect(details.sgstRate).toBe(9);
      expect(details.igstRate).toBe(0);
    });

    it('should build inter-state tax details when states differ', () => {
      const details = buildTaxDetails(
        '29AABCU9603R1ZM',
        '8471',
        10000,
        'electronics',
        'Karnataka',
        'Maharashtra'
      );

      expect(details.cgstRate).toBe(0);
      expect(details.sgstRate).toBe(0);
      expect(details.igstRate).toBe(18);
    });
  });
});
