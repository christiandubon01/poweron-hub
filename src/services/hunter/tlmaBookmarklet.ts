/**
 * TLMA bookmarklet helper — browser-only DOM read, no network/cookies/tokens.
 * User runs bookmarklet on publiclookup.rivco.org results page; app imports from clipboard.
 */

export const TLMA_BOOKMARKLET_LABEL = 'Copy TLMA Table'

export const TLMA_BOOKMARKLET_SUCCESS_ALERT =
  'TLMA table copied. Return to Power On Hub and click Import From Clipboard.'

/** Minified bookmarklet: reads visible #resultsScroll or table.results-table outerHTML only. */
const TLMA_BOOKMARKLET_SCRIPT = `(function(){var el=document.querySelector('#resultsScroll')||document.querySelector('table.results-table');if(!el){alert('No TLMA results table found. Make sure results are visible on the TLMA page.');return;}var html=el.outerHTML;function done(){alert('${TLMA_BOOKMARKLET_SUCCESS_ALERT.replace(/'/g, "\\'")}');}if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(html).then(done).catch(function(){var ta=document.createElement('textarea');ta.value=html;ta.style.position='fixed';ta.style.left='-9999px';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');done();}catch(e){alert('Could not copy table HTML. Use Manual Paste in Hunter instead.');}document.body.removeChild(ta);});}else{var ta=document.createElement('textarea');ta.value=html;ta.style.position='fixed';ta.style.left='-9999px';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');done();}catch(e){alert('Could not copy table HTML. Use Manual Paste in Hunter instead.');}document.body.removeChild(ta);}})();`

export function getTlmaBookmarkletHref(): string {
  return `javascript:${TLMA_BOOKMARKLET_SCRIPT}`
}

/** Copyable bookmarklet source for users who cannot drag to bookmarks bar. */
export function getTlmaBookmarkletCode(): string {
  return getTlmaBookmarkletHref()
}

/** Heuristic check before parseTlmaTableHtml — clipboard should look like TLMA table HTML. */
export function looksLikeTlmaTableHtml(text: string): boolean {
  const trimmed = String(text || '').trim()
  if (!trimmed) return false

  const lower = trimmed.toLowerCase()
  const hasTlmaMarker =
    lower.includes('resultsscroll') ||
    lower.includes('results-table') ||
    lower.includes('id="resultsscroll"')

  const hasTableRows =
    /<table[\s>]/i.test(trimmed) &&
    (/<tbody[\s>]/i.test(trimmed) || /<tr[\s>]/i.test(trimmed)) &&
    /<td[\s>]/i.test(trimmed)

  return hasTlmaMarker || hasTableRows
}
