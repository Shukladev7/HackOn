import { v4 as uuidv4 } from 'uuid';

// --- Interfaces ---

export interface TaxDetails {
  gstin: string;
  hsnCode: string;
  taxableValue: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
}

export interface OrderInfo {
  orderId: string;
  customerId: string;
  customerName: string;
  customerGstin?: string;
  sku: string;
  productCategory: string;
  price: number;
  hsnCode: string;
  placedAt: string;
}

export interface BuyerDetails {
  buyerId: string;
  name: string;
  gstin?: string;
  address: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
  };
}

export interface GSTCreditNote {
  creditNoteId: string;
  originalOrderId: string;
  gstin: string;
  hsnCode: string;
  taxableValue: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  totalTaxAmount: number;
  reason: string;
  generatedAt: string;
}

export interface GSTTaxInvoice {
  invoiceId: string;
  newOrderId: string;
  buyerGstin: string;
  sellerGstin: string;
  hsnCode: string;
  taxableValue: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  totalTaxAmount: number;
  totalAmount: number;
  generatedAt: string;
}

export type ProductRestrictionType = 'hazardous' | 'age_restricted' | 'region_locked';

export interface ProductRestriction {
  type: ProductRestrictionType;
  metadata?: {
    minimumAge?: number;
    allowedRegions?: string[];
    blockedRegions?: string[];
    requiresLicense?: boolean;
  };
}

export interface ProductInfo {
  sku: string;
  category: string;
  restrictions: ProductRestriction[];
}

export interface BuyerEligibility {
  buyerId: string;
  age?: number;
  region: string;
  hasHazmatLicense?: boolean;
}

export interface RestrictionValidationResult {
  eligible: boolean;
  failedRestrictions: {
    type: ProductRestrictionType;
    reason: string;
  }[];
}

// --- Constants ---

// Default seller GSTIN for the platform (configurable in production)
const PLATFORM_GSTIN = '29AABCU9603R1ZM';

// Default GST rates by product category (simplified for MVP)
const DEFAULT_TAX_RATES: Record<string, { cgst: number; sgst: number; igst: number }> = {
  electronics: { cgst: 9, sgst: 9, igst: 18 },
  clothing: { cgst: 2.5, sgst: 2.5, igst: 5 },
  food: { cgst: 0, sgst: 0, igst: 0 },
  furniture: { cgst: 9, sgst: 9, igst: 18 },
  books: { cgst: 0, sgst: 0, igst: 0 },
  cosmetics: { cgst: 9, sgst: 9, igst: 18 },
  pharmaceuticals: { cgst: 6, sgst: 6, igst: 12 },
  default: { cgst: 9, sgst: 9, igst: 18 },
};

// --- GST Credit Note Generation ---

/**
 * Generates a GST credit note for the original order when reallocation transfers ownership.
 * Contains valid GSTIN, HSN code, taxable value, and applicable tax rates as per Indian GST Act.
 */
export function generateCreditNote(
  originalOrder: OrderInfo,
  taxDetails: TaxDetails
): GSTCreditNote {
  if (!taxDetails.gstin) {
    throw new Error('GSTIN is required for credit note generation');
  }
  if (!taxDetails.hsnCode) {
    throw new Error('HSN code is required for credit note generation');
  }
  if (taxDetails.taxableValue <= 0) {
    throw new Error('Taxable value must be positive');
  }

  const cgstAmount = roundToTwo((taxDetails.taxableValue * taxDetails.cgstRate) / 100);
  const sgstAmount = roundToTwo((taxDetails.taxableValue * taxDetails.sgstRate) / 100);
  const igstAmount = roundToTwo((taxDetails.taxableValue * taxDetails.igstRate) / 100);
  const totalTaxAmount = roundToTwo(cgstAmount + sgstAmount + igstAmount);

  return {
    creditNoteId: `CN-${uuidv4().substring(0, 8).toUpperCase()}`,
    originalOrderId: originalOrder.orderId,
    gstin: taxDetails.gstin,
    hsnCode: taxDetails.hsnCode,
    taxableValue: taxDetails.taxableValue,
    cgstRate: taxDetails.cgstRate,
    cgstAmount,
    sgstRate: taxDetails.sgstRate,
    sgstAmount,
    igstRate: taxDetails.igstRate,
    igstAmount,
    totalTaxAmount,
    reason: 'Order reallocation - package redirected to new buyer',
    generatedAt: new Date().toISOString(),
  };
}

// --- GST Tax Invoice Generation ---

/**
 * Generates a new GST tax invoice for the new buyer when reallocation is executed.
 * Contains valid GSTIN, HSN code, taxable value, and applicable tax rates.
 */
export function generateTaxInvoice(
  newOrderId: string,
  buyerDetails: BuyerDetails,
  taxDetails: TaxDetails
): GSTTaxInvoice {
  if (!taxDetails.hsnCode) {
    throw new Error('HSN code is required for invoice generation');
  }
  if (taxDetails.taxableValue <= 0) {
    throw new Error('Taxable value must be positive');
  }

  const buyerGstin = buyerDetails.gstin || 'UNREGISTERED';

  const cgstAmount = roundToTwo((taxDetails.taxableValue * taxDetails.cgstRate) / 100);
  const sgstAmount = roundToTwo((taxDetails.taxableValue * taxDetails.sgstRate) / 100);
  const igstAmount = roundToTwo((taxDetails.taxableValue * taxDetails.igstRate) / 100);
  const totalTaxAmount = roundToTwo(cgstAmount + sgstAmount + igstAmount);
  const totalAmount = roundToTwo(taxDetails.taxableValue + totalTaxAmount);

  return {
    invoiceId: `INV-${uuidv4().substring(0, 8).toUpperCase()}`,
    newOrderId,
    buyerGstin,
    sellerGstin: taxDetails.gstin,
    hsnCode: taxDetails.hsnCode,
    taxableValue: taxDetails.taxableValue,
    cgstRate: taxDetails.cgstRate,
    cgstAmount,
    sgstRate: taxDetails.sgstRate,
    sgstAmount,
    igstRate: taxDetails.igstRate,
    igstAmount,
    totalTaxAmount,
    totalAmount,
    generatedAt: new Date().toISOString(),
  };
}

// --- Product Restriction Validation ---

/**
 * Validates product-specific restrictions against buyer eligibility.
 * Checks hazardous goods, age-restricted items, and region-locked products.
 * Returns whether the buyer is eligible and which restrictions failed.
 */
export function validateProductRestrictions(
  product: ProductInfo,
  buyer: BuyerEligibility
): RestrictionValidationResult {
  const failedRestrictions: RestrictionValidationResult['failedRestrictions'] = [];

  for (const restriction of product.restrictions) {
    switch (restriction.type) {
      case 'hazardous': {
        if (!buyer.hasHazmatLicense) {
          failedRestrictions.push({
            type: 'hazardous',
            reason: 'Buyer does not have hazardous materials handling license',
          });
        }
        break;
      }

      case 'age_restricted': {
        const minimumAge = restriction.metadata?.minimumAge ?? 18;
        if (buyer.age === undefined || buyer.age < minimumAge) {
          failedRestrictions.push({
            type: 'age_restricted',
            reason: buyer.age === undefined
              ? 'Buyer age is not verified'
              : `Buyer age (${buyer.age}) is below minimum required age (${minimumAge})`,
          });
        }
        break;
      }

      case 'region_locked': {
        const allowedRegions = restriction.metadata?.allowedRegions;
        const blockedRegions = restriction.metadata?.blockedRegions;

        if (allowedRegions && allowedRegions.length > 0) {
          if (!allowedRegions.includes(buyer.region)) {
            failedRestrictions.push({
              type: 'region_locked',
              reason: `Buyer region (${buyer.region}) is not in allowed regions: ${allowedRegions.join(', ')}`,
            });
          }
        } else if (blockedRegions && blockedRegions.length > 0) {
          if (blockedRegions.includes(buyer.region)) {
            failedRestrictions.push({
              type: 'region_locked',
              reason: `Buyer region (${buyer.region}) is in blocked regions: ${blockedRegions.join(', ')}`,
            });
          }
        }
        break;
      }
    }
  }

  return {
    eligible: failedRestrictions.length === 0,
    failedRestrictions,
  };
}

// --- Helper: Get Tax Rates for Product Category ---

/**
 * Returns the applicable tax rates for a given product category.
 * Uses intra-state (CGST+SGST) or inter-state (IGST) depending on seller/buyer state match.
 */
export function getTaxRatesForCategory(
  category: string,
  sellerState?: string,
  buyerState?: string
): { cgstRate: number; sgstRate: number; igstRate: number } {
  const rates = DEFAULT_TAX_RATES[category.toLowerCase()] || DEFAULT_TAX_RATES.default;

  // If both states are provided and they match, use intra-state (CGST+SGST)
  // If states differ, use inter-state (IGST only)
  if (sellerState && buyerState && sellerState !== buyerState) {
    return {
      cgstRate: 0,
      sgstRate: 0,
      igstRate: rates.igst,
    };
  }

  return {
    cgstRate: rates.cgst,
    sgstRate: rates.sgst,
    igstRate: 0,
  };
}

// --- Helper: Build Tax Details ---

/**
 * Builds a TaxDetails object from order and category information.
 */
export function buildTaxDetails(
  gstin: string,
  hsnCode: string,
  taxableValue: number,
  category: string,
  sellerState?: string,
  buyerState?: string
): TaxDetails {
  const rates = getTaxRatesForCategory(category, sellerState, buyerState);

  return {
    gstin,
    hsnCode,
    taxableValue,
    cgstRate: rates.cgstRate,
    sgstRate: rates.sgstRate,
    igstRate: rates.igstRate,
  };
}

// --- Utility ---

function roundToTwo(num: number): number {
  return Math.round(num * 100) / 100;
}

export const gstService = {
  generateCreditNote,
  generateTaxInvoice,
  validateProductRestrictions,
  getTaxRatesForCategory,
  buildTaxDetails,
  PLATFORM_GSTIN,
};

export default gstService;
