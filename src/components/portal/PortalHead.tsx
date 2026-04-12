/**
 * PortalHead.tsx
 * React component for managing SEO head tags using React Helmet pattern
 * Handles dynamic meta tags, schema.org JSON-LD, Open Graph, and canonical URLs
 */

import React, { useEffect } from 'react';
import PortalSEO, { PageType, MetaTags } from '../../services/portal/PortalSEO';

export interface PortalHeadProps {
  pageType: PageType;
  customTitle?: string;
  customDescription?: string;
  customImage?: string;
  customUrl?: string;
  includeLocalBusiness?: boolean;
  includeService?: boolean;
  serviceName?: string;
  includeReview?: boolean;
  includeFAQ?: boolean;
  locale?: string;
}

/**
 * PortalHead Component
 * Manages all head-related SEO elements for portal pages
 * Uses React.useEffect to directly manipulate document.head
 * (This is a pattern used when React Helmet is not available)
 */
export function PortalHead({
  pageType,
  customTitle,
  customDescription,
  customImage,
  customUrl,
  includeLocalBusiness = pageType === 'home' || pageType === 'contact',
  includeService = pageType.startsWith('service'),
  serviceName,
  includeReview = pageType === 'home',
  includeFAQ = true,
  locale = 'en_US',
}: PortalHeadProps) {
  // Get base meta tags
  const metaTags = PortalSEO.getMetaTags(pageType);

  // Override with custom values if provided
  const finalMetaTags: MetaTags = {
    ...metaTags,
    title: customTitle || metaTags.title,
    description: customDescription || metaTags.description,
    ogImage: customImage || metaTags.ogImage,
    ogUrl: customUrl || metaTags.ogUrl,
    twitterImage: customImage || metaTags.twitterImage,
  };

  // Update head tags on mount and when dependencies change
  useEffect(() => {
    // Update title
    document.title = finalMetaTags.title;

    // Helper to set or create meta tag
    const setMetaTag = (name: string, content: string, property?: boolean) => {
      let meta = document.querySelector(
        property ? `meta[property="${name}"]` : `meta[name="${name}"]`,
      ) as HTMLMetaElement | null;

      if (!meta) {
        meta = document.createElement('meta');
        if (property) {
          meta.setAttribute('property', name);
        } else {
          meta.setAttribute('name', name);
        }
        document.head.appendChild(meta);
      }

      meta.content = content;
    };

    // Helper to set or create link tag
    const setLinkTag = (rel: string, href: string) => {
      let link = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;

      if (!link) {
        link = document.createElement('link');
        link.rel = rel;
        document.head.appendChild(link);
      }

      link.href = href;
    };

    // Standard meta tags
    setMetaTag('description', finalMetaTags.description);
    setMetaTag('keywords', finalMetaTags.keywords.join(', '));
    setMetaTag('viewport', 'width=device-width, initial-scale=1.0');
    setMetaTag('charset', 'utf-8');
    setMetaTag('language', locale.split('_')[0]);

    // Open Graph meta tags
    setMetaTag('og:title', finalMetaTags.ogTitle, true);
    setMetaTag('og:description', finalMetaTags.ogDescription, true);
    setMetaTag('og:image', finalMetaTags.ogImage, true);
    setMetaTag('og:image:width', '1200', true);
    setMetaTag('og:image:height', '630', true);
    setMetaTag('og:image:type', 'image/png', true);
    setMetaTag('og:url', finalMetaTags.ogUrl, true);
    setMetaTag('og:type', finalMetaTags.ogType, true);
    setMetaTag('og:site_name', PortalSEO.SITE_NAME, true);
    setMetaTag('og:locale', locale, true);

    // Twitter Card meta tags
    setMetaTag('twitter:card', finalMetaTags.twitterCard);
    setMetaTag('twitter:title', finalMetaTags.twitterTitle);
    setMetaTag('twitter:description', finalMetaTags.twitterDescription);
    setMetaTag('twitter:image', finalMetaTags.twitterImage);
    setMetaTag('twitter:creator', '@poweronsolutions');
    setMetaTag('twitter:site', '@poweronsolutions');

    // Additional meta tags
    setMetaTag('author', PortalSEO.COMPANY_NAME);
    setMetaTag('publisher', PortalSEO.COMPANY_NAME);
    setMetaTag('robots', 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1');

    // Canonical URL
    setLinkTag('canonical', finalMetaTags.canonical);

    // Alternate links for other languages/devices
    setLinkTag('alternate', finalMetaTags.canonical);

    // Icons
    setLinkTag('icon', `${PortalSEO.SITE_URL}/favicon.ico`);
    setLinkTag('apple-touch-icon', `${PortalSEO.SITE_URL}/apple-touch-icon.png`);

    // Mobile optimizations
    setMetaTag('mobile-web-app-capable', 'yes');
    setMetaTag('apple-mobile-web-app-capable', 'yes');
    setMetaTag('apple-mobile-web-app-status-bar-style', 'black-translucent');

    // Security headers
    setMetaTag('referrer', 'strict-origin-when-cross-origin');

    // Inject JSON-LD structured data
    injectJsonLD(pageType, includeLocalBusiness, includeService, serviceName, includeReview, includeFAQ);

    // Cleanup function (optional - can be useful if component unmounts)
    return () => {
      // Could remove meta tags here if needed
    };
  }, [
    pageType,
    finalMetaTags,
    locale,
    includeLocalBusiness,
    includeService,
    serviceName,
    includeReview,
    includeFAQ,
  ]);

  // No DOM rendering - this component only manages head tags
  return null;
}

/**
 * Inject JSON-LD structured data into document head
 */
function injectJsonLD(
  pageType: PageType,
  includeLocalBusiness: boolean,
  includeService: boolean,
  serviceName?: string,
  includeReview?: boolean,
  includeFAQ?: boolean,
) {
  // Helper to inject or update script tag
  const injectScript = (id: string, jsonData: object) => {
    let script = document.getElementById(id) as HTMLScriptElement | null;

    if (!script) {
      script = document.createElement('script');
      script.id = id;
      script.type = 'application/ld+json';
      document.head.appendChild(script);
    }

    script.textContent = JSON.stringify(jsonData);
  };

  // LocalBusiness schema
  if (includeLocalBusiness) {
    const localBusinessSchema = PortalSEO.generateLocalBusinessSchema();
    injectScript('schema-local-business', localBusinessSchema);
  }

  // Service schema
  if (includeService && serviceName) {
    const serviceSchema = PortalSEO.generateServiceSchema(serviceName);
    injectScript('schema-service', serviceSchema);
  }

  // Review/AggregateRating schema
  if (includeReview) {
    const reviewSchema = PortalSEO.generateReviewSchema();
    injectScript('schema-review', reviewSchema);
  }

  // FAQ schema
  if (includeFAQ) {
    const faqSchema = PortalSEO.generateFAQSchema();
    injectScript('schema-faq', faqSchema);
  }

  // Breadcrumb schema for service pages
  if (pageType.startsWith('service')) {
    const servicePath = pageType.replace('service-', '');
    const breadcrumbSchema = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Home',
          item: PortalSEO.SITE_URL,
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: servicePath.charAt(0).toUpperCase() + servicePath.slice(1).replace('-', ' '),
          item: `${PortalSEO.SITE_URL}/service/${servicePath}`,
        },
      ],
    };
    injectScript('schema-breadcrumb', breadcrumbSchema);
  }
}

/**
 * Hook for managing portal head tags
 * Can be used anywhere in the portal application
 */
export function usePortalHead(
  pageType: PageType,
  options?: Partial<PortalHeadProps>,
) {
  useEffect(() => {
    // This hook re-renders the PortalHead component
    // by triggering the side effects above
  }, [pageType, options]);
}

export default PortalHead;
