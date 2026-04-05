/**
 * src/agents/scoutMaterial.ts
 * SCOUT Material Intelligence Agent — V3-25
 *
 * Registers with the NEXUS routing system and handles material-related
 * queries: price checks, supplier comparisons, alternatives lookup,
 * lead time inquiries, and supplier requirement queries.
 *
 * Public API:
 *   initScoutMaterialAgent()  → void (registers with NEXUS)
 *   handleMaterialQuery(query) → Promise<ScoutMaterialResponse>
 */

import {
  searchMaterialPricing,
  comparePrices,
  findAlternatives,
  checkPriceChanges,
  type SupplierResult,
  type PriceComparison,
  type AlternativeProduct,
  type PriceAlert,
} from '../services/materialIntelligence';

// ─── Display Component Types (SCOUT-specific extensions) ───────────────────────

export type ScoutDisplayType =
  | 'price_comparison_card'
  | 'alternative_product_card'
  | 'supplier_info_card'
  | 'lead_time_alert'
  | 'price_alert_card'
  | 'no_results_card';

export interface PriceComparisonCard {
  type: 'price_comparison_card';
  item_name: string;
  best_supplier: string;
  best_price: number;
  unit: string;
  savings_vs_highest: number;
  savings_pct: number;
  vault_price?: number;
  savings_vs_vault?: number;
  all_results: SupplierResult[];
}

export interface AlternativeProductCard {
  type: 'alternative_product_card';
  product_name: string;
  brand: string;
  description: string;
  best_price: number;
  best_supplier: string;
  unit: string;
  compatibility_notes: string;
}

export interface SupplierInfoCard {
  type: 'supplier_info_card';
  supplier_name: string;
  price: number;
  unit: string;
  in_stock: boolean;
  lead_time_days: number;
  minimum_order: number;
  sku?: string;
  notes?: string;
}

export interface LeadTimeAlert {
  type: 'lead_time_alert';
  item_name: string;
  supplier_name: string;
  lead_time_days: number;
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface PriceAlertCard {
  type: 'price_alert_card';
  item_name: string;
  supplier_name: string;
  previous_price: number;
  current_price: number;
  change_pct: number;
  direction: 'up' | 'down';
  severity: 'info' | 'warning' | 'critical';
}

export interface NoResultsCard {
  type: 'no_results_card';
  query: string;
  message: string;
  suggestions: string[];
}

export type ScoutDisplayComponent =
  | PriceComparisonCard
  | AlternativeProductCard
  | SupplierInfoCard
  | LeadTimeAlert
  | PriceAlertCard
  | NoResultsCard;

// ─── Agent Response ────────────────────────────────────────────────────────────

export interface ScoutMaterialResponse {
  speak: string;
  display: ScoutDisplayComponent[];
}

// ─── Query Intent Types ────────────────────────────────────────────────────────

type QueryIntent =
  | 'price_check'
  | 'comparison'
  | 'alternative'
  | 'lead_time'
  | 'supplier_requirements'
  | 'price_alerts'
  | 'unknown';

interface ParsedIntent {
  intent: QueryIntent;
  itemName: string | null;
  supplierName: string | null;
  category: string | null;
}

// ─── NEXUS Agent Bus (stub registry) ─────────────────────────────────────────

/** Lightweight agent bus — wired to real NEXUS routing on integration */
interface AgentRegistration {
  agentId: string;
  displayName: string;
  routeTarget: string;
  handler: (query: string) => Promise<ScoutMaterialResponse>;
}

const _agentRegistry: Map<string, AgentRegistration> = new Map();

function registerWithNexus(registration: AgentRegistration): void {
  _agentRegistry.set(registration.agentId, registration);
  // STUB — wire to actual NEXUS agent bus during V2 integration
  // nexusAgentBus.register(registration);
}

// ─── initScoutMaterialAgent ───────────────────────────────────────────────────

/**
 * Registers the SCOUT Material agent with the NEXUS routing system.
 * Call once at application startup, alongside other agent inits.
 */
export function initScoutMaterialAgent(): void {
  registerWithNexus({
    agentId: 'SCOUT_MATERIAL',
    displayName: 'SCOUT Material Intelligence',
    routeTarget: 'VAULT', // NEXUS routes material/pricing queries to VAULT → SCOUT
    handler: handleMaterialQuery,
  });
}

// ─── Intent Parser ─────────────────────────────────────────────────────────────

const PRICE_CHECK_KEYWORDS = [
  'price', 'pricing', 'cost', 'how much', "what's the price", 'how much does',
  'how much for', 'cost of', 'per foot', 'per unit', 'rate',
];

const COMPARISON_KEYWORDS = [
  'compare', 'comparison', 'vs', 'versus', 'cheapest', 'cheapest price',
  'best price', 'best deal', 'lowest price', 'which supplier', 'who has',
  'where can i get', 'who sells',
];

const ALTERNATIVE_KEYWORDS = [
  'alternative', 'alternatives', 'equivalent', 'substitute', 'substitution',
  'instead of', 'similar to', 'replacement for', 'other options', 'swap',
];

const LEAD_TIME_KEYWORDS = [
  'lead time', 'lead times', 'how long', 'when can i get', 'availability',
  'available', 'in stock', 'stock', 'delivery', 'when will', 'days out',
];

const SUPPLIER_KEYWORDS = [
  'supplier', 'suppliers', 'distributor', 'distributors', 'vendor', 'vendors',
  'graybar', 'rexel', 'wesco', 'home depot pro', 'local supplier',
  'minimum order', 'minimum', 'where to buy',
];

const PRICE_ALERT_KEYWORDS = [
  'alert', 'alerts', 'price change', 'price changes', 'changed', 'went up',
  'went down', 'increased', 'decreased', 'notification', 'changed price',
];

const CATEGORY_HINTS: Record<string, string> = {
  wire: 'wire', thhn: 'wire', cable: 'wire', romex: 'wire',
  breaker: 'breakers', 'circuit breaker': 'breakers', panel: 'panels', 'load center': 'panels',
  conduit: 'conduit', emt: 'conduit', pvc: 'conduit', rigid: 'conduit',
  box: 'boxes', 'junction box': 'boxes', 'outlet box': 'boxes',
  device: 'devices', outlet: 'devices', receptacle: 'devices', switch: 'devices', gfci: 'devices',
};

const SUPPLIER_NAME_MAP: Record<string, string> = {
  graybar: 'Graybar',
  rexel: 'Rexel',
  wesco: 'WESCO',
  'home depot': 'Home Depot Pro',
  'home depot pro': 'Home Depot Pro',
  local: 'Local Supplier',
  'local supplier': 'Local Supplier',
};

function parseIntent(query: string): ParsedIntent {
  const lower = query.toLowerCase();

  // Detect intent
  let intent: QueryIntent = 'unknown';
  let highestScore = 0;

  const intentGroups: [QueryIntent, string[]][] = [
    ['price_check', PRICE_CHECK_KEYWORDS],
    ['comparison', COMPARISON_KEYWORDS],
    ['alternative', ALTERNATIVE_KEYWORDS],
    ['lead_time', LEAD_TIME_KEYWORDS],
    ['supplier_requirements', SUPPLIER_KEYWORDS],
    ['price_alerts', PRICE_ALERT_KEYWORDS],
  ];

  for (const [candidate, keywords] of intentGroups) {
    const score = keywords.filter(kw => lower.includes(kw)).length;
    if (score > highestScore) {
      highestScore = score;
      intent = candidate;
    }
  }

  // Default to price_check if no intent is clear but query mentions a material
  if (intent === 'unknown' && highestScore === 0) {
    intent = 'price_check';
  }

  // Extract item name — strip intent keywords and extract the material-like phrase
  let itemName: string | null = extractItemName(query);

  // Extract supplier name if mentioned
  let supplierName: string | null = null;
  for (const [alias, canonical] of Object.entries(SUPPLIER_NAME_MAP)) {
    if (lower.includes(alias)) {
      supplierName = canonical;
      break;
    }
  }

  // Extract category
  let category: string | null = null;
  for (const [hint, cat] of Object.entries(CATEGORY_HINTS)) {
    if (lower.includes(hint)) {
      category = cat;
      break;
    }
  }

  return { intent, itemName, supplierName, category };
}

/**
 * Attempts to extract an item name from a free-text query.
 * Strips intent/filler words and returns the core material description.
 */
function extractItemName(query: string): string | null {
  // Remove common filler phrases
  const fillerPhrases = [
    "what's the price of", "what is the price of", "how much does", 'how much for',
    'price of', 'pricing for', 'cost of', 'find', 'look up', 'search for',
    'get me', 'what are alternatives to', 'alternatives for', 'alternatives to',
    'compare prices for', 'compare', 'lead time for', 'lead time on',
    'availability of', 'in stock', 'check', 'find alternatives for',
    'find alternatives to', "what's the lead time for", 'price check on',
    'price check for', 'i need', 'do you have',
  ];

  let cleaned = query.toLowerCase().trim();
  for (const phrase of fillerPhrases) {
    cleaned = cleaned.replace(phrase, '').trim();
  }

  // Trim punctuation
  cleaned = cleaned.replace(/[?!.,]+$/g, '').trim();

  if (!cleaned || cleaned.length < 3) return null;
  return cleaned;
}

// ─── Response Builders ─────────────────────────────────────────────────────────

function buildPriceCheckResponse(
  itemName: string,
  results: SupplierResult[],
  comparison: PriceComparison,
): ScoutMaterialResponse {
  const best = comparison.best_deal;
  const displayName = itemName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  let speakText = `Best price on ${displayName} is $${best.price.toFixed(2)} per ${best.unit} from ${best.supplier_name}.`;
  if (comparison.savings_vs_highest > 0) {
    speakText += ` You save $${comparison.savings_vs_highest.toFixed(2)} compared to the highest price.`;
  }
  if (comparison.savings_vs_vault !== undefined && comparison.savings_vs_vault > 0) {
    speakText += ` That's $${comparison.savings_vs_vault.toFixed(2)} better than your VAULT price.`;
  }
  if (!best.in_stock) {
    speakText += ` Note: ${best.supplier_name} is currently out of stock — lead time is ${best.lead_time_days} day${best.lead_time_days !== 1 ? 's' : ''}.`;
  }

  const display: ScoutDisplayComponent[] = [
    {
      type: 'price_comparison_card',
      item_name: displayName,
      best_supplier: best.supplier_name,
      best_price: best.price,
      unit: best.unit,
      savings_vs_highest: comparison.savings_vs_highest,
      savings_pct: comparison.savings_pct_vs_highest,
      vault_price: comparison.vault_price,
      savings_vs_vault: comparison.savings_vs_vault,
      all_results: comparison.results,
    } as PriceComparisonCard,
  ];

  // Add lead time alerts for items with long lead times
  for (const result of results) {
    if (result.lead_time_days >= 3) {
      const severity: LeadTimeAlert['severity'] =
        result.lead_time_days >= 7 ? 'critical' : result.lead_time_days >= 3 ? 'warning' : 'info';

      display.push({
        type: 'lead_time_alert',
        item_name: displayName,
        supplier_name: result.supplier_name,
        lead_time_days: result.lead_time_days,
        severity,
        message: `${result.supplier_name} has a ${result.lead_time_days}-day lead time${!result.in_stock ? ' (out of stock)' : ''}.`,
      } as LeadTimeAlert);
    }
  }

  return { speak: speakText, display };
}

function buildComparisonResponse(
  itemName: string,
  results: SupplierResult[],
  comparison: PriceComparison,
): ScoutMaterialResponse {
  const displayName = itemName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  const speak = `Comparing ${results.length} suppliers for ${displayName}: ` +
    `${comparison.best_deal.supplier_name} has the best price at $${comparison.best_deal.price.toFixed(2)}, ` +
    `and ${comparison.highest_price.supplier_name} is highest at $${comparison.highest_price.price.toFixed(2)}. ` +
    `Average across suppliers is $${comparison.average_price.toFixed(2)}.`;

  const display: ScoutDisplayComponent[] = [
    {
      type: 'price_comparison_card',
      item_name: displayName,
      best_supplier: comparison.best_deal.supplier_name,
      best_price: comparison.best_deal.price,
      unit: comparison.best_deal.unit,
      savings_vs_highest: comparison.savings_vs_highest,
      savings_pct: comparison.savings_pct_vs_highest,
      vault_price: comparison.vault_price,
      savings_vs_vault: comparison.savings_vs_vault,
      all_results: comparison.results,
    } as PriceComparisonCard,
    // Add supplier cards for each result
    ...comparison.results.map(r => ({
      type: 'supplier_info_card' as const,
      supplier_name: r.supplier_name,
      price: r.price,
      unit: r.unit,
      in_stock: r.in_stock,
      lead_time_days: r.lead_time_days,
      minimum_order: r.minimum_order,
      sku: r.sku,
      notes: r.notes,
    } as SupplierInfoCard)),
  ];

  return { speak, display };
}

function buildAlternativesResponse(
  itemName: string,
  alternatives: AlternativeProduct[],
): ScoutMaterialResponse {
  const displayName = itemName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  if (alternatives.length === 0) {
    return {
      speak: `I couldn't find any catalogued alternatives for ${displayName}. Check with your distributor for substitutions.`,
      display: [{
        type: 'no_results_card',
        query: itemName,
        message: `No alternatives found for ${displayName}.`,
        suggestions: ['Contact your local supplier', 'Check manufacturer cross-reference guides'],
      }],
    };
  }

  const speak = `Found ${alternatives.length} alternative${alternatives.length !== 1 ? 's' : ''} for ${displayName}: ` +
    alternatives.map(a => {
      const best = a.pricing.length > 0
        ? a.pricing.reduce((min, r) => r.price < min.price ? r : min)
        : null;
      return best
        ? `${a.product_name} (best at $${best.price.toFixed(2)} from ${best.supplier_name})`
        : a.product_name;
    }).join(', ') + '.';

  const display: ScoutDisplayComponent[] = alternatives.map(alt => {
    const best = alt.pricing.length > 0
      ? alt.pricing.reduce((min, r) => r.price < min.price ? r : min)
      : null;

    return {
      type: 'alternative_product_card',
      product_name: alt.product_name,
      brand: alt.brand,
      description: alt.description,
      best_price: best?.price ?? 0,
      best_supplier: best?.supplier_name ?? 'Unknown',
      unit: best?.unit ?? '',
      compatibility_notes: alt.compatibility_notes,
    } as AlternativeProductCard;
  });

  return { speak, display };
}

function buildLeadTimeResponse(
  itemName: string,
  results: SupplierResult[],
  supplierName: string | null,
): ScoutMaterialResponse {
  const displayName = itemName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  const filtered = supplierName
    ? results.filter(r => r.supplier_name === supplierName)
    : results;

  if (filtered.length === 0) {
    return {
      speak: `No lead time data found for ${displayName}${supplierName ? ` from ${supplierName}` : ''}.`,
      display: [{
        type: 'no_results_card',
        query: itemName,
        message: 'No lead time data available.',
        suggestions: ['Contact supplier directly', 'Check their online availability portal'],
      }],
    };
  }

  const inStock = filtered.filter(r => r.in_stock);
  const outOfStock = filtered.filter(r => !r.in_stock);

  let speak = `Lead times for ${displayName}: `;
  if (inStock.length > 0) {
    speak += `${inStock.map(r => r.supplier_name).join(', ')} ${inStock.length === 1 ? 'has' : 'have'} it in stock for immediate pickup. `;
  }
  if (outOfStock.length > 0) {
    speak += outOfStock.map(r => `${r.supplier_name} is out of stock with a ${r.lead_time_days}-day lead time`).join(', ') + '.';
  }

  const display: ScoutDisplayComponent[] = filtered.map(r => {
    const severity: LeadTimeAlert['severity'] =
      !r.in_stock && r.lead_time_days >= 7 ? 'critical'
      : !r.in_stock && r.lead_time_days >= 3 ? 'warning'
      : 'info';

    return {
      type: 'lead_time_alert',
      item_name: displayName,
      supplier_name: r.supplier_name,
      lead_time_days: r.lead_time_days,
      severity,
      message: r.in_stock
        ? `${r.supplier_name}: In stock — same-day available.`
        : `${r.supplier_name}: Out of stock — ${r.lead_time_days}-day lead time.`,
    } as LeadTimeAlert;
  });

  return { speak, display };
}

function buildSupplierInfoResponse(
  itemName: string,
  results: SupplierResult[],
  supplierName: string | null,
): ScoutMaterialResponse {
  const displayName = itemName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  const filtered = supplierName
    ? results.filter(r => r.supplier_name === supplierName)
    : results;

  if (filtered.length === 0) {
    return {
      speak: `No supplier data found for ${displayName}.`,
      display: [{
        type: 'no_results_card',
        query: itemName,
        message: `No supplier data for ${displayName}.`,
        suggestions: ['Try a different item name', 'Contact supplier directly'],
      }],
    };
  }

  const speak = supplierName
    ? `${supplierName} has ${displayName} at $${filtered[0].price.toFixed(2)} per ${filtered[0].unit}. ` +
      `Minimum order: ${filtered[0].minimum_order}. ` +
      (filtered[0].in_stock ? 'In stock.' : `Out of stock — ${filtered[0].lead_time_days}-day lead time.`)
    : `Found ${filtered.length} suppliers for ${displayName}. Use the cards below for details on each supplier's requirements.`;

  const display: ScoutDisplayComponent[] = filtered.map(r => ({
    type: 'supplier_info_card',
    supplier_name: r.supplier_name,
    price: r.price,
    unit: r.unit,
    in_stock: r.in_stock,
    lead_time_days: r.lead_time_days,
    minimum_order: r.minimum_order,
    sku: r.sku,
    notes: r.notes,
  } as SupplierInfoCard));

  return { speak, display };
}

function buildPriceAlertsResponse(alerts: PriceAlert[]): ScoutMaterialResponse {
  if (alerts.length === 0) {
    return {
      speak: 'No significant price changes detected across your material cache. All prices are stable.',
      display: [{
        type: 'no_results_card',
        query: 'price alerts',
        message: 'No price changes exceed the 5% alert threshold.',
        suggestions: ['Check back after refreshing material pricing'],
      }],
    };
  }

  const critCount = alerts.filter(a => a.severity === 'critical').length;
  const warnCount = alerts.filter(a => a.severity === 'warning').length;

  const speak = `Price alert: ${alerts.length} material${alerts.length !== 1 ? 's' : ''} changed more than 5%. ` +
    (critCount > 0 ? `${critCount} critical (20%+ change). ` : '') +
    (warnCount > 0 ? `${warnCount} warning-level changes. ` : '') +
    `Biggest mover: ${alerts[0].item_name} at ${alerts[0].supplier_name} ` +
    `${alerts[0].direction === 'up' ? 'up' : 'down'} ${Math.abs(alerts[0].change_pct).toFixed(1)}%.`;

  const display: ScoutDisplayComponent[] = alerts.map(alert => ({
    type: 'price_alert_card',
    item_name: alert.item_name,
    supplier_name: alert.supplier_name,
    previous_price: alert.previous_price,
    current_price: alert.current_price,
    change_pct: alert.change_pct,
    direction: alert.direction,
    severity: alert.severity,
  } as PriceAlertCard));

  return { speak, display };
}

// ─── handleMaterialQuery ───────────────────────────────────────────────────────

/**
 * Main query handler for SCOUT Material Intelligence.
 * Parses intent, fetches data, and returns a structured response
 * ready for NEXUS to forward to the UI and voice synthesis.
 */
export async function handleMaterialQuery(
  query: string,
): Promise<ScoutMaterialResponse> {
  const { intent, itemName, supplierName, category } = parseIntent(query);

  // Price alerts don't require an item name
  if (intent === 'price_alerts') {
    const alerts = await checkPriceChanges();
    return buildPriceAlertsResponse(alerts);
  }

  // All other intents need an item name
  if (!itemName) {
    return {
      speak: "I need a specific material to look up. Try asking about something like '12 AWG THHN wire' or a Square D 20A breaker.",
      display: [{
        type: 'no_results_card',
        query,
        message: 'No material name detected in your query.',
        suggestions: [
          'THHN wire 12 AWG',
          'Square D 20A single pole breaker',
          '3/4 EMT conduit',
          'Leviton 20A tamper resistant receptacle',
        ],
      }],
    };
  }

  // Fetch pricing data
  const results = await searchMaterialPricing(itemName, category ?? undefined);

  if (results.length === 0) {
    return {
      speak: `I couldn't find pricing data for "${itemName}" in my catalog. It may not be indexed yet, or try a more specific product name.`,
      display: [{
        type: 'no_results_card',
        query: itemName,
        message: `No pricing data found for "${itemName}".`,
        suggestions: [
          'Check spelling and try again',
          'Try a brand name (e.g., Square D, Leviton, Eaton)',
          'Contact your distributor directly',
        ],
      }],
    };
  }

  // Route to appropriate response builder by intent
  switch (intent) {
    case 'comparison':
      return buildComparisonResponse(itemName, results, comparePrices(results, itemName));

    case 'alternative': {
      const alternatives = await findAlternatives(itemName);
      return buildAlternativesResponse(itemName, alternatives);
    }

    case 'lead_time':
      return buildLeadTimeResponse(itemName, results, supplierName);

    case 'supplier_requirements':
      return buildSupplierInfoResponse(itemName, results, supplierName);

    case 'price_check':
    default:
      return buildPriceCheckResponse(itemName, results, comparePrices(results, itemName));
  }
}
