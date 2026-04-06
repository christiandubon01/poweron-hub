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
  return templates[industry];
}

export default templates;
