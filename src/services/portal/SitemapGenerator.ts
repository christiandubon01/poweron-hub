/**
 * SitemapGenerator.ts
 * Service for generating and serving XML sitemap and robots.txt
 * These can be served as static files or dynamically generated
 */

import PortalSEO from './PortalSEO';

/**
 * Generate robots.txt content
 * Can be served from /public/robots.txt or generated dynamically
 */
export function generateRobotsTxt(): string {
  return PortalSEO.generateRobotsTxt();
}

/**
 * Generate XML sitemap content
 * Can be served from /public/sitemap.xml or generated dynamically
 */
export function generateSitemap(): string {
  return PortalSEO.generateSitemap();
}

/**
 * Export sitemap as downloadable blob
 */
export function downloadSitemap(): Blob {
  const sitemapXml = generateSitemap();
  return new Blob([sitemapXml], { type: 'application/xml' });
}

/**
 * Export robots.txt as downloadable blob
 */
export function downloadRobotsTxt(): Blob {
  const robotsTxt = generateRobotsTxt();
  return new Blob([robotsTxt], { type: 'text/plain' });
}

/**
 * Get sitemap entries
 */
export function getSitemapEntries() {
  return PortalSEO.generateSitemapEntries();
}

/**
 * Validate sitemap structure
 */
export function validateSitemap(): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const sitemap = generateSitemap();

    // Check for XML header
    if (!sitemap.includes('<?xml')) {
      errors.push('Missing XML declaration');
    }

    // Check for urlset
    if (!sitemap.includes('<urlset')) {
      errors.push('Missing urlset element');
    }

    // Check for URLs
    const urlMatches = sitemap.match(/<url>/g);
    if (!urlMatches || urlMatches.length === 0) {
      warnings.push('No URLs found in sitemap');
    } else {
      // Validate URL count
      const totalUrls = urlMatches.length;
      if (totalUrls > 50000) {
        warnings.push(`Sitemap contains ${totalUrls} URLs, Google recommends max 50,000`);
      }
    }

    // Check for proper closing tags
    if (!sitemap.includes('</urlset>')) {
      errors.push('Missing closing urlset tag');
    }

    // Check for loc elements
    if (!sitemap.includes('<loc>')) {
      errors.push('Missing loc elements in URLs');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  } catch (error) {
    return {
      isValid: false,
      errors: [
        `Error validating sitemap: ${error instanceof Error ? error.message : 'Unknown error'}`,
      ],
      warnings: [],
    };
  }
}

/**
 * Get sitemap statistics
 */
export function getSitemapStats() {
  const entries = PortalSEO.generateSitemapEntries();
  const sitemap = generateSitemap();

  return {
    totalEntries: entries.length,
    sitemapSizeKB: Math.round(new Blob([sitemap]).size / 1024),
    pages: entries.map(entry => ({
      url: entry.url,
      priority: entry.priority,
      changeFrequency: entry.changefreq,
    })),
  };
}

export default {
  generateRobotsTxt,
  generateSitemap,
  downloadSitemap,
  downloadRobotsTxt,
  getSitemapEntries,
  validateSitemap,
  getSitemapStats,
};
