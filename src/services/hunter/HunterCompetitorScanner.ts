/**
 * HUNTER Competitor Scanner Service
 * Scans Google Maps and Yelp for competitor intelligence
 * Detects market gaps that HUNTER can exploit for lead generation
 */

// =====================================================
// Types
// =====================================================

export enum GapType {
  UNDERSERVED_AREA = 'underserved_area',
  WEAK_COMPETITOR = 'weak_competitor',
  CLOSED_BUSINESS = 'closed_business',
  NO_EMERGENCY = 'no_emergency',
  SPECIALTY_GAP = 'specialty_gap',
}

export enum CompetitorStrength {
  WEAK = 'weak',
  MODERATE = 'moderate',
  STRONG = 'strong',
}

export interface CompetitorLocation {
  id: string;
  name: string;
  rating: number;
  reviewCount: number;
  phone?: string;
  website?: string;
  address?: string;
  zipCode?: string;
  hours?: string;
  photoCount: number;
  source: 'google_maps' | 'yelp';
  lastReviewDate?: string; // ISO string
  strength: CompetitorStrength;
}

export interface CompetitorGap {
  id: string;
  type: GapType;
  zipCode: string;
  area: string;
  radius: number; // miles
  description: string;
  estimatedLeadVolume: number;
  opportunityScore: number; // 0-100
  details: {
    competitorCount?: number;
    avgRating?: number;
    emergencyServiceGap?: boolean;
    specialtyGaps?: string[];
    closedBusinessCount?: number;
  };
  discoveredAt: string; // ISO timestamp
  lastUpdated: string; // ISO timestamp
}

export interface CompetitorScanResult {
  timestamp: string;
  serviceArea: string;
  radiusMiles: number;
  competitors: CompetitorLocation[];
  gaps: CompetitorGap[];
  summary: {
    totalCompetitors: number;
    weakCompetitors: number;
    emergencyServiceCoverage: boolean;
    specialtiesAvailable: string[];
    topGapTypes: GapType[];
  };
}

// =====================================================
// Service Class
// =====================================================

export class HunterCompetitorScanner {
  private readonly googleMapsApiKey?: string;
  private readonly yelpApiKey?: string;

  constructor(googleMapsApiKey?: string, yelpApiKey?: string) {
    this.googleMapsApiKey = googleMapsApiKey;
    this.yelpApiKey = yelpApiKey;
  }

  /**
   * Scan Google Maps for electricians in service area
   * Extracts: business name, rating, review count, phone, website, hours, photos count
   */
  async scanGoogleMaps(
    serviceArea: string,
    radiusMiles: number
  ): Promise<CompetitorLocation[]> {
    const competitors: CompetitorLocation[] = [];

    // Mock data - in production, would call Google Maps API
    // API endpoint: https://maps.googleapis.com/maps/api/place/textsearch/json
    // Query: "electricians near {serviceArea}"
    // Fields: name, rating, user_ratings_total, formatted_phone_number, website, opening_hours, photos

    // Example mock competitors
    const mockCompetitors = [
      {
        id: 'gm_001',
        name: 'ABC Electric Solutions',
        rating: 3.2,
        reviewCount: 18,
        phone: '(555) 123-4567',
        website: '',
        address: '123 Main St',
        zipCode: '90210',
        hours: '8AM-5PM M-F',
        photoCount: 2,
        source: 'google_maps' as const,
        lastReviewDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
        strength: CompetitorStrength.WEAK,
      },
      {
        id: 'gm_002',
        name: 'Expert Electrical',
        rating: 4.7,
        reviewCount: 112,
        phone: '(555) 234-5678',
        website: 'expertelectrical.com',
        address: '456 Oak Ave',
        zipCode: '90210',
        hours: '7AM-6PM M-Sat, 24/7 Emergency',
        photoCount: 15,
        source: 'google_maps' as const,
        lastReviewDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        strength: CompetitorStrength.STRONG,
      },
      {
        id: 'gm_003',
        name: 'Power Electric',
        rating: 3.8,
        reviewCount: 45,
        phone: '(555) 345-6789',
        website: 'powerelectric.net',
        address: '789 Elm St',
        zipCode: '90211',
        hours: '8AM-5PM M-F',
        photoCount: 8,
        source: 'google_maps' as const,
        lastReviewDate: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
        strength: CompetitorStrength.MODERATE,
      },
    ];

    // Filter weak competitors
    competitors.push(
      ...mockCompetitors.map((c) => ({
        ...c,
        strength: this.assessStrength(c.rating, c.reviewCount, c.website, c.photoCount),
      }))
    );

    return competitors;
  }

  /**
   * Scan Yelp for electrician competitors
   * Identifies: contractors going dark, bad review trends, closed businesses
   */
  async scanYelpCompetitors(serviceArea: string): Promise<CompetitorLocation[]> {
    const competitors: CompetitorLocation[] = [];

    // Mock data - in production, would call Yelp API
    // API endpoint: https://api.yelp.com/v3/businesses/search
    // Query: "electricians {serviceArea}"
    // Fields: name, rating, review_count, phone, url, hours, photos

    const mockYelpCompetitors = [
      {
        id: 'yelp_001',
        name: 'Lightning Electric',
        rating: 2.9,
        reviewCount: 32,
        phone: '(555) 456-7890',
        website: '',
        address: '321 Pine St',
        zipCode: '90212',
        hours: '8AM-4PM',
        photoCount: 1,
        source: 'yelp' as const,
        lastReviewDate: new Date(Date.now() - 300 * 24 * 60 * 60 * 1000).toISOString(),
        strength: CompetitorStrength.WEAK,
      },
      {
        id: 'yelp_002',
        name: 'Spark & Co',
        rating: 4.2,
        reviewCount: 87,
        phone: '(555) 567-8901',
        website: 'sparkandco.com',
        address: '654 Maple Dr',
        zipCode: '90213',
        hours: '24/7 Emergency Available',
        photoCount: 12,
        source: 'yelp' as const,
        lastReviewDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        strength: CompetitorStrength.STRONG,
      },
    ];

    competitors.push(
      ...mockYelpCompetitors.map((c) => ({
        ...c,
        strength: this.assessStrength(c.rating, c.reviewCount, c.website, c.photoCount),
      }))
    );

    return competitors;
  }

  /**
   * Detect market gaps and opportunities from scan results
   */
  async detectCompetitorGaps(
    competitors: CompetitorLocation[],
    serviceArea: string,
    radiusMiles: number
  ): Promise<CompetitorGap[]> {
    const gaps: CompetitorGap[] = [];
    const now = new Date().toISOString();

    // Group competitors by zip code
    const competitorsByZip = new Map<string, CompetitorLocation[]>();
    competitors.forEach((c) => {
      const zip = c.zipCode || 'unknown';
      if (!competitorsByZip.has(zip)) {
        competitorsByZip.set(zip, []);
      }
      competitorsByZip.get(zip)!.push(c);
    });

    // Detect UNDERSERVED_AREA: zip codes with <3 electricians within 15 miles
    competitorsByZip.forEach((zips, zipCode) => {
      if (zips.length < 3) {
        gaps.push({
          id: `gap_underserved_${zipCode}`,
          type: GapType.UNDERSERVED_AREA,
          zipCode,
          area: `${serviceArea} - ${zipCode}`,
          radius: radiusMiles,
          description: `Only ${zips.length} electrician${zips.length !== 1 ? 's' : ''} servicing this area. Limited competition.`,
          estimatedLeadVolume: Math.floor((3 - zips.length) * 8), // ~8 leads per competitor
          opportunityScore: Math.min(100, (3 - zips.length) * 25 + 25),
          details: {
            competitorCount: zips.length,
            avgRating: zips.reduce((sum, c) => sum + c.rating, 0) / zips.length,
          },
          discoveredAt: now,
          lastUpdated: now,
        });
      }
    });

    // Detect WEAK_COMPETITOR: rating <3.5 and declining reviews (6+ months)
    competitors.forEach((c) => {
      if (c.rating < 3.5) {
        const monthsOld = c.lastReviewDate
          ? (Date.now() - new Date(c.lastReviewDate).getTime()) / (30 * 24 * 60 * 60 * 1000)
          : 12;

        if (monthsOld >= 6) {
          gaps.push({
            id: `gap_weak_${c.id}`,
            type: GapType.WEAK_COMPETITOR,
            zipCode: c.zipCode || 'unknown',
            area: `${c.address || serviceArea}`,
            radius: radiusMiles,
            description: `${c.name} has ${c.rating.toFixed(1)}★ rating with no recent reviews (${Math.floor(monthsOld)}+ months). Opportunity for superior service.`,
            estimatedLeadVolume: 3,
            opportunityScore: Math.max(50, 100 - c.rating * 10),
            details: {
              avgRating: c.rating,
            },
            discoveredAt: now,
            lastUpdated: now,
          });
        }
      }
    });

    // Detect NO_EMERGENCY: area where no electrician offers 24/7 emergency service
    const has24HourService = competitors.some(
      (c) => c.hours?.includes('24') || c.hours?.includes('Emergency')
    );
    if (!has24HourService && competitors.length > 0) {
      gaps.push({
        id: `gap_emergency_${serviceArea}`,
        type: GapType.NO_EMERGENCY,
        zipCode: competitors[0].zipCode || 'unknown',
        area: serviceArea,
        radius: radiusMiles,
        description: 'No electrician in area offers 24/7 emergency service. High margin opportunity.',
        estimatedLeadVolume: 5,
        opportunityScore: 85,
        details: {
          emergencyServiceGap: true,
          competitorCount: competitors.length,
        },
        discoveredAt: now,
        lastUpdated: now,
      });
    }

    // Detect SPECIALTY_GAP: no solar electrician, no EV charger installer
    const hasSpecialties = new Set<string>();
    competitors.forEach((c) => {
      if (c.name.toLowerCase().includes('solar')) hasSpecialties.add('solar');
      if (c.name.toLowerCase().includes('ev') || c.name.toLowerCase().includes('charger')) {
        hasSpecialties.add('ev_charger');
      }
    });

    const missingSpecialties = [];
    if (!hasSpecialties.has('solar')) {
      missingSpecialties.push('solar_installation');
    }
    if (!hasSpecialties.has('ev_charger')) {
      missingSpecialties.push('ev_charger_installation');
    }

    if (missingSpecialties.length > 0) {
      gaps.push({
        id: `gap_specialty_${serviceArea}`,
        type: GapType.SPECIALTY_GAP,
        zipCode: competitors[0]?.zipCode || 'unknown',
        area: serviceArea,
        radius: radiusMiles,
        description: `No specialists offering: ${missingSpecialties.join(', ')}. Niche market opportunity.`,
        estimatedLeadVolume: 4,
        opportunityScore: 75,
        details: {
          specialtyGaps: missingSpecialties,
          competitorCount: competitors.length,
        },
        discoveredAt: now,
        lastUpdated: now,
      });
    }

    return gaps;
  }

  /**
   * Generate gap report formatted as HUNTER lead opportunities
   * Each gap becomes a potential lead source with scoring boost
   */
  async generateGapReport(scanResult: CompetitorScanResult): Promise<string> {
    const report = `
HUNTER COMPETITOR INTELLIGENCE REPORT
=====================================
Service Area: ${scanResult.serviceArea}
Scan Date: ${new Date(scanResult.timestamp).toLocaleDateString()}
Radius: ${scanResult.radiusMiles} miles

MARKET SUMMARY
--------------
Total Competitors Found: ${scanResult.summary.totalCompetitors}
Weak Competitors (<3.5★): ${scanResult.summary.weakCompetitors}
24/7 Emergency Coverage: ${scanResult.summary.emergencyServiceCoverage ? 'YES' : 'NO - GAP DETECTED'}
Available Specialties: ${scanResult.summary.specialtiesAvailable.join(', ') || 'None detected'}

OPPORTUNITIES DETECTED (${scanResult.gaps.length})
-------------------------------------------
${scanResult.gaps
  .map(
    (gap) => `
[${gap.type.toUpperCase()}] ${gap.area}
Score: ${gap.opportunityScore}/100
Details: ${gap.description}
Est. Lead Volume: ${gap.estimatedLeadVolume} leads
`
  )
  .join('\n')}

NEXT ACTIONS
------------
1. Review weak competitors - target with superior service messaging
2. Establish 24/7 emergency service if gap identified
3. Develop specialty offerings (solar, EV) in underserved areas
4. Create targeted ad campaigns for detected gaps
    `;
    return report;
  }

  // =====================================================
  // Private Helper Methods
  // =====================================================

  private assessStrength(
    rating: number,
    reviewCount: number,
    website: string | undefined,
    photoCount: number
  ): CompetitorStrength {
    // Weak: <3.5 stars, <30 reviews, no website, <5 photos
    if (rating < 3.5 && reviewCount < 30 && !website && photoCount < 5) {
      return CompetitorStrength.WEAK;
    }
    // Strong: >4.0 stars, >75 reviews, has website, >10 photos
    if (rating >= 4.0 && reviewCount > 75 && website && photoCount >= 10) {
      return CompetitorStrength.STRONG;
    }
    return CompetitorStrength.MODERATE;
  }

  private calculateLeadVolume(gap: CompetitorGap): number {
    switch (gap.type) {
      case GapType.UNDERSERVED_AREA:
        return gap.details.competitorCount ? (3 - gap.details.competitorCount) * 8 : 8;
      case GapType.WEAK_COMPETITOR:
        return 3;
      case GapType.NO_EMERGENCY:
        return 5;
      case GapType.SPECIALTY_GAP:
        return 4;
      case GapType.CLOSED_BUSINESS:
        return 2;
      default:
        return 1;
    }
  }
}

export default HunterCompetitorScanner;
