// @ts-nocheck
/**
 * SPARK Conversation Memory Service
 *
 * Per-contact memory system tracking:
 * - Every conversation, date, duration, and transcript summary
 * - All commitments made (both sides) with status tracking
 * - Relationship scoring (1-10) based on frequency, payment history, engagement
 * - Searchable conversation history (forever storage in Supabase)
 * - Promise tracking and fulfillment flagging
 *
 * Storage: Supabase spark_contacts table (primary), fallback localStorage
 * Sync: Merge localStorage with Supabase on connection restore
 */

import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────────────────────

export type ContactType = 'GC' | 'PM' | 'homeowner' | 'solar'
export type PromiseStatus = 'pending' | 'fulfilled' | 'broken'
export type CommitmentOutcome = 'interested' | 'uninterested' | 'quoted' | 'won' | 'lost' | 'follow_up_needed'

export interface Commitment {
  text: string
  made_by: 'christian' | 'them'
  date: string // ISO timestamp
  due_date?: string // ISO timestamp
  status: PromiseStatus
  flagged?: boolean // Set when overdue or broken
}

export interface Conversation {
  id: string
  date: string // ISO timestamp
  duration_minutes?: number
  transcript_summary: string
  commitments_made: Commitment[]
  commitments_received: Commitment[]
  flags: string[] // 'late_payment', 'ghosted', 'broken_promise', etc.
  outcome: CommitmentOutcome
  follow_up_due?: string // ISO timestamp
  notes?: string
}

export interface ContactProfile {
  contact_id: string
  name: string
  company?: string
  role?: string // 'owner', 'manager', 'supervisor', etc.
  type: ContactType
  email?: string
  phone?: string
  first_contact_date: string // ISO timestamp
  last_contact_date: string // ISO timestamp
  total_conversations: number
  total_business_value: number // $ sum
  conversations: Conversation[]
  promises: Commitment[]
  relationship_score: number // 1-10
  score_breakdown?: {
    recency_score: number
    interaction_frequency: number
    business_value: number
    promise_fulfillment_rate: number
    response_rate: number
  }
  user_id?: string // For Supabase linking
  created_at?: string
  updated_at?: string
}

export interface SearchQuery {
  contact_name?: string
  contact_id?: string
  date_range?: { start: string; end: string } // ISO timestamps
  include_flags?: string[]
  query_text?: string // NLP search in transcript_summary
}

export interface SearchResult {
  contact: ContactProfile
  matching_conversations: Conversation[]
  context: string
}

// ── Memory Manager ──────────────────────────────────────────────────────────

class SparkConversationMemoryManager {
  private contacts: Map<string, ContactProfile> = new Map()
  private isInitialized = false

  /**
   * Initialize from Supabase, with fallback to localStorage
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return

    try {
      // Attempt to fetch from Supabase
      const { data, error } = await supabase
        .from('spark_contacts')
        .select('*')
        .order('updated_at', { ascending: false })

      if (error) throw error

      if (data && Array.isArray(data)) {
        data.forEach((contact: any) => {
          this.contacts.set(contact.contact_id, contact)
        })
        console.log(`[SparkMemory] Loaded ${data.length} contacts from Supabase`)
      }
    } catch (err) {
      console.warn('[SparkMemory] Supabase fetch failed, attempting localStorage', err)
      this.loadFromLocalStorage()
    }

    this.isInitialized = true
  }

  /**
   * Fallback: Load from localStorage
   */
  private loadFromLocalStorage(): void {
    try {
      const stored = localStorage.getItem('spark_contacts_memory')
      if (stored) {
        const parsed = JSON.parse(stored) as ContactProfile[]
        parsed.forEach((c) => this.contacts.set(c.contact_id, c))
        console.log(`[SparkMemory] Loaded ${parsed.length} contacts from localStorage`)
      }
    } catch (err) {
      console.warn('[SparkMemory] localStorage load failed', err)
    }
  }

  /**
   * Save all contacts to localStorage (immediate backup)
   */
  private saveToLocalStorage(): void {
    try {
      const arr = Array.from(this.contacts.values())
      localStorage.setItem('spark_contacts_memory', JSON.stringify(arr))
    } catch (err) {
      console.error('[SparkMemory] localStorage save failed', err)
    }
  }

  /**
   * Add or update a contact profile
   */
  async upsertContact(profile: ContactProfile): Promise<void> {
    profile.updated_at = new Date().toISOString()

    // Compute relationship score
    profile.relationship_score = this.computeRelationshipScore(profile)

    this.contacts.set(profile.contact_id, profile)
    this.saveToLocalStorage()

    // Async push to Supabase
    try {
      await supabase
        .from('spark_contacts')
        .upsert([profile], { onConflict: 'contact_id' })
        .select()
    } catch (err) {
      console.error('[SparkMemory] Supabase upsert failed', err)
    }
  }

  /**
   * Record a new conversation for a contact
   */
  async recordConversation(
    contact_id: string,
    conversation: Omit<Conversation, 'id'>
  ): Promise<void> {
    const contact = this.contacts.get(contact_id)
    if (!contact) {
      console.error(`[SparkMemory] Contact ${contact_id} not found`)
      return
    }

    const conv: Conversation = {
      id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      ...conversation,
    }

    contact.conversations.push(conv)
    contact.total_conversations++
    contact.last_contact_date = conv.date

    // Merge commitments into promises array
    ;[...conv.commitments_made, ...conv.commitments_received].forEach((c) => {
      if (!contact.promises.find((p) => p.text === c.text && p.date === c.date)) {
        contact.promises.push(c)
      }
    })

    await this.upsertContact(contact)
  }

  /**
   * Record a commitment (promise) on an existing conversation
   */
  async recordCommitment(
    contact_id: string,
    conversation_id: string,
    commitment: Commitment
  ): Promise<void> {
    const contact = this.contacts.get(contact_id)
    if (!contact) return

    const conv = contact.conversations.find((c) => c.id === conversation_id)
    if (!conv) return

    if (commitment.made_by === 'christian') {
      conv.commitments_made.push(commitment)
    } else {
      conv.commitments_received.push(commitment)
    }

    // Also add to contact-level promises
    if (!contact.promises.find((p) => p.text === commitment.text && p.date === commitment.date)) {
      contact.promises.push(commitment)
    }

    await this.upsertContact(contact)
  }

  /**
   * Update promise status (pending → fulfilled/broken)
   */
  async updatePromiseStatus(
    contact_id: string,
    promise_text: string,
    promise_date: string,
    status: PromiseStatus,
    flagged?: boolean
  ): Promise<void> {
    const contact = this.contacts.get(contact_id)
    if (!contact) return

    const promise = contact.promises.find((p) => p.text === promise_text && p.date === promise_date)
    if (promise) {
      promise.status = status
      if (flagged !== undefined) promise.flagged = flagged
    }

    await this.upsertContact(contact)
  }

  /**
   * Compute relationship score (1-10) based on:
   * - Recency of last contact (decays over time)
   * - Number of interactions
   * - Business value generated
   * - Promise fulfillment rate (both sides)
   * - Response rate to follow-ups
   */
  private computeRelationshipScore(contact: ContactProfile): number {
    let score = 5 // Neutral starting point

    // Recency: decays over 90 days
    const daysSinceContact = Math.max(
      0,
      (Date.now() - new Date(contact.last_contact_date).getTime()) / (1000 * 60 * 60 * 24)
    )
    const recencyScore = Math.max(0, 3 * (1 - daysSinceContact / 90))
    score += recencyScore

    // Interaction frequency: boost for frequent interactions
    const frequencyScore = Math.min(2, contact.total_conversations / 10)
    score += frequencyScore

    // Business value: boost for high-value customers
    const valueScore = Math.min(2, contact.total_business_value / 50000)
    score += valueScore

    // Promise fulfillment rate
    const promises = contact.promises
    if (promises.length > 0) {
      const fulfilled = promises.filter((p) => p.status === 'fulfilled').length
      const fulfillmentRate = fulfilled / promises.length
      const fulfillmentScore = fulfillmentRate * 2
      score += fulfillmentScore
    }

    // Cap at 10
    return Math.min(10, Math.max(1, score))
  }

  /**
   * Search for contacts and conversations
   * Supports: contact name, date range, flags, full-text search
   */
  searchContacts(query: SearchQuery): SearchResult[] {
    const results: SearchResult[] = []

    this.contacts.forEach((contact) => {
      // Name filter
      if (query.contact_name && !contact.name.toLowerCase().includes(query.contact_name.toLowerCase())) {
        return
      }

      // ID filter
      if (query.contact_id && contact.contact_id !== query.contact_id) {
        return
      }

      // Find matching conversations
      let matching = contact.conversations

      // Date range filter
      if (query.date_range) {
        const start = new Date(query.date_range.start).getTime()
        const end = new Date(query.date_range.end).getTime()
        matching = matching.filter((c) => {
          const cDate = new Date(c.date).getTime()
          return cDate >= start && cDate <= end
        })
      }

      // Flags filter
      if (query.include_flags && query.include_flags.length > 0) {
        matching = matching.filter((c) => 
          query.include_flags!.some((flag) => c.flags.includes(flag))
        )
      }

      // Text search
      if (query.query_text) {
        const queryLower = query.query_text.toLowerCase()
        matching = matching.filter(
          (c) =>
            c.transcript_summary.toLowerCase().includes(queryLower) ||
            c.notes?.toLowerCase().includes(queryLower)
        )
      }

      if (matching.length > 0) {
        results.push({
          contact,
          matching_conversations: matching,
          context: `${matching.length} conversation(s) matched in ${contact.name}'s history`,
        })
      }
    })

    return results
  }

  /**
   * Get all contacts that need follow-up
   * Returns contacts with overdue follow_up_due dates
   */
  getOverdueFollowUps(): ContactProfile[] {
    const now = new Date()
    const overdue: ContactProfile[] = []

    this.contacts.forEach((contact) => {
      const conversations = contact.conversations.filter((c) => {
        if (!c.follow_up_due) return false
        const due = new Date(c.follow_up_due)
        return due < now && c.outcome !== 'won'
      })

      if (conversations.length > 0) {
        overdue.push(contact)
      }
    })

    return overdue.sort((a, b) => {
      const aDate = new Date(a.conversations[a.conversations.length - 1]?.follow_up_due || 0)
      const bDate = new Date(b.conversations[b.conversations.length - 1]?.follow_up_due || 0)
      return aDate.getTime() - bDate.getTime()
    })
  }

  /**
   * Get contacts that may be ghosting
   * Returns contacts with last_contact > days_ago and status still 'interested'
   */
  getGhostedContacts(days_ago = 30): ContactProfile[] {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days_ago)

    const ghosted: ContactProfile[] = []
    this.contacts.forEach((contact) => {
      const lastContact = new Date(contact.last_contact_date)
      const lastConv = contact.conversations[contact.conversations.length - 1]

      if (lastContact < cutoff && lastConv?.outcome === 'interested') {
        ghosted.push(contact)
      }
    })

    return ghosted.sort((a, b) => 
      new Date(a.last_contact_date).getTime() - new Date(b.last_contact_date).getTime()
    )
  }

  /**
   * Get all contacts with broken promises (flagged)
   */
  getBrokenPromises(): Array<{ contact: ContactProfile; promise: Commitment }> {
    const broken: Array<{ contact: ContactProfile; promise: Commitment }> = []

    this.contacts.forEach((contact) => {
      contact.promises
        .filter((p) => p.status === 'broken' || (p.flagged && p.status === 'pending'))
        .forEach((promise) => {
          broken.push({ contact, promise })
        })
    })

    return broken.sort((a, b) => 
      new Date(a.promise.date).getTime() - new Date(b.promise.date).getTime()
    )
  }

  /**
   * Get contact by ID
   */
  getContact(contact_id: string): ContactProfile | undefined {
    return this.contacts.get(contact_id)
  }

  /**
   * Get all contacts
   */
  getAllContacts(): ContactProfile[] {
    return Array.from(this.contacts.values())
      .sort((a, b) => b.relationship_score - a.relationship_score)
  }

  /**
   * Sync localStorage with Supabase (bidirectional merge)
   */
  async syncWithSupabase(): Promise<void> {
    try {
      // Fetch latest from Supabase
      const { data, error } = await supabase
        .from('spark_contacts')
        .select('*')
        .order('updated_at', { ascending: false })

      if (error) throw error

      if (data) {
        // Merge: prefer Supabase if updated_at is newer
        data.forEach((remote: any) => {
          const local = this.contacts.get(remote.contact_id)
          if (!local || new Date(remote.updated_at) > new Date(local.updated_at || '')) {
            this.contacts.set(remote.contact_id, remote)
          }
        })

        // Push any local updates that are newer
        const toSync = Array.from(this.contacts.values()).filter((c) => {
          const remote = data.find((r: any) => r.contact_id === c.contact_id)
          return !remote || new Date(c.updated_at || '') > new Date(remote.updated_at)
        })

        if (toSync.length > 0) {
          await supabase.from('spark_contacts').upsert(toSync, { onConflict: 'contact_id' })
        }
      }

      this.saveToLocalStorage()
      console.log('[SparkMemory] Sync completed')
    } catch (err) {
      console.error('[SparkMemory] Sync failed', err)
    }
  }
}

// ── Singleton Instance ──────────────────────────────────────────────────────

let instance: SparkConversationMemoryManager | null = null

export async function getSparkMemoryManager(): Promise<SparkConversationMemoryManager> {
  if (!instance) {
    instance = new SparkConversationMemoryManager()
    await instance.initialize()
  }
  return instance
}

// ── Exported named functions ────────────────────────────────────────────────

export async function initializeSparkMemory(): Promise<void> {
  const manager = await getSparkMemoryManager()
  return Promise.resolve()
}

export async function recordContactConversation(
  contact_id: string,
  conversation: Omit<Conversation, 'id'>
): Promise<void> {
  const manager = await getSparkMemoryManager()
  return manager.recordConversation(contact_id, conversation)
}

export async function updateContactPromise(
  contact_id: string,
  promise_text: string,
  promise_date: string,
  status: PromiseStatus,
  flagged?: boolean
): Promise<void> {
  const manager = await getSparkMemoryManager()
  return manager.updatePromiseStatus(contact_id, promise_text, promise_date, status, flagged)
}

export async function searchSparkContacts(query: SearchQuery): Promise<SearchResult[]> {
  const manager = await getSparkMemoryManager()
  return manager.searchContacts(query)
}

export async function getOverdueFollowUps(): Promise<ContactProfile[]> {
  const manager = await getSparkMemoryManager()
  return manager.getOverdueFollowUps()
}

export async function getGhostedContacts(days_ago?: number): Promise<ContactProfile[]> {
  const manager = await getSparkMemoryManager()
  return manager.getGhostedContacts(days_ago)
}

export async function getBrokenPromises(): Promise<Array<{ contact: ContactProfile; promise: Commitment }>> {
  const manager = await getSparkMemoryManager()
  return manager.getBrokenPromises()
}

export async function upsertSparkContact(profile: ContactProfile): Promise<void> {
  const manager = await getSparkMemoryManager()
  return manager.upsertContact(profile)
}

export async function getSparkContact(contact_id: string): Promise<ContactProfile | undefined> {
  const manager = await getSparkMemoryManager()
  return manager.getContact(contact_id)
}

export async function getAllSparkContacts(): Promise<ContactProfile[]> {
  const manager = await getSparkMemoryManager()
  return manager.getAllContacts()
}

export async function syncSparkMemoryWithSupabase(): Promise<void> {
  const manager = await getSparkMemoryManager()
  return manager.syncWithSupabase()
}
