/**
 * src/services/materialIntelligence.ts
 * SCOUT Material Intelligence Service — V3-25
 *
 * Provides pricing intelligence for electrical materials by simulating
 * real-time distributor queries (Graybar, Rexel, WESCO, Home Depot Pro,
 * and local suppliers). Includes price comparison, alternative product
 * lookup, and a Supabase-backed 24-hour price cache with alert generation.
 *
 * Public API:
 *   searchMaterialPricing(itemName, category?)  → Promise<SupplierResult[]>
 *   comparePrices(results)                      → PriceComparison
 *   findAlternatives(itemName)                  → Promise<AlternativeProduct[]>
 *   checkPriceChanges()                         → Promise<PriceAlert[]>
 */

import { syncToSupabase, fetchFromSupabase } from './supabaseService';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SupplierResult {
  supplier_name: string;
  price: number;
  unit: string;
  in_stock: boolean;
  lead_time_days: number;
  minimum_order: number;
  last_updated: string; // ISO timestamp
  sku?: string;
  notes?: string;
}

export interface PriceComparison {
  results: SupplierResult[];
  best_deal: SupplierResult;
  highest_price: SupplierResult;
  average_price: number;
  savings_vs_highest: number;
  savings_pct_vs_highest: number;
  vault_price?: number;
  savings_vs_vault?: number;
}

export interface AlternativeProduct {
  product_name: string;
  brand: string;
  description: string;
  pricing: SupplierResult[];
  compatibility_notes: string;
}

export interface MaterialCacheEntry {
  item_key: string;
  item_name: string;
  category: string;
  results: SupplierResult[];
  cached_at: string; // ISO timestamp
  expires_at: string; // ISO timestamp (+24h)
}

export interface PriceAlert {
  item_name: string;
  supplier_name: string;
  previous_price: number;
  current_price: number;
  change_pct: number;
  direction: 'up' | 'down';
  alerted_at: string; // ISO timestamp
  severity: 'info' | 'warning' | 'critical';
}

// ─── Mock Distributor Data ─────────────────────────────────────────────────────

/**
 * Comprehensive mock catalog for electrical materials.
 * Keyed by normalized item name for fast lookup.
 * Prices reflect realistic 2026 electrical supply market.
 */

interface MockCatalogEntry {
  category: string;
  unit: string;
  vault_price: number; // VAULT reference price
  suppliers: Array<{
    supplier_name: string;
    price: number;
    in_stock: boolean;
    lead_time_days: number;
    minimum_order: number;
    sku: string;
    notes?: string;
  }>;
  alternatives: string[]; // keys into MOCK_CATALOG
}

const MOCK_CATALOG: Record<string, MockCatalogEntry> = {
  // ── THHN Wire ───────────────────────────────────────────────────────────────
  'thhn wire 12 awg black': {
    category: 'wire',
    unit: 'per 1000ft spool',
    vault_price: 89.50,
    suppliers: [
      { supplier_name: 'Graybar',         price: 87.25, in_stock: true,  lead_time_days: 0, minimum_order: 1, sku: 'GRY-THHN12BLK' },
      { supplier_name: 'Rexel',           price: 84.99, in_stock: true,  lead_time_days: 0, minimum_order: 1, sku: 'RXL-W12THHN-B' },
      { supplier_name: 'WESCO',           price: 91.00, in_stock: true,  lead_time_days: 1, minimum_order: 1, sku: 'WSC-12THHN-BK' },
      { supplier_name: 'Home Depot Pro',  price: 99.00, in_stock: true,  lead_time_days: 0, minimum_order: 1, sku: 'HDP-1000FT12B' },
      { supplier_name: 'Local Supplier',  price: 82.00, in_stock: false, lead_time_days: 3, minimum_order: 2, sku: 'LOC-12BLK-THN', notes: 'Call ahead to confirm stock' },
    ],
    alternatives: ['thhn wire 12 awg white', 'thhn wire 10 awg black'],
  },
  'thhn wire 12 awg white': {
    category: 'wire',
    unit: 'per 1000ft spool',
    vault_price: 87.00,
    suppliers: [
      { supplier_name: 'Graybar',         price: 86.50, in_stock: true,  lead_time_days: 0, minimum_order: 1, sku: 'GRY-THHN12WHT' },
      { supplier_name: 'Rexel',           price: 83.75, in_stock: true,  lead_time_days: 0, minimum_order: 1, sku: 'RXL-W12THHN-W' },
      { supplier_name: 'WESCO',           price: 89.50, in_stock: true,  lead_time_days: 1, minimum_order: 1, sku: 'WSC-12THHN-WH' },
      { supplier_name: 'Home Depot Pro',  price: 97.00, in_stock: true,  lead_time_days: 0, minimum_order: 1, sku: 'HDP-1000FT12W' },
      { supplier_name: 'Local Supplier',  price: 81.00, in_stock: true,  lead_time_days: 1, minimum_order: 2, sku: 'LOC-12WHT-THN' },
    ],
    alternatives: ['thhn wire 12 awg black', 'thhn wire 10 awg white'],
  },
  'thhn wire 10 awg black': {
    category: 'wire',
    unit: 'per 500ft spool',
    vault_price: 94.00,
    suppliers: [
      { supplier_name: 'Graybar',         price: 92.10, in_stock: true,  lead_time_days: 0, minimum_order: 1, sku: 'GRY-THHN10BLK' },
      { supplier_name: 'Rexel',           price: 90.50, in_stock: true,  lead_time_days: 0, minimum_order: 1, sku: 'RXL-W10THHN-B' },
      { supplier_name: 'WESCO',           price: 96.75, in_stock: false, lead_time_days: 2, minimum_order: 1, sku: 'WSC-10THHN-BK' },
      { supplier_name: 'Home Depot Pro',  price: 104.00, in_stock: true, lead_time_days: 0, minimum_order: 1, sku: 'HDP-500FT10BK' },
      { supplier_name: 'Local Supplier',  price: 88.00, in_stock: true,  lead_time_days: 0, minimum_order: 1, sku: 'LOC-10BLK-THN' },
    ],
    alternatives: ['thhn wire 12 awg black', 'thhn wire 8 awg black'],
  },
  'thhn wire 8 awg black': {
    category: 'wire',
    unit: 'per 500ft spool',
    vault_price: 148.00,
    suppliers: [
      { supplier_name: 'Graybar',         price: 144.50, in_stock: true,  lead_time_days: 0, minimum_order: 1, sku: 'GRY-THHN8BLK' },
      { supplier_name: 'Rexel',           price: 141.00, in_stock: true,  lead_time_days: 0, minimum_order: 1, sku: 'RXL-W8THHN-B' },
      { supplier_name: 'WESCO',           price: 151.25, in_stock: true,  lead_time_days: 1, minimum_order: 1, sku: 'WSC-8THHN-BLK' },
      { supplier_name: 'Home Depot Pro',  price: 162.00, in_stock: false, lead_time_days: 3, minimum_order: 1, sku: 'HDP-500FT8BLK' },
      { supplier_name: 'Local Supplier',  price: 138.00, in_stock: true,  lead_time_days: 2, minimum_order: 1, sku: 'LOC-8BLK-THHN' },
    ],
    alternatives: ['thhn wire 10 awg black', 'thhn wire 6 awg black'],
  },

  // ── Breakers ────────────────────────────────────────────────────────────────
  'square d 20a single pole breaker': {
    category: 'breakers',
    unit: 'each',
    vault_price: 12.50,
    suppliers: [
      { supplier_name: 'Graybar',         price: 11.85, in_stock: true,  lead_time_days: 0, minimum_order: 1,  sku: 'GRY-HOM120' },
      { supplier_name: 'Rexel',           price: 11.20, in_stock: true,  lead_time_days: 0, minimum_order: 1,  sku: 'RXL-QO120' },
      { supplier_name: 'WESCO',           price: 12.00, in_stock: true,  lead_time_days: 0, minimum_order: 10, sku: 'WSC-HOM120', notes: '10-pack minimum' },
      { supplier_name: 'Home Depot Pro',  price: 13.97, in_stock: true,  lead_time_days: 0, minimum_order: 1,  sku: 'HDP-HOM120CP' },
      { supplier_name: 'Local Supplier',  price: 10.50, in_stock: true,  lead_time_days: 0, minimum_order: 5,  sku: 'LOC-SQD20SP', notes: '5-pack deal' },
    ],
    alternatives: ['square d 20a double pole breaker', 'eaton 20a single pole breaker'],
  },
  'square d 20a double pole breaker': {
    category: 'breakers',
    unit: 'each',
    vault_price: 24.00,
    suppliers: [
      { supplier_name: 'Graybar',         price: 22.50, in_stock: true,  lead_time_days: 0, minimum_order: 1,  sku: 'GRY-HOM220' },
      { supplier_name: 'Rexel',           price: 21.75, in_stock: true,  lead_time_days: 0, minimum_order: 1,  sku: 'RXL-QO220' },
      { supplier_name: 'WESCO',           price: 23.50, in_stock: true,  lead_time_days: 0, minimum_order: 5,  sku: 'WSC-HOM220', notes: '5-pack minimum' },
      { supplier_name: 'Home Depot Pro',  price: 26.98, in_stock: true,  lead_time_days: 0, minimum_order: 1,  sku: 'HDP-HOM220CP' },
      { supplier_name: 'Local Supplier',  price: 20.00, in_stock: false, lead_time_days: 2, minimum_order: 1,  sku: 'LOC-SQD20DP' },
    ],
    alternatives: ['square d 20a single pole breaker', 'eaton 20a double pole breaker'],
  },
  'eaton 20a single pole breaker': {
    category: 'breakers',
    unit: 'each',
    vault_price: 11.75,
    suppliers: [
      { supplier_name: 'Graybar',         price: 11.10, in_stock: true,  lead_time_days: 0, minimum_order: 1,  sku: 'GRY-BR120' },
      { supplier_name: 'Rexel',           price: 10.50, in_stock: true,  lead_time_days: 0, minimum_order: 1,  sku: 'RXL-BR120' },
      { supplier_name: 'WESCO',           price: 11.50, in_stock: true,  lead_time_days: 0, minimum_order: 10, sku: 'WSC-BR120' },
      { supplier_name: 'Home Depot Pro',  price: 12.87, in_stock: true,  lead_time_days: 0, minimum_order: 1,  sku: 'HDP-BR120' },
      { supplier_name: 'Local Supplier',  price: 9.95,  in_stock: true,  lead_time_days: 0, minimum_order: 1,  sku: 'LOC-ETN20SP' },
    ],
    alternatives: ['square d 20a single pole breaker', 'eaton 20a double pole breaker'],
  },
  'eaton 20a double pole breaker': {
    category: 'breakers',
    unit: 'each',
    vault_price: 22.50,
    suppliers: [
      { supplier_name: 'Graybar',         price: 21.00, in_stock: true,  lead_time_days: 0, minimum_order: 1, sku: 'GRY-BR220' },
      { supplier_name: 'Rexel',           price: 20.25, in_stock: true,  lead_time_days: 0, minimum_order: 1, sku: 'RXL-BR220' },
      { supplier_name: 'WESCO',           price: 22.00, in_stock: true,  lead_time_days: 0, minimum_order: 5, sku: 'WSC-BR220' },
      { supplier_name: 'Home Depot Pro',  price: 24.97, in_stock: true,  lead_time_days: 0, minimum_order: 1, sku: 'HDP-BR220' },
      { supplier_name: 'Local Supplier',  price: 19.00, in_stock: true,  lead_time_days: 1, minimum_order: 1, sku: 'LOC-ETN20DP' },
    ],
    alternatives: ['square d 20a double pole breaker', 'eaton 20a single pole breaker'],
  },

  // ── Panels ───────────────────────────────────────────────────────────────────
  'square d 200a 40-circuit panel': {
    category: 'panels',
    unit: 'each',
    vault_price: 385.00,
    suppliers: [
      { supplier_name: 'Graybar',         price: 372.00, in_stock: true,  lead_time_days: 0, minimum_order: 1, sku: 'GRY-PH40C200P' },
      { supplier_name: 'Rexel',           price: 359.00, in_stock: true,  lead_time_days: 0, minimum_order: 1, sku: 'RXL-PH40C200' },
      { supplier_name: 'WESCO',           price: 390.00, in_stock: false, lead_time_days: 5, minimum_order: 1, sku: 'WSC-PH40C200', notes: 'Special order' },
      { supplier_name: 'Home Depot Pro',  price: 419.00, in_stock: true,  lead_time_days: 0, minimum_order: 1, sku: 'HDP-PH40C200' },
      { supplier_name: 'Local Supplier',  price: 345.00, in_stock: false, lead_time_days: 7, minimum_order: 1, sku: 'LOC-SQD40C200', notes: 'Call for availability' },
    ],
    alternatives: ['eaton 200a 40-circuit panel', 'square d 150a 30-circuit panel'],
  },
  'eaton 200a 40-circuit panel': {
    category: 'panels',
    unit: 'each',
    vault_price: 365.00,
    suppliers: [
      { supplier_name: 'Graybar',         price: 351.00, in_stock: true,  lead_time_days: 0, minimum_order: 1, sku: 'GRY-BR40L200P' },
      { supplier_name: 'Rexel',           price: 342.00, in_stock: true,  lead_time_days: 1, minimum_order: 1, sku: 'RXL-BR40L200' },
      { supplier_name: 'WESCO',           price: 368.00, in_stock: true,  lead_time_days: 0, minimum_order: 1, sku: 'WSC-BR40L200' },
      { supplier_name: 'Home Depot Pro',  price: 398.00, in_stock: true,  lead_time_days: 0, minimum_order: 1, sku: 'HDP-BR40L200' },
      { supplier_name: 'Local Supplier',  price: 328.00, in_stock: true,  lead_time_days: 2, minimum_order: 1, sku: 'LOC-ETN40C200' },
    ],
    alternatives: ['square d 200a 40-circuit panel', 'eaton 150a 30-circuit panel'],
  },

  // ── Conduit ──────────────────────────────────────────────────────────────────
  '3/4 emt conduit 10ft': {
    category: 'conduit',
    unit: 'per stick (10ft)',
    vault_price: 8.75,
    suppliers: [
      { supplier_name: 'Graybar',         price: 8.40, in_stock: true,  lead_time_days: 0, minimum_order: 10, sku: 'GRY-EMT34-10' },
      { supplier_name: 'Rexel',           price: 8.10, in_stock: true,  lead_time_days: 0, minimum_order: 10, sku: 'RXL-EMT34-10' },
      { supplier_name: 'WESCO',           price: 8.90, in_stock: true,  lead_time_days: 0, minimum_order: 25, sku: 'WSC-EMT34-10', notes: 'Bundle of 25 only' },
      { supplier_name: 'Home Depot Pro',  price: 9.98, in_stock: true,  lead_time_days: 0, minimum_order: 1,  sku: 'HDP-EMT34-10' },
      { supplier_name: 'Local Supplier',  price: 7.75, in_stock: true,  lead_time_days: 0, minimum_order: 10, sku: 'LOC-EMT34-10' },
    ],
    alternatives: ['1/2 emt conduit 10ft', '3/4 rigid conduit 10ft', '3/4 pvc conduit 10ft'],
  },
  '1/2 emt conduit 10ft': {
    category: 'conduit',
    unit: 'per stick (10ft)',
    vault_price: 5.90,
    suppliers: [
      { supplier_name: 'Graybar',         price: 5.60, in_stock: true,  lead_time_days: 0, minimum_order: 10, sku: 'GRY-EMT12-10' },
      { supplier_name: 'Rexel',           price: 5.40, in_stock: true,  lead_time_days: 0, minimum_order: 10, sku: 'RXL-EMT12-10' },
      { supplier_name: 'WESCO',           price: 5.95, in_stock: true,  lead_time_days: 0, minimum_order: 25, sku: 'WSC-EMT12-10' },
      { supplier_name: 'Home Depot Pro',  price: 6.49, in_stock: true,  lead_time_days: 0, minimum_order: 1,  sku: 'HDP-EMT12-10' },
      { supplier_name: 'Local Supplier',  price: 5.15, in_stock: true,  lead_time_days: 0, minimum_order: 10, sku: 'LOC-EMT12-10' },
    ],
    alternatives: ['3/4 emt conduit 10ft', '1/2 pvc conduit 10ft'],
  },
  '3/4 pvc conduit 10ft': {
    category: 'conduit',
    unit: 'per stick (10ft)',
    vault_price: 4.50,
    suppliers: [
      { supplier_name: 'Graybar',         price: 4.25, in_stock: true,  lead_time_days: 0, minimum_order: 10, sku: 'GRY-PVC34-10' },
      { supplier_name: 'Rexel',           price: 4.10, in_stock: true,  lead_time_days: 0, minimum_order: 10, sku: 'RXL-PVC34-10' },
      { supplier_name: 'WESCO',           price: 4.60, in_stock: true,  lead_time_days: 0, minimum_order: 50, sku: 'WSC-PVC34-10', notes: '50-stick bundle' },
      { supplier_name: 'Home Depot Pro',  price: 4.99, in_stock: true,  lead_time_days: 0, minimum_order: 1,  sku: 'HDP-PVC34-10' },
      { supplier_name: 'Local Supplier',  price: 3.85, in_stock: true,  lead_time_days: 0, minimum_order: 20, sku: 'LOC-PVC34-10' },
    ],
    alternatives: ['3/4 emt conduit 10ft', '1/2 pvc conduit 10ft'],
  },

  // ── Boxes ────────────────────────────────────────────────────────────────────
  '4 square box 1-1/2 deep': {
    category: 'boxes',
    unit: 'each',
    vault_price: 3.25,
    suppliers: [
      { supplier_name: 'Graybar',         price: 3.10, in_stock: true,  lead_time_days: 0, minimum_order: 25, sku: 'GRY-5133A' },
      { supplier_name: 'Rexel',           price: 2.95, in_stock: true,  lead_time_days: 0, minimum_order: 25, sku: 'RXL-5133A' },
      { supplier_name: 'WESCO',           price: 3.30, in_stock: true,  lead_time_days: 0, minimum_order: 50, sku: 'WSC-5133A' },
      { supplier_name: 'Home Depot Pro',  price: 3.68, in_stock: true,  lead_time_days: 0, minimum_order: 1,  sku: 'HDP-5133A' },
      { supplier_name: 'Local Supplier',  price: 2.80, in_stock: true,  lead_time_days: 0, minimum_order: 25, sku: 'LOC-4SQ-15' },
    ],
    alternatives: ['4 square box 2-1/8 deep', '4 square single-gang mud ring'],
  },
  'single gang old work box': {
    category: 'boxes',
    unit: 'each',
    vault_price: 1.85,
    suppliers: [
      { supplier_name: 'Graybar',         price: 1.75, in_stock: true,  lead_time_days: 0, minimum_order: 50, sku: 'GRY-B114R' },
      { supplier_name: 'Rexel',           price: 1.65, in_stock: true,  lead_time_days: 0, minimum_order: 50, sku: 'RXL-B114R' },
      { supplier_name: 'WESCO',           price: 1.80, in_stock: true,  lead_time_days: 0, minimum_order: 50, sku: 'WSC-B114R' },
      { supplier_name: 'Home Depot Pro',  price: 2.18, in_stock: true,  lead_time_days: 0, minimum_order: 1,  sku: 'HDP-B114R' },
      { supplier_name: 'Local Supplier',  price: 1.50, in_stock: true,  lead_time_days: 0, minimum_order: 50, sku: 'LOC-1GOW' },
    ],
    alternatives: ['single gang new work box', 'double gang old work box'],
  },
  'double gang old work box': {
    category: 'boxes',
    unit: 'each',
    vault_price: 2.75,
    suppliers: [
      { supplier_name: 'Graybar',         price: 2.60, in_stock: true,  lead_time_days: 0, minimum_order: 25, sku: 'GRY-B228R' },
      { supplier_name: 'Rexel',           price: 2.45, in_stock: true,  lead_time_days: 0, minimum_order: 25, sku: 'RXL-B228R' },
      { supplier_name: 'WESCO',           price: 2.70, in_stock: true,  lead_time_days: 0, minimum_order: 50, sku: 'WSC-B228R' },
      { supplier_name: 'Home Depot Pro',  price: 3.09, in_stock: true,  lead_time_days: 0, minimum_order: 1,  sku: 'HDP-B228R' },
      { supplier_name: 'Local Supplier',  price: 2.30, in_stock: true,  lead_time_days: 0, minimum_order: 25, sku: 'LOC-2GOW' },
    ],
    alternatives: ['single gang old work box', 'double gang new work box'],
  },

  // ── Devices ─────────────────────────────────────────────────────────────────
  'leviton 20a tamper resistant receptacle': {
    category: 'devices',
    unit: 'each',
    vault_price: 5.50,
    suppliers: [
      { supplier_name: 'Graybar',         price: 5.25, in_stock: true,  lead_time_days: 0, minimum_order: 10, sku: 'GRY-T5362' },
      { supplier_name: 'Rexel',           price: 4.99, in_stock: true,  lead_time_days: 0, minimum_order: 10, sku: 'RXL-T5362' },
      { supplier_name: 'WESCO',           price: 5.40, in_stock: true,  lead_time_days: 0, minimum_order: 10, sku: 'WSC-T5362' },
      { supplier_name: 'Home Depot Pro',  price: 6.29, in_stock: true,  lead_time_days: 0, minimum_order: 1,  sku: 'HDP-T5362' },
      { supplier_name: 'Local Supplier',  price: 4.75, in_stock: true,  lead_time_days: 0, minimum_order: 25, sku: 'LOC-LEV20TR' },
    ],
    alternatives: ['hubbell 20a tamper resistant receptacle', 'leviton 15a tamper resistant receptacle'],
  },
  'leviton 15a tamper resistant receptacle': {
    category: 'devices',
    unit: 'each',
    vault_price: 3.95,
    suppliers: [
      { supplier_name: 'Graybar',         price: 3.75, in_stock: true,  lead_time_days: 0, minimum_order: 10, sku: 'GRY-T5262' },
      { supplier_name: 'Rexel',           price: 3.55, in_stock: true,  lead_time_days: 0, minimum_order: 10, sku: 'RXL-T5262' },
      { supplier_name: 'WESCO',           price: 3.80, in_stock: true,  lead_time_days: 0, minimum_order: 25, sku: 'WSC-T5262' },
      { supplier_name: 'Home Depot Pro',  price: 4.47, in_stock: true,  lead_time_days: 0, minimum_order: 1,  sku: 'HDP-T5262' },
      { supplier_name: 'Local Supplier',  price: 3.40, in_stock: true,  lead_time_days: 0, minimum_order: 25, sku: 'LOC-LEV15TR' },
    ],
    alternatives: ['leviton 20a tamper resistant receptacle', 'hubbell 15a tamper resistant receptacle'],
  },
  'hubbell 20a tamper resistant receptacle': {
    category: 'devices',
    unit: 'each',
    vault_price: 5.75,
    suppliers: [
      { supplier_name: 'Graybar',         price: 5.50, in_stock: true,  lead_time_days: 0, minimum_order: 10, sku: 'GRY-HBL5362' },
      { supplier_name: 'Rexel',           price: 5.25, in_stock: true,  lead_time_days: 0, minimum_order: 10, sku: 'RXL-HBL5362' },
      { supplier_name: 'WESCO',           price: 5.65, in_stock: false, lead_time_days: 3, minimum_order: 10, sku: 'WSC-HBL5362' },
      { supplier_name: 'Home Depot Pro',  price: 6.49, in_stock: true,  lead_time_days: 0, minimum_order: 1,  sku: 'HDP-HBL5362', notes: 'Pro account required' },
      { supplier_name: 'Local Supplier',  price: 5.00, in_stock: true,  lead_time_days: 1, minimum_order: 10, sku: 'LOC-HUB20TR' },
    ],
    alternatives: ['leviton 20a tamper resistant receptacle', 'hubbell 15a tamper resistant receptacle'],
  },
  'leviton 20a decora gfci': {
    category: 'devices',
    unit: 'each',
    vault_price: 22.00,
    suppliers: [
      { supplier_name: 'Graybar',         price: 20.75, in_stock: true,  lead_time_days: 0, minimum_order: 5, sku: 'GRY-GFNT2' },
      { supplier_name: 'Rexel',           price: 19.99, in_stock: true,  lead_time_days: 0, minimum_order: 5, sku: 'RXL-GFNT2' },
      { supplier_name: 'WESCO',           price: 21.50, in_stock: true,  lead_time_days: 0, minimum_order: 5, sku: 'WSC-GFNT2' },
      { supplier_name: 'Home Depot Pro',  price: 24.98, in_stock: true,  lead_time_days: 0, minimum_order: 1, sku: 'HDP-GFNT2' },
      { supplier_name: 'Local Supplier',  price: 18.75, in_stock: true,  lead_time_days: 0, minimum_order: 5, sku: 'LOC-LEV20GFI' },
    ],
    alternatives: ['leviton 15a decora gfci', 'hubbell 20a gfci receptacle'],
  },
  '20a single pole toggle switch': {
    category: 'devices',
    unit: 'each',
    vault_price: 4.25,
    suppliers: [
      { supplier_name: 'Graybar',         price: 4.00, in_stock: true,  lead_time_days: 0, minimum_order: 10, sku: 'GRY-CS20-2' },
      { supplier_name: 'Rexel',           price: 3.80, in_stock: true,  lead_time_days: 0, minimum_order: 10, sku: 'RXL-CS20-2' },
      { supplier_name: 'WESCO',           price: 4.15, in_stock: true,  lead_time_days: 0, minimum_order: 25, sku: 'WSC-CS20-2' },
      { supplier_name: 'Home Depot Pro',  price: 4.87, in_stock: true,  lead_time_days: 0, minimum_order: 1,  sku: 'HDP-CS20-2' },
      { supplier_name: 'Local Supplier',  price: 3.60, in_stock: true,  lead_time_days: 0, minimum_order: 10, sku: 'LOC-20SP-SWT' },
    ],
    alternatives: ['15a single pole toggle switch', '20a 3-way switch'],
  },
};

// ─── In-Memory Cache ───────────────────────────────────────────────────────────

/** In-process cache: item_key → { entry, previousEntry } */
interface CacheEntry {
  entry: MaterialCacheEntry;
  previousEntry?: MaterialCacheEntry;
}

const _memoryCache = new Map<string, CacheEntry>();

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Helpers ───────────────────────────────────────────────────────────────────

function normalizeItemName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

function fuzzyFindCatalogKey(itemName: string): string | null {
  const normalized = normalizeItemName(itemName);

  // Exact match first
  if (MOCK_CATALOG[normalized]) return normalized;

  // Partial keyword match — score by overlap
  const queryWords = new Set(normalized.split(' ').filter(w => w.length > 2));
  let bestKey: string | null = null;
  let bestScore = 0;

  for (const key of Object.keys(MOCK_CATALOG)) {
    const keyWords = new Set(key.split(' ').filter(w => w.length > 2));
    const intersection = [...queryWords].filter(w => keyWords.has(w)).length;
    const score = intersection / Math.max(queryWords.size, keyWords.size);
    if (score > bestScore && score >= 0.5) {
      bestScore = score;
      bestKey = key;
    }
  }

  return bestKey;
}

function buildSupplierResults(catalogEntry: MockCatalogEntry): SupplierResult[] {
  const now = new Date().toISOString();
  return catalogEntry.suppliers.map(s => ({
    supplier_name: s.supplier_name,
    price: s.price,
    unit: catalogEntry.unit,
    in_stock: s.in_stock,
    lead_time_days: s.lead_time_days,
    minimum_order: s.minimum_order,
    last_updated: now,
    sku: s.sku,
    notes: s.notes,
  }));
}

// ─── searchMaterialPricing ─────────────────────────────────────────────────────

/**
 * Searches for current pricing across simulated distributor sources.
 * Returns results from all 5 suppliers with availability and lead times.
 * Results are cached in memory (and stubbed to Supabase) with 24-hour TTL.
 */
export async function searchMaterialPricing(
  itemName: string,
  category?: string,
): Promise<SupplierResult[]> {
  const key = normalizeItemName(itemName);
  const now = Date.now();

  // Check memory cache first
  const cached = _memoryCache.get(key);
  if (cached && new Date(cached.entry.expires_at).getTime() > now) {
    return cached.entry.results;
  }

  // Look up in mock catalog
  const catalogKey = fuzzyFindCatalogKey(itemName);

  if (!catalogKey) {
    // Return empty results for unknown items
    return [];
  }

  const catalogEntry = MOCK_CATALOG[catalogKey];

  // Filter by category if provided
  if (category && catalogEntry.category !== category.toLowerCase()) {
    return [];
  }

  const results = buildSupplierResults(catalogEntry);
  const cachedAt = new Date().toISOString();
  const expiresAt = new Date(now + CACHE_TTL_MS).toISOString();

  const newCacheEntry: MaterialCacheEntry = {
    item_key: key,
    item_name: catalogKey,
    category: catalogEntry.category,
    results,
    cached_at: cachedAt,
    expires_at: expiresAt,
  };

  // Preserve previous entry for price-change detection
  const previousEntry = cached?.entry;
  _memoryCache.set(key, { entry: newCacheEntry, previousEntry });

  // Persist to Supabase (stub — wires to material_price_cache on integration)
  void syncToSupabase({
    table: 'material_price_cache',
    data: {
      item_key: key,
      item_name: catalogKey,
      category: catalogEntry.category,
      results: JSON.stringify(results),
      cached_at: cachedAt,
      expires_at: expiresAt,
    },
    operation: 'upsert',
  });

  return results;
}

// ─── comparePrices ─────────────────────────────────────────────────────────────

/**
 * Compares a set of SupplierResults.
 * Sorts by price ascending, flags best deal, and calculates savings.
 * Optionally compares against VAULT price if available in the catalog.
 */
export function comparePrices(
  results: SupplierResult[],
  itemName?: string,
): PriceComparison {
  if (results.length === 0) {
    throw new Error('comparePrices: no results to compare');
  }

  const sorted = [...results].sort((a, b) => a.price - b.price);
  const best_deal = sorted[0];
  const highest_price = sorted[sorted.length - 1];
  const average_price =
    sorted.reduce((sum, r) => sum + r.price, 0) / sorted.length;

  const savings_vs_highest = highest_price.price - best_deal.price;
  const savings_pct_vs_highest =
    (savings_vs_highest / highest_price.price) * 100;

  let vault_price: number | undefined;
  let savings_vs_vault: number | undefined;

  if (itemName) {
    const key = fuzzyFindCatalogKey(itemName);
    if (key) {
      vault_price = MOCK_CATALOG[key].vault_price;
      savings_vs_vault = vault_price - best_deal.price;
    }
  }

  return {
    results: sorted,
    best_deal,
    highest_price,
    average_price: Math.round(average_price * 100) / 100,
    savings_vs_highest: Math.round(savings_vs_highest * 100) / 100,
    savings_pct_vs_highest: Math.round(savings_pct_vs_highest * 10) / 10,
    vault_price,
    savings_vs_vault:
      savings_vs_vault !== undefined
        ? Math.round(savings_vs_vault * 100) / 100
        : undefined,
  };
}

// ─── findAlternatives ──────────────────────────────────────────────────────────

/**
 * Returns equivalent/alternative products for a given item name.
 * Each alternative includes full supplier pricing.
 */
export async function findAlternatives(
  itemName: string,
): Promise<AlternativeProduct[]> {
  const key = fuzzyFindCatalogKey(itemName);
  if (!key) return [];

  const catalogEntry = MOCK_CATALOG[key];
  const altKeys = catalogEntry.alternatives ?? [];

  const alternatives: AlternativeProduct[] = [];

  for (const altKey of altKeys) {
    const altEntry = MOCK_CATALOG[altKey];
    if (!altEntry) continue;

    const pricing = await searchMaterialPricing(altKey);

    // Build compatibility note
    const isSameCategory = altEntry.category === catalogEntry.category;
    const compatNote = isSameCategory
      ? `Compatible replacement in the same category (${altEntry.category}). Verify amperage and form factor match.`
      : `Cross-category alternative. Confirm installation compatibility before substituting.`;

    // Format display name from key
    const displayName = altKey
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    // Extract brand (first word or two)
    const parts = altKey.split(' ');
    const brand = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);

    alternatives.push({
      product_name: displayName,
      brand,
      description: `${altEntry.category.charAt(0).toUpperCase() + altEntry.category.slice(1)} — ${altEntry.unit}`,
      pricing,
      compatibility_notes: compatNote,
    });
  }

  return alternatives;
}

// ─── checkPriceChanges ────────────────────────────────────────────────────────

/**
 * Compares current cached prices against previous cache snapshot.
 * Items that have changed by more than 5% generate a PriceAlert.
 * Alerts are persisted to Supabase material_alerts table (stub).
 */
export async function checkPriceChanges(): Promise<PriceAlert[]> {
  const alerts: PriceAlert[] = [];
  const CHANGE_THRESHOLD = 0.05; // 5%

  for (const [, cacheEntry] of _memoryCache) {
    const { entry, previousEntry } = cacheEntry;
    if (!previousEntry) continue;

    for (const current of entry.results) {
      const previous = previousEntry.results.find(
        r => r.supplier_name === current.supplier_name,
      );
      if (!previous) continue;

      const changePct = (current.price - previous.price) / previous.price;
      const absChange = Math.abs(changePct);

      if (absChange > CHANGE_THRESHOLD) {
        const severity: PriceAlert['severity'] =
          absChange > 0.2 ? 'critical' : absChange > 0.1 ? 'warning' : 'info';

        const alert: PriceAlert = {
          item_name: entry.item_name,
          supplier_name: current.supplier_name,
          previous_price: previous.price,
          current_price: current.price,
          change_pct: Math.round(changePct * 1000) / 10, // one decimal
          direction: changePct > 0 ? 'up' : 'down',
          alerted_at: new Date().toISOString(),
          severity,
        };

        alerts.push(alert);

        // Persist to Supabase material_alerts table (stub)
        void syncToSupabase({
          table: 'material_alerts',
          data: {
            item_name: alert.item_name,
            supplier_name: alert.supplier_name,
            previous_price: alert.previous_price,
            current_price: alert.current_price,
            change_pct: alert.change_pct,
            direction: alert.direction,
            severity: alert.severity,
            alerted_at: alert.alerted_at,
          },
          operation: 'insert',
        });
      }
    }
  }

  return alerts;
}

// ─── Catalog Utilities ────────────────────────────────────────────────────────

/** Returns all available catalog keys for a given category */
export function getCatalogKeysByCategory(category: string): string[] {
  return Object.entries(MOCK_CATALOG)
    .filter(([, entry]) => entry.category === category.toLowerCase())
    .map(([key]) => key);
}

/** Returns all category names in the catalog */
export function getCatalogCategories(): string[] {
  return [...new Set(Object.values(MOCK_CATALOG).map(e => e.category))];
}

/** Returns total number of mock catalog items */
export function getMockItemCount(): number {
  return Object.keys(MOCK_CATALOG).length;
}
