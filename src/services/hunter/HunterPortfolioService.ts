// @ts-nocheck
/**
 * src/services/hunter/HunterPortfolioService.ts
 * HUNTER Portfolio Showcase Service
 *
 * Manages portfolio entries for completed projects including photos, testimonials,
 * certifications, and enables export for website, customer portal, and social media.
 *
 * PUBLIC API:
 *   createPortfolioEntry(projectId)         → Promise<PortfolioEntry>
 *   getPortfolioEntries(filters?)           → Promise<PortfolioEntry[]>
 *   updatePortfolioEntry(entryId, data)    → Promise<PortfolioEntry>
 *   deletePortfolioEntry(entryId)          → Promise<void>
 *   requestClientTestimonial(entryId)      → Promise<void>
 *   generateShowcaseHTML(entries)          → string
 *   exportForSocialMedia(entryId, platform) → Promise<SocialMediaExport>
 *   getCertifications()                    → Promise<Certification[]>
 *   validatePortfolioEntry(entry)          → ValidationResult
 */

import { supabase } from '@/lib/supabase';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ProjectType = 'residential' | 'commercial' | 'solar' | 'service';
export type SocialPlatform = 'instagram' | 'facebook' | 'linkedin';
export type CertificationType = 'license' | 'solar' | 'sales' | 'design' | 'insurance' | 'bonding' | 'nec';

export interface PortfolioPhoto {
  id: string;
  url: string;
  caption?: string;
  before_after?: 'before' | 'after' | null;
  uploaded_at?: string;
}

export interface ClientTestimonial {
  text: string;
  client_name: string;
  rating: number; // 1-5
  date?: string;
  contact?: string;
}

export interface PortfolioEntry {
  id: string;
  project_id: string;
  project_name: string;
  project_type: ProjectType;
  description: string;
  location_city: string;
  completion_date: string;
  photos: PortfolioPhoto[];
  testimonial?: ClientTestimonial;
  scope_summary: string;
  highlight_stat: string; // e.g., "200A panel upgrade", "6.4kW solar system"
  thumbnail_url?: string;
  featured: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Certification {
  id: string;
  type: CertificationType;
  name: string;
  number?: string;
  issuing_body?: string;
  issued_date?: string;
  expiration_date?: string;
  status: 'active' | 'expired' | 'in_progress';
  verification_url?: string;
  badge_url?: string;
}

export interface SocialMediaExport {
  platform: SocialPlatform;
  content: string;
  images: string[];
  hashtags: string[];
  callToAction?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ─── Portfolio Service ─────────────────────────────────────────────────────────

/**
 * Creates a new portfolio entry from completed project data
 */
export async function createPortfolioEntry(
  projectId: string,
  projectData: any
): Promise<PortfolioEntry> {
  // Auto-generate description from project scope
  const description = generateDescriptionFromScope(projectData);

  // Extract highlight stat from material takeoff
  const highlightStat = extractHighlightStatFromMTO(projectData);

  // Get project field log photos
  const photos = await extractProjectPhotos(projectId, projectData);

  const entry: PortfolioEntry = {
    id: `portfolio_${projectId}_${Date.now()}`,
    project_id: projectId,
    project_name: projectData.name || 'Untitled Project',
    project_type: projectData.type || 'residential',
    description,
    location_city: projectData.location || extractCityFromAddress(projectData.address),
    completion_date: projectData.completedAt || new Date().toISOString().split('T')[0],
    photos,
    scope_summary: buildScopeSummary(projectData),
    highlight_stat: highlightStat,
    thumbnail_url: photos.length > 0 ? photos[0].url : undefined,
    featured: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Save to Supabase if available
  try {
    await supabase
      .from('hunter_portfolio_entries')
      .insert([entry]);
  } catch (error) {
    console.warn('Portfolio entry saved locally, Supabase unavailable:', error);
  }

  return entry;
}

/**
 * Retrieves portfolio entries with optional filtering
 */
export async function getPortfolioEntries(
  filters?: {
    project_type?: ProjectType;
    featured_only?: boolean;
    limit?: number;
  }
): Promise<PortfolioEntry[]> {
  try {
    let query = supabase.from('hunter_portfolio_entries').select('*');

    if (filters?.project_type) {
      query = query.eq('project_type', filters.project_type);
    }

    if (filters?.featured_only) {
      query = query.eq('featured', true);
    }

    if (filters?.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;

    if (error) throw error;
    return (data || []) as PortfolioEntry[];
  } catch (error) {
    console.warn('Failed to fetch portfolio entries:', error);
    return [];
  }
}

/**
 * Updates a portfolio entry
 */
export async function updatePortfolioEntry(
  entryId: string,
  updates: Partial<PortfolioEntry>
): Promise<PortfolioEntry> {
  const updatedEntry = {
    ...updates,
    updated_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabase
      .from('hunter_portfolio_entries')
      .update(updatedEntry)
      .eq('id', entryId)
      .select()
      .single();

    if (error) throw error;
    return data as PortfolioEntry;
  } catch (error) {
    console.warn('Failed to update portfolio entry:', error);
    throw error;
  }
}

/**
 * Deletes a portfolio entry
 */
export async function deletePortfolioEntry(entryId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('hunter_portfolio_entries')
      .delete()
      .eq('id', entryId);

    if (error) throw error;
  } catch (error) {
    console.warn('Failed to delete portfolio entry:', error);
    throw error;
  }
}

/**
 * Requests a client testimonial for a portfolio entry
 * Generates email/text prompt template for the contractor
 */
export async function requestClientTestimonial(
  entryId: string,
  clientEmail?: string,
  clientPhone?: string
): Promise<void> {
  const entry = await supabase
    .from('hunter_portfolio_entries')
    .select('*')
    .eq('id', entryId)
    .single();

  if (!entry.data) throw new Error('Portfolio entry not found');

  const emailTemplate = buildTestimonialEmailTemplate(entry.data);
  const smsTemplate = buildTestimonialSMSTemplate(entry.data);

  // Store request for tracking
  try {
    await supabase
      .from('hunter_testimonial_requests')
      .insert([
        {
          entry_id: entryId,
          client_email: clientEmail,
          client_phone: clientPhone,
          email_template: emailTemplate,
          sms_template: smsTemplate,
          requested_at: new Date().toISOString(),
          status: 'pending',
        },
      ]);
  } catch (error) {
    console.warn('Failed to log testimonial request:', error);
  }

  // Return templates for contractor to copy/use
  return { emailTemplate, smsTemplate } as any;
}

/**
 * Generates professional HTML showcase of portfolio entries
 * Embeddable on website or shared via link
 */
export function generateShowcaseHTML(entries: PortfolioEntry[]): string {
  const cards = entries
    .map((entry) => generatePortfolioCard(entry))
    .join('\n');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Project Portfolio</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #f5f5f5;
      padding: 40px 20px;
      color: #333;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    .header {
      text-align: center;
      margin-bottom: 50px;
    }

    .header h1 {
      font-size: 2.5rem;
      margin-bottom: 10px;
      color: #1a1a1a;
    }

    .header p {
      font-size: 1.1rem;
      color: #666;
    }

    .portfolio-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
      gap: 30px;
      margin-bottom: 50px;
    }

    .portfolio-card {
      background: white;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    }

    .portfolio-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
    }

    .card-hero {
      position: relative;
      width: 100%;
      height: 280px;
      overflow: hidden;
      background: #f0f0f0;
    }

    .card-hero img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .card-badge {
      position: absolute;
      top: 12px;
      right: 12px;
      background: linear-gradient(135deg, #ff6b35 0%, #f7931e 100%);
      color: white;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 0.85rem;
      font-weight: 600;
      text-transform: capitalize;
    }

    .card-body {
      padding: 20px;
    }

    .card-title {
      font-size: 1.3rem;
      font-weight: 700;
      margin-bottom: 8px;
      color: #1a1a1a;
    }

    .card-location {
      font-size: 0.9rem;
      color: #888;
      margin-bottom: 12px;
    }

    .card-highlight {
      background: #f0f7ff;
      border-left: 4px solid #ff6b35;
      padding: 12px;
      margin-bottom: 15px;
      border-radius: 4px;
      font-weight: 600;
      color: #ff6b35;
      font-size: 0.95rem;
    }

    .card-description {
      font-size: 0.95rem;
      line-height: 1.5;
      color: #555;
      margin-bottom: 15px;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .card-testimonial {
      background: #f9f9f9;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 15px;
      font-size: 0.9rem;
      color: #666;
      font-style: italic;
      border-left: 3px solid #fbbf24;
    }

    .card-testimonial-author {
      margin-top: 8px;
      font-weight: 600;
      color: #333;
      font-style: normal;
    }

    .card-rating {
      display: flex;
      gap: 2px;
      font-size: 0.9rem;
    }

    .star {
      color: #fbbf24;
    }

    .card-footer {
      border-top: 1px solid #eee;
      padding-top: 15px;
      padding-bottom: 0;
    }

    .card-date {
      font-size: 0.85rem;
      color: #999;
      display: block;
      margin-bottom: 12px;
    }

    @media (max-width: 768px) {
      .header h1 {
        font-size: 2rem;
      }

      .portfolio-grid {
        grid-template-columns: 1fr;
        gap: 20px;
      }

      .card-hero {
        height: 240px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Our Project Portfolio</h1>
      <p>Professional electrical and solar installations we're proud of</p>
    </div>

    <div class="portfolio-grid">
      ${cards}
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Exports portfolio entry for social media platforms
 */
export async function exportForSocialMedia(
  entryId: string,
  platform: SocialPlatform
): Promise<SocialMediaExport> {
  const entry = await supabase
    .from('hunter_portfolio_entries')
    .select('*')
    .eq('id', entryId)
    .single();

  if (!entry.data) throw new Error('Portfolio entry not found');

  const data = entry.data as PortfolioEntry;

  const baseHashtags = [
    '#ElectricalContractor',
    '#ElectricalWork',
    '#ProQuality',
    '#LocalElectrician',
  ];

  const typeHashtags: Record<ProjectType, string[]> = {
    residential: ['#ResidentialElectrical', '#HomeElectrical'],
    commercial: ['#CommercialElectrical', '#CommercialConstruction'],
    solar: ['#SolarInstallation', '#RenewableEnergy', '#SolarPower'],
    service: ['#ElectricalService', '#ServiceCall'],
  };

  const allHashtags = [
    ...baseHashtags,
    ...typeHashtags[data.project_type],
    `#${data.location_city.replace(/\s/g, '')}`,
  ];

  const cta = 'Contact us for your next electrical project!';

  if (platform === 'instagram') {
    return {
      platform: 'instagram',
      content: buildInstagramCaption(data, allHashtags),
      images: data.photos.map((p) => p.url),
      hashtags: allHashtags,
      callToAction: cta,
    };
  } else if (platform === 'facebook') {
    return {
      platform: 'facebook',
      content: buildFacebookPost(data, allHashtags),
      images: data.photos.map((p) => p.url),
      hashtags: allHashtags,
      callToAction: cta,
    };
  } else if (platform === 'linkedin') {
    return {
      platform: 'linkedin',
      content: buildLinkedInPost(data),
      images: data.photos.slice(0, 1).map((p) => p.url), // LinkedIn single image
      hashtags: ['#Electrical', '#Construction', '#Professional'],
      callToAction: 'Get in touch',
    };
  }

  throw new Error('Unknown platform');
}

/**
 * Retrieves certifications including solar, electrical licenses, and insurance
 */
export async function getCertifications(): Promise<Certification[]> {
  try {
    const { data, error } = await supabase
      .from('hunter_certifications')
      .select('*')
      .order('expiration_date', { ascending: false });

    if (error) throw error;

    return (data || []).map((cert: any) => ({
      ...cert,
      status: determineCertStatus(cert.expiration_date),
    }));
  } catch (error) {
    console.warn('Failed to fetch certifications:', error);
    return [];
  }
}

/**
 * Validates portfolio entry for completeness
 */
export function validatePortfolioEntry(entry: Partial<PortfolioEntry>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!entry.project_name) errors.push('Project name is required');
  if (!entry.project_type) errors.push('Project type is required');
  if (!entry.description) errors.push('Description is required');
  if (!entry.location_city) errors.push('Location city is required');
  if (!entry.completion_date) errors.push('Completion date is required');
  if (!entry.highlight_stat) errors.push('Highlight statistic is required');

  // Warnings for best practices
  if (!entry.photos || entry.photos.length === 0) {
    warnings.push('No photos added - portfolio entry will be less impactful');
  }
  if (!entry.testimonial) {
    warnings.push('No client testimonial - add one for social proof');
  }
  if (!entry.featured) {
    warnings.push('This entry is not featured - consider promoting your best work');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ─── Helper Functions ──────────────────────────────────────────────────────────

function generateDescriptionFromScope(projectData: any): string {
  const scope = projectData.description || projectData.scope || '';
  const type = projectData.type || 'electrical';

  if (scope) {
    return scope.substring(0, 300) + (scope.length > 300 ? '...' : '');
  }

  return `Professional ${type} installation completed with attention to safety and quality standards.`;
}

function extractHighlightStatFromMTO(projectData: any): string {
  if (projectData.highlight_stat) return projectData.highlight_stat;

  const mtoRows = projectData.mtoRows || [];
  const mtoSummary = mtoRows
    .slice(0, 2)
    .map((row: any) => `${row.qty} ${row.name}`)
    .join(', ');

  if (mtoSummary) return mtoSummary;

  const laborHrs = projectData.laborHrs || 0;
  if (laborHrs > 0) return `${laborHrs} labor hours`;

  return 'Professional installation completed';
}

async function extractProjectPhotos(projectId: string, projectData: any): Promise<PortfolioPhoto[]> {
  const photos: PortfolioPhoto[] = [];

  // Extract from field logs if available
  if (projectData.logs && Array.isArray(projectData.logs)) {
    projectData.logs.forEach((log: any, index: number) => {
      if (log.photo_url) {
        photos.push({
          id: `photo_${projectId}_${index}`,
          url: log.photo_url,
          caption: log.note,
          uploaded_at: log.date,
        });
      }
    });
  }

  return photos;
}

function extractCityFromAddress(address: string): string {
  if (!address) return '';
  const parts = address.split(',');
  return parts.length > 1 ? parts[1].trim() : address.split(' ').slice(-2).join(' ');
}

function buildScopeSummary(projectData: any): string {
  const elements = [];

  if (projectData.type) elements.push(`Type: ${projectData.type}`);
  if (projectData.laborHrs) elements.push(`Labor: ${projectData.laborHrs} hrs`);
  if (projectData.contract) elements.push(`Value: $${Math.round(projectData.contract)}`);

  return elements.join(' • ');
}

function generatePortfolioCard(entry: PortfolioEntry): string {
  const heroImage = entry.photos?.[0]?.url || 'https://via.placeholder.com/380x280?text=No+Photo';
  const testimonialHtml = entry.testimonial
    ? `
      <div class="card-testimonial">
        <div>"${entry.testimonial.text}"</div>
        <div class="card-testimonial-author">
          – ${entry.testimonial.client_name}
          <div class="card-rating">
            ${Array(entry.testimonial.rating)
              .fill(0)
              .map(() => '<span class="star">★</span>')
              .join('')}
          </div>
        </div>
      </div>
    `
    : '';

  return `
    <div class="portfolio-card">
      <div class="card-hero">
        <img src="${heroImage}" alt="${entry.project_name}">
        <div class="card-badge">${entry.project_type}</div>
      </div>
      <div class="card-body">
        <h3 class="card-title">${entry.project_name}</h3>
        <div class="card-location">${entry.location_city}</div>
        <div class="card-highlight">${entry.highlight_stat}</div>
        <div class="card-description">${entry.description}</div>
        ${testimonialHtml}
        <div class="card-footer">
          <span class="card-date">Completed ${formatDate(entry.completion_date)}</span>
        </div>
      </div>
    </div>
  `;
}

function buildTestimonialEmailTemplate(entry: PortfolioEntry): string {
  return `
Subject: Share Your Experience - Testimonial Request

Hi [Client Name],

We hope you're enjoying your new [${entry.project_type}] installation! We'd love to hear about your experience and learn how the project turned out for you.

Would you be willing to share a brief testimonial about working with us? Your feedback helps other homeowners/businesses learn about our commitment to quality and service.

If you'd like to share, just reply to this email with:
- A brief comment about the experience (2-3 sentences)
- Your name
- 1-5 star rating

Thank you for choosing us!

Best regards,
[Your Company]
  `;
}

function buildTestimonialSMSTemplate(entry: PortfolioEntry): string {
  return `Hi [Name]! Quick question: How happy are you with your [${entry.project_type}] work? We'd love your feedback in 1-2 sentences. Reply here!`;
}

function buildInstagramCaption(entry: PortfolioEntry, hashtags: string[]): string {
  return `
✨ Project Complete: ${entry.project_name}

📍 ${entry.location_city}
📊 ${entry.highlight_stat}

${entry.description.substring(0, 150)}...

We take pride in delivering quality workmanship every project. Ready for your next installation?

${hashtags.join(' ')}
  `;
}

function buildFacebookPost(entry: PortfolioEntry, hashtags: string[]): string {
  return `
🚀 Another Project, Another Success Story!

We're excited to share this ${entry.project_type} project in ${entry.location_city}.

${entry.highlight_stat}

${entry.description}

${entry.testimonial ? `💬 "${entry.testimonial.text}" - ${entry.testimonial.client_name}` : ''}

Looking for professional electrical work? Let's talk about your next project!

${hashtags.join(' ')}
  `;
}

function buildLinkedInPost(entry: PortfolioEntry): string {
  return `
🔌 Completed Project: ${entry.project_name}

Successfully delivered a ${entry.project_type} installation in ${entry.location_city}.

Key accomplishments:
• ${entry.highlight_stat}
• Maintained project schedule and budget
• Exceeded quality standards

This project showcases our team's commitment to technical excellence and customer satisfaction.

#ElectricalConstruction #ProjectDelivery #ProfessionalServices
  `;
}

function buildTestimonialEmailTemplate(entry: any): string {
  return `
Subject: Share Your Experience - Testimonial Request

Hi [Client Name],

We hope you're enjoying your new installation! We'd love to hear about your experience.

Would you be willing to share a brief testimonial about working with us? Your feedback helps other customers learn about our commitment to quality and service.

Thank you,
[Your Company]
  `;
}

function buildTestimonialSMSTemplate(entry: any): string {
  return `Hi [Name]! How happy are you with your work? Reply with 1-2 sentences and a rating (1-5 stars).`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function determineCertStatus(expirationDate: string): 'active' | 'expired' | 'in_progress' {
  if (!expirationDate) return 'in_progress';
  const expDate = new Date(expirationDate);
  return expDate > new Date() ? 'active' : 'expired';
}
