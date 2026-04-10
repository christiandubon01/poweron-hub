/**
 * HunterObjectionBank.ts
 * HUNTER Agent — Pre-loaded objection-response pairs
 *
 * Built from Christian Dubon's actual field scripts and confirmed HUNTER
 * debrief rules. Each entry is a real-world objection Christian encounters
 * with response language calibrated to his voice: direct, experienced,
 * never defensive.
 *
 * Usage:
 *   getObjectionResponses('residential') → returns objection set relevant
 *   to residential service leads.
 *
 * The bank grows from debrief-confirmed rules. Add new entries via
 * addDebriefObjection() to expand from live call learnings.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** The category of objection */
export type ObjectionCategory =
  | 'competition'      // "We already have someone"
  | 'price'            // "That seems expensive" / "Can you do it cheaper?"
  | 'credibility'      // "You're kind of young" / "Are you licensed?"
  | 'delay'            // "We'll think about it"
  | 'escape'           // "Send me your info" / "We'll call you"
  | 'scope'            // "We just need something small"
  | 'trust';           // General trust / unknown contractor hesitation

/** Which lead types this objection commonly appears with */
export type LeadType =
  | 'residential'
  | 'commercial'
  | 'gc'              // General contractor relationship
  | 'solar'
  | 'service_call'
  | 'referral'
  | 'cold'
  | 'all';            // Applies to every lead type

/** A single objection-response pair */
export interface ObjectionResponse {
  id: string;
  objection: string;
  response: string;
  category: ObjectionCategory;
  applicableLeadTypes: LeadType[];
  /** True if this was confirmed effective through a debrief session */
  debriefConfirmed: boolean;
  /** Guidance note for how to deliver this response */
  deliveryNote?: string;
  /** Which pitch angle this pairs best with */
  angleAffinity?: string;
}

/** Result of getObjectionResponses — the filtered and ranked objection set */
export interface ObjectionSet {
  leadType: LeadType;
  objections: ObjectionResponse[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Objection Bank
// ─────────────────────────────────────────────────────────────────────────────

const OBJECTION_BANK: ObjectionResponse[] = [

  // ── COMPETITION ────────────────────────────────────────────────────────────

  {
    id: 'OBJ-001',
    objection: "We already have an electrician.",
    response:
      "That's good to hear. A lot of my clients had someone before they called me — usually after an emergency, a failed inspection, or a job that sat half-finished. I'm not asking you to replace anyone. I'm asking for the chance to show you what a licensed C-10 with seven years field experience actually looks like on a job. If you ever have something urgent and your guy can't get there, I'm the call you want to have.",
    category: 'competition',
    applicableLeadTypes: ['residential', 'commercial', 'gc', 'cold', 'all'],
    debriefConfirmed: true,
    deliveryNote: 'Stay calm. Never trash the existing contractor. Lead with emergency availability.',
    angleAffinity: 'urgency',
  },
  {
    id: 'OBJ-002',
    objection: "We're happy with who we've been using.",
    response:
      "I get it — when you find someone reliable, you stick with them. I respect that. I'm not here to take a job from anyone. But I do want you to know I'm in the area, I'm licensed and insured, and I keep a tight schedule. If your guy ever gets backed up or you need a second opinion on something code-related, reach out. I'd rather you call me as a backup and end up never needing it than not have my number when things get complicated.",
    category: 'competition',
    applicableLeadTypes: ['residential', 'gc', 'commercial', 'cold'],
    debriefConfirmed: true,
    deliveryNote: 'Build the backup relationship. This plants the seed for the next opening.',
    angleAffinity: 'relationship',
  },

  // ── PRICE ──────────────────────────────────────────────────────────────────

  {
    id: 'OBJ-003',
    objection: "That seems expensive.",
    response:
      "I hear that. Let me break down what that number covers: you're getting a licensed C-10 — not a handyman — full liability insurance, workers' comp, materials pulled from the right suppliers, and work that passes city inspection the first time. I've seen what happens when someone goes cheap on electrical. Breakers that won't hold, wire gauge that's wrong for the load, inspections that fail and cost double to fix. My price is what it costs to do it right. I'm not the cheapest call, and I'm not trying to be.",
    category: 'price',
    applicableLeadTypes: ['residential', 'commercial', 'service_call', 'cold', 'all'],
    debriefConfirmed: true,
    deliveryNote: 'Use NEC code knowledge — reference specific code if relevant. Never apologize for your price.',
    angleAffinity: 'pain',
  },
  {
    id: 'OBJ-004',
    objection: "Can you do it cheaper?",
    response:
      "I can look at the scope with you and see if there's anything we can phase out or do in stages. But my floor is my floor — it covers labor, materials, insurance, and my license. I don't cut corners on code compliance because a failed inspection costs you way more in the end. What I can do is make sure every dollar you spend with me is work that lasts and passes. If you want, we can walk the job together and I can show you exactly what's driving the number.",
    category: 'price',
    applicableLeadTypes: ['residential', 'commercial', 'service_call', 'all'],
    debriefConfirmed: true,
    deliveryNote: 'Offer a site visit to justify scope — never just cut the number.',
    angleAffinity: 'opportunity',
  },

  // ── CREDIBILITY ────────────────────────────────────────────────────────────

  {
    id: 'OBJ-005',
    objection: "You're kind of young.",
    response:
      "I get that a lot. Seven years in the field, C-10 licensed in California, and I've pulled permits on residential panels, commercial TIs, solar interconnects, and service upgrades. I know the 2020 NEC backward. I know what Desert Hot Springs and Cathedral City building departments want to see on an inspection. Age doesn't wire a panel — experience and code knowledge do. Ask me anything about the job. I'll show you I know what I'm talking about.",
    category: 'credibility',
    applicableLeadTypes: ['residential', 'commercial', 'gc', 'cold', 'all'],
    debriefConfirmed: true,
    deliveryNote: 'Go technical immediately. NEC code references shut this down fast. Confidence, not defensiveness.',
    angleAffinity: 'pain',
  },
  {
    id: 'OBJ-006',
    objection: "Are you actually licensed?",
    response:
      "Yes. California C-10 Electrical Contractor license. You can look it up right now on the CSLB website — search Power On Solutions LLC. Full liability insurance, workers' comp, bonded. I don't cut any of that. It's not optional in California and it shouldn't be for anyone working on your property.",
    category: 'credibility',
    applicableLeadTypes: ['residential', 'commercial', 'gc', 'cold', 'all'],
    debriefConfirmed: true,
    deliveryNote: 'Give the CSLB verification path. Never hesitate on this one.',
    angleAffinity: 'competitor_gap',
  },

  // ── DELAY ─────────────────────────────────────────────────────────────────

  {
    id: 'OBJ-007',
    objection: "We'll think about it.",
    response:
      "Totally fair. While you're thinking about it — can I ask what the main thing is you want to think through? Because if it's price, scope, or timing, I'd rather address that now than have you sitting with an unanswered question. And if you do want to move forward, I want to get you on the schedule before my next open slot fills. Right now I have [day/week] open. Want me to hold that while you decide?",
    category: 'delay',
    applicableLeadTypes: ['residential', 'commercial', 'service_call', 'referral', 'all'],
    debriefConfirmed: true,
    deliveryNote: 'Always offer a specific date to hold. Turn "think about it" into a concrete next step.',
    angleAffinity: 'urgency',
  },
  {
    id: 'OBJ-008',
    objection: "We need to talk to a few other contractors first.",
    response:
      "That makes sense, and I'd expect nothing less on a job this size. Get your quotes. When you're comparing, make sure you're looking at license number, insurance cert, and whether the estimate includes permit fees — those surprise a lot of people later. When you're ready to talk, I'll still be here. And if you want a second walkthrough after you've gotten the other numbers, I'm happy to do that.",
    category: 'delay',
    applicableLeadTypes: ['residential', 'commercial', 'gc', 'solar', 'cold'],
    debriefConfirmed: false,
    deliveryNote: 'Give them the comparison checklist — this positions you as the knowledgeable contractor they come back to.',
    angleAffinity: 'competitor_gap',
  },

  // ── ESCAPE ────────────────────────────────────────────────────────────────

  {
    id: 'OBJ-009',
    objection: "Send me your info and we'll be in touch.",
    response:
      "I can do that. And to make sure it doesn't get buried — when's a good time to follow up with you directly? I'd rather put something on the calendar than have my info sit in an inbox. Even a five-minute call next week so I know where you are on the decision. What works better for you — Tuesday morning or Thursday afternoon?",
    category: 'escape',
    applicableLeadTypes: ['residential', 'commercial', 'gc', 'cold', 'all'],
    debriefConfirmed: true,
    deliveryNote: 'Offer two specific time options. "Send info" without a follow-up is a dead end — lock a callback date.',
    angleAffinity: 'relationship',
  },
  {
    id: 'OBJ-010',
    objection: "We'll call you when we're ready.",
    response:
      "I appreciate that. My schedule fills up a few weeks out, so the earlier I hear from you, the better chance I have of holding something that works for your timeline. If you do want to reach me, my direct number is the best way — I don't have an answering service. When do you think you'll have a clearer idea of timing?",
    category: 'escape',
    applicableLeadTypes: ['residential', 'commercial', 'service_call', 'all'],
    debriefConfirmed: true,
    deliveryNote: 'Reference real schedule constraints. Forces them to think about timeline concretely.',
    angleAffinity: 'urgency',
  },

  // ── SCOPE ─────────────────────────────────────────────────────────────────

  {
    id: 'OBJ-011',
    objection: "It's just a small job — is it worth your time?",
    response:
      "Absolutely. I do service work in the area regularly and small jobs are how most of my long-term relationships started. A panel swap I quoted as a small job turned into a full service upgrade and solar tie-in six months later once the homeowner saw how I work. I'm happy to come out and take a look. If it's quick, I'll tell you upfront.",
    category: 'scope',
    applicableLeadTypes: ['residential', 'service_call', 'referral'],
    debriefConfirmed: false,
    deliveryNote: 'Use a comparable job story — small → bigger. Shows relationship value.',
    angleAffinity: 'relationship',
  },

  // ── TRUST ─────────────────────────────────────────────────────────────────

  {
    id: 'OBJ-012',
    objection: "I don't know you.",
    response:
      "Fair point. I'm local — Desert Hot Springs area, licensed C-10 with Power On Solutions LLC. You can verify my license on the CSLB site right now. I can also send you references from jobs in the area — homeowners and GCs I've worked with. I'd rather earn your trust than ask for it. What would give you confidence that I'm the right call for this?",
    category: 'trust',
    applicableLeadTypes: ['residential', 'cold', 'service_call', 'all'],
    debriefConfirmed: false,
    deliveryNote: 'CSLB lookup + references combination. Ask them what they need — that invites a real conversation.',
    angleAffinity: 'relationship',
  },

  // ── SOLAR-SPECIFIC ────────────────────────────────────────────────────────

  {
    id: 'OBJ-013',
    objection: "The solar company said they handle the electrical.",
    response:
      "Some do, some don't — and the ones that do sometimes subcontract it out to whoever's available. It's worth asking if the person doing your interconnect work is actually a licensed C-10 or just a C-46 solar contractor who's pulling the permit. There's a difference in what they're licensed to touch. I specialize in the electrical side of solar — service upgrades, panel capacity, interconnect compliance — and I'm C-10 licensed for all of it.",
    category: 'competition',
    applicableLeadTypes: ['solar', 'residential'],
    debriefConfirmed: false,
    deliveryNote: 'Use licensing specifics (C-10 vs C-46) — shows technical depth without being arrogant.',
    angleAffinity: 'competitor_gap',
  },

  // ── COMMERCIAL/GC-SPECIFIC ────────────────────────────────────────────────

  {
    id: 'OBJ-014',
    objection: "We already have preferred subs for electrical.",
    response:
      "Understood. I'm not trying to push anyone out. Where I come in is when your preferred sub is booked out, or when you need someone fast with local AHJ experience in the DHS and Palm Springs market. I've pulled permits here and I know the inspectors. If a situation comes up where your regular guy can't get there, I want to be on your backup list — not replace anyone. Can I at least give you my direct number?",
    category: 'competition',
    applicableLeadTypes: ['gc', 'commercial'],
    debriefConfirmed: true,
    deliveryNote: 'GC relationships are long-play. Focus on backup availability and local AHJ knowledge.',
    angleAffinity: 'competitor_gap',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the full objection bank (all entries).
 */
export function getAllObjections(): ObjectionResponse[] {
  return [...OBJECTION_BANK];
}

/**
 * Get the relevant objection set for a given lead type.
 * Includes all 'all' entries plus entries specific to the lead type.
 * Sorted so debrief-confirmed entries appear first.
 *
 * @param leadType - The category of lead being pitched
 */
export function getObjectionResponses(leadType: LeadType): ObjectionSet {
  const filtered = OBJECTION_BANK.filter(
    o =>
      o.applicableLeadTypes.includes('all') ||
      o.applicableLeadTypes.includes(leadType)
  ).sort((a, b) => {
    // Confirmed first
    if (a.debriefConfirmed && !b.debriefConfirmed) return -1;
    if (!a.debriefConfirmed && b.debriefConfirmed) return 1;
    return 0;
  });

  return { leadType, objections: filtered };
}

/**
 * Get a single objection response by ID.
 * Returns undefined if not found.
 */
export function getObjectionById(id: string): ObjectionResponse | undefined {
  return OBJECTION_BANK.find(o => o.id === id);
}

/**
 * Get objections filtered by category.
 * Useful when a specific objection type is anticipated before the call.
 */
export function getObjectionsByCategory(
  category: ObjectionCategory,
  leadType?: LeadType
): ObjectionResponse[] {
  return OBJECTION_BANK.filter(o => {
    if (o.category !== category) return false;
    if (!leadType) return true;
    return o.applicableLeadTypes.includes('all') || o.applicableLeadTypes.includes(leadType);
  });
}

/**
 * Add a new objection-response pair confirmed through a debrief session.
 * In production, this should persist to Supabase. For now, appends to
 * the in-memory bank for the current session.
 *
 * @param entry - The new objection entry (id will be auto-assigned if omitted)
 */
export function addDebriefObjection(
  entry: Omit<ObjectionResponse, 'id'> & { id?: string }
): ObjectionResponse {
  const newEntry: ObjectionResponse = {
    ...entry,
    id: entry.id ?? `OBJ-DEBRIEF-${Date.now()}`,
    debriefConfirmed: true,
  };
  OBJECTION_BANK.push(newEntry);
  return newEntry;
}
