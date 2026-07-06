/**
 * Browser-side TLMA results table parser.
 * Parses pasted HTML from publiclookup.rivco.org (#resultsScroll / results-table).
 */

export interface ParsedTlmaPermit {
  permit_number: string
  description: string
  status: string
  city: string
  street_name: string
  apn: string
  tract: string | null
  lot: string | null
  permit_type: string
  sqft_by_type: string
  sqft_breakdown: Record<string, number>
  total_sqft: number | null
  applied_date: string | null
  issued_date: string | null
  finalized_date: string | null
  expired_date: string | null
  contact: string | null
  contact_type: string | null
  contact_company: string | null
  contact_home_phone: string | null
  contact_business_phone: string | null
  contact_mobile_phone: string | null
  project_name: string | null
  print_href: string | null
  source_url: string
  address: string | null
}

export interface TlmaParseResult {
  total_rows: number
  rows_with_permit_numbers: number
  permits: ParsedTlmaPermit[]
  warnings: string[]
}

export interface TlmaSearchFilters {
  city?: string
  permitType?: string
  pageSize?: number
  page?: number
  appliedDateStart?: string
  appliedDateEnd?: string
  issuedDateStart?: string
  issuedDateEnd?: string
}

export const DEFAULT_TLMA_SEARCH_FILTERS: Required<TlmaSearchFilters> = {
  city: '',
  permitType: 'Commercial Buildings (BNR)',
  pageSize: 100,
  page: 1,
  appliedDateStart: '',
  appliedDateEnd: '',
  issuedDateStart: '',
  issuedDateEnd: '',
}

export const TLMA_SEARCH_CITIES = [
  { label: 'Any / All TLMA', value: '' },
  { label: 'CABAZON', value: 'CABAZON' },
  { label: 'COACHELLA', value: 'COACHELLA' },
  { label: 'DESERT CENTER', value: 'DESERT CENTER' },
  { label: 'DESERT EDGE', value: 'DESERT EDGE' },
  { label: 'EAST HEMET', value: 'EAST HEMET' },
  { label: 'LAKE ELSINORE', value: 'LAKE ELSINORE' },
  { label: 'MECCA', value: 'MECCA' },
  { label: 'NORTH PALM SPRINGS', value: 'NORTH PALM SPRINGS' },
  { label: 'RIVERSIDE', value: 'RIVERSIDE' },
  { label: 'SKY VALLEY', value: 'SKY VALLEY' },
  { label: 'TEMECULA', value: 'TEMECULA' },
  { label: 'THERMAL', value: 'THERMAL' },
  { label: 'THOUSAND PALMS', value: 'THOUSAND PALMS' },
  { label: 'WINCHESTER', value: 'WINCHESTER' },
] as const

/** Exact TLMA Criteria.PermitType values from publiclookup.rivco.org dropdown. */
export const TLMA_SEARCH_PERMIT_TYPES = [
  { label: 'Any / All Permit Types', value: '' },
  { label: 'Commercial Buildings (BNR)', value: 'Commercial Buildings (BNR)' },
  { label: 'Residential Buildings', value: 'Residential Dwelling (BRS)' },
  { label: 'Electrical', value: 'Electric (BEL)' },
  { label: 'Solar / Wind', value: 'Wind Energy Conversion (BWE)' },
  { label: 'Mechanical', value: 'Mechanical (BME)' },
  { label: 'Plumbing', value: 'Plumbing (BPL)' },
  { label: 'Grading', value: 'Grading (BGR)' },
] as const

export const TLMA_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

const TLMA_ORIGIN = 'https://publiclookup.rivco.org'

const HEADER_ALIASES: Record<string, keyof ParsedTlmaPermit> = {
  'permit number': 'permit_number',
  'permit #': 'permit_number',
  permit: 'permit_number',
  description: 'description',
  'permit description': 'description',
  status: 'status',
  'permit status': 'status',
  city: 'city',
  'street name': 'street_name',
  street: 'street_name',
  address: 'street_name',
  apn: 'apn',
  tract: 'tract',
  lot: 'lot',
  'permit type': 'permit_type',
  type: 'permit_type',
  'sq ft by type': 'sqft_by_type',
  'sqft by type': 'sqft_by_type',
  'total sq ft': 'total_sqft',
  'total sqft': 'total_sqft',
  'applied date': 'applied_date',
  'issued date': 'issued_date',
  'finalized date': 'finalized_date',
  'final date': 'finalized_date',
  'expired date': 'expired_date',
  'expire date': 'expired_date',
  contact: 'contact',
  'contact name': 'contact',
  'contact type': 'contact_type',
  company: 'contact_company',
  'contact company': 'contact_company',
  'home phone': 'contact_home_phone',
  'business phone': 'contact_business_phone',
  'mobile phone': 'contact_mobile_phone',
  mobile: 'contact_mobile_phone',
  'project name': 'project_name',
  project: 'project_name',
}

const POSITION_FIELDS: Array<keyof ParsedTlmaPermit> = [
  'permit_number',
  'description',
  'status',
  'city',
  'street_name',
  'apn',
  'tract',
  'lot',
  'permit_type',
  'sqft_by_type',
  'total_sqft',
  'applied_date',
  'issued_date',
  'finalized_date',
  'expired_date',
  'contact',
  'contact_type',
  'contact_company',
  'contact_home_phone',
  'contact_business_phone',
  'contact_mobile_phone',
  'project_name',
]

function decodeHtmlEntities(value: string) {
  if (!value) return ''
  const textarea = document.createElement('textarea')
  textarea.innerHTML = value
  return textarea.value
}

function cleanText(value: string | null | undefined) {
  return decodeHtmlEntities(String(value || ''))
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeHeader(value: string) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9# ]/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeDate(value: string | null | undefined): string | null {
  const trimmed = cleanText(value || '')
  if (!trimmed || trimmed === 'N/A' || trimmed === '-') return null
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10)
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (us) {
    const [, mm, dd, yyyy] = us
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
  }
  return trimmed
}

function parseSqftBreakdown(raw: string): Record<string, number> {
  const result: Record<string, number> = {}
  if (!raw?.trim()) return result
  for (const line of raw.split(/\n+/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = trimmed.match(/^(.+?)\s+([\d,]+(?:\.\d+)?)$/)
    if (!match) continue
    const key = match[1]
      .toLowerCase()
      .replace(/\([^)]*\)/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .replace(/\s+/g, '_')
    const val = Math.round(parseFloat(match[2].replace(/,/g, '')))
    if (key && Number.isFinite(val)) result[key] = val
  }
  return result
}

function parseTotalSqft(value: string | null | undefined, breakdown: Record<string, number>) {
  const raw = cleanText(value || '')
  if (raw) {
    const parsed = parseFloat(raw.replace(/,/g, ''))
    if (Number.isFinite(parsed)) return Math.round(parsed)
  }
  const values = Object.values(breakdown)
  return values.length ? values.reduce((sum, n) => sum + n, 0) : null
}

function absoluteTlmaUrl(href: string | null | undefined) {
  const trimmed = cleanText(href || '')
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('/')) return `${TLMA_ORIGIN}${trimmed}`
  return `${TLMA_ORIGIN}/${trimmed.replace(/^\/+/, '')}`
}

function buildPermitSourceUrl(permitNumber: string, printHref: string | null) {
  if (printHref) return printHref
  const params = new URLSearchParams({ 'Criteria.PermitNumber': permitNumber })
  return `${TLMA_ORIGIN}/?${params.toString()}`
}

function buildAddress(streetName: string, city: string) {
  const street = cleanText(streetName)
  const cityName = cleanText(city)
  if (street && cityName) return `${street}, ${cityName}, CA`
  return street || cityName || null
}

function cellText(cell: Element | null | undefined) {
  if (!cell) return ''
  const clone = cell.cloneNode(true) as HTMLElement
  clone.querySelectorAll('script, style').forEach(node => node.remove())
  return cleanText(clone.textContent || '')
}

function cellMultilineText(cell: Element | null | undefined) {
  if (!cell) return ''
  const clone = cell.cloneNode(true) as HTMLElement
  clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'))
  clone.querySelectorAll('script, style').forEach(node => node.remove())
  return decodeHtmlEntities(clone.innerHTML || '')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

function findResultsTable(doc: Document) {
  const scrollRoot = doc.querySelector('#resultsScroll')
  if (scrollRoot) {
    const nested = scrollRoot.querySelector('table.results-table, table')
    if (nested) return nested
  }
  return doc.querySelector('table.results-table') || doc.querySelector('table')
}

function headerFieldMap(table: HTMLTableElement) {
  const headerCells = Array.from(
    table.querySelectorAll('thead th, thead td, tr:first-child th, tr:first-child td')
  )
  const map = new Map<number, keyof ParsedTlmaPermit>()
  headerCells.forEach((cell, index) => {
    const field = HEADER_ALIASES[normalizeHeader(cell.textContent || '')]
    if (field) map.set(index, field)
  })
  return map
}

function extractPrintHref(row: Element) {
  const link =
    row.querySelector('a[href*="Print" i]') ||
    row.querySelector('a[href*="print" i]') ||
    row.querySelector('td a[href]') ||
    row.querySelector('a[href]')
  return absoluteTlmaUrl(link?.getAttribute('href'))
}

function rowToPermit(cells: Element[], headerMap: Map<number, keyof ParsedTlmaPermit>, row: Element): ParsedTlmaPermit | null {
  const values: Partial<Record<keyof ParsedTlmaPermit, string>> = {}

  cells.forEach((cell, index) => {
    const field = headerMap.get(index) || POSITION_FIELDS[index]
    if (!field || field === 'print_href' || field === 'source_url' || field === 'address' || field === 'sqft_breakdown') return
    const text = field === 'sqft_by_type' ? cellMultilineText(cell) : cellText(cell)
    values[field] = text
  })

  const permitNumber = cleanText(values.permit_number || '')
  if (!permitNumber) return null

  const sqftByType = values.sqft_by_type || ''
  const sqftBreakdown = parseSqftBreakdown(sqftByType)
  const printHref = extractPrintHref(row)
  const streetName = cleanText(values.street_name || '')
  const city = cleanText(values.city || '')

  return {
    permit_number: permitNumber,
    description: cleanText(values.description || ''),
    status: cleanText(values.status || ''),
    city,
    street_name: streetName,
    apn: cleanText(values.apn || ''),
    tract: cleanText(values.tract || '') || null,
    lot: cleanText(values.lot || '') || null,
    permit_type: cleanText(values.permit_type || ''),
    sqft_by_type: sqftByType,
    sqft_breakdown: sqftBreakdown,
    total_sqft: parseTotalSqft(values.total_sqft, sqftBreakdown),
    applied_date: normalizeDate(values.applied_date),
    issued_date: normalizeDate(values.issued_date),
    finalized_date: normalizeDate(values.finalized_date),
    expired_date: normalizeDate(values.expired_date),
    contact: cleanText(values.contact || '') || null,
    contact_type: cleanText(values.contact_type || '') || null,
    contact_company: cleanText(values.contact_company || '') || null,
    contact_home_phone: cleanText(values.contact_home_phone || '') || null,
    contact_business_phone: cleanText(values.contact_business_phone || '') || null,
    contact_mobile_phone: cleanText(values.contact_mobile_phone || '') || null,
    project_name: cleanText(values.project_name || '') || null,
    print_href: printHref,
    source_url: buildPermitSourceUrl(permitNumber, printHref),
    address: buildAddress(streetName, city),
  }
}

export function buildTlmaSearchUrl(filters: TlmaSearchFilters = DEFAULT_TLMA_SEARCH_FILTERS) {
  const city = String(filters.city ?? '').trim()
  const permitType = String(filters.permitType ?? '').trim()
  const pageSize = Math.min(Math.max(Number(filters.pageSize) || 100, 1), 100)
  const page = Math.min(Math.max(Number(filters.page) || 1, 1), 9999)
  const appliedDateStart = String(filters.appliedDateStart ?? '').trim()
  const appliedDateEnd = String(filters.appliedDateEnd ?? '').trim()
  const issuedDateStart = String(filters.issuedDateStart ?? '').trim()
  const issuedDateEnd = String(filters.issuedDateEnd ?? '').trim()

  const queryParts = [
    `Page=${page}`,
    `PageSize=${pageSize}`,
    'SortBy=IssuedDate',
    'SortDesc=value',
    'Criteria.PermitNumber=',
    `Criteria.PermitType=${encodeURIComponent(permitType)}`,
    'Criteria.WorkClass=',
    'Criteria.StreetName=',
    `Criteria.City=${encodeURIComponent(city)}`,
    'Criteria.ParcelNumber=',
    'Criteria.ProjectName=',
    'Criteria.Description=',
    'Criteria.SubdivisionName=',
    'Criteria.Tract=',
    'Criteria.Lot=',
    'Criteria.ContactName=',
    'Criteria.SqFtMin=',
    '__Invariant=Criteria.SqFtMin',
    'Criteria.SqFtMax=',
    '__Invariant=Criteria.SqFtMax',
  ]

  if (appliedDateStart) {
    queryParts.push(`Criteria.AppliedDateStart=${encodeURIComponent(appliedDateStart)}`)
  } else {
    queryParts.push('Criteria.AppliedDateStart=', '__Invariant=Criteria.AppliedDateStart')
  }
  if (appliedDateEnd) {
    queryParts.push(`Criteria.AppliedDateEnd=${encodeURIComponent(appliedDateEnd)}`)
  } else {
    queryParts.push('Criteria.AppliedDateEnd=', '__Invariant=Criteria.AppliedDateEnd')
  }
  if (issuedDateStart) {
    queryParts.push(`Criteria.IssuedDateStart=${encodeURIComponent(issuedDateStart)}`)
  } else {
    queryParts.push('Criteria.IssuedDateStart=', '__Invariant=Criteria.IssuedDateStart')
  }
  if (issuedDateEnd) {
    queryParts.push(`Criteria.IssuedDateEnd=${encodeURIComponent(issuedDateEnd)}`)
  } else {
    queryParts.push('Criteria.IssuedDateEnd=', '__Invariant=Criteria.IssuedDateEnd')
  }

  queryParts.push(
    'Criteria.FinalDateStart=',
    '__Invariant=Criteria.FinalDateStart',
    'Criteria.FinalDateEnd=',
    '__Invariant=Criteria.FinalDateEnd',
    'Criteria.ExpireDateStart=',
    '__Invariant=Criteria.ExpireDateStart',
    'Criteria.ExpireDateEnd=',
    '__Invariant=Criteria.ExpireDateEnd',
    'Criteria.SortBy=IssuedDate',
    'Criteria.SortDesc=true',
    `Criteria.PageSize=${pageSize}`,
    '__Invariant=Criteria.PageSize',
    'Criteria.SortDesc=false',
  )

  return `${TLMA_ORIGIN}/?${queryParts.join('&')}`
}

export function parseTlmaTableHtml(html: string): TlmaParseResult {
  const warnings: string[] = []
  const trimmed = String(html || '').trim()
  if (!trimmed) {
    return {
      total_rows: 0,
      rows_with_permit_numbers: 0,
      permits: [],
      warnings: ['Paste the TLMA results table HTML first.'],
    }
  }

  const doc = new DOMParser().parseFromString(trimmed, 'text/html')
  const table = findResultsTable(doc)
  if (!table) {
    return {
      total_rows: 0,
      rows_with_permit_numbers: 0,
      permits: [],
      warnings: ['No #resultsScroll table or results-table found in pasted HTML.'],
    }
  }

  const headerMap = headerFieldMap(table as HTMLTableElement)
  if (headerMap.size === 0) {
    warnings.push('Table headers were not recognized; falling back to column order.')
  }

  const bodyRows = Array.from(table.querySelectorAll('tbody tr'))
  const permits: ParsedTlmaPermit[] = []

  for (const row of bodyRows) {
    const cells = Array.from(row.querySelectorAll('td'))
    if (!cells.length) continue
    const permit = rowToPermit(cells, headerMap, row)
    if (permit) permits.push(permit)
  }

  if (bodyRows.length && !permits.length) {
    warnings.push('Rows were found, but no permit numbers could be extracted.')
  }
  if (permits.length >= 50) {
    warnings.push(`Parsed ${permits.length} permits from pasted table. Large page imports are supported.`)
  }

  return {
    total_rows: bodyRows.length,
    rows_with_permit_numbers: permits.length,
    permits,
    warnings,
  }
}
