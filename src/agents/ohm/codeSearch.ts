// @ts-nocheck
/**
 * Code Search Module — Search and retrieve NEC articles, jurisdiction rules, and related code references.
 *
 * Features:
 * - Keyword-based NEC article search (vector embeddings for future)
 * - Jurisdiction rule lookup and amendment retrieval
 * - Related articles discovery
 * - Natural language query interpretation via Claude
 */

import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────────────────────

export interface NECArticle {
  id: string
  article_number: string
  section: string
  title: string
  description: string
  excerpt: string
  base_code: string
  is_california_amendment: boolean
  nec_version: string
  keywords: string[]
  related_articles: string[]
}

export interface JurisdictionRule {
  id: string
  jurisdiction: string
  rule_category: string
  nec_article: string
  rule_text: string
  severity: 'info' | 'warning' | 'error'
  effective_date: string
  expires_date: string | null
}

export interface CodeSearchResult {
  articles: NECArticle[]
  rules: JurisdictionRule[]
  relatedTopics: string[]
}

// ── NEC Article Search ───────────────────────────────────────────────────────

/**
 * Search NEC articles using keyword matching and text search.
 * For now, uses keyword-based matching. Future: integrate vector search when embeddings are populated.
 *
 * @param query Natural language query (e.g., "wire sizing for 100 amp service")
 * @param jurisdiction Optional jurisdiction for related rules
 * @param keywords Optional keyword array for direct search
 * @returns Promise with matching articles and rules
 */
export async function searchNECArticles(
  query: string,
  jurisdiction?: string,
  keywords?: string[]
): Promise<CodeSearchResult> {
  try {
    let searchKeywords = keywords

    // If no keywords provided, use Claude to extract them from natural language
    if (!searchKeywords || searchKeywords.length === 0) {
      searchKeywords = await extractKeywordsFromQuery(query)
    }

    // Search articles by keywords (keyword array overlap)
    let articlesQuery = supabase
      .from('nec_articles')
      .select('*')

    // If we have keywords, filter by keyword array overlap
    if (searchKeywords.length > 0) {
      // Use keyword text search on the keywords array
      // This is PostgreSQL array overlap operator @> or @<
      const keywordFilter = searchKeywords.map(k => `%${k.toLowerCase()}%`)

      // Search in keywords and title/description
      articlesQuery = articlesQuery.or(
        `keywords.cs.{${searchKeywords.map(k => `"${k}"`).join(',')}},title.ilike.%${query}%,description.ilike.%${query}%`
      )
    } else {
      // Fallback to text search on title and description
      articlesQuery = articlesQuery.or(`title.ilike.%${query}%,description.ilike.%${query}%`)
    }

    const { data: articles, error: articlesError } = await articlesQuery.limit(10)

    if (articlesError) {
      console.error('[OHM] Article search error:', articlesError)
      throw new Error(`Article search failed: ${articlesError.message}`)
    }

    // Fetch jurisdiction rules if jurisdiction provided
    let rules: JurisdictionRule[] = []
    if (jurisdiction) {
      const { data: rulesData, error: rulesError } = await supabase
        .from('jurisdiction_rules')
        .select('*')
        .eq('jurisdiction', jurisdiction)
        .limit(5)

      if (rulesError) {
        console.error('[OHM] Jurisdiction rules error:', rulesError)
      } else {
        rules = rulesData || []
      }
    }

    // Extract unique related topics from articles
    const relatedTopics = Array.from(
      new Set((articles || []).flatMap(a => a.related_articles || []))
    )

    return {
      articles: (articles as NECArticle[]) || [],
      rules,
      relatedTopics: relatedTopics.slice(0, 5),
    }
  } catch (err) {
    console.error('[OHM] searchNECArticles error:', err)
    throw err
  }
}

/**
 * Future: Vector search for NEC articles using embeddings.
 * Placeholder for when embeddings are populated in nec_articles table.
 *
 * @param queryVector Embedding vector for the search query
 * @param limit Number of results to return
 * @returns Promise with similar articles
 */
export async function searchNECArticlesByVector(
  queryVector: number[],
  limit: number = 5
): Promise<NECArticle[]> {
  try {
    // Placeholder RPC call for vector search (requires PostgreSQL pgvector extension)
    // This will be implemented when embeddings are generated for all NEC articles
    /*
    const { data, error } = await supabase.rpc('search_nec_articles_vector', {
      query_vector: queryVector,
      match_count: limit,
      match_threshold: 0.75,
    })

    if (error) throw new Error(`Vector search failed: ${error.message}`)
    return data as NECArticle[]
    */

    console.warn('[OHM] Vector search not yet implemented; use keyword search instead')
    return []
  } catch (err) {
    console.error('[OHM] Vector search error:', err)
    return []
  }
}

// ── Jurisdiction Rules ───────────────────────────────────────────────────────

/**
 * Get jurisdiction-specific rules for a given jurisdiction and optional NEC article.
 *
 * @param jurisdiction Jurisdiction name (e.g., "San Diego County", "Los Angeles City")
 * @param necArticle Optional NEC article number to filter (e.g., "310")
 * @returns Promise with jurisdiction rules
 */
export async function getJurisdictionRules(
  jurisdiction: string,
  necArticle?: string
): Promise<JurisdictionRule[]> {
  try {
    let query = supabase
      .from('jurisdiction_rules')
      .select('*')
      .eq('jurisdiction', jurisdiction)

    if (necArticle) {
      query = query.eq('nec_article', necArticle)
    }

    const { data, error } = await query

    if (error) {
      console.error('[OHM] getJurisdictionRules error:', error)
      throw new Error(`Failed to fetch jurisdiction rules: ${error.message}`)
    }

    return (data as JurisdictionRule[]) || []
  } catch (err) {
    console.error('[OHM] getJurisdictionRules error:', err)
    throw err
  }
}

/**
 * Get California-specific amendments for a given NEC article.
 *
 * @param necArticle NEC article number (e.g., "625" for EV charging)
 * @returns Promise with California amendment articles
 */
export async function getCaliforniaAmendments(necArticle: string): Promise<NECArticle[]> {
  try {
    const { data, error } = await supabase
      .from('nec_articles')
      .select('*')
      .eq('nec_article', necArticle)
      .eq('is_california_amendment', true)

    if (error) {
      console.error('[OHM] getCaliforniaAmendments error:', error)
      throw new Error(`Failed to fetch California amendments: ${error.message}`)
    }

    return (data as NECArticle[]) || []
  } catch (err) {
    console.error('[OHM] getCaliforniaAmendments error:', err)
    throw err
  }
}

// ── Related Articles ─────────────────────────────────────────────────────────

/**
 * Get articles related to a given NEC article number.
 *
 * @param articleNumber NEC article number (e.g., "310")
 * @returns Promise with related articles
 */
export async function getRelatedArticles(articleNumber: string): Promise<NECArticle[]> {
  try {
    // First get the article to see its related_articles list
    const { data: article, error: articleError } = await supabase
      .from('nec_articles')
      .select('related_articles')
      .eq('article_number', articleNumber)
      .single()

    if (articleError) {
      console.error('[OHM] getRelatedArticles fetch error:', articleError)
      return []
    }

    if (!article?.related_articles || article.related_articles.length === 0) {
      return []
    }

    // Fetch the related articles by number
    const { data: relatedArticles, error: relatedError } = await supabase
      .from('nec_articles')
      .select('*')
      .in('article_number', article.related_articles)

    if (relatedError) {
      console.error('[OHM] getRelatedArticles fetch related error:', relatedError)
      return []
    }

    return (relatedArticles as NECArticle[]) || []
  } catch (err) {
    console.error('[OHM] getRelatedArticles error:', err)
    return []
  }
}

// ── Keyword Extraction ───────────────────────────────────────────────────────

/**
 * Use Claude to extract keywords from a natural language query.
 * This helps improve search accuracy for NEC articles.
 *
 * @param query Natural language query
 * @returns Promise with extracted keywords
 */
async function extractKeywordsFromQuery(query: string): Promise<string[]> {
  try {
    const response = await fetch('/.netlify/functions/claude', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        messages: [
          {
            role: 'user',
            content: `Extract 3-5 electrical code keywords from this query for NEC article search:
"${query}"

Return ONLY a comma-separated list of keywords (no explanation). Examples: wire sizing, EV charging, solar, grounding, conduit fill`,
          },
        ],
      }),
    })

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.statusText}`)
    }

    const data = await response.json()
    const content = (data.content?.[0]?.text ?? '') as string
    const keywords = content
      .split(',')
      .map(k => k.trim().toLowerCase())
      .filter(k => k.length > 0)

    return keywords.slice(0, 5)
  } catch (err) {
    console.error('[OHM] extractKeywordsFromQuery error:', err)
    return []
  }
}

// ── Query Utilities ──────────────────────────────────────────────────────────

/**
 * Format NEC article for display with section and excerpt.
 *
 * @param article NEC article to format
 * @returns Formatted string for display
 */
export function formatNECArticle(article: NECArticle): string {
  const cal = article.is_california_amendment ? ' (California Amendment)' : ''
  return `
**NEC ${article.article_number}${cal}** — ${article.title}

Section: ${article.section}
${article.excerpt}

Keywords: ${article.keywords.join(', ')}
`.trim()
}

/**
 * Format jurisdiction rule for display.
 *
 * @param rule Jurisdiction rule to format
 * @returns Formatted string for display
 */
export function formatJurisdictionRule(rule: JurisdictionRule): string {
  return `
**${rule.jurisdiction}** — ${rule.rule_category}

Severity: ${rule.severity.toUpperCase()}
NEC Article: ${rule.nec_article}

${rule.rule_text}

Effective: ${rule.effective_date}${rule.expires_date ? ` (expires ${rule.expires_date})` : ''}
`.trim()
}
