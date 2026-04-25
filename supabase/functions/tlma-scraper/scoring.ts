import type { TLMAPermit, ScoreResult } from "./types.ts";

// ----- BASE SCORES BY PERMIT TYPE CODE -----
const BASE_SCORES: Record<string, number> = {
  BNR: 70, // Commercial Buildings
  BTI: 65, // Tenant Improvement
  BMN: 60, // Mfg Buildings Commercial
  BRS: 55, // Residential Dwelling
  BAR: 50, // Residential Add/Rehab
  BAS: 50, // Accessory Building
  BSP: 40, // Pool/Spa/Fountains
  BMR: 35, // Mfg Home Residential
};

// ----- KEYWORD DEFINITIONS -----
interface KeywordDef {
  keyword: string;
  weight: number;
  isPenalty?: boolean;
}

const KEYWORD_DEFS: KeywordDef[] = [
  // Direct electrical signals
  { keyword: "main panel", weight: 20 },
  { keyword: "subpanel", weight: 20 },
  { keyword: "panel upgrade", weight: 20 },
  { keyword: "service upgrade", weight: 20 },
  { keyword: "rewire", weight: 18 },
  { keyword: "ev charger", weight: 18 },
  { keyword: "evse", weight: 18 },
  { keyword: "ev charging", weight: 18 },
  // Solar/battery
  { keyword: "solar addition", weight: 18 },
  { keyword: "solar replacement", weight: 18 },
  { keyword: "battery storage", weight: 18 },
  { keyword: "battery", weight: 18 },
  { keyword: "ess", weight: 15 },
  { keyword: "solar", weight: 15 },
  // Lighting
  { keyword: "parking lot lighting", weight: 18 },
  { keyword: "commercial lighting", weight: 18 },
  { keyword: "lighting maintenance", weight: 15 },
  { keyword: "lighting upgrade", weight: 12 },
  { keyword: "exterior lighting", weight: 12 },
  // Public/HOA
  { keyword: "shopping center", weight: 15 },
  { keyword: "pool equipment", weight: 12 },
  { keyword: "hoa", weight: 12 },
  { keyword: "common area", weight: 12 },
  { keyword: "public space", weight: 12 },
  { keyword: "park", weight: 10 },
  // Project type
  { keyword: "tenant improvement", weight: 12 },
  { keyword: "adu", weight: 12 },
  { keyword: "guest", weight: 10 },
  { keyword: "addition", weight: 8 },
  { keyword: "remodel", weight: 8 },
  // Penalties
  { keyword: "owner-builder", weight: -25, isPenalty: true },
  { keyword: "diy", weight: -20, isPenalty: true },
  { keyword: "self-perform", weight: -15, isPenalty: true },
];

// Keywords that trigger Rule 2 force override (direct electrical signals including solar/EV/battery)
const ELECTRICAL_SIGNAL_KEYWORDS = new Set([
  "solar",
  "solar addition",
  "solar replacement",
  "ev charger",
  "evse",
  "ev charging",
  "battery",
  "battery storage",
  "ess",
]);

// ----- MAIN SCORING FUNCTION -----
export function scorePermit(permit: TLMAPermit): ScoreResult {
  const notes: string[] = [];
  const keywordHits: Array<{ keyword: string; weight: number }> = [];
  const penalties: Array<{ reason: string; weight: number }> = [];
  const forceOverrides: Array<{
    rule: string;
    new_score_floor?: number;
    new_score_ceiling?: number;
  }> = [];

  // 1. Base score
  const baseScore = BASE_SCORES[permit.permit_type_code] ?? 0;
  if (baseScore > 0) {
    const labelMap: Record<string, string> = {
      BNR: "Strong commercial signal (BNR base=70)",
      BTI: "Tenant improvement signal (BTI base=65)",
      BMN: "Commercial manufactured building (BMN base=60)",
      BRS: "Residential dwelling (BRS base=55)",
      BAR: "Residential add/rehab (BAR base=50)",
      BAS: "Accessory building (BAS base=50)",
      BSP: "Pool/spa/fountains (BSP base=40)",
      BMR: "Manufactured home residential (BMR base=35)",
    };
    notes.push(labelMap[permit.permit_type_code] ?? `Base score=${baseScore}`);
  } else {
    notes.push(`Unknown permit type code '${permit.permit_type_code}' (base=0)`);
  }

  // 2. Sqft bonus
  let sqftBonus = 0;
  const sqft = permit.total_sqft;
  if (sqft !== null && sqft !== undefined) {
    if (sqft > 5000) {
      sqftBonus = 25;
      notes.push(`Very large project: ${sqft} sqft adds +25`);
    } else if (sqft >= 2000) {
      sqftBonus = 15;
      notes.push(`Large project: ${sqft} sqft adds +15`);
    } else if (sqft >= 1000) {
      sqftBonus = 5;
      notes.push(`Medium project: ${sqft} sqft adds +5`);
    } else {
      notes.push(`Small project: ${sqft} sqft — no sqft bonus`);
    }
  }

  // 3. Keyword scanning
  const searchText = [
    permit.permit_description ?? "",
    permit.project_name ?? "",
  ]
    .join(" ")
    .toLowerCase();

  // Sort by length descending so longer phrases match before shorter sub-phrases
  const sortedKeywords = [...KEYWORD_DEFS].sort(
    (a, b) => b.keyword.length - a.keyword.length
  );

  for (const def of sortedKeywords) {
    if (searchText.includes(def.keyword.toLowerCase())) {
      if (def.isPenalty) {
        penalties.push({ reason: def.keyword, weight: def.weight });
        notes.push(`Penalty: "${def.keyword}" (${def.weight})`);
      } else {
        keywordHits.push({ keyword: def.keyword, weight: def.weight });
        notes.push(
          `Keyword match: "${def.keyword}" boosts score by +${def.weight}`
        );
      }
    }
  }

  // 4. Contact signal modifier
  let contactSignalWeight = 0;
  const contactType = permit.contact_type ?? "";
  const contactCompany = permit.contact_company ?? "";
  const companyLower = contactCompany.toLowerCase();

  if (
    contactType === "Applicant" &&
    /construction|builders|contracting|electric|builder/i.test(contactCompany)
  ) {
    contactSignalWeight += 15;
    notes.push(`GC company name matches expected contractor pattern (+15)`);
  }

  if (contactType === "Engineer") {
    contactSignalWeight += 5;
    notes.push(`Engineer contact type (+5)`);
  }

  if (/architecture|architect/i.test(companyLower)) {
    contactSignalWeight += 10;
    notes.push(`Architecture firm contact (+10)`);
  }

  if (contactType === "Owner" && contactCompany.trim() === "") {
    contactSignalWeight -= 10;
    notes.push(`Owner contact with no company — likely self-performed (-10)`);
  }

  if (
    contactType === "Owner" &&
    /owner.builder|owner builder/i.test(companyLower)
  ) {
    contactSignalWeight -= 15;
    notes.push(`Owner-builder signal in company name (-15)`);
  }

  // 5. Permit status modifier
  let statusModifier = 0;
  const permitStatus = permit.permit_status ?? "";
  if (/issued/i.test(permitStatus)) {
    statusModifier = 10;
    notes.push(`Permit status Issued (+10)`);
  } else if (/plan/i.test(permitStatus)) {
    statusModifier = 5;
    notes.push(`Permit status Plan Check (+5)`);
  } else if (/pend correction|pending/i.test(permitStatus)) {
    statusModifier = 0;
    notes.push(`Permit status Pending (0)`);
  } else if (/payment pending/i.test(permitStatus)) {
    statusModifier = -5;
    notes.push(`Permit status Payment Pending (-5)`);
  } else if (/finalized/i.test(permitStatus)) {
    statusModifier = -50;
    notes.push(`Permit status Finalized (-50)`);
  } else if (/expired/i.test(permitStatus)) {
    statusModifier = -100;
    notes.push(`Permit status Expired (-100)`);
  }

  // 6. Compute raw → clamped
  const keywordSum = keywordHits.reduce((acc, k) => acc + k.weight, 0);
  const penaltySum = penalties.reduce((acc, p) => acc + p.weight, 0);
  const raw =
    baseScore +
    sqftBonus +
    keywordSum +
    contactSignalWeight +
    statusModifier +
    penaltySum;
  let clamped = Math.max(0, Math.min(100, raw));

  notes.push(
    `Score computation: base(${baseScore}) + sqft(${sqftBonus}) + keywords(${keywordSum}) + contact(${contactSignalWeight}) + status(${statusModifier}) + penalties(${penaltySum}) = raw(${raw}) → clamped(${clamped})`
  );

  // 7. Force overrides (applied in order)
  // Rule 1: Commercial issued ≥ 2000 sqft → floor 75
  if (
    ["BNR", "BTI"].includes(permit.permit_type_code) &&
    /issued/i.test(permitStatus) &&
    sqft !== null &&
    sqft !== undefined &&
    sqft > 2000
  ) {
    if (clamped < 75) {
      forceOverrides.push({ rule: "Rule1_CommercialIssuedLarge", new_score_floor: 75 });
      notes.push(`Forced minimum 75 (commercial issued ≥2000 sqft)`);
      clamped = 75;
    }
  }

  // Rule 2: Direct electrical signal keyword → floor 60
  const hasElectricalSignal = keywordHits.some((k) =>
    ELECTRICAL_SIGNAL_KEYWORDS.has(k.keyword.toLowerCase())
  );
  if (hasElectricalSignal) {
    if (clamped < 60) {
      forceOverrides.push({ rule: "Rule2_DirectElectricalSignal", new_score_floor: 60 });
      notes.push(
        `Forced minimum 60 (direct electrical signal in description)`
      );
      clamped = 60;
    }
  }

  // Rule 3: Large project > 4000 sqft → floor 60
  if (sqft !== null && sqft !== undefined && sqft > 4000) {
    if (clamped < 60) {
      forceOverrides.push({ rule: "Rule3_LargeProject", new_score_floor: 60 });
      notes.push(`Forced minimum 60 (large project >4000 sqft)`);
      clamped = 60;
    }
  }

  // Rule 4: Finalized or Expired → ceiling 20
  if (/finalized|expired/i.test(permitStatus)) {
    if (clamped > 20) {
      forceOverrides.push({ rule: "Rule4_ClosedPermit", new_score_ceiling: 20 });
      notes.push(`Capped at 20 (permit closed/expired, not actionable)`);
      clamped = 20;
    }
  }

  // Rule 5: Owner with no company → ceiling 35
  if (contactType === "Owner" && contactCompany.trim() === "") {
    if (clamped > 35) {
      forceOverrides.push({ rule: "Rule5_OwnerNoCompany", new_score_ceiling: 35 });
      notes.push(
        `Capped at 35 (owner-builder, low electrical sub likelihood)`
      );
      clamped = 35;
    }
  }

  const finalScore = clamped;

  // 8. Score tier
  let scoreTier: ScoreResult["score_tier"];
  if (finalScore >= 85) scoreTier = "elite";
  else if (finalScore >= 75) scoreTier = "strong";
  else if (finalScore >= 60) scoreTier = "qualified";
  else if (finalScore >= 30) scoreTier = "expansion";
  else scoreTier = "archived";

  notes.push(`Final score: ${finalScore} → tier: ${scoreTier}`);

  return {
    final_score: finalScore,
    score_tier: scoreTier,
    base_score: baseScore,
    sqft_bonus: sqftBonus,
    keyword_hits: keywordHits,
    contact_signal_weight: contactSignalWeight,
    status_modifier: statusModifier,
    penalties,
    force_overrides: forceOverrides,
    transparency_notes: notes,
  };
}
