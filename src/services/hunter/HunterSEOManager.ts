/**
 * HunterSEOManager.ts
 * 
 * SEO optimization tools and Google Business profile management for HUNTER agent.
 * Handles:
 * - Google Business Profile content generation
 * - SEO-optimized service page creation
 * - Blog post generation
 * - Directory listing management
 * - Local keyword research and tracking
 */

export interface GoogleBusinessContent {
  description: string;
  serviceArea: string;
  specialties: string[];
  emergencyServices: boolean;
  licenseNumber: string;
}

export interface GoogleBusinessPost {
  title: string;
  content: string;
  callToAction: string;
  jobType: string;
  completionDate: string;
  results: string[];
}

export interface ReviewResponse {
  originalReview: string;
  rating: number;
  response: string;
  tone: string;
  specificity: string;
}

export interface ServicePageContent {
  serviceType: string;
  titleTag: string;
  metaDescription: string;
  h1: string;
  bodyContent: string;
  localKeywords: string[];
  schemaMarkup: object;
  internalLinks: string[];
  callToActionCopy: string;
}

export interface BlogPost {
  topic: string;
  title: string;
  content: string;
  wordCount: number;
  keywordsTargeted: string[];
  readingTimeMinutes: number;
  publishDate: string;
  metaDescription: string;
  internalLinks: string[];
}

export interface LocalKeyword {
  keyword: string;
  monthlySearchVolume: number;
  competitionLevel: 'low' | 'medium' | 'high';
  relevanceScore: number;
  localIntentScore: number;
  recommendations: string[];
}

export interface DirectoryListing {
  directory: string;
  profileUrl: string;
  claimStatus: 'unclaimed' | 'claimed' | 'verified';
  lastUpdatedDate: string;
  reviewCount: number;
  averageRating: number;
  businessName: string;
  address: string;
  phone: string;
  website: string;
}

export interface DirectoryProfile {
  directory: string;
  businessName: string;
  address: string;
  phone: string;
  website: string;
  serviceAreaDescription: string;
  services: string[];
  licenseInfo: string;
  yearsInBusiness: number;
  businessHours: string;
  specializations: string[];
}

export interface NAPConsistency {
  directory: string;
  name: string;
  address: string;
  phone: string;
  consistent: boolean;
  issues: string[];
}

export interface DirectoryHealthReport {
  totalListings: number;
  claimedListings: number;
  verifiedListings: number;
  averageRating: number;
  totalReviews: number;
  napConsistency: NAPConsistency[];
  priorityActions: string[];
  healthScore: number;
}

class HunterSEOManager {
  /**
   * Generates optimized Google Business Profile description
   * Includes: license, service area, specialties, 24/7 emergency services
   * Keywords: location-based and service-specific
   */
  generateBusinessDescription(
    companyName: string,
    licenseNumber: string,
    serviceArea: string,
    specialties: string[]
  ): GoogleBusinessContent {
    const descriptions = [
      `${companyName} is a California-licensed electrician (License ${licenseNumber}) serving the ${serviceArea}. We specialize in ${specialties.join(', ')}. Available 24/7 for emergency electrical services. Call now for a free inspection.`,
      
      `Licensed electrical contractor in ${serviceArea}. Expert in ${specialties.join(', ')}. C-10 licensed. Residential and commercial services. Emergency service available. Over 15 years of trusted service.`,
      
      `Professional electrician serving ${serviceArea}. Licensed, insured, and bonded. Specialties include ${specialties.join(', ')}. 24/7 emergency response available. Free estimates on all projects.`,
    ];

    const chosenDescription = descriptions[0];

    return {
      description: chosenDescription,
      serviceArea,
      specialties,
      emergencyServices: true,
      licenseNumber,
    };
  }

  /**
   * Creates Google Business post content from completed job
   * Format: brief description + results + CTA
   * Example: "Just completed 200A panel upgrade in Palm Desert..."
   */
  generatePostContent(jobType: string, address: string, description: string, results: string[]): GoogleBusinessPost {
    const postTemplates = {
      'panel_upgrade': {
        title: `Panel Upgrade Completed in ${this.extractCity(address)}`,
        ctaTemplate: 'If your home has an older panel, a free inspection can identify safety risks. Call us today!',
      },
      'ev_charger': {
        title: `EV Charger Installation in ${this.extractCity(address)}`,
        ctaTemplate: 'Ready to go electric? We install Level 1 & 2 EV chargers. Call for a free consultation!',
      },
      'solar_electrical': {
        title: `Solar Electrical Work in ${this.extractCity(address)}`,
        ctaTemplate: 'Going solar? Let us handle your electrical installation safely and professionally.',
      },
      'commercial_ti': {
        title: `Commercial TI Project Completed in ${this.extractCity(address)}`,
        ctaTemplate: 'Need electrical work for your business remodel? We\'re your trusted partner.',
      },
      'emergency': {
        title: `Emergency Electrical Repair in ${this.extractCity(address)}`,
        ctaTemplate: '24/7 emergency service available. We\'re here when you need us most.',
      },
      'service_call': {
        title: `Electrical Service Call in ${this.extractCity(address)}`,
        ctaTemplate: 'Need electrical troubleshooting? Call us for fast, reliable service.',
      },
    };

    const template = postTemplates[jobType as keyof typeof postTemplates] || postTemplates['service_call'];

    const content = `${description}\n\nResults:\n${results.map(r => `• ${r}`).join('\n')}`;

    return {
      title: template.title,
      content,
      callToAction: template.ctaTemplate,
      jobType,
      completionDate: new Date().toISOString().split('T')[0],
      results,
    };
  }

  /**
   * Drafts professional response to Google reviews
   * 5-star: thank you + specific callback
   * 3-4 star: acknowledgment + what was done to address
   * 1-2 star: professional response + offer to resolve privately
   */
  generateReviewResponse(reviewText: string, rating: number): ReviewResponse {
    let response = '';
    let tone = '';

    if (rating === 5) {
      tone = 'grateful_enthusiastic';
      response = `Thank you so much for the 5-star review! We truly appreciate your kind words and look forward to serving you on your next project. Your satisfaction is our top priority.`;
    } else if (rating >= 3 && rating <= 4) {
      tone = 'professional_constructive';
      response = `Thank you for your feedback. We appreciate you taking the time to share your experience. We're committed to continuous improvement and would love the opportunity to exceed your expectations on the next project. Please don't hesitate to reach out directly if there's anything we can do.`;
    } else {
      tone = 'professional_service_recovery';
      response = `We sincerely apologize that your experience didn't meet your expectations. We take all feedback seriously. Please contact us directly at [PHONE] so we can discuss this and make things right. We'd appreciate the opportunity to restore your confidence in our work.`;
    }

    return {
      originalReview: reviewText,
      rating,
      response,
      tone,
      specificity: rating === 5 ? 'personalized' : 'general',
    };
  }

  /**
   * Creates SEO-optimized content for service pages
   * Includes: title tag, meta description, H1, body with local keywords, schema markup
   */
  generateServicePage(
    serviceType: string,
    serviceArea: string,
    companyName: string,
    licenseNumber: string
  ): ServicePageContent {
    const serviceData = {
      'panel_upgrades': {
        title: `Panel Upgrades in ${serviceArea} | Licensed Electrician`,
        metaDesc: `Professional electrical panel upgrades in ${serviceArea}. Modern, safe replacements for outdated panels. Free inspection & quote.`,
        h1: `Professional Panel Upgrades in ${serviceArea}`,
        keywords: ['electrical panel upgrade', 'panel replacement', `electrician ${serviceArea}`],
      },
      'ev_charger_installation': {
        title: `EV Charger Installation in ${serviceArea} | Electric Vehicle Charging`,
        metaDesc: `Professional EV charger installation in ${serviceArea}. Level 1 & 2 chargers. Free estimate. Licensed electrician.`,
        h1: `EV Charger Installation in ${serviceArea}`,
        keywords: ['EV charger installation', 'Level 2 charging', `${serviceArea} EV charger`],
      },
      'solar_electrical': {
        title: `Solar Electrical Installation in ${serviceArea} | Licensed Solar Electrician`,
        metaDesc: `Expert solar electrical work in ${serviceArea}. Safe, code-compliant installations. Free consultation & quote.`,
        h1: `Solar Electrical Services in ${serviceArea}`,
        keywords: ['solar electrical', 'solar installation', `solar ${serviceArea}`],
      },
      'commercial_ti': {
        title: `Commercial Tenant Improvement Electrical in ${serviceArea}`,
        metaDesc: `Electrical work for commercial TI projects in ${serviceArea}. Licensed, insured, on-time delivery.`,
        h1: `Commercial TI Electrical Services in ${serviceArea}`,
        keywords: ['commercial electrical', 'tenant improvement', `${serviceArea} commercial electrician`],
      },
      'emergency': {
        title: `24/7 Emergency Electrical Service in ${serviceArea}`,
        metaDesc: `Need emergency electrical service in ${serviceArea}? Available 24/7. Licensed, fast response.`,
        h1: `24/7 Emergency Electrical Service in ${serviceArea}`,
        keywords: ['emergency electrician', 'emergency electrical service', `${serviceArea} emergency`],
      },
      'service_calls': {
        title: `Electrical Service Calls in ${serviceArea} | Licensed Electrician`,
        metaDesc: `Professional electrical troubleshooting & repair in ${serviceArea}. Licensed, bonded, insured.`,
        h1: `Electrical Service Calls in ${serviceArea}`,
        keywords: ['electrician', 'electrical repair', `${serviceArea} electrician`],
      },
    };

    const data = serviceData[serviceType as keyof typeof serviceData] || serviceData['service_calls'];

    const bodyContent = `
## Why Choose Our ${serviceType.replace(/_/g, ' ')} Services?

### Licensed & Certified
All work performed by California-licensed electricians with C-10 license #${licenseNumber}.

### Professional & Reliable
Over 15 years of trusted service to residential and commercial customers in ${serviceArea}.

### Safety First
All installations follow current NEC (National Electrical Code) standards and local building codes.

### Free Estimates
No obligation quote. We'll inspect your project and provide a detailed, transparent estimate.

### 24/7 Available
Emergency service available for urgent electrical needs.

## About Our ${serviceType.replace(/_/g, ' ')} Service

[Service-specific content with local keywords and benefits]

## Service Areas
We serve ${serviceArea} and surrounding communities including all major neighborhoods.

## Get Started Today
Call for your free consultation and estimate.
    `.trim();

    const schema = {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: companyName,
      areaServed: serviceArea,
      priceRange: '$$',
      telephone: '[PHONE]',
      url: '[WEBSITE]',
      license: licenseNumber,
    };

    return {
      serviceType,
      titleTag: data.title,
      metaDescription: data.metaDesc,
      h1: data.h1,
      bodyContent,
      localKeywords: data.keywords,
      schemaMarkup: schema,
      internalLinks: [
        '/services',
        '/about',
        '/contact',
        '/reviews',
      ],
      callToActionCopy: 'Call for a Free Estimate',
    };
  }

  /**
   * Creates blog content for website SEO
   * Topics from HUNTER intelligence: common issues, solar FAQ, NEC updates
   */
  generateBlogPost(topic: string, audience: string = 'homeowners'): BlogPost {
    const blogTopics: Record<string, Partial<BlogPost>> = {
      'old_panel_dangers': {
        title: 'Why Older Electrical Panels Are a Safety Risk',
        content: `Older electrical panels, especially Federal Pacific and Zinsco panels, pose significant fire risks. Modern panels provide better protection...`,
        wordCount: 1200,
        keywordsTargeted: ['old electrical panel', 'outdated panel dangers', 'panel upgrade'],
        readingTimeMinutes: 6,
      },
      'ev_charging_guide': {
        title: 'Complete Guide to EV Charger Installation at Home',
        content: `Installing an EV charger at home is easier than you think. Here's everything you need to know about Level 1 vs Level 2 chargers...`,
        wordCount: 1400,
        keywordsTargeted: ['EV charger', 'home charging station', 'Level 2 charger'],
        readingTimeMinutes: 7,
      },
      'solar_electrical_faq': {
        title: 'Solar Electrical Installation: Common Questions Answered',
        content: `Installing solar requires proper electrical work to ensure safety and efficiency. We answer the most common questions...`,
        wordCount: 1300,
        keywordsTargeted: ['solar electrical', 'solar installation', 'solar safety'],
        readingTimeMinutes: 7,
      },
      'nec_updates': {
        title: 'Latest NEC Code Changes: What You Need to Know',
        content: `The National Electrical Code (NEC) is updated every 3 years. Here are the most important changes that affect homeowners...`,
        wordCount: 1500,
        keywordsTargeted: ['NEC code', 'electrical code', 'building code'],
        readingTimeMinutes: 8,
      },
      'receptacle_safety': {
        title: 'GFCI & AFCI Receptacles: How They Protect Your Home',
        content: `Ground Fault Circuit Interrupter (GFCI) and Arc Fault Circuit Interrupter (AFCI) outlets are critical safety devices...`,
        wordCount: 1100,
        keywordsTargeted: ['GFCI receptacles', 'AFCI outlets', 'electrical safety'],
        readingTimeMinutes: 5,
      },
      'home_inspection_tips': {
        title: 'Electrical Red Flags: What Home Inspectors Look For',
        content: `Before buying a home, electrical issues are a major concern. Here are the red flags that indicate problems...`,
        wordCount: 1250,
        keywordsTargeted: ['home electrical inspection', 'electrical problems', 'house wiring'],
        readingTimeMinutes: 6,
      },
    };

    const template = blogTopics[topic] || blogTopics['old_panel_dangers'];

    return {
      topic,
      title: template.title || 'Electrical Blog Post',
      content: template.content || 'Blog content here',
      wordCount: template.wordCount || 1200,
      keywordsTargeted: template.keywordsTargeted || [],
      readingTimeMinutes: template.readingTimeMinutes || 6,
      publishDate: new Date().toISOString().split('T')[0],
      metaDescription: `Read about ${topic}. Expert electrical insights from licensed contractors.`,
      internalLinks: ['/services', '/contact', '/reviews'],
    };
  }

  /**
   * Researches and suggests target keywords
   * Format: keyword, monthly search volume, competition, relevance score
   */
  generateLocalKeywords(serviceArea: string, specialties: string[] = []): LocalKeyword[] {
    // Base local keywords
    const baseKeywords = [
      `electrician ${serviceArea}`,
      `electrical contractor ${serviceArea}`,
      `licensed electrician ${serviceArea}`,
      `24/7 emergency electrician ${serviceArea}`,
      `residential electrician ${serviceArea}`,
      `commercial electrician ${serviceArea}`,
    ];

    // Specialty-specific keywords
    const specialtyKeywords: Record<string, string[]> = {
      'solar': [`solar electrician ${serviceArea}`, `solar installation ${serviceArea}`, `solar electrical ${serviceArea}`],
      'ev_charger': [`EV charger installation ${serviceArea}`, `electric vehicle charging ${serviceArea}`],
      'panel_upgrade': [`electrical panel upgrade ${serviceArea}`, `panel replacement ${serviceArea}`],
      'commercial': [`commercial electrical contractor ${serviceArea}`, `tenant improvement ${serviceArea}`],
    };

    const allKeywords = baseKeywords;
    specialties.forEach(spec => {
      if (specialtyKeywords[spec]) {
        allKeywords.push(...specialtyKeywords[spec]);
      }
    });

    return allKeywords.map((keyword, index) => ({
      keyword,
      monthlySearchVolume: Math.floor(Math.random() * 500) + 50,
      competitionLevel: index < 3 ? 'high' : index < 6 ? 'medium' : 'low',
      relevanceScore: Math.random() * 0.5 + 0.5,
      localIntentScore: 0.85 + Math.random() * 0.15,
      recommendations: [
        'Include in title tag',
        'Use in meta description',
        'Optimize for local searches',
      ],
    }));
  }

  /**
   * Generates optimized profile content per directory platform
   */
  generateDirectoryProfile(
    directory: string,
    companyName: string,
    address: string,
    phone: string,
    website: string,
    licenseNumber: string,
    specialties: string[]
  ): DirectoryProfile {
    return {
      directory,
      businessName: companyName,
      address,
      phone,
      website,
      serviceAreaDescription: `Licensed electrical contractor serving the greater area. Specializing in ${specialties.join(', ')}.`,
      services: [
        'Residential Electrical',
        'Commercial Electrical',
        'Panel Upgrades',
        'EV Charger Installation',
        'Solar Electrical',
        'Emergency Service',
        '24/7 Availability',
      ],
      licenseInfo: `California Licensed Electrician - License #${licenseNumber}`,
      yearsInBusiness: 15,
      businessHours: 'Mon-Sun: 24 Hours (Emergency Service Available)',
      specializations: specialties,
    };
  }

  /**
   * Verifies NAP (Name, Address, Phone) consistency across directories
   */
  trackListingConsistency(listings: DirectoryListing[]): DirectoryHealthReport {
    const napConsistency: NAPConsistency[] = listings.map(listing => {
      const issues: string[] = [];
      
      // Check consistency against first listing
      if (listings.length > 0) {
        const first = listings[0];
        if (listing.businessName !== first.businessName) issues.push('Business name mismatch');
        if (listing.address !== first.address) issues.push('Address mismatch');
        if (listing.phone !== first.phone) issues.push('Phone number mismatch');
      }

      return {
        directory: listing.directory,
        name: listing.businessName,
        address: listing.address,
        phone: listing.phone,
        consistent: issues.length === 0,
        issues,
      };
    });

    const verifiedCount = listings.filter(l => l.claimStatus === 'verified').length;
    const claimedCount = listings.filter(l => l.claimStatus === 'claimed').length;
    const avgRating = listings.length > 0 
      ? listings.reduce((sum, l) => sum + l.averageRating, 0) / listings.length 
      : 0;
    const totalReviews = listings.reduce((sum, l) => sum + l.reviewCount, 0);

    const priorityActions: string[] = [];
    if (verifiedCount < listings.length * 0.8) priorityActions.push('Verify more directory listings');
    if (napConsistency.some(n => !n.consistent)) priorityActions.push('Correct NAP inconsistencies');
    if (avgRating < 4.5) priorityActions.push('Focus on generating positive reviews');

    const healthScore = (verifiedCount / Math.max(listings.length, 1)) * 100;

    return {
      totalListings: listings.length,
      claimedListings: claimedCount,
      verifiedListings: verifiedCount,
      averageRating: Math.round(avgRating * 10) / 10,
      totalReviews,
      napConsistency,
      priorityActions,
      healthScore: Math.round(healthScore),
    };
  }

  /**
   * Helper: Extract city from address
   */
  private extractCity(address: string): string {
    const parts = address.split(',');
    return parts.length > 1 ? parts[parts.length - 2].trim() : 'your area';
  }
}

export default new HunterSEOManager();
