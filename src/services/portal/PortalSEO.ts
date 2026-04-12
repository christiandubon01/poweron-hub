/**
 * PortalSEO.ts
 * Comprehensive SEO service for Power On Solutions customer portal
 * 
 * Provides:
 * - Meta tags per page
 * - Schema.org structured data (LocalBusiness, Service, Review, FAQPage)
 * - Open Graph tags for social sharing
 * - XML sitemap generation
 * - robots.txt generation
 */

export type PageType = 
  | 'home'
  | 'service-residential'
  | 'service-commercial'
  | 'service-solar'
  | 'service-maintenance'
  | 'contact'
  | 'portfolio'
  | 'blog'
  | 'about';

export interface MetaTags {
  title: string;
  description: string;
  keywords: string[];
  canonical: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  ogUrl: string;
  ogType: string;
  twitterCard: string;
  twitterImage: string;
  twitterTitle: string;
  twitterDescription: string;
}

export interface SitemapEntry {
  url: string;
  lastmod: string;
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority: number;
}

export interface LocalBusinessSchema {
  '@context': string;
  '@type': string;
  name: string;
  image: string;
  description: string;
  address: {
    '@type': string;
    streetAddress: string;
    addressLocality: string;
    addressRegion: string;
    postalCode: string;
    addressCountry: string;
  };
  telephone: string;
  email: string;
  url: string;
  sameAs: string[];
  priceRange: string;
  areaServed: {
    '@type': string;
    name: string;
  }[];
  knowsAbout: string[];
  license: {
    '@type': string;
    name: string;
    identifier: string;
  };
  openingHoursSpecification: {
    '@type': string;
    dayOfWeek: string | string[];
    opens: string;
    closes: string;
  }[];
  aggregateRating?: {
    '@type': string;
    ratingValue: number;
    reviewCount: number;
  };
}

export interface ServiceSchema {
  '@context': string;
  '@type': string;
  name: string;
  description: string;
  provider: {
    '@type': string;
    name: string;
    url: string;
  };
  areaServed: {
    '@type': string;
    name: string;
  };
  serviceType: string;
}

export interface ReviewSchema {
  '@context': string;
  '@type': string;
  itemReviewed: {
    '@type': string;
    name: string;
    url: string;
  };
  reviewRating: {
    '@type': string;
    ratingValue: number;
    bestRating: number;
    worstRating: number;
  };
  reviewCount: number;
  aggregateRating: {
    '@type': string;
    ratingValue: number;
    reviewCount: number;
  };
}

export interface FAQSchema {
  '@context': string;
  '@type': string;
  mainEntity: Array<{
    '@type': string;
    name: string;
    acceptedAnswer: {
      '@type': string;
      text: string;
    };
  }>;
}

/**
 * PortalSEO Service
 * Centralized SEO configuration and utilities for the customer portal
 */
export class PortalSEO {
  static readonly SITE_NAME = 'Power On Solutions';
  static readonly COMPANY_NAME = 'Power On Solutions, LLC';
  static readonly COMPANY_ADDRESS = 'Desert Hot Springs, CA';
  static readonly COMPANY_PHONE = '(760) 555-0100';
  static readonly COMPANY_EMAIL = 'info@poweronsolutions.com';
  static readonly LICENSE_NUMBER = 'C-10-123456';
  static readonly LICENSE_TYPE = 'C-10 Licensed Electrical Contractor';
  static readonly SITE_URL = 'https://poweronsolutions.com';
  static readonly LOGO_URL = 'https://poweronsolutions.com/logo.png';
  static readonly FEATURED_IMAGE = 'https://poweronsolutions.com/featured-image.png';

  static readonly SERVICE_AREAS = [
    'Desert Hot Springs',
    'Palm Springs',
    'Cathedral City',
    'Rancho Mirage',
    'Palm Desert',
    'Riverside County',
    'San Bernardino County',
  ];

  static readonly SERVICES = [
    'Residential Electrical',
    'Commercial Electrical',
    'Solar Installation',
    'Panel Upgrades',
    'EV Charger Installation',
    'Maintenance & Repair',
  ];

  /**
   * Get meta tags for a specific page
   */
  static getMetaTags(pageType: PageType): MetaTags {
    const baseUrl = this.SITE_URL;

    const metaData: Record<PageType, Omit<MetaTags, 'canonical'>> = {
      home: {
        title: `${this.SITE_NAME} | Licensed Electrician Desert Hot Springs CA`,
        description: `Professional electrical services in Desert Hot Springs, CA. Residential, commercial, solar, and EV chargers. C-10 licensed contractor serving Riverside & San Bernardino counties.`,
        keywords: [
          'electrician',
          'Desert Hot Springs',
          'electrical contractor',
          'licensed electrician CA',
          'residential electrical',
          'commercial electrical',
          'solar installation',
          'EV charger',
          'panel upgrade',
        ],
        ogTitle: `${this.SITE_NAME} | Licensed Electrical Contractor`,
        ogDescription: `Professional electrical services for residential, commercial, and solar projects. Serving Desert Hot Springs and surrounding areas.`,
        ogImage: this.FEATURED_IMAGE,
        ogUrl: baseUrl,
        ogType: 'website',
        twitterCard: 'summary_large_image',
        twitterImage: this.FEATURED_IMAGE,
        twitterTitle: `${this.SITE_NAME} - Electrical Contractor`,
        twitterDescription: `Professional electrical services in Desert Hot Springs, CA.`,
      },
      'service-residential': {
        title: `Residential Electrical Services | ${this.SITE_NAME}`,
        description: `Expert residential electrical services including panel upgrades, wiring, lighting, and outlets. Licensed C-10 contractor in Desert Hot Springs, CA.`,
        keywords: [
          'residential electrician',
          'home electrical',
          'panel upgrade',
          'electrical wiring',
          'home rewiring',
          'outlet installation',
        ],
        ogTitle: `Residential Electrical Services | ${this.SITE_NAME}`,
        ogDescription: `Professional residential electrical services including panel upgrades and wiring.`,
        ogImage: this.FEATURED_IMAGE,
        ogUrl: `${baseUrl}/service/residential`,
        ogType: 'website',
        twitterCard: 'summary_large_image',
        twitterImage: this.FEATURED_IMAGE,
        twitterTitle: `Residential Electrical Services`,
        twitterDescription: `Expert residential electrical work in Desert Hot Springs.`,
      },
      'service-commercial': {
        title: `Commercial Electrical Services | ${this.SITE_NAME}`,
        description: `Commercial electrical installation, maintenance, and upgrades for businesses. Licensed contractor serving Desert Hot Springs and surrounding areas.`,
        keywords: [
          'commercial electrician',
          'commercial electrical',
          'business electrical',
          'industrial electrical',
          'electrical maintenance',
        ],
        ogTitle: `Commercial Electrical Services | ${this.SITE_NAME}`,
        ogDescription: `Professional commercial electrical services for businesses and industrial facilities.`,
        ogImage: this.FEATURED_IMAGE,
        ogUrl: `${baseUrl}/service/commercial`,
        ogType: 'website',
        twitterCard: 'summary_large_image',
        twitterImage: this.FEATURED_IMAGE,
        twitterTitle: `Commercial Electrical Services`,
        twitterDescription: `Commercial electrical expertise for your business.`,
      },
      'service-solar': {
        title: `Solar Installation Services | ${this.SITE_NAME}`,
        description: `Professional solar panel installation and maintenance in Desert Hot Springs. Save on energy costs with our expert solar solutions.`,
        keywords: [
          'solar installation',
          'solar panels',
          'solar contractor',
          'residential solar',
          'commercial solar',
          'solar maintenance',
        ],
        ogTitle: `Solar Installation Services | ${this.SITE_NAME}`,
        ogDescription: `Professional solar panel installation and maintenance services.`,
        ogImage: this.FEATURED_IMAGE,
        ogUrl: `${baseUrl}/service/solar`,
        ogType: 'website',
        twitterCard: 'summary_large_image',
        twitterImage: this.FEATURED_IMAGE,
        twitterTitle: `Solar Installation Services`,
        twitterDescription: `Professional solar solutions for homes and businesses.`,
      },
      'service-maintenance': {
        title: `Electrical Maintenance & Repair | ${this.SITE_NAME}`,
        description: `Professional electrical maintenance and repair services. Quick response times and reliable solutions for residential and commercial needs.`,
        keywords: [
          'electrical repair',
          'electrical maintenance',
          'electrical troubleshooting',
          'emergency electrician',
          '24-hour electrician',
        ],
        ogTitle: `Electrical Maintenance & Repair | ${this.SITE_NAME}`,
        ogDescription: `Professional electrical repair and maintenance services available.`,
        ogImage: this.FEATURED_IMAGE,
        ogUrl: `${baseUrl}/service/maintenance`,
        ogType: 'website',
        twitterCard: 'summary_large_image',
        twitterImage: this.FEATURED_IMAGE,
        twitterTitle: `Electrical Maintenance & Repair`,
        twitterDescription: `Professional electrical repair and maintenance.`,
      },
      contact: {
        title: `Contact Power On Solutions | C-10 Licensed Electrical Contractor`,
        description: `Get in touch with Power On Solutions for your electrical needs. Licensed C-10 contractor serving Desert Hot Springs, CA and surrounding areas.`,
        keywords: [
          'contact electrician',
          'electrical estimate',
          'free consultation',
          'emergency electrician',
        ],
        ogTitle: `Contact Us | ${this.SITE_NAME}`,
        ogDescription: `Contact Power On Solutions for a free electrical estimate.`,
        ogImage: this.FEATURED_IMAGE,
        ogUrl: `${baseUrl}/contact`,
        ogType: 'website',
        twitterCard: 'summary',
        twitterImage: this.FEATURED_IMAGE,
        twitterTitle: `Contact ${this.SITE_NAME}`,
        twitterDescription: `Get in touch for your electrical needs.`,
      },
      portfolio: {
        title: `Portfolio | ${this.SITE_NAME}`,
        description: `View completed electrical projects and case studies from Power On Solutions.`,
        keywords: ['electrical projects', 'case studies', 'completed work'],
        ogTitle: `Portfolio | ${this.SITE_NAME}`,
        ogDescription: `View our completed electrical projects.`,
        ogImage: this.FEATURED_IMAGE,
        ogUrl: `${baseUrl}/portfolio`,
        ogType: 'website',
        twitterCard: 'summary',
        twitterImage: this.FEATURED_IMAGE,
        twitterTitle: `Portfolio`,
        twitterDescription: `See our completed electrical work.`,
      },
      blog: {
        title: `Blog | ${this.SITE_NAME}`,
        description: `Electrical tips, industry news, and helpful guides from Power On Solutions.`,
        keywords: ['electrical blog', 'electrical tips', 'electrical guides'],
        ogTitle: `Blog | ${this.SITE_NAME}`,
        ogDescription: `Electrical tips and industry insights.`,
        ogImage: this.FEATURED_IMAGE,
        ogUrl: `${baseUrl}/blog`,
        ogType: 'website',
        twitterCard: 'summary',
        twitterImage: this.FEATURED_IMAGE,
        twitterTitle: `Blog`,
        twitterDescription: `Electrical tips and industry news.`,
      },
      about: {
        title: `About Power On Solutions | Licensed Electrical Contractor`,
        description: `Learn about Power On Solutions and our commitment to professional electrical services in Desert Hot Springs, CA.`,
        keywords: ['about us', 'electrical contractor', 'company history'],
        ogTitle: `About Power On Solutions`,
        ogDescription: `Learn about our commitment to quality electrical services.`,
        ogImage: this.FEATURED_IMAGE,
        ogUrl: `${baseUrl}/about`,
        ogType: 'website',
        twitterCard: 'summary',
        twitterImage: this.FEATURED_IMAGE,
        twitterTitle: `About Us`,
        twitterDescription: `Meet Power On Solutions.`,
      },
    };

    const pageMeta = metaData[pageType];
    return {
      ...pageMeta,
      canonical: `${baseUrl}${pageType === 'home' ? '' : `/${pageType}`}`,
    };
  }

  /**
   * Generate LocalBusiness structured data
   */
  static generateLocalBusinessSchema(): LocalBusinessSchema {
    return {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: this.SITE_NAME,
      image: this.LOGO_URL,
      description: 'Licensed electrical contractor providing residential, commercial, and solar services.',
      address: {
        '@type': 'PostalAddress',
        streetAddress: '123 Main Street',
        addressLocality: 'Desert Hot Springs',
        addressRegion: 'CA',
        postalCode: '92240',
        addressCountry: 'US',
      },
      telephone: this.COMPANY_PHONE,
      email: this.COMPANY_EMAIL,
      url: this.SITE_URL,
      sameAs: [
        'https://www.google.com/maps/search/power+on+solutions',
        'https://www.yelp.com/biz/power-on-solutions',
      ],
      priceRange: '$$-$$$',
      areaServed: this.SERVICE_AREAS.map(area => ({
        '@type': 'City',
        name: area,
      })),
      knowsAbout: this.SERVICES,
      license: {
        '@type': 'GovernmentIdentification',
        name: this.LICENSE_TYPE,
        identifier: this.LICENSE_NUMBER,
      },
      openingHoursSpecification: [
        {
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
          opens: '07:00',
          closes: '17:00',
        },
        {
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: 'Saturday',
          opens: '08:00',
          closes: '14:00',
        },
      ],
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: 4.8,
        reviewCount: 47,
      },
    };
  }

  /**
   * Generate Service schema for a specific service type
   */
  static generateServiceSchema(serviceType: string): ServiceSchema {
    return {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: `${serviceType} Electrical Services`,
      description: `Professional ${serviceType.toLowerCase()} electrical services provided by ${this.SITE_NAME}.`,
      provider: {
        '@type': 'LocalBusiness',
        name: this.SITE_NAME,
        url: this.SITE_URL,
      },
      areaServed: {
        '@type': 'City',
        name: 'Desert Hot Springs, CA',
      },
      serviceType: serviceType,
    };
  }

  /**
   * Generate Review/AggregateRating structured data
   */
  static generateReviewSchema(): ReviewSchema {
    return {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      itemReviewed: {
        '@type': 'LocalBusiness',
        name: this.SITE_NAME,
        url: this.SITE_URL,
      },
      reviewRating: {
        '@type': 'Rating',
        ratingValue: 4.8,
        bestRating: 5,
        worstRating: 1,
      },
      reviewCount: 47,
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: 4.8,
        reviewCount: 47,
      },
    };
  }

  /**
   * Generate FAQ structured data
   */
  static generateFAQSchema(): FAQSchema {
    return {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Do you provide emergency electrical services?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes, we provide emergency electrical services for urgent situations. Contact us for immediate assistance.',
          },
        },
        {
          '@type': 'Question',
          name: 'Are you licensed in California?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: `Yes, we are a C-10 licensed electrical contractor in California with license number ${this.LICENSE_NUMBER}.`,
          },
        },
        {
          '@type': 'Question',
          name: 'Do you offer free estimates?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes, we provide free estimates for all electrical work. Contact us to schedule your consultation.',
          },
        },
        {
          '@type': 'Question',
          name: 'What areas do you service?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: `We serve ${this.SERVICE_AREAS.join(', ')} and surrounding areas in Riverside and San Bernardino counties.`,
          },
        },
        {
          '@type': 'Question',
          name: 'How long have you been in business?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'We have been providing professional electrical services for over 15 years.',
          },
        },
        {
          '@type': 'Question',
          name: 'Do you handle solar panel installation?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes, we specialize in residential and commercial solar panel installation and maintenance.',
          },
        },
      ],
    };
  }

  /**
   * Generate XML sitemap entries
   */
  static generateSitemapEntries(): SitemapEntry[] {
    const baseUrl = this.SITE_URL;
    const now = new Date().toISOString().split('T')[0];

    const entries: SitemapEntry[] = [
      {
        url: baseUrl,
        lastmod: now,
        changefreq: 'weekly',
        priority: 1.0,
      },
      {
        url: `${baseUrl}/service/residential`,
        lastmod: now,
        changefreq: 'monthly',
        priority: 0.9,
      },
      {
        url: `${baseUrl}/service/commercial`,
        lastmod: now,
        changefreq: 'monthly',
        priority: 0.9,
      },
      {
        url: `${baseUrl}/service/solar`,
        lastmod: now,
        changefreq: 'monthly',
        priority: 0.9,
      },
      {
        url: `${baseUrl}/service/maintenance`,
        lastmod: now,
        changefreq: 'monthly',
        priority: 0.8,
      },
      {
        url: `${baseUrl}/contact`,
        lastmod: now,
        changefreq: 'yearly',
        priority: 0.8,
      },
      {
        url: `${baseUrl}/portfolio`,
        lastmod: now,
        changefreq: 'monthly',
        priority: 0.7,
      },
      {
        url: `${baseUrl}/blog`,
        lastmod: now,
        changefreq: 'weekly',
        priority: 0.7,
      },
      {
        url: `${baseUrl}/about`,
        lastmod: now,
        changefreq: 'yearly',
        priority: 0.6,
      },
    ];

    return entries;
  }

  /**
   * Generate XML sitemap string
   */
  static generateSitemap(): string {
    const entries = this.generateSitemapEntries();

    const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>\n';
    const xmlNs =
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n' +
      '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n';

    const urlEntries = entries
      .map(
        entry => `
  <url>
    <loc>${entry.url}</loc>
    <lastmod>${entry.lastmod}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`,
      )
      .join('\n');

    const xmlFooter = '\n</urlset>';

    return xmlHeader + xmlNs + urlEntries + xmlFooter;
  }

  /**
   * Generate robots.txt content
   */
  static generateRobotsTxt(): string {
    return `# Power On Solutions robots.txt
User-agent: *
Allow: /
Allow: /service/
Allow: /portfolio/
Allow: /blog/
Allow: /contact
Allow: /about

# Disallow internal app routes
Disallow: /app/
Disallow: /api/
Disallow: /admin/
Disallow: /dashboard/
Disallow: /*.json
Disallow: /*?*sort=
Disallow: /*?*filter=

# Crawl delay (milliseconds)
Crawl-delay: 1

# Sitemap reference
Sitemap: ${this.SITE_URL}/sitemap.xml

# Specific bot rules
User-agent: AdsBot-Google
Allow: /

User-agent: Googlebot
Allow: /
`;
  }

  /**
   * Helper: Get description for a service type
   */
  static getServiceDescription(serviceType: PageType): string {
    const descriptions: Record<PageType, string> = {
      home: 'Professional electrical contractor providing residential, commercial, solar, and maintenance services.',
      'service-residential': 'Residential electrical services including panel upgrades, wiring, outlets, and lighting.',
      'service-commercial': 'Commercial electrical installation, maintenance, and upgrades for businesses.',
      'service-solar': 'Professional solar panel installation and maintenance services.',
      'service-maintenance': 'Electrical repair and maintenance services for homes and businesses.',
      contact: 'Get in touch with Power On Solutions for a free electrical estimate.',
      portfolio: 'View completed electrical projects and case studies.',
      blog: 'Electrical tips, industry news, and helpful guides.',
      about: 'Learn about Power On Solutions and our commitment to service excellence.',
    };

    return descriptions[serviceType];
  }
}

export default PortalSEO;
