/**
 * PowerOn Hub — Supabase Database Types
 *
 * These types are manually maintained to match the schema in 002_core_tables.sql
 * and 003_agent_tables.sql. Once the Supabase project is live, regenerate with:
 *   npm run supabase:types
 *
 * Regenerated types will replace this file automatically.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      // ── Organizations ──────────────────────────────────────────────────────
      organizations: {
        Row: {
          id:                     string
          name:                   string
          slug:                   string
          owner_id:               string | null
          subscription_status:    'trial' | 'active' | 'past_due' | 'canceled'
          stripe_customer_id:     string | null
          stripe_subscription_id: string | null
          settings:               Json
          created_at:             string
          updated_at:             string
        }
        Insert: Omit<Database['public']['Tables']['organizations']['Row'], 'id' | 'created_at' | 'updated_at'>
          & Partial<Pick<Database['public']['Tables']['organizations']['Row'], 'id' | 'created_at' | 'updated_at'>>
        Update: Partial<Database['public']['Tables']['organizations']['Insert']>
      }

      // ── Profiles ───────────────────────────────────────────────────────────
      profiles: {
        Row: {
          id:                string
          org_id:            string
          full_name:         string
          role:              'owner' | 'admin' | 'field' | 'viewer'
          phone:             string | null
          avatar_url:        string | null
          passcode_hash:     string | null
          biometric_enabled: boolean
          last_login_at:     string | null
          last_login_ip:     string | null
          last_login_device: string | null
          is_active:             boolean
          audit_token:           string | null
          audit_access_enabled:  boolean
          onboarding_completed:  boolean | null
          created_at:            string
          updated_at:            string
        }
        Insert: Omit<Database['public']['Tables']['profiles']['Row'], 'created_at' | 'updated_at'>
          & Partial<Pick<Database['public']['Tables']['profiles']['Row'], 'created_at' | 'updated_at'>>
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>
      }

      // ── User Sessions ──────────────────────────────────────────────────────
      user_sessions: {
        Row: {
          id:             string
          user_id:        string
          org_id:         string
          device_type:    'ios' | 'android' | 'web' | 'desktop' | null
          device_info:    Json | null
          ip_address:     string | null
          started_at:     string
          last_active_at: string
          ended_at:       string | null
          is_anomalous:   boolean
        }
        Insert: Omit<Database['public']['Tables']['user_sessions']['Row'], 'id' | 'started_at' | 'last_active_at'>
          & Partial<Pick<Database['public']['Tables']['user_sessions']['Row'], 'id' | 'started_at' | 'last_active_at'>>
        Update: Partial<Database['public']['Tables']['user_sessions']['Insert']>
      }

      // ── Clients ────────────────────────────────────────────────────────────
      clients: {
        Row: {
          id:         string
          org_id:     string
          name:       string
          company:    string | null
          email:      string | null
          phone:      string | null
          address:    Json | null
          type:       'residential' | 'commercial' | 'industrial'
          source:     string | null
          notes:      string | null
          tags:       string[] | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['clients']['Row'], 'id' | 'created_at' | 'updated_at'>
          & Partial<Pick<Database['public']['Tables']['clients']['Row'], 'id' | 'created_at' | 'updated_at'>>
        Update: Partial<Database['public']['Tables']['clients']['Insert']>
      }

      // ── Project Templates ──────────────────────────────────────────────────
      project_templates: {
        Row: {
          id:              string
          org_id:          string
          name:            string
          type:            string
          phases:          Json
          default_tasks:   Json | null
          compliance_reqs: Json | null
          is_active:       boolean
          created_at:      string
          updated_at:      string
        }
        Insert: Omit<Database['public']['Tables']['project_templates']['Row'], 'id' | 'created_at' | 'updated_at'>
          & Partial<Pick<Database['public']['Tables']['project_templates']['Row'], 'id' | 'created_at' | 'updated_at'>>
        Update: Partial<Database['public']['Tables']['project_templates']['Insert']>
      }

      // ── Projects ───────────────────────────────────────────────────────────
      projects: {
        Row: {
          id:               string
          org_id:           string
          client_id:        string | null
          name:             string
          description:      string | null
          type:             'residential_service' | 'residential_remodel' | 'residential_new'
                          | 'commercial_ti' | 'commercial_new' | 'commercial_service'
                          | 'industrial' | 'solar' | 'ev_charger' | 'panel_upgrade' | 'other'
          status:           'lead' | 'estimate' | 'pending' | 'approved' | 'in_progress'
                          | 'on_hold' | 'punch_list' | 'closeout' | 'completed' | 'canceled'
          phase:            string | null
          template_id:      string | null
          priority:         'low' | 'normal' | 'high' | 'urgent'
          address:          Json | null
          estimated_value:  number | null
          contract_value:   number | null
          actual_cost:      number | null
          estimated_start:  string | null
          estimated_end:    string | null
          actual_start:     string | null
          actual_end:       string | null
          permit_status:    'not_required' | 'pending' | 'submitted' | 'approved' | 'failed' | 'expired'
          permit_number:    string | null
          inspection_status: string | null
          ahj_jurisdiction: string | null
          nec_version:      string
          closeout_score:   number | null
          tags:             string[] | null
          metadata:         Json
          created_by:       string | null
          created_at:       string
          updated_at:       string
        }
        Insert: Omit<Database['public']['Tables']['projects']['Row'], 'id' | 'created_at' | 'updated_at'>
          & Partial<Pick<Database['public']['Tables']['projects']['Row'], 'id' | 'created_at' | 'updated_at'>>
        Update: Partial<Database['public']['Tables']['projects']['Insert']>
      }

      // ── Invoices ───────────────────────────────────────────────────────────
      invoices: {
        Row: {
          id:             string
          org_id:         string
          project_id:     string | null
          client_id:      string | null
          invoice_number: string
          status:         'draft' | 'sent' | 'viewed' | 'partial' | 'paid' | 'overdue' | 'void' | 'disputed'
          line_items:     Json
          subtotal:       number | null
          tax_rate:       number | null
          tax_amount:     number | null
          total:          number | null
          amount_paid:    number
          balance_due:    number | null
          due_date:       string | null
          days_overdue:   number
          last_reminder_at: string | null
          reminder_count: number
          payment_method: string | null
          sent_at:        string | null
          paid_at:        string | null
          created_by:     string | null
          created_at:     string
          updated_at:     string
        }
        Insert: Omit<Database['public']['Tables']['invoices']['Row'], 'id' | 'days_overdue' | 'created_at' | 'updated_at'>
          & Partial<Pick<Database['public']['Tables']['invoices']['Row'], 'id' | 'created_at' | 'updated_at'>>
        Update: Partial<Database['public']['Tables']['invoices']['Insert']>
      }

      // ── Payments ────────────────────────────────────────────────────────────
      payments: {
        Row: {
          id:          string
          org_id:      string
          invoice_id:  string
          amount:      number
          method:      'check' | 'cash' | 'credit_card' | 'ach' | 'zelle' | 'venmo' | 'other'
          reference:   string | null
          received_at: string
          recorded_by: string
          notes:       string | null
          created_at:  string
        }
        Insert: Omit<Database['public']['Tables']['payments']['Row'], 'id' | 'created_at'>
          & Partial<Pick<Database['public']['Tables']['payments']['Row'], 'id' | 'created_at'>>
        Update: Partial<Database['public']['Tables']['payments']['Insert']>
      }

      // ── Estimates ───────────────────────────────────────────────────────────
      estimates: {
        Row: {
          id:          string
          org_id:      string
          project_id:  string | null
          client_id:   string | null
          status:      'draft' | 'sent' | 'viewed' | 'accepted' | 'rejected' | 'expired'
          line_items:  Json
          subtotal:    number | null
          tax_rate:    number | null
          tax_amount:  number | null
          total:       number | null
          valid_until: string | null
          sent_at:     string | null
          accepted_at: string | null
          created_by:  string | null
          created_at:  string
          updated_at:  string
        }
        Insert: Omit<Database['public']['Tables']['estimates']['Row'], 'id' | 'created_at' | 'updated_at'>
          & Partial<Pick<Database['public']['Tables']['estimates']['Row'], 'id' | 'created_at' | 'updated_at'>>
        Update: Partial<Database['public']['Tables']['estimates']['Insert']>
      }

      // ── Agents ─────────────────────────────────────────────────────────────
      agents: {
        Row: {
          id:             string
          name:           string
          display_name:   string
          domain:         string
          status:         'active' | 'paused' | 'error' | 'maintenance'
          config:         Json
          memory_scope:   string[]
          last_active_at: string | null
          error_count:    number
          created_at:     string
        }
        Insert: Omit<Database['public']['Tables']['agents']['Row'], 'created_at'>
          & Partial<Pick<Database['public']['Tables']['agents']['Row'], 'created_at'>>
        Update: Partial<Database['public']['Tables']['agents']['Insert']>
      }

      // ── Notifications ──────────────────────────────────────────────────────
      notifications: {
        Row: {
          id:         string
          org_id:     string
          user_id:    string
          agent_id:   string | null
          type:       'alert' | 'reminder' | 'proposal' | 'report' | 'anomaly' | 'approval_required'
          title:      string
          body:       string | null
          data:       Json | null
          channel:    'push' | 'email' | 'sms' | 'in_app'
          is_read:    boolean
          read_at:    string | null
          sent_at:    string
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['notifications']['Row'], 'id' | 'sent_at' | 'created_at'>
          & Partial<Pick<Database['public']['Tables']['notifications']['Row'], 'id' | 'sent_at' | 'created_at'>>
        Update: Partial<Database['public']['Tables']['notifications']['Insert']>
      }

      // ── Audit Log ──────────────────────────────────────────────────────────
      audit_log: {
        Row: {
          id:          number
          org_id:      string
          actor_type:  'user' | 'agent' | 'system'
          actor_id:    string
          actor_name:  string | null
          action:      string
          entity_type: string
          entity_id:   string | null
          description: string | null
          changes:     Json | null
          metadata:    Json
          ip_address:  string | null
          device_type: string | null
          session_id:  string | null
          created_at:  string
        }
        Insert: Omit<Database['public']['Tables']['audit_log']['Row'], 'id' | 'created_at'>
          & Partial<Pick<Database['public']['Tables']['audit_log']['Row'], 'created_at'>>
        Update: never   // audit_log is append-only
      }
    }

    Views:   Record<string, never>

    Functions: {
      search_memory: {
        Args: {
          p_org_id:          string
          p_query_embedding: string
          p_agent_id?:       string | null
          p_entity_type?:    string | null
          p_limit?:          number
          p_threshold?:      number
        }
        Returns: Array<{
          id:          string
          entity_type: string
          entity_id:   string | null
          agent_id:    string | null
          content:     string
          similarity:  number
          metadata:    Json
          created_at:  string
        }>
      }

      upsert_memory: {
        Args: {
          p_org_id:       string
          p_entity_type:  string
          p_entity_id:    string | null
          p_agent_id:     string | null
          p_content:      string
          p_embedding:    string
          p_metadata?:    Json
        }
        Returns: string
      }

      seed_project_templates_for_org: {
        Args: { p_org_id: string }
        Returns: void
      }
    }

    Enums:        Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
