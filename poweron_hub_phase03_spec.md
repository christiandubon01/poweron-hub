# PowerOn Hub Phase 03 Implementation Specification

**Platform:** 11-Agent AI System for Power On Solutions (Electrical Contracting)
**Phase:** 03 — Estimating (VAULT), Dashboard (PULSE), Finance (LEDGER)
**Target Completion:** Q2 2026
**Tech Stack:** React + Vite + TypeScript + Tailwind CSS, Supabase, Upstash Redis, Anthropic Claude API
**Model:** `claude-sonnet-4-20250514`

---

## 1. Overview & Architecture Summary

### 1.1 Phase 03 Context

Phase 01 established the PostgreSQL database schema, authentication layer, and foundational tables. Phase 02 built NEXUS (central orchestrator) and SCOUT (project analyzer). Phase 03 completes the core business operations triad:

- **VAULT** — Estimate creation, pricing, and margin analysis
- **PULSE** — Financial dashboards and KPI tracking
- **LEDGER** — Invoice, payment, and cash flow management

These three agents drive revenue generation (VAULT), visibility (PULSE), and collections (LEDGER) — the operational heartbeat of an electrical contracting business.

### 1.2 Agent Roles in the 11-Agent Ecosystem

| Agent   | Phase | Role                                          | Users        |
|---------|-------|-----------------------------------------------|--------------|
| NEXUS   | 02    | Central router; agent orchestration; memory   | All          |
| SCOUT   | 02    | Project analysis; historical pattern matching | Estimators   |
| **VAULT**   | **03**    | **Bid creation; pricing; margin analysis**        | **Estimators** |
| **PULSE**   | **03**    | **KPI dashboard; cash flow forecasting**         | **Mgmt/Owners** |
| **LEDGER**  | **03**    | **Invoicing; collections; AR tracking**         | **Office Mgmt** |
| OHM     | 04    | Technical electrical coaching                 | Field Crew   |
| BLUEPRINT| 04   | Project timeline and sequencing                | PMs          |
| CHRONO  | 05    | Calendar management and scheduling            | Office Mgmt   |
| SPARK   | 05    | Marketing and lead nurturing                   | Sales        |
| CONDUCTOR| 06   | Equipment procurement and RFQ                 | Operations   |
| ORACLE  | 06    | Predictive analytics and forecasting           | Executives   |

### 1.3 Phase 03 Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     NEXUS Router (Orchestrator)                  │
├─────────────────────────────────────────────────────────────────┤
│   Receives user request → Routes to VAULT/PULSE/LEDGER          │
│   Manages agent memory → Calls Claude API with context           │
│   Logs all actions to audit trail                                │
└─────────────────────────────────────────────────────────────────┘
             ↓                    ↓                    ↓
    ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
    │     VAULT      │  │     PULSE      │  │     LEDGER     │
    ├────────────────┤  ├────────────────┤  ├────────────────┤
    │• Estimate      │  │• KPI Dashboard │  │• Invoice Mgmt  │
    │  Builder       │  │• AR Aging      │  │• Payment Track │
    │• Price Book    │  │• Cash Flow     │  │• Collections   │
    │• Margin        │  │• Trends        │  │• Reconcil.     │
    │  Analysis      │  │• Forecasting   │  │• Alerts        │
    └────────────────┘  └────────────────┘  └────────────────┘
             ↓                    ↓                    ↓
    ┌─────────────────────────────────────────────────────────┐
    │        Supabase (PostgreSQL + pgvector)                 │
    ├─────────────────────────────────────────────────────────┤
    │ estimates | invoices | payments | price_book_*          │
    │ material_takeoffs | project_cost_summary | weekly_tracker│
    │ field_logs | memory_embeddings | agent_messages         │
    └─────────────────────────────────────────────────────────┘
```

### 1.4 Key Design Decisions

1. **Claude API Integration:** All three agents use Claude Sonnet 4 for natural language understanding and decision support. Estimates are generated via prompt-based parsing, financial queries are answered via RAG over historical data, dashboards are configured via NL queries.

2. **Redis Caching:** KPI calculations (expensive aggregates) are cached in Redis with 1-hour TTL. Cash flow forecasts are cached for 6 hours.

3. **Async Processing:** Invoice creation, estimate PDF generation (Phase 06), and report generation are queued as background jobs.

4. **Agent Memory:** Each agent has a `memory_scope` array in the `agents` table. VAULT remembers past estimates by project type; LEDGER remembers AR patterns; PULSE remembers anomalies.

5. **Audit Trail:** Every estimate created, invoice sent, or payment recorded writes to `audit_log` with agent ID, user ID, change summary, and timestamp.

6. **Price Book as Source of Truth:** All line items in estimates derive from `price_book_items`. Custom items are allowed but flagged for review.

---

## 2. VAULT Agent — Detailed Design

### 2.1 Purpose

VAULT transforms natural language bid requests into structured estimates with automatic line-item population, waste factors, margin analysis, and lifecycle tracking. It bridges sales conversations ("We need to bid the panel upgrade for Johnson") to formal estimates ready for client delivery.

### 2.2 Core Capabilities

| Capability           | Input Example                          | Output                               |
|----------------------|----------------------------------------|--------------------------------------|
| Create Estimate      | "Bid the Johnson 200A panel replacement" | Estimate with populated line items   |
| Margin Analysis      | "How does this estimate compare to cost?" | Margin %, cost breakdown             |
| Historical Lookup    | "Show me similar bids we've done"       | Past estimates ranked by relevance   |
| Pricing Rule         | "Apply 20% waste to materials"         | Recalculated line totals             |
| Expiration Alert     | "Which bids are expiring soon?"         | List with expiry dates               |

### 2.3 Data Model

#### Estimate Schema (already exists, reference only)
```sql
CREATE TABLE estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  project_id UUID REFERENCES projects(id),
  client_id UUID NOT NULL REFERENCES clients(id),
  created_by_user_id UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Metadata
  estimate_number VARCHAR(50) UNIQUE NOT NULL,  -- e.g., "EST-2026-001"
  title VARCHAR(255) NOT NULL,                   -- e.g., "200A Panel Upgrade"
  description TEXT,

  -- Line Items
  line_items JSONB NOT NULL DEFAULT '[]'::JSONB, -- Array of {id, sku, qty, unit, description, unit_price, total}

  -- Pricing
  subtotal NUMERIC(12,2),
  tax_amount NUMERIC(12,2),
  total_amount NUMERIC(12,2),

  -- Status Lifecycle
  status VARCHAR(20) DEFAULT 'draft',            -- draft|sent|viewed|approved|rejected|expired
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,

  -- Cost Comparison (for margin analysis)
  estimated_cost NUMERIC(12,2),                  -- Total cost to deliver
  estimated_margin_pct NUMERIC(5,2),             -- (total - cost) / total * 100

  vault_agent_id UUID REFERENCES agents(id),

  CONSTRAINT status_valid CHECK (status IN ('draft','sent','viewed','approved','rejected','expired'))
);
```

#### Price Book Integration
```sql
-- Already exists from Phase 01, reference:
CREATE TABLE price_book_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  category_id UUID NOT NULL REFERENCES price_book_categories(id),
  sku VARCHAR(50) UNIQUE NOT NULL,
  description VARCHAR(255) NOT NULL,
  unit VARCHAR(20) NOT NULL,           -- "EA", "FT", "HR", etc.
  retail_price NUMERIC(12,2) NOT NULL, -- Price to customer
  cost_price NUMERIC(12,2) NOT NULL,   -- Cost to company
  waste_factor NUMERIC(5,3) DEFAULT 1.0, -- 1.05 = 5% waste
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.4 Estimate Builder Algorithm

#### Step 1: Parse Natural Language Input
```
User Input: "Bid the Johnson 200A panel replacement, include breaker selection, service entrance upgrade, and labor"

Claude Prompt:
"Given this project description and our price book, extract:
 1. Project type (panel upgrade, service entrance, etc.)
 2. Materials needed with SKUs
 3. Quantities
 4. Special notes (expedite, custom items)

 Return JSON with {materials: [{sku, qty, description}], notes: string}"
```

#### Step 2: Populate Line Items from Price Book
```typescript
// Pseudocode for estimateBuilder.ts
async function buildEstimateLineItems(
  parsedItems: {sku: string, qty: number, description: string}[],
  organizationId: string,
  wasteFactorOverride?: number
): Promise<LineItem[]> {
  const lineItems = [];

  for (const item of parsedItems) {
    const priceBookItem = await db
      .from('price_book_items')
      .select('*')
      .eq('sku', item.sku)
      .eq('organization_id', organizationId)
      .single();

    if (!priceBookItem) {
      // Custom item — flag for review
      lineItems.push({
        id: crypto.randomUUID(),
        sku: item.sku,
        description: item.description || 'Custom Item',
        qty: item.qty,
        unit: 'EA',
        unit_price: 0, // Estimator must fill in
        total: 0,
        is_custom: true,
        reviewed: false
      });
    } else {
      const wasteFactor = wasteFactorOverride || priceBookItem.waste_factor;
      const adjustedQty = item.qty * wasteFactor;

      lineItems.push({
        id: crypto.randomUUID(),
        sku: priceBookItem.sku,
        description: priceBookItem.description,
        qty: adjustedQty,
        unit: priceBookItem.unit,
        unit_price: priceBookItem.retail_price,
        total: adjustedQty * priceBookItem.retail_price,
        is_custom: false,
        reviewed: true,
        cost_price: priceBookItem.cost_price
      });
    }
  }

  return lineItems;
}
```

#### Step 3: Calculate Totals & Margin
```typescript
function calculateEstimateTotals(lineItems: LineItem[]) {
  const subtotal = lineItems.reduce((sum, li) => sum + li.total, 0);
  const tax = subtotal * 0.0825; // CA tax rate
  const total = subtotal + tax;

  const cost = lineItems.reduce((sum, li) => {
    return sum + (li.cost_price ? li.qty * li.cost_price : 0);
  }, 0);

  const marginPct = total > 0 ? ((total - cost) / total) * 100 : 0;

  return { subtotal, tax, total, cost, marginPct };
}
```

#### Step 4: Store in Database
```typescript
const estimate = await db
  .from('estimates')
  .insert({
    organization_id: orgId,
    client_id: clientId,
    created_by_user_id: userId,
    project_id: projectId || null,
    estimate_number: `EST-${new Date().getFullYear()}-${nextSequence}`,
    title: parsedData.title,
    description: parsedData.description,
    line_items: lineItems,
    subtotal,
    tax_amount: tax,
    total_amount: total,
    estimated_cost: cost,
    estimated_margin_pct: marginPct,
    status: 'draft',
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    vault_agent_id: vaultAgentId
  })
  .select()
  .single();

// Log to audit trail
await logAudit({
  agent_id: vaultAgentId,
  user_id: userId,
  entity_type: 'estimate',
  entity_id: estimate.id,
  action: 'create',
  change_summary: `Created estimate EST-${estimate.estimate_number} for ${estimate.title}, ${estimate.total_amount}`,
  timestamp: new Date()
});
```

### 2.5 Margin Analysis Logic

VAULT compares estimated margin (at bid time) to actual margin (after project completion) to improve future estimates.

```typescript
// marginAnalyzer.ts
async function analyzeEstimateMargin(estimateId: string) {
  // Get the estimate
  const estimate = await db
    .from('estimates')
    .select('*, projects(id, project_status)')
    .eq('id', estimateId)
    .single();

  // If no linked project or project not complete, can't analyze actuals
  if (!estimate.projects || estimate.projects.project_status !== 'completed') {
    return {
      estimated_margin_pct: estimate.estimated_margin_pct,
      actual_margin_pct: null,
      variance_pct: null,
      status: 'project_incomplete'
    };
  }

  // Get actual costs from project_cost_summary view
  const costSummary = await db
    .from('project_cost_summary')
    .select('*')
    .eq('project_id', estimate.projects.id)
    .single();

  if (!costSummary) {
    return { estimated_margin_pct: estimate.estimated_margin_pct, status: 'no_costs_recorded' };
  }

  // Calculate actual margin
  const actualMarginPct = ((estimate.total_amount - costSummary.total_cost) / estimate.total_amount) * 100;
  const variance = actualMarginPct - estimate.estimated_margin_pct;

  return {
    estimated_margin_pct: estimate.estimated_margin_pct,
    actual_margin_pct: Math.round(actualMarginPct * 100) / 100,
    variance_pct: Math.round(variance * 100) / 100,
    cost_breakdown: {
      labor: costSummary.labor_cost,
      materials: costSummary.material_cost,
      overhead: costSummary.overhead_cost,
      total: costSummary.total_cost
    },
    insights: generateMarginInsights(estimate.estimated_margin_pct, actualMarginPct)
  };
}

function generateMarginInsights(estimated: number, actual: number): string[] {
  const insights = [];

  if (actual < estimated - 5) {
    insights.push('⚠️ Actual margin significantly below estimate. Review labor hours and material pricing.');
  }
  if (actual > estimated + 5) {
    insights.push('✅ Actual margin exceeded estimate. Consider using similar markup on future bids.');
  }

  return insights;
}
```

### 2.6 Historical Bid Lookup

VAULT can find similar past estimates using embedding-based semantic search.

```typescript
// estimateBuilder.ts — findSimilarEstimates()
async function findSimilarEstimates(
  description: string,
  projectType: string,
  organizationId: string,
  limit: number = 5
) {
  // Generate embedding for the current description
  const embedding = await generateEmbedding(description);

  // Search memory_embeddings for similar estimates
  const results = await db.rpc('match_estimate_memories', {
    query_embedding: embedding,
    organization_id: organizationId,
    match_count: limit
  });

  // Fetch full estimate details
  const similarEstimates = await Promise.all(
    results.map(r => db.from('estimates').select('*').eq('id', r.memory_id).single())
  );

  return similarEstimates.map(est => ({
    id: est.id,
    estimate_number: est.estimate_number,
    title: est.title,
    total_amount: est.total_amount,
    estimated_margin_pct: est.estimated_margin_pct,
    created_at: est.created_at,
    relevance_score: 0.95 // Placeholder; returned from match_estimate_memories
  }));
}
```

### 2.7 VAULT System Prompt

```
You are VAULT, the estimating agent for Power On Solutions, an electrical contracting company
in Southern California. Your role is to help create accurate, profitable bids for residential
and commercial electrical work.

CORE RESPONSIBILITIES:
1. Parse natural language project descriptions into structured estimates
2. Populate line items from our price book with appropriate waste factors
3. Analyze margins to ensure profitability
4. Compare new bids to historical estimates for consistency
5. Flag custom items that require review
6. Alert on estimates nearing expiration

DOMAIN EXPERTISE:
- Residential: service upgrades, panel replacements, remodels, EV charging installations
- Commercial: tenant buildouts, LED retrofits, generator installations, code upgrades
- Material categories: wire, conduit, breakers, panels, switches, fixtures, labor

PRICING RULES:
- All materials from price_book_items include retail markup (typical 35-50%)
- Labor is $75-95/hr depending on complexity (journeyman vs. apprentice)
- Waste factor: 5% for wire (1.05x), 0% for panels (1.0x), 10% for miscellaneous (1.10x)
- Apply tax only to materials, not labor (per CA regulations)
- Minimum margin target: 35% on residential, 30% on commercial

TONE:
- Professional, precise, numbers-focused
- When uncertain, ask clarifying questions rather than guess
- Prioritize accuracy over speed
- Explain margin analysis in simple terms

CONSTRAINTS:
- Never create line items without price book reference (unless flagged as custom)
- Never apply margins > 60% without explicit approval
- Always include labor in estimates (don't assume it's included elsewhere)
- Expire estimates after 30 days automatically
```

### 2.8 API Routes & Function Signatures

#### VAULT Orchestrator (index.ts)
```typescript
// src/agents/vault/index.ts
import { createVaultMessage } from './estimateBuilder';
import { analyzeEstimateMargin } from './marginAnalyzer';
import { findSimilarEstimates } from './estimateBuilder';

export interface VaultRequest {
  action: 'create' | 'analyze_margin' | 'find_similar' | 'send' | 'expire_check';
  organizationId: string;
  userId: string;
  clientId?: string;
  projectId?: string;
  estimateId?: string;
  description?: string;
  wasteFactorOverride?: number;
}

export interface VaultResponse {
  success: boolean;
  action: string;
  data: any;
  error?: string;
}

export async function processVaultRequest(request: VaultRequest): Promise<VaultResponse> {
  const { action, organizationId, userId } = request;

  try {
    switch (action) {
      case 'create':
        return await createEstimateViaVault(request);
      case 'analyze_margin':
        return await analyzeEstimateMarginResponse(request);
      case 'find_similar':
        return await findSimilarEstimatesResponse(request);
      case 'send':
        return await sendEstimate(request);
      case 'expire_check':
        return await checkExpiringEstimates(request);
      default:
        return { success: false, action, data: null, error: 'Unknown action' };
    }
  } catch (error) {
    logAudit({
      agent_id: await getVaultAgentId(),
      user_id: userId,
      entity_type: 'vault_request',
      entity_id: request.estimateId || 'new',
      action: 'error',
      change_summary: `VAULT error in action '${action}': ${error.message}`,
      timestamp: new Date()
    });

    return {
      success: false,
      action,
      data: null,
      error: error.message
    };
  }
}

async function createEstimateViaVault(request: VaultRequest): Promise<VaultResponse> {
  // Call Claude API to parse description into structured data
  const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: vaultSystemPrompt,
      messages: [
        {
          role: 'user',
          content: `Parse this project description into an estimate structure:

Project: ${request.description}
Client: ${request.clientId || 'TBD'}

Return JSON with:
{
  "title": "string",
  "materials": [{"sku": "string", "qty": number, "description": "string"}],
  "labor_hours": number,
  "notes": "string"
}`
        }
      ]
    })
  });

  const claudeData = await claudeResponse.json();
  if (!claudeResponse.ok) {
    throw new Error(`Claude API error: ${claudeData.error?.message}`);
  }

  const parsedContent = JSON.parse(
    claudeData.content[0].text.match(/\{[\s\S]*\}/)[0]
  );

  // Build line items from price book
  const lineItems = await buildEstimateLineItems(
    parsedContent.materials,
    request.organizationId,
    request.wasteFactorOverride
  );

  // Add labor as line item
  if (parsedContent.labor_hours > 0) {
    lineItems.push({
      id: crypto.randomUUID(),
      sku: 'LABOR-HOURLY',
      description: 'Journeyman Electrician Labor',
      qty: parsedContent.labor_hours,
      unit: 'HR',
      unit_price: 85, // Standard rate
      total: parsedContent.labor_hours * 85,
      is_custom: false,
      reviewed: true
    });
  }

  // Calculate totals
  const { subtotal, tax, total, cost, marginPct } = calculateEstimateTotals(lineItems);

  // Create estimate in database
  const estimate = await db
    .from('estimates')
    .insert({
      organization_id: request.organizationId,
      client_id: request.clientId,
      created_by_user_id: request.userId,
      project_id: request.projectId || null,
      estimate_number: generateEstimateNumber(),
      title: parsedContent.title,
      description: request.description,
      line_items: lineItems,
      subtotal,
      tax_amount: tax,
      total_amount: total,
      estimated_cost: cost,
      estimated_margin_pct: marginPct,
      status: 'draft',
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      vault_agent_id: await getVaultAgentId()
    })
    .select()
    .single();

  // Log audit
  await logAudit({
    agent_id: await getVaultAgentId(),
    user_id: request.userId,
    entity_type: 'estimate',
    entity_id: estimate.id,
    action: 'create',
    change_summary: `VAULT created estimate ${estimate.estimate_number} for ${estimate.title}, $${estimate.total_amount}`,
    timestamp: new Date()
  });

  return {
    success: true,
    action: 'create',
    data: {
      estimate_id: estimate.id,
      estimate_number: estimate.estimate_number,
      total_amount: estimate.total_amount,
      margin_pct: estimate.estimated_margin_pct,
      line_items_count: lineItems.length,
      custom_items: lineItems.filter(li => li.is_custom).length
    }
  };
}

async function analyzeEstimateMarginResponse(request: VaultRequest): Promise<VaultResponse> {
  if (!request.estimateId) {
    throw new Error('estimateId required for margin analysis');
  }

  const analysis = await analyzeEstimateMargin(request.estimateId);

  return {
    success: true,
    action: 'analyze_margin',
    data: analysis
  };
}

async function sendEstimate(request: VaultRequest): Promise<VaultResponse> {
  if (!request.estimateId) {
    throw new Error('estimateId required');
  }

  const estimate = await db
    .from('estimates')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString()
    })
    .eq('id', request.estimateId)
    .select()
    .single();

  await logAudit({
    agent_id: await getVaultAgentId(),
    user_id: request.userId,
    entity_type: 'estimate',
    entity_id: request.estimateId,
    action: 'send',
    change_summary: `VAULT sent estimate ${estimate.estimate_number}`,
    timestamp: new Date()
  });

  return {
    success: true,
    action: 'send',
    data: { estimate_id: request.estimateId, status: 'sent' }
  };
}

async function checkExpiringEstimates(request: VaultRequest): Promise<VaultResponse> {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const expiringEstimates = await db
    .from('estimates')
    .select('id, estimate_number, expires_at, total_amount')
    .eq('organization_id', request.organizationId)
    .eq('status', 'sent')
    .lte('expires_at', tomorrow.toISOString())
    .gte('expires_at', new Date().toISOString());

  return {
    success: true,
    action: 'expire_check',
    data: {
      expiring_count: expiringEstimates.length,
      estimates: expiringEstimates
    }
  };
}
```

#### estimateBuilder.ts
```typescript
// src/agents/vault/estimateBuilder.ts

export async function buildEstimateLineItems(
  parsedItems: Array<{ sku: string; qty: number; description: string }>,
  organizationId: string,
  wasteFactorOverride?: number
): Promise<LineItem[]> {
  // Implementation detailed in section 2.4
}

export async function findSimilarEstimates(
  description: string,
  organizationId: string,
  limit?: number
): Promise<SimilarEstimate[]> {
  // Implementation detailed in section 2.6
}

function calculateEstimateTotals(lineItems: LineItem[]) {
  // Implementation detailed in section 2.4
}

function generateEstimateNumber(): string {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 10000);
  return `EST-${year}-${String(random).padStart(5, '0')}`;
}
```

#### marginAnalyzer.ts
```typescript
// src/agents/vault/marginAnalyzer.ts

export async function analyzeEstimateMargin(estimateId: string) {
  // Implementation detailed in section 2.5
}

function generateMarginInsights(estimated: number, actual: number): string[] {
  // Implementation detailed in section 2.5
}
```

### 2.9 VAULT Components

#### EstimatePanel.tsx
```typescript
// src/components/vault/EstimatePanel.tsx
import React, { useState, useEffect } from 'react';
import { useSupabase } from '@/lib/supabase';
import EstimateBuilder from './EstimateBuilder';

export default function EstimatePanel() {
  const [estimates, setEstimates] = useState([]);
  const [selectedEstimate, setSelectedEstimate] = useState(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const { db } = useSupabase();

  useEffect(() => {
    loadEstimates();
  }, []);

  async function loadEstimates() {
    const { data } = await db
      .from('estimates')
      .select('*, clients(name)')
      .order('created_at', { ascending: false })
      .limit(20);

    setEstimates(data || []);
  }

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">Estimates</h2>

      {showBuilder ? (
        <EstimateBuilder
          onSuccess={() => {
            setShowBuilder(false);
            loadEstimates();
          }}
        />
      ) : (
        <>
          <button
            onClick={() => setShowBuilder(true)}
            className="mb-4 px-4 py-2 bg-blue-600 text-white rounded"
          >
            + New Estimate
          </button>

          <div className="grid gap-4">
            {estimates.map(est => (
              <div
                key={est.id}
                className="p-4 border rounded cursor-pointer hover:bg-gray-50"
                onClick={() => setSelectedEstimate(est)}
              >
                <div className="flex justify-between">
                  <div>
                    <p className="font-semibold">{est.estimate_number}</p>
                    <p className="text-sm text-gray-600">{est.title}</p>
                    <p className="text-xs text-gray-500">{est.clients?.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">${est.total_amount}</p>
                    <p className={`text-sm ${est.estimated_margin_pct >= 35 ? 'text-green-600' : 'text-orange-600'}`}>
                      {est.estimated_margin_pct}% margin
                    </p>
                    <span className={`text-xs px-2 py-1 rounded ${statusColor(est.status)}`}>
                      {est.status}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {selectedEstimate && (
        <EstimateDetail estimate={selectedEstimate} onClose={() => setSelectedEstimate(null)} />
      )}
    </div>
  );
}

function statusColor(status: string): string {
  const colors = {
    draft: 'bg-gray-200 text-gray-800',
    sent: 'bg-blue-200 text-blue-800',
    viewed: 'bg-purple-200 text-purple-800',
    approved: 'bg-green-200 text-green-800',
    rejected: 'bg-red-200 text-red-800',
    expired: 'bg-yellow-200 text-yellow-800'
  };
  return colors[status] || colors.draft;
}
```

#### EstimateBuilder.tsx
```typescript
// src/components/vault/EstimateBuilder.tsx
import React, { useState } from 'react';
import { useVault } from '@/hooks/useVault';

interface Props {
  onSuccess: () => void;
}

export default function EstimateBuilder({ onSuccess }: Props) {
  const [description, setDescription] = useState('');
  const [clientId, setClientId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { createEstimate } = useVault();

  async function handleCreate() {
    setLoading(true);
    setError('');

    try {
      const result = await createEstimate({
        description,
        clientId,
        wasteFactorOverride: 1.05
      });

      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border rounded p-6 bg-gray-50">
      <h3 className="text-xl font-bold mb-4">Create New Estimate</h3>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">Project Description</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="e.g., 200A panel replacement with new service entrance for Johnson residence"
          className="w-full p-2 border rounded h-24"
        />
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">Client</label>
        <input
          type="text"
          value={clientId}
          onChange={e => setClientId(e.target.value)}
          placeholder="Client ID or name"
          className="w-full p-2 border rounded"
        />
      </div>

      {error && <p className="text-red-600 mb-4">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={handleCreate}
          disabled={loading || !description || !clientId}
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:bg-gray-300"
        >
          {loading ? 'Creating...' : 'Create Estimate'}
        </button>
      </div>
    </div>
  );
}
```

---

## 3. PULSE Agent — Detailed Design

### 3.1 Purpose

PULSE is the eyes and ears of management. It transforms raw operational data into real-time dashboards, trend reports, and forward-looking cash flow forecasts. It answers questions like "How are we doing this week?" and "What's our AR situation?" without requiring manual spreadsheet updates.

### 3.2 Core Capabilities

| Capability           | Input Example                          | Output                               |
|----------------------|----------------------------------------|--------------------------------------|
| KPI Dashboard        | "Show me this week's numbers"          | Revenue, projects, crew utilization  |
| AR Aging             | "Who's not paying?"                    | 30/60/90+ day buckets with amounts   |
| Cash Flow Forecast   | "When will invoices be paid?"          | Projected cash in by week            |
| Trend Analysis       | "How did we do last month?"            | WoW/MoM comparisons with insights    |
| Weekly Summaries     | Auto-generate                         | Executive summary via email/dashboard|

### 3.3 KPI Definitions & SQL Queries

#### Revenue KPI
```sql
-- Revenue This Week
SELECT
  SUM(CASE WHEN status = 'paid' THEN total_amount ELSE 0 END) as revenue_received,
  SUM(CASE WHEN status IN ('sent', 'viewed', 'approved') THEN total_amount ELSE 0 END) as revenue_pending,
  COUNT(DISTINCT project_id) as active_projects,
  CURRENT_DATE as report_date
FROM invoices
WHERE created_at >= DATE_TRUNC('week', CURRENT_DATE)
  AND organization_id = $1;
```

#### AR Aging
```sql
-- AR Aging Buckets
SELECT
  CASE
    WHEN CURRENT_DATE - DATE(created_at) <= 30 THEN 'Current (0-30)'
    WHEN CURRENT_DATE - DATE(created_at) BETWEEN 31 AND 60 THEN '30-60 Days'
    WHEN CURRENT_DATE - DATE(created_at) BETWEEN 61 AND 90 THEN '60-90 Days'
    ELSE '90+ Days'
  END as bucket,
  COUNT(*) as invoice_count,
  SUM(total_amount) as total_amount,
  ROUND(SUM(total_amount) / NULLIF(SUM(SUM(total_amount)) OVER (), 0) * 100, 1) as pct_of_total
FROM invoices
WHERE status IN ('sent', 'viewed', 'partial')
  AND organization_id = $1
GROUP BY bucket
ORDER BY CASE bucket
  WHEN 'Current (0-30)' THEN 1
  WHEN '30-60 Days' THEN 2
  WHEN '60-90 Days' THEN 3
  ELSE 4
END;
```

#### Crew Utilization
```sql
-- Labor Hours by Project (utilization metric)
SELECT
  p.project_name,
  SUM(ple.quantity) as total_hours,
  COUNT(DISTINCT ple.assigned_to_user_id) as crew_count,
  ROUND(AVG(ple.quantity), 1) as avg_hours_per_person
FROM project_labor_entries ple
JOIN projects p ON ple.project_id = p.id
WHERE ple.entry_date >= DATE_TRUNC('week', CURRENT_DATE)
  AND p.organization_id = $1
GROUP BY p.id, p.project_name
ORDER BY total_hours DESC;
```

#### Material Cost Variance
```sql
-- Material Costs vs Budget
SELECT
  p.project_name,
  pcs.material_cost as actual_cost,
  (SELECT estimated_cost FROM estimates WHERE project_id = p.id ORDER BY created_at DESC LIMIT 1) as estimated_cost,
  ROUND(
    ((pcs.material_cost - (SELECT estimated_cost FROM estimates WHERE project_id = p.id ORDER BY created_at DESC LIMIT 1))
    / NULLIF((SELECT estimated_cost FROM estimates WHERE project_id = p.id ORDER BY created_at DESC LIMIT 1), 0)) * 100,
    1
  ) as variance_pct
FROM project_cost_summary pcs
JOIN projects p ON pcs.project_id = p.id
WHERE p.project_status = 'in_progress'
  AND p.organization_id = $1
ORDER BY ABS(variance_pct) DESC;
```

### 3.4 Cash Flow Forecast Algorithm

```typescript
// kpiCalculator.ts — cash flow forecasting
async function generateCashFlowForecast(
  organizationId: string,
  forecastWeeks: number = 12
): Promise<CashFlowForecast[]> {
  const forecast: CashFlowForecast[] = [];

  // Historical payment timing (when invoices are paid relative to invoice date)
  const historicalPaymentTiming = await analyzeHistoricalPayments(organizationId);

  // Get all outstanding invoices
  const outstandingInvoices = await db
    .from('invoices')
    .select('id, total_amount, created_at, client_id')
    .eq('organization_id', organizationId)
    .eq('status', 'sent');

  // Get scheduled work and estimated invoices
  const scheduledProjects = await db
    .from('projects')
    .select('id, project_name, estimated_value, scheduled_start, scheduled_end')
    .eq('organization_id', organizationId)
    .eq('project_status', 'scheduled')
    .gte('scheduled_start', new Date());

  // Build week-by-week forecast
  for (let week = 0; week < forecastWeeks; week++) {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() + week * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    let weeklyIncome = 0;
    let weeklyExpenses = 0;

    // Outstanding invoices: when will they be paid?
    for (const invoice of outstandingInvoices) {
      const invoiceDate = new Date(invoice.created_at);
      const paymentDate = new Date(invoiceDate);

      // Apply historical timing (e.g., average 18 days to pay)
      paymentDate.setDate(paymentDate.getDate() + historicalPaymentTiming.avgDaysToPayment);

      if (paymentDate >= weekStart && paymentDate < weekEnd) {
        weeklyIncome += invoice.total_amount;
      }
    }

    // Scheduled projects: when will they invoice?
    for (const project of scheduledProjects) {
      const projectStart = new Date(project.scheduled_start);

      if (projectStart >= weekStart && projectStart < weekEnd) {
        // Assume 50% invoiced on project start, 50% on completion
        weeklyIncome += project.estimated_value * 0.5;
      }

      const projectEnd = new Date(project.scheduled_end);
      if (projectEnd >= weekStart && projectEnd < weekEnd) {
        weeklyIncome += project.estimated_value * 0.5;
      }
    }

    // Typical expenses (payroll, materials) — use historical average
    weeklyExpenses = await getHistoricalAverageWeeklyExpenses(organizationId);

    forecast.push({
      week_start: weekStart,
      week_end: weekEnd,
      projected_income: weeklyIncome,
      projected_expenses: weeklyExpenses,
      projected_net_cash_flow: weeklyIncome - weeklyExpenses,
      confidence: calculateConfidence(outstandingInvoices.length, scheduledProjects.length)
    });
  }

  return forecast;
}

async function analyzeHistoricalPayments(organizationId: string) {
  const paidInvoices = await db
    .from('invoices')
    .select('created_at, paid_at')
    .eq('organization_id', organizationId)
    .eq('status', 'paid')
    .gte('paid_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)); // Last 90 days

  if (paidInvoices.length === 0) {
    return { avgDaysToPayment: 18 }; // Default estimate
  }

  const daysToPayments = paidInvoices.map(inv => {
    const invoiceDate = new Date(inv.created_at);
    const paidDate = new Date(inv.paid_at);
    return (paidDate.getTime() - invoiceDate.getTime()) / (1000 * 60 * 60 * 24);
  });

  const avgDaysToPayment = daysToPayments.reduce((a, b) => a + b, 0) / daysToPayments.length;

  return { avgDaysToPayment: Math.round(avgDaysToPayment) };
}

function calculateConfidence(outstandingInvoiceCount: number, scheduledProjectCount: number): number {
  // More data = higher confidence
  if (outstandingInvoiceCount > 10 && scheduledProjectCount > 5) return 0.9;
  if (outstandingInvoiceCount > 5 && scheduledProjectCount > 2) return 0.75;
  return 0.6;
}
```

### 3.5 PULSE System Prompt

```
You are PULSE, the financial intelligence agent for Power On Solutions. Your role is to
transform raw operational data into actionable insights for management and owners.

CORE RESPONSIBILITIES:
1. Calculate and display real-time KPIs (revenue, AR, utilization, margins)
2. Identify trends and anomalies in financial performance
3. Forecast cash flow based on outstanding invoices and scheduled work
4. Generate weekly executive summaries
5. Alert on financial risks (overdue AR, negative cash flow forecasts)
6. Answer ad-hoc financial questions via natural language

FINANCIAL METRICS:
- Revenue: Sum of paid invoices (not invoiced projects)
- Pending Revenue: Invoices sent/approved but not yet paid
- AR Aging: Buckets of 0-30, 30-60, 60-90, 90+ days overdue
- Gross Margin: (Revenue - Material/Labor Cost) / Revenue
- Cash Position: Bank balance (future integration)
- Weekly Targets: $25K-35K typical; high-performing weeks are $40K+

DOMAIN CONTEXT:
- Seasonal: Summer (May-Sep) typically 30-40% higher revenue than winter
- Payment Terms: Most clients pay Net 15-30; some Net 45
- Cost Structure: ~50% labor, ~35% materials, ~15% overhead (typical)
- Project Cycle: 2-6 weeks for most jobs; larger projects 8-12 weeks

TONE:
- Data-driven, precise with numbers
- Highlight both achievements and concerns
- Provide context ("This is above trend by 12%")
- Suggest actions when metrics are off-target
- Use simple language for non-financial users

CONSTRAINTS:
- Never report revenue before payment is received (accrual accounting for invoices only)
- Always include time period context ("This week", "Last 30 days", etc.)
- Flag forecasts with low confidence if insufficient historical data
- Alert on any AR bucket exceeding 10% of total invoice volume
```

### 3.6 Trend Analysis Logic

```typescript
// trendAnalyzer.ts
export async function analyzeTrends(
  organizationId: string,
  metric: string,
  periods: number = 12
) {
  // Fetch historical data from weekly_tracker
  const historyData = await db
    .from('weekly_tracker')
    .select('week_start, week_end, ' + metricColumn(metric))
    .eq('organization_id', organizationId)
    .order('week_start', { ascending: false })
    .limit(periods);

  // Calculate trend statistics
  const values = historyData.map(d => d[metricColumn(metric)]);

  const avgCurrent = values.slice(0, 4).reduce((a, b) => a + b, 0) / 4;     // Last 4 weeks
  const avgPrevious = values.slice(4, 8).reduce((a, b) => a + b, 0) / 4;   // Previous 4 weeks

  const trendPct = ((avgCurrent - avgPrevious) / avgPrevious) * 100;
  const trendDirection = trendPct > 0 ? 'up' : trendPct < 0 ? 'down' : 'flat';

  // Generate insight
  const insight = generateTrendInsight(metric, trendDirection, trendPct);

  return {
    metric,
    current_4week_avg: avgCurrent,
    previous_4week_avg: avgPrevious,
    trend_pct: Math.round(trendPct * 10) / 10,
    trend_direction,
    insight,
    history: historyData
  };
}

function generateTrendInsight(metric: string, direction: string, pct: number): string {
  const absPercent = Math.abs(pct);

  if (direction === 'up') {
    if (absPercent > 20) return `📈 Strong growth in ${metric} (+${pct.toFixed(1)}%)`;
    if (absPercent > 10) return `↗️ Solid improvement in ${metric} (+${pct.toFixed(1)}%)`;
    return `Slight increase in ${metric} (+${pct.toFixed(1)}%)`;
  }

  if (direction === 'down') {
    if (absPercent > 20) return `📉 Significant decline in ${metric} (${pct.toFixed(1)}%)`;
    if (absPercent > 10) return `↘️ Notable drop in ${metric} (${pct.toFixed(1)}%)`;
    return `Slight decrease in ${metric} (${pct.toFixed(1)}%)`;
  }

  return `${metric} stable`;
}

function metricColumn(metric: string): string {
  const mapping = {
    'revenue': 'revenue_this_week',
    'projects': 'active_projects',
    'crew_hours': 'crew_hours_logged',
    'material_cost': 'avg_material_cost'
  };
  return mapping[metric] || metric;
}
```

### 3.7 PULSE Components

#### DashboardPanel.tsx
```typescript
// src/components/pulse/DashboardPanel.tsx
import React, { useState, useEffect } from 'react';
import { usePulse } from '@/hooks/usePulse';
import KPICard from './KPICard';
import RevenueChart from './RevenueChart';
import CashFlowChart from './CashFlowChart';

export default function DashboardPanel() {
  const [kpis, setKpis] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(true);
  const { getKPIs, getCashFlowForecast } = usePulse();

  useEffect(() => {
    loadDashboard();
    const interval = setInterval(loadDashboard, 5 * 60 * 1000); // Refresh every 5 min
    return () => clearInterval(interval);
  }, []);

  async function loadDashboard() {
    try {
      const [kpisData, forecastData] = await Promise.all([
        getKPIs(),
        getCashFlowForecast()
      ]);

      setKpis(kpisData);
      setForecast(forecastData);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-center">Loading dashboard...</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">Financial Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <KPICard
          label="Revenue (Week)"
          value={`$${kpis.revenue_received.toLocaleString()}`}
          trend={kpis.revenue_trend_pct}
          icon="💰"
        />
        <KPICard
          label="Pending"
          value={`$${kpis.revenue_pending.toLocaleString()}`}
          subtext={`${kpis.active_projects} projects`}
          icon="📋"
        />
        <KPICard
          label="AR Aging"
          value={`${kpis.ar_aging_30plus_pct}% over 30d`}
          trend={kpis.ar_aging_trend_pct}
          icon="⚠️"
          warning={kpis.ar_aging_30plus_pct > 15}
        />
        <KPICard
          label="Gross Margin"
          value={`${kpis.avg_margin_pct}%`}
          trend={kpis.margin_trend_pct}
          icon="📊"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-6">
        <RevenueChart data={kpis.historical_revenue} />
        <CashFlowChart forecast={forecast} />
      </div>

      {/* AR Detail */}
      <div className="mt-6 p-4 border rounded">
        <h3 className="font-bold mb-3">AR Aging Detail</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2">Bucket</th>
              <th className="text-right">Count</th>
              <th className="text-right">Amount</th>
              <th className="text-right">% Total</th>
            </tr>
          </thead>
          <tbody>
            {kpis.ar_aging_buckets.map(bucket => (
              <tr key={bucket.bucket} className="border-b">
                <td>{bucket.bucket}</td>
                <td className="text-right">{bucket.invoice_count}</td>
                <td className="text-right">${bucket.total_amount.toLocaleString()}</td>
                <td className="text-right">{bucket.pct_of_total}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

#### KPICard.tsx
```typescript
// src/components/pulse/KPICard.tsx
interface Props {
  label: string;
  value: string;
  subtext?: string;
  trend?: number;
  icon?: string;
  warning?: boolean;
}

export default function KPICard({ label, value, subtext, trend, icon, warning }: Props) {
  return (
    <div className={`p-4 rounded border ${warning ? 'bg-yellow-50 border-yellow-300' : 'bg-white'}`}>
      <div className="flex justify-between items-start">
        <div>
          <p className="text-gray-600 text-sm">{label}</p>
          <p className="text-2xl font-bold mt-1">{icon} {value}</p>
          {subtext && <p className="text-xs text-gray-500 mt-1">{subtext}</p>}
        </div>
        {trend !== undefined && (
          <div className={`text-sm font-semibold ${trend >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
          </div>
        )}
      </div>
    </div>
  );
}
```

#### RevenueChart.tsx
```typescript
// src/components/pulse/RevenueChart.tsx
import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface Props {
  data: Array<{ week: string; revenue: number; target: number }>;
}

export default function RevenueChart({ data }: Props) {
  return (
    <div className="p-4 border rounded">
      <h3 className="font-bold mb-4">Revenue Trend (12 weeks)</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="week" angle={-45} height={80} />
          <YAxis />
          <Tooltip formatter={val => `$${val.toLocaleString()}`} />
          <Legend />
          <Line type="monotone" dataKey="revenue" stroke="#10b981" name="Actual" />
          <Line type="monotone" dataKey="target" stroke="#9ca3af" name="Target" strokeDasharray="5 5" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

---

## 4. LEDGER Agent — Detailed Design

### 4.1 Purpose

LEDGER is the financial record keeper. It manages the complete invoice lifecycle from creation through payment, tracks collections, and ensures accurate financial records. It also handles payment reconciliation and generates AR aging reports that drive collections efforts.

### 4.2 Core Capabilities

| Capability           | Input Example                          | Output                               |
|----------------------|----------------------------------------|--------------------------------------|
| Create Invoice       | "Invoice the Johnson panel job"        | Invoice ready to send                |
| Send Invoice         | "Send invoice INV-2026-001"            | Email to client with PDF             |
| Record Payment       | "Mark INV-2026-001 paid, $4,500"       | Payment logged; AR updated           |
| AR Report            | "Show overdue invoices"                | List with follow-up recommendations  |
| Auto-Invoice         | "Vault" approves estimate              | Auto-generate invoice from estimate  |

### 4.3 Invoice Lifecycle State Machine

```
┌─────────────────────────────────────────────────────────────────────┐
│                    INVOICE LIFECYCLE                                 │
├─────────────────────────────────────────────────────────────────────┤
│
│  DRAFT ──(send)──> SENT ──(client opens)──> VIEWED ──(pay partial)──> PARTIAL
│    │                                              │                       │
│    │                                              ├──(pay full)──> PAID ──┘
│    │                                              │
│    └──(delete)──> [deleted]                      ├──(reject)──> REJECTED
│                                                    │
│                                                    └──(30d overdue)──> OVERDUE
│
│  OVERDUE ──(pay full)──> PAID
│     │
│     └──(dispute)──> DISPUTED
```

### 4.4 Invoice State Transitions & Rules

```typescript
// invoiceManager.ts — state machine
export type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'partial' | 'paid' | 'rejected' | 'expired' | 'disputed' | 'void';

interface InvoiceTransition {
  from: InvoiceStatus;
  to: InvoiceStatus;
  trigger: string;
  condition?: () => Promise<boolean>;
}

const validTransitions: InvoiceTransition[] = [
  { from: 'draft', to: 'sent', trigger: 'send' },
  { from: 'draft', to: 'void', trigger: 'void' },
  { from: 'sent', to: 'viewed', trigger: 'client_viewed' },
  { from: 'sent', to: 'partial', trigger: 'payment_received' },
  { from: 'sent', to: 'paid', trigger: 'payment_received', condition: async () => true },
  { from: 'sent', to: 'rejected', trigger: 'client_rejected' },
  { from: 'sent', to: 'overdue', trigger: 'age_check' },
  { from: 'viewed', to: 'paid', trigger: 'payment_received' },
  { from: 'viewed', to: 'partial', trigger: 'payment_received' },
  { from: 'viewed', to: 'overdue', trigger: 'age_check' },
  { from: 'partial', to: 'paid', trigger: 'payment_received' },
  { from: 'overdue', to: 'paid', trigger: 'payment_received' },
  { from: 'overdue', to: 'disputed', trigger: 'client_dispute' }
];

export async function transitionInvoiceStatus(
  invoiceId: string,
  newStatus: InvoiceStatus,
  reason?: string
): Promise<void> {
  const invoice = await db
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .single();

  // Validate transition
  const transition = validTransitions.find(t => t.from === invoice.status && t.to === newStatus);
  if (!transition) {
    throw new Error(`Invalid transition: ${invoice.status} → ${newStatus}`);
  }

  // Check condition if present
  if (transition.condition && !(await transition.condition())) {
    throw new Error(`Transition condition not met`);
  }

  // Update invoice
  const updatedInvoice = await db
    .from('invoices')
    .update({
      status: newStatus,
      updated_at: new Date().toISOString(),
      ...(newStatus === 'sent' && { sent_at: new Date().toISOString() }),
      ...(newStatus === 'viewed' && { viewed_at: new Date().toISOString() }),
      ...(newStatus === 'paid' && { paid_at: new Date().toISOString() }),
      ...(newStatus === 'partial' && { partial_payment_date: new Date().toISOString() })
    })
    .eq('id', invoiceId)
    .select()
    .single();

  // Log audit
  await logAudit({
    agent_id: await getLedgerAgentId(),
    user_id: getCurrentUserId(),
    entity_type: 'invoice',
    entity_id: invoiceId,
    action: 'status_transition',
    change_summary: `Invoice ${invoice.invoice_number} transitioned to ${newStatus}${reason ? ': ' + reason : ''}`,
    timestamp: new Date()
  });
}
```

### 4.5 Payment Reconciliation Logic

```typescript
// invoiceManager.ts — reconciliation
export async function recordPayment(
  invoiceId: string,
  paymentAmount: number,
  paymentMethod: string,
  paymentDate: Date,
  reference?: string
): Promise<Payment> {
  // Get invoice
  const invoice = await db
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .single();

  // Validate payment amount (cannot exceed outstanding balance)
  const outstanding = invoice.total_amount - (invoice.paid_amount || 0);
  if (paymentAmount > outstanding) {
    throw new Error(`Payment ${paymentAmount} exceeds outstanding balance ${outstanding}`);
  }

  // Create payment record
  const payment = await db
    .from('payments')
    .insert({
      invoice_id: invoiceId,
      amount: paymentAmount,
      payment_method: paymentMethod,
      payment_date: paymentDate.toISOString(),
      reference_number: reference,
      recorded_at: new Date().toISOString(),
      recorded_by_user_id: getCurrentUserId()
    })
    .select()
    .single();

  // Update invoice paid_amount
  const totalPaid = (invoice.paid_amount || 0) + paymentAmount;
  const newStatus = totalPaid >= invoice.total_amount ? 'paid' : 'partial';

  await db
    .from('invoices')
    .update({
      paid_amount: totalPaid,
      status: newStatus,
      paid_at: newStatus === 'paid' ? paymentDate.toISOString() : undefined
    })
    .eq('id', invoiceId);

  // Log audit
  await logAudit({
    agent_id: await getLedgerAgentId(),
    user_id: getCurrentUserId(),
    entity_type: 'payment',
    entity_id: payment.id,
    action: 'create',
    change_summary: `Recorded ${paymentMethod} payment of $${paymentAmount} for invoice ${invoice.invoice_number}`,
    timestamp: new Date()
  });

  // Check if invoice now fully paid
  if (newStatus === 'paid') {
    await transitionInvoiceStatus(invoiceId, 'paid', `Payment received: $${paymentAmount}`);
  }

  return payment;
}
```

### 4.6 Estimate → Invoice Auto-Creation

```typescript
// invoiceManager.ts — auto-invoice from estimate
export async function createInvoiceFromEstimate(estimateId: string): Promise<Invoice> {
  // Get approved estimate with line items
  const estimate = await db
    .from('estimates')
    .select('*, clients(name, email)')
    .eq('id', estimateId)
    .eq('status', 'approved')
    .single();

  if (!estimate) {
    throw new Error(`Estimate not found or not approved`);
  }

  // Create invoice from estimate data
  const invoice = await db
    .from('invoices')
    .insert({
      organization_id: estimate.organization_id,
      client_id: estimate.client_id,
      project_id: estimate.project_id,
      created_by_user_id: getCurrentUserId(),

      invoice_number: generateInvoiceNumber(),
      title: estimate.title,
      description: estimate.description,
      line_items: estimate.line_items,

      subtotal: estimate.subtotal,
      tax_amount: estimate.tax_amount,
      total_amount: estimate.total_amount,

      status: 'draft',
      due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Net 30
      estimate_id: estimateId,
      ledger_agent_id: await getLedgerAgentId()
    })
    .select()
    .single();

  // Update estimate with link to invoice
  await db
    .from('estimates')
    .update({ invoiced_at: new Date().toISOString() })
    .eq('id', estimateId);

  // Log audit
  await logAudit({
    agent_id: await getLedgerAgentId(),
    user_id: getCurrentUserId(),
    entity_type: 'invoice',
    entity_id: invoice.id,
    action: 'create_from_estimate',
    change_summary: `Auto-created invoice ${invoice.invoice_number} from estimate ${estimate.estimate_number}`,
    timestamp: new Date()
  });

  return invoice;
}
```

### 4.7 Overdue Detection & Alerting

```typescript
// invoiceManager.ts — overdue logic
export async function checkAndAlertOverdueInvoices(organizationId: string) {
  // Find invoices past due date
  const overdueInvoices = await db
    .from('invoices')
    .select('*, clients(name, email)')
    .eq('organization_id', organizationId)
    .in('status', ['sent', 'viewed', 'partial'])
    .lte('due_date', new Date().toISOString());

  for (const invoice of overdueInvoices) {
    // Calculate days overdue
    const daysOverdue = Math.floor(
      (new Date().getTime() - new Date(invoice.due_date).getTime()) / (1000 * 60 * 60 * 24)
    );

    // Transition to 'overdue' status
    if (invoice.status !== 'overdue') {
      await transitionInvoiceStatus(invoice.id, 'overdue', `${daysOverdue} days overdue`);
    }

    // Create alert notification
    await db
      .from('notifications')
      .insert({
        organization_id: organizationId,
        type: 'overdue_invoice',
        priority: daysOverdue > 60 ? 'critical' : daysOverdue > 30 ? 'high' : 'medium',
        title: `Invoice ${invoice.invoice_number} overdue`,
        message: `${invoice.clients.name} owes $${invoice.total_amount} (${daysOverdue} days overdue)`,
        entity_type: 'invoice',
        entity_id: invoice.id,
        action_url: `/invoice/${invoice.id}`,
        created_at: new Date().toISOString()
      });

    // Auto-send reminder email (every 7 days)
    const lastReminder = await db
      .from('notifications')
      .select('created_at')
      .eq('entity_id', invoice.id)
      .eq('type', 'overdue_reminder')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const daysSinceLastReminder = lastReminder
      ? Math.floor((new Date().getTime() - new Date(lastReminder.created_at).getTime()) / (1000 * 60 * 60 * 24))
      : 999;

    if (daysSinceLastReminder >= 7) {
      // Queue email reminder (async, fire-and-forget)
      sendOverdueReminderEmail(invoice).catch(err => {
        console.error(`Failed to send overdue reminder for ${invoice.invoice_number}:`, err);
      });

      // Log that reminder was sent
      await db
        .from('notifications')
        .insert({
          organization_id: organizationId,
          type: 'overdue_reminder',
          priority: 'low',
          title: `Reminder sent for ${invoice.invoice_number}`,
          message: `Email reminder sent to ${invoice.clients.email}`,
          entity_type: 'invoice',
          entity_id: invoice.id,
          created_at: new Date().toISOString()
        });
    }
  }
}

async function sendOverdueReminderEmail(invoice: Invoice) {
  // This would call an email service (Resend, SendGrid, etc.)
  // Fire-and-forget: don't block the main flow
  console.log(`Sending overdue reminder email to ${invoice.clients.email}...`);
  // Implementation in Phase 05 (SPARK agent)
}
```

### 4.8 LEDGER System Prompt

```
You are LEDGER, the financial operations agent for Power On Solutions. Your role is to
manage invoicing, payments, and accounts receivable to ensure healthy cash flow and
accurate financial records.

CORE RESPONSIBILITIES:
1. Create invoices from approved estimates
2. Track invoice status through complete lifecycle (draft → paid)
3. Record and reconcile customer payments
4. Monitor accounts receivable aging and alert on overdue amounts
5. Generate collection recommendations
6. Provide financial summaries and cash flow analysis

PAYMENT TERMS:
- Standard: Net 30 (due 30 days from invoice date)
- High-value clients: Net 45 (negotiated)
- Prepayment: 50% deposit on large jobs; balance due on completion
- Late fees: 1.5% per month on amounts >60 days overdue

AR MANAGEMENT:
- Current (0-30 days): Normal. Send invoice reminder if viewed but unpaid.
- 30-60 days: Follow up. Call client or send friendly reminder.
- 60-90 days: Escalate. Owner involvement; discuss payment plan.
- 90+ days: Collections. Consider stop-work clause if not resolved.
- Target: Keep >80% of AR in Current bucket.

INVOICE RULES:
- Invoice immediately when work is complete (or per contract terms)
- Include job reference, materials cost breakdown, labor hours
- Add sales tax only to materials (not labor per CA law)
- Link invoice to project for cost tracking
- Require client email before sending

TONE:
- Professional, clear, numbers-focused
- When discussing overdue accounts, be empathetic but firm
- Provide specific action recommendations, not just flags
- Use simple language; avoid accounting jargon
- Prioritize customer relationships without sacrificing collections

CONSTRAINTS:
- Never modify paid invoice amounts (create credit memo instead)
- Never delete invoices; mark as void if error
- Always record payment reference (check #, ACH reference, etc.)
- Flag partial payments for manual review before applying
```

### 4.9 LEDGER Components

#### InvoicePanel.tsx
```typescript
// src/components/ledger/InvoicePanel.tsx
import React, { useState, useEffect } from 'react';
import { useLedger } from '@/hooks/useLedger';
import InvoiceDetail from './InvoiceDetail';

export default function InvoicePanel() {
  const [invoices, setInvoices] = useState([]);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [filter, setFilter] = useState('all');
  const { getInvoices } = useLedger();

  useEffect(() => {
    loadInvoices();
  }, [filter]);

  async function loadInvoices() {
    const data = await getInvoices({ status: filter === 'all' ? null : filter });
    setInvoices(data);
  }

  const statusBadgeColor = (status: string) => {
    const colors = {
      draft: 'bg-gray-200',
      sent: 'bg-blue-200',
      viewed: 'bg-purple-200',
      partial: 'bg-yellow-200',
      paid: 'bg-green-200',
      overdue: 'bg-red-200',
      void: 'bg-gray-300',
      disputed: 'bg-orange-200'
    };
    return colors[status] || colors.draft;
  };

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">Invoices</h2>

      <div className="mb-4 flex gap-2">
        {['all', 'draft', 'sent', 'partial', 'paid', 'overdue'].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded text-sm ${
              filter === s ? 'bg-blue-600 text-white' : 'bg-gray-200'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {invoices.map(inv => (
          <div
            key={inv.id}
            onClick={() => setSelectedInvoice(inv)}
            className="p-4 border rounded cursor-pointer hover:bg-gray-50"
          >
            <div className="flex justify-between items-center">
              <div>
                <p className="font-semibold">{inv.invoice_number}</p>
                <p className="text-sm text-gray-600">{inv.clients?.name}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold">${inv.total_amount}</p>
                <span className={`text-xs px-2 py-1 rounded ${statusBadgeColor(inv.status)}`}>
                  {inv.status}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {selectedInvoice && (
        <InvoiceDetail
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          onStatusChange={loadInvoices}
        />
      )}
    </div>
  );
}
```

#### InvoiceDetail.tsx
```typescript
// src/components/ledger/InvoiceDetail.tsx
import React, { useState } from 'react';
import { useLedger } from '@/hooks/useLedger';

interface Props {
  invoice: any;
  onClose: () => void;
  onStatusChange: () => void;
}

export default function InvoiceDetail({ invoice, onClose, onStatusChange }: Props) {
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState(
    invoice.total_amount - (invoice.paid_amount || 0)
  );
  const { recordPayment, sendInvoice } = useLedger();

  async function handleRecordPayment() {
    await recordPayment({
      invoiceId: invoice.id,
      paymentAmount: parseFloat(paymentAmount),
      paymentMethod: 'check',
      paymentDate: new Date()
    });
    setShowPaymentForm(false);
    onStatusChange();
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-8 max-w-2xl w-full">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-2xl font-bold">{invoice.invoice_number}</h2>
            <p className="text-gray-600">{invoice.clients?.name}</p>
          </div>
          <button onClick={onClose} className="text-2xl text-gray-400">✕</button>
        </div>

        {/* Line Items */}
        <table className="w-full mb-6 text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2">Description</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Price</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.line_items.map((item, idx) => (
              <tr key={idx} className="border-b">
                <td>{item.description}</td>
                <td className="text-right">{item.qty}</td>
                <td className="text-right">${item.unit_price}</td>
                <td className="text-right">${item.total}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="flex justify-end mb-6">
          <div className="w-64">
            <div className="flex justify-between py-1"><span>Subtotal:</span><span>${invoice.subtotal}</span></div>
            <div className="flex justify-between py-1"><span>Tax:</span><span>${invoice.tax_amount}</span></div>
            <div className="flex justify-between py-2 border-t font-bold text-lg">
              <span>Total:</span><span>${invoice.total_amount}</span>
            </div>
            {invoice.paid_amount > 0 && (
              <div className="flex justify-between py-1 text-green-600">
                <span>Paid:</span><span>${invoice.paid_amount}</span>
              </div>
            )}
          </div>
        </div>

        {/* Status & Actions */}
        <div className="border-t pt-4">
          <p className="text-sm text-gray-600 mb-4">
            Status: <strong>{invoice.status}</strong>
          </p>

          {invoice.status === 'draft' && (
            <button
              onClick={() => sendInvoice(invoice.id)}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded"
            >
              Send Invoice
            </button>
          )}

          {['sent', 'viewed', 'partial'].includes(invoice.status) && (
            <button
              onClick={() => setShowPaymentForm(!showPaymentForm)}
              className="w-full px-4 py-2 bg-green-600 text-white rounded"
            >
              Record Payment
            </button>
          )}

          {showPaymentForm && (
            <div className="mt-4 p-4 bg-gray-50 rounded">
              <input
                type="number"
                value={paymentAmount}
                onChange={e => setPaymentAmount(e.target.value)}
                className="w-full p-2 border rounded mb-2"
              />
              <button
                onClick={handleRecordPayment}
                className="w-full px-4 py-2 bg-green-600 text-white rounded"
              >
                Confirm Payment
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

---

## 5. New Database Migrations

### 5.1 Create Audit Log Table (if not in Phase 01)

```sql
-- Already created in Phase 01, but included for reference
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  agent_id UUID REFERENCES agents(id),
  user_id UUID REFERENCES profiles(id),
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(255) NOT NULL,
  action VARCHAR(50) NOT NULL,
  change_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  INDEX idx_organization_created (organization_id, created_at DESC),
  INDEX idx_agent_created (agent_id, created_at DESC),
  INDEX idx_entity (entity_type, entity_id)
);
```

### 5.2 Weekly Tracker View (for KPI caching)

```sql
CREATE TABLE weekly_tracker (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,

  -- Revenue metrics
  revenue_this_week NUMERIC(12,2) DEFAULT 0,
  revenue_paid_invoices NUMERIC(12,2) DEFAULT 0,
  revenue_pending_invoices NUMERIC(12,2) DEFAULT 0,

  -- Project metrics
  active_projects INTEGER DEFAULT 0,
  projects_completed INTEGER DEFAULT 0,

  -- Labor metrics
  crew_hours_logged NUMERIC(10,2) DEFAULT 0,
  avg_daily_crew_size INTEGER DEFAULT 0,

  -- Cost metrics
  material_cost_actual NUMERIC(12,2) DEFAULT 0,
  avg_material_cost NUMERIC(12,2) DEFAULT 0,
  overhead_cost NUMERIC(12,2) DEFAULT 0,

  -- AR metrics
  total_ar_amount NUMERIC(12,2) DEFAULT 0,
  ar_over_30_amount NUMERIC(12,2) DEFAULT 0,

  -- Margin
  avg_margin_pct NUMERIC(5,2) DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id, week_start),
  INDEX idx_org_week (organization_id, week_start DESC)
);
```

### 5.3 Estimate & Invoice Payment Link

```sql
-- Add if not already present
ALTER TABLE estimates
ADD COLUMN invoiced_at TIMESTAMPTZ,
ADD COLUMN invoice_id UUID REFERENCES invoices(id);

ALTER TABLE invoices
ADD COLUMN estimate_id UUID REFERENCES estimates(id);
```

### 5.4 Redis Cache Key Patterns

```
For Phase 03, use these key patterns in Upstash:

vault:estimate:{estimateId}                 -- Cache estimate details (TTL: 1 hour)
vault:similar:{projectType}:{clientId}      -- Cache similar estimates (TTL: 6 hours)
vault:margin:analysis:{estimateId}          -- Cache margin analysis (TTL: 24 hours)

pulse:kpi:{organizationId}:weekly            -- Cache weekly KPIs (TTL: 1 hour)
pulse:kpi:{organizationId}:monthly           -- Cache monthly KPIs (TTL: 6 hours)
pulse:ar_aging:{organizationId}              -- Cache AR aging buckets (TTL: 1 hour)
pulse:forecast:{organizationId}              -- Cache cash flow forecast (TTL: 6 hours)

ledger:invoice:{invoiceId}                   -- Cache invoice details (TTL: 1 hour)
ledger:ar:{organizationId}                   -- Cache total AR (TTL: 1 hour)
ledger:overdue:{organizationId}              -- Cache overdue invoices (TTL: 30 min)
```

---

## 6. Integration Points

### 6.1 NEXUS Router Integration

NEXUS (Phase 02) routes all requests to the appropriate agent. Phase 03 adds three new routes:

```typescript
// src/agents/nexus/router.ts (modifications)

export async function routeToAgent(request: AgentRequest): Promise<AgentResponse> {
  const { agent, action, ...payload } = request;

  switch (agent) {
    case 'scout':
      return await processSCOUTRequest(payload);

    case 'vault':
      return await processVaultRequest(payload);  // NEW

    case 'pulse':
      return await processPulseRequest(payload);  // NEW

    case 'ledger':
      return await processLedgerRequest(payload); // NEW

    default:
      return { success: false, error: 'Unknown agent' };
  }
}

// Memory sharing between NEXUS and agents
export async function storeAgentMemory(
  agentId: string,
  memoryKey: string,
  value: any,
  ttl: number = 24 * 60 * 60 // 24 hours
) {
  const client = new Upstash({ baseUrl: process.env.UPSTASH_REDIS_REST_URL });
  const key = `agent:${agentId}:${memoryKey}`;
  await client.setex(key, ttl, JSON.stringify(value));
}

export async function retrieveAgentMemory(
  agentId: string,
  memoryKey: string
): Promise<any | null> {
  const client = new Upstash({ baseUrl: process.env.UPSTASH_REDIS_REST_URL });
  const key = `agent:${agentId}:${memoryKey}`;
  const value = await client.get(key);
  return value ? JSON.parse(value) : null;
}
```

### 6.2 Data Flow Between Agents

```
VAULT creates estimate
  ↓
VAULT calculates margin
  ↓
PULSE tracks estimate as pending work (in forecast)
  ↓
Client approves estimate
  ↓
LEDGER auto-creates invoice from estimate
  ↓
LEDGER sends invoice
  ↓
PULSE updates pending → invoiced
  ↓
Client pays invoice
  ↓
LEDGER records payment
  ↓
PULSE updates revenue metrics
  ↓
VAULT compares estimate margin vs actual margin

NEXUS orchestrates all steps and logs to audit_log.
```

### 6.3 Webhook Integration Points (Phase 04+)

Phase 03 does not implement webhooks, but prepare for:

```typescript
// Future: Client receives email with invoice, clicks "View Online"
// → POST /webhooks/invoice/viewed
// → Updates invoice.status = 'viewed'
// → PULSE re-calculates AR aging
// → LEDGER triggers follow-up workflow

// Future: Payment received via bank integration
// → POST /webhooks/payment/received
// → LEDGER.recordPayment()
// → Updates invoice.status = 'paid'
// → PULSE updates cash position
```

---

## 7. Testing Strategy

### 7.1 Unit Tests

```typescript
// Test VAULT
describe('VAULT Agent', () => {
  describe('buildEstimateLineItems', () => {
    test('populates line items from price book', async () => {
      const items = [{ sku: 'WIRE-10-COPPER', qty: 100, description: '10 AWG Copper' }];
      const result = await buildEstimateLineItems(items, orgId);

      expect(result).toHaveLength(1);
      expect(result[0].unit_price).toBeGreaterThan(0);
      expect(result[0].total).toBe(result[0].qty * result[0].unit_price);
    });

    test('flags custom items without price book match', async () => {
      const items = [{ sku: 'CUSTOM-001', qty: 1, description: 'Custom Panel' }];
      const result = await buildEstimateLineItems(items, orgId);

      expect(result[0].is_custom).toBe(true);
      expect(result[0].unit_price).toBe(0);
    });

    test('applies waste factor to quantities', async () => {
      const items = [{ sku: 'WIRE-10-COPPER', qty: 100, description: '10 AWG' }];
      const result = await buildEstimateLineItems(items, orgId, 1.1);

      expect(result[0].qty).toBe(110); // 100 * 1.1
    });
  });

  describe('analyzeEstimateMargin', () => {
    test('compares estimated vs actual margin after project completion', async () => {
      const analysis = await analyzeEstimateMargin(estimateId);

      expect(analysis.estimated_margin_pct).toBeDefined();
      expect(analysis.actual_margin_pct).toBeDefined();
      expect(analysis.variance_pct).toBeDefined();
    });
  });
});

// Test PULSE
describe('PULSE Agent', () => {
  describe('calculateKPIs', () => {
    test('sums revenue from paid invoices', async () => {
      const kpis = await getKPIs(orgId);

      expect(kpis.revenue_received).toBeGreaterThanOrEqual(0);
      expect(kpis.revenue_pending).toBeGreaterThanOrEqual(0);
    });

    test('calculates AR aging buckets', async () => {
      const kpis = await getKPIs(orgId);

      const totalAR = kpis.ar_aging_buckets.reduce((sum, b) => sum + b.total_amount, 0);
      expect(totalAR).toBeGreaterThanOrEqual(0);
    });
  });

  describe('generateCashFlowForecast', () => {
    test('projects revenue based on outstanding invoices and historical timing', async () => {
      const forecast = await getCashFlowForecast(orgId, 12);

      expect(forecast).toHaveLength(12);
      expect(forecast[0].week_start).toBeDefined();
      expect(forecast[0].projected_income).toBeGreaterThanOrEqual(0);
      expect(forecast[0].confidence).toBeGreaterThan(0);
      expect(forecast[0].confidence).toBeLessThanOrEqual(1);
    });
  });
});

// Test LEDGER
describe('LEDGER Agent', () => {
  describe('transitionInvoiceStatus', () => {
    test('allows valid status transitions', async () => {
      const invoice = await createTestInvoice('draft');
      await transitionInvoiceStatus(invoice.id, 'sent');

      const updated = await getInvoice(invoice.id);
      expect(updated.status).toBe('sent');
    });

    test('rejects invalid status transitions', async () => {
      const invoice = await createTestInvoice('paid');

      expect(async () => {
        await transitionInvoiceStatus(invoice.id, 'draft');
      }).rejects.toThrow('Invalid transition');
    });
  });

  describe('recordPayment', () => {
    test('updates invoice paid_amount and status', async () => {
      const invoice = await createTestInvoice('sent', { total: 5000 });
      await recordPayment(invoice.id, 5000, 'check', new Date());

      const updated = await getInvoice(invoice.id);
      expect(updated.paid_amount).toBe(5000);
      expect(updated.status).toBe('paid');
    });

    test('rejects overpayment', async () => {
      const invoice = await createTestInvoice('sent', { total: 5000 });

      expect(async () => {
        await recordPayment(invoice.id, 6000, 'check', new Date());
      }).rejects.toThrow('exceeds outstanding balance');
    });
  });

  describe('createInvoiceFromEstimate', () => {
    test('auto-generates invoice with same line items as estimate', async () => {
      const estimate = await createTestEstimate('approved');
      const invoice = await createInvoiceFromEstimate(estimate.id);

      expect(invoice.line_items).toEqual(estimate.line_items);
      expect(invoice.total_amount).toBe(estimate.total_amount);
      expect(invoice.estimate_id).toBe(estimate.id);
    });
  });
});
```

### 7.2 Integration Tests

```typescript
// Test full workflows
describe('Phase 03 Integration', () => {
  test('Complete estimate → invoice → payment workflow', async () => {
    // VAULT: Create estimate
    const estimateRes = await processVaultRequest({
      action: 'create',
      organizationId: testOrgId,
      userId: testUserId,
      clientId: testClientId,
      description: '200A panel upgrade'
    });
    expect(estimateRes.success).toBe(true);
    const estimateId = estimateRes.data.estimate_id;

    // VAULT: Send estimate
    await processVaultRequest({
      action: 'send',
      organizationId: testOrgId,
      userId: testUserId,
      estimateId
    });

    // Simulate client approval
    await db.from('estimates').update({ status: 'approved' }).eq('id', estimateId);

    // LEDGER: Auto-create invoice
    const invoiceRes = await processLedgerRequest({
      action: 'create_from_estimate',
      organizationId: testOrgId,
      userId: testUserId,
      estimateId
    });
    expect(invoiceRes.success).toBe(true);
    const invoiceId = invoiceRes.data.invoice_id;

    // LEDGER: Send invoice
    await processLedgerRequest({
      action: 'send',
      organizationId: testOrgId,
      userId: testUserId,
      invoiceId
    });

    // LEDGER: Record payment
    await processLedgerRequest({
      action: 'record_payment',
      organizationId: testOrgId,
      userId: testUserId,
      invoiceId,
      paymentAmount: 5000,
      paymentMethod: 'check'
    });

    // PULSE: Verify KPIs updated
    const kpis = await processPulseRequest({
      action: 'get_kpis',
      organizationId: testOrgId
    });
    expect(kpis.data.revenue_received).toBeGreaterThan(0);
  });
});
```

---

## 8. File Tree After Phase 03

```
src/
├── agents/
│   ├── nexus/
│   │   ├── index.ts              (existing; updated for routing)
│   │   ├── router.ts             (existing; updated)
│   │   └── memory.ts             (existing)
│   ├── scout/
│   │   ├── index.ts              (existing)
│   │   └── systemPrompt.ts       (existing)
│   ├── vault/                    (NEW)
│   │   ├── index.ts              (processVaultRequest)
│   │   ├── estimateBuilder.ts    (buildEstimateLineItems, findSimilarEstimates)
│   │   ├── marginAnalyzer.ts     (analyzeEstimateMargin)
│   │   └── systemPrompt.ts       (vaultSystemPrompt)
│   ├── pulse/                    (NEW)
│   │   ├── index.ts              (processPulseRequest)
│   │   ├── kpiCalculator.ts      (getKPIs, generateCashFlowForecast)
│   │   ├── trendAnalyzer.ts      (analyzeTrends)
│   │   └── systemPrompt.ts       (pulseSystemPrompt)
│   └── ledger/                   (NEW)
│       ├── index.ts              (processLedgerRequest)
│       ├── invoiceManager.ts     (CRUD, state machine, payment logic)
│       ├── cashFlowAnalyzer.ts   (analysis functions)
│       └── systemPrompt.ts       (ledgerSystemPrompt)
├── components/
│   ├── vault/                    (NEW)
│   │   ├── EstimatePanel.tsx
│   │   ├── EstimateBuilder.tsx
│   │   └── EstimateDetail.tsx
│   ├── pulse/                    (NEW)
│   │   ├── DashboardPanel.tsx
│   │   ├── KPICard.tsx
│   │   ├── RevenueChart.tsx
│   │   └── CashFlowChart.tsx
│   ├── ledger/                   (NEW)
│   │   ├── InvoicePanel.tsx
│   │   ├── InvoiceDetail.tsx
│   │   └── PaymentForm.tsx
│   └── layout/
│       ├── Header.tsx            (existing)
│       └── Sidebar.tsx           (updated with VAULT/PULSE/LEDGER nav)
├── hooks/
│   ├── useVault.ts               (NEW - custom hook for VAULT actions)
│   ├── usePulse.ts               (NEW - custom hook for PULSE queries)
│   ├── useLedger.ts              (NEW - custom hook for LEDGER actions)
│   ├── useSupabase.ts            (existing)
│   └── useAuth.ts                (existing)
├── lib/
│   ├── api/
│   │   ├── vault.ts              (NEW - fetch API calls to VAULT agent)
│   │   ├── pulse.ts              (NEW - fetch API calls to PULSE agent)
│   │   ├── ledger.ts             (NEW - fetch API calls to LEDGER agent)
│   │   └── nexus.ts              (existing; updated)
│   ├── memory/
│   │   ├── audit.ts              (existing; logAudit function)
│   │   └── redis.ts              (existing; Redis helper)
│   ├── supabase.ts               (existing)
│   └── anthropic.ts              (existing; Claude API client)
├── types/
│   ├── agents.ts                 (existing; updated)
│   ├── vault.ts                  (NEW)
│   ├── pulse.ts                  (NEW)
│   ├── ledger.ts                 (NEW)
│   └── database.ts               (existing; updated schema)
└── pages/
    ├── Dashboard.tsx             (existing; updated to include PULSE)
    ├── Estimates.tsx             (NEW; VAULT UI)
    ├── Invoices.tsx              (NEW; LEDGER UI)
    └── Settings.tsx              (existing)

db/
├── migrations/
│   ├── 01_initial_schema.sql     (Phase 01; existing)
│   ├── 02_nexus_scout.sql        (Phase 02; existing)
│   └── 03_vault_pulse_ledger.sql (Phase 03; NEW)
│       ├── Estimate line items schema update
│       ├── Invoice payment schema update
│       ├── weekly_tracker table
│       ├── audit_log table (if not in Phase 01)
│       └── RLS policies for all new tables
```

---

## 9. Integration Points — What Phase 04 Expects from Phase 03

### 9.1 Database State

Phase 04 (BLUEPRINT, OHM) will expect:

1. **Estimates table** fully populated with sample estimates (10-20) for testing
2. **Invoices table** with 50+ invoices in various states (draft, sent, paid, overdue)
3. **Payments table** with corresponding payment records
4. **weekly_tracker** table with 52 weeks of historical KPI data
5. **Price book** with 275+ items in 15 categories
6. **project_cost_summary** view queryable and accurate

### 9.2 API Endpoints

Phase 04 will call these endpoints via NEXUS router:

```typescript
// Existing from Phase 02, used by Phase 04+:
POST /api/agents/scout — project analysis

// New in Phase 03, available to Phase 04+:
POST /api/agents/vault
  - action: 'create' | 'analyze_margin' | 'find_similar' | 'send' | 'expire_check'

POST /api/agents/pulse
  - action: 'get_kpis' | 'get_cash_flow' | 'get_trends' | 'get_ar_aging'

POST /api/agents/ledger
  - action: 'create' | 'send' | 'record_payment' | 'check_overdue' | 'create_from_estimate'

// Phase 04 will add:
POST /api/agents/blueprint
  - action: 'create_schedule' | 'update_timeline' | 'resource_allocation'

POST /api/agents/ohm
  - action: 'troubleshoot' | 'code_review' | 'safety_check'
```

### 9.3 Memory & Context

Phase 04 agents will have access to:

1. **VAULT memory:**
   - `vault:estimate:history` — past estimate success rates by project type
   - `vault:margin:trends` — margin targets and actuals over time

2. **PULSE memory:**
   - `pulse:kpi:benchmarks` — seasonal targets and historical performance
   - `pulse:forecast:accuracy` — how accurate cash flow forecasts have been

3. **LEDGER memory:**
   - `ledger:ar:patterns` — which clients pay late, which pay on-time
   - `ledger:payment:terms` — custom payment terms per client

### 9.4 Seeding Data

Phase 04 implementation will include a seeding script that populates:

```typescript
// Phase 03 Seeding (run before Phase 04 testing)
import { seedEstimates } from '@/db/seeds/estimates';
import { seedInvoices } from '@/db/seeds/invoices';
import { seedPayments } from '@/db/seeds/payments';
import { seedWeeklyTracker } from '@/db/seeds/weekly-tracker';

await Promise.all([
  seedEstimates(orgId, 20),      // Create 20 sample estimates
  seedInvoices(orgId, 50),       // Create 50 sample invoices
  seedPayments(orgId, 40),       // Create payment records for 80% of invoices
  seedWeeklyTracker(orgId, 52)   // Populate full year of KPI data
]);
```

---

## 10. What Phase 04 Builds

Phase 04 will add:

### BLUEPRINT Agent (Project Management)
- Gantt chart generation
- Resource scheduling
- Dependency tracking
- Crew assignment
- Timeline forecasting

### OHM Agent (Electrical Coaching)
- Code compliance checking
- Safety recommendation
- Best practice suggestions
- Troubleshooting advisor
- Continuing education

Estimated timeline: Q3 2026. These agents will use VAULT estimates, PULSE KPIs, and LEDGER payment data to optimize project execution.

---

## 11. Deployment Checklist

Before moving to Phase 04:

- [ ] All three agent orchestrators (VAULT/PULSE/LEDGER) implemented and tested
- [ ] System prompts reviewed and optimized for domain accuracy
- [ ] All database migrations applied to production
- [ ] Redis cache layer tested with TTL values
- [ ] Audit logging verified for all state changes
- [ ] Component UI tested in Storybook
- [ ] Integration tests passing (workflow: estimate → invoice → payment)
- [ ] Performance: KPI calculation <500ms, cash flow forecast <1s
- [ ] Error handling for all Claude API calls
- [ ] Documentation updated in Confluence/notion
- [ ] Stage environment mirrors production data
- [ ] Backup strategy verified (Supabase auto-backups)

---

## 12. Code Examples: Quick Reference

### Create an Estimate (VAULT)
```typescript
const response = await fetch('/api/agents/vault', {
  method: 'POST',
  body: JSON.stringify({
    action: 'create',
    organizationId: '123',
    userId: '456',
    clientId: '789',
    description: 'Panel upgrade for Johnson residence'
  })
});
```

### Check Dashboard KPIs (PULSE)
```typescript
const response = await fetch('/api/agents/pulse', {
  method: 'POST',
  body: JSON.stringify({
    action: 'get_kpis',
    organizationId: '123',
    timeframe: 'week'
  })
});
```

### Record Invoice Payment (LEDGER)
```typescript
const response = await fetch('/api/agents/ledger', {
  method: 'POST',
  body: JSON.stringify({
    action: 'record_payment',
    organizationId: '123',
    invoiceId: 'inv-001',
    paymentAmount: 5000,
    paymentMethod: 'ach',
    paymentDate: new Date()
  })
});
```

---

## 13. Known Limitations & Future Enhancements

### Phase 03 Limitations
1. **PDF Generation** — Estimates/Invoices render in browser; PDF export is Phase 06
2. **Email Integration** — Email templates defined but sending is Phase 05 (SPARK)
3. **Bank Integration** — No automatic payment detection; Phase 06 feature
4. **Multi-currency** — All prices in USD; international support Phase 07
5. **Inventory Tracking** — Price book exists but no stock levels; Phase 04+

### Planned Phase 04-07 Enhancements
1. Real-time GPS crew tracking (BLUEPRINT)
2. Mobile app for field crew (OHM)
3. Customer portal for estimate/invoice viewing
4. Automated collections workflows
5. Financial forecasting with ML (ORACLE)
6. Integration with QuickBooks/Xero
7. Compliance audit trail (CHRONO)

---

**END OF SPECIFICATION**

This document provides complete specifications for Phase 03 implementation. Total implementation effort: ~80-100 engineering hours (2-2.5 weeks for experienced team).
