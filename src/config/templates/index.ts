import plumbing from './plumbing.json';
import gc from './gc.json';
import medicalBilling from './medical-billing.json';
import mechanic from './mechanic.json';
import electricalSupplier from './electrical-supplier.json';

export { plumbing };
export { gc };
export { medicalBilling };
export { mechanic };
export { electricalSupplier };

export type IndustryTemplate = typeof plumbing;

const templates: Record<string, IndustryTemplate> = {
  plumbing,
  gc,
  'medical-billing': medicalBilling,
  mechanic,
  'electrical-supplier': electricalSupplier,
};

export function getTemplate(industry: string): IndustryTemplate | undefined {
  // Admin template preview: if poweron_preview_industry is set in sessionStorage, use that template
  try {
    const previewIndustry = sessionStorage.getItem('poweron_preview_industry')
    if (previewIndustry && templates[previewIndustry]) {
      return templates[previewIndustry]
    }
  } catch { /* ignore — SSR or storage unavailable */ }
  return templates[industry];
}

export default templates;
