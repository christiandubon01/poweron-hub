// Raw permit data extracted from one TLMA search result row
export interface TLMAPermit {
  permit_number: string;
  permit_description: string;
  permit_status: string;
  city: string;
  street_name: string;
  apn: string;
  tract: string | null;
  lot: string | null;
  permit_type_label: string;
  permit_type_code: string;
  sqft_breakdown: Record<string, number>;
  total_sqft: number | null;
  applied_date: string | null;
  issued_date: string | null;
  finalized_date: string | null;
  expired_date: string | null;
  contact_name: string | null;
  contact_type: string | null;
  contact_company: string | null;
  contact_home_phone: string | null;
  contact_business_phone: string | null;
  contact_mobile: string | null;
  project_name: string | null;
}

// Output of scoring engine for one permit
export interface ScoreResult {
  final_score: number;
  score_tier: "elite" | "strong" | "qualified" | "expansion" | "archived";
  base_score: number;
  sqft_bonus: number;
  keyword_hits: Array<{ keyword: string; weight: number }>;
  contact_signal_weight: number;
  status_modifier: number;
  penalties: Array<{ reason: string; weight: number }>;
  force_overrides: Array<{
    rule: string;
    new_score_floor?: number;
    new_score_ceiling?: number;
  }>;
  transparency_notes: string[];
}

// What we hand to Supabase for upsert
export interface HunterLeadRow {
  tenant_id: string;
  user_id: string;
  source: "tlma_riverside";
  source_tag: string;
  lead_type: string;
  contact_name: string | null;
  company_name: string | null;
  contact_company: string | null;
  contact_type_label: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  description: string | null;
  estimated_value: number | null;
  score: number;
  score_tier: string;
  score_factors: object;
  status: "new" | "archived";
  permit_number: string;
  permit_url: string;
  permit_type_code: string;
  permit_type_label: string;
  work_class_code: string | null;
  permit_status: string;
  total_sqft: number | null;
  sqft_breakdown: object | null;
  applied_date: string | null;
  issued_date: string | null;
  finalized_date: string | null;
  expired_date: string | null;
  // Geocoding fields (added by migration 071)
  latitude?: number | null;
  longitude?: number | null;
  distance_from_base_miles?: number | null;
  geocoded_at?: string | null;
  geocoding_status?: 'pending' | 'success' | 'failed' | 'skipped' | null;
}

export interface DryRunReport {
  timestamp: string;
  dry_run: true;
  search_matrix_size: number;
  total_permits_fetched: number;
  permits_after_dedup: number;
  permits_above_score_threshold: number;
  permits_below_score_threshold_archived: number;
  score_distribution: {
    elite: number;
    strong: number;
    qualified: number;
    expansion: number;
    archived: number;
  };
  sample_permits: Array<{
    permit_number: string;
    score: number;
    tier: string;
    description: string;
  }>;
  errors: string[];
}

export interface LiveRunReport {
  timestamp: string;
  dry_run: false;
  search_matrix_size: number;
  total_permits_fetched: number;
  inserts: number;
  updates: number;
  revisions_logged: number;
  last_seen_touched: number;
  skipped_unchanged: number;
  errors: string[];
}
