/**
 * src/features/blueprint-vr/electricalCatalog.ts
 *
 * Electrical scope catalog for the Blueprint VR generator.
 * Organizes electrical components by construction stage with render hints for VR visualization.
 *
 * Stages covered:
 * - Underground: below-grade and foundation electrical work
 * - Rough In: framing phase installations
 * - Trim: finish phase installations
 * - Finished: final as-built state
 */

import type { VRStage } from './types'
import { STAGE_ORDER } from './stages'

/**
 * Render hints for VR visualization of electrical components.
 */
export interface ElectricalRenderHints {
  assetCategory: string
  colorMaterial: string
  installMethod: string
}

/**
 * An electrical scope item in the catalog.
 */
export interface ElectricalCatalogItem {
  id: string
  label: string
  stage: VRStage
  category: string
  description?: string
  renderHints: ElectricalRenderHints
}

/**
 * Underground stage catalog items.
 * Covers foundation and below-grade electrical work including conduits, boxes, grounding, and stub-ups.
 */
const UNDERGROUND_CATALOG: ElectricalCatalogItem[] = [
  {
    id: 'underground-pvc-conduit',
    label: 'PVC Conduit',
    stage: 'underground',
    category: 'Underground Conduit',
    description: 'Schedule 40 PVC conduit for underground runs',
    renderHints: {
      assetCategory: 'conduit',
      colorMaterial: 'gray plastic',
      installMethod: 'buried in trench, minimum 18 inches deep',
    },
  },
  {
    id: 'underground-duct-bank',
    label: 'Underground Duct Bank',
    stage: 'underground',
    category: 'Underground Conduit',
    description: 'Multiple conduits in organized duct bank',
    renderHints: {
      assetCategory: 'duct-bank',
      colorMaterial: 'gray plastic with separators',
      installMethod: 'encased in concrete, minimum 36 inches below grade',
    },
  },
  {
    id: 'underground-floor-box',
    label: 'Floor Receptacle Box',
    stage: 'underground',
    category: 'Floor Receptacle Hardware',
    description: 'Recessed floor box with cover plate for floor-mounted outlets',
    renderHints: {
      assetCategory: 'floor-box',
      colorMaterial: 'cast aluminum with brass trim',
      installMethod: 'set flush in concrete slab during pour',
    },
  },
  {
    id: 'underground-slab-box',
    label: 'Slab Box',
    stage: 'underground',
    category: 'Slab Box',
    description: 'Electrical box embedded in concrete slab',
    renderHints: {
      assetCategory: 'slab-box',
      colorMaterial: 'plastic or PVC gray',
      installMethod: 'placed before concrete pour, positioned to grade level',
    },
  },
  {
    id: 'underground-pull-box',
    label: 'Underground Pull Box',
    stage: 'underground',
    category: 'Underground Pull Box',
    description: 'Large access box for underground conduit pulls',
    renderHints: {
      assetCategory: 'pull-box',
      colorMaterial: 'concrete precast gray',
      installMethod: 'set level with finished grade, concrete collar',
    },
  },
  {
    id: 'underground-conduit-sleeve',
    label: 'Conduit Sleeve',
    stage: 'underground',
    category: 'Sleeve',
    description: 'Protective sleeve for conduit passing through structural elements',
    renderHints: {
      assetCategory: 'sleeve',
      colorMaterial: 'steel or PVC black',
      installMethod: 'installed before concrete pour through slab or wall',
    },
  },
  {
    id: 'underground-stub-up',
    label: 'Stub-Up',
    stage: 'underground',
    category: 'Stub-Up',
    description: 'Vertical conduit extended above slab for building entry',
    renderHints: {
      assetCategory: 'stub-up',
      colorMaterial: 'PVC gray or EMT metallic',
      installMethod: 'extends 18-24 inches above slab, secured to mudsill',
    },
  },
  {
    id: 'underground-ground-rod',
    label: 'Ground Rod',
    stage: 'underground',
    category: 'Grounding/Bonding',
    description: 'Copper-bonded ground rod for grounding electrode system',
    renderHints: {
      assetCategory: 'ground-rod',
      colorMaterial: 'copper-bonded steel',
      installMethod: 'driven minimum 8 feet deep, marked at grade',
    },
  },
  {
    id: 'underground-ground-lug',
    label: 'Ground Lug and Conductor',
    stage: 'underground',
    category: 'Grounding/Bonding',
    description: 'Copper lug and bare copper conductor connecting ground rod to panel',
    renderHints: {
      assetCategory: 'ground-conductor',
      colorMaterial: 'bare copper',
      installMethod: 'minimum #6 copper, run directly from rod to panel',
    },
  },
  {
    id: 'underground-bonding-strap',
    label: 'Bonding Strap',
    stage: 'underground',
    category: 'Grounding/Bonding',
    description: 'Copper bonding strap for equipment bonding at foundation',
    renderHints: {
      assetCategory: 'bonding-strap',
      colorMaterial: 'bare copper',
      installMethod: 'clamped to steel, bolted to concrete anchor',
    },
  },
]

/**
 * Rough In stage catalog items.
 * Covers wall and framing phase electrical installation.
 */
const ROUGH_IN_CATALOG: ElectricalCatalogItem[] = [
  {
    id: 'rough-in-electrical-box',
    label: 'Electrical Box',
    stage: 'roughIn',
    category: 'Box',
    description: 'Standard outlet, switch, or junction box for framing',
    renderHints: {
      assetCategory: 'electrical-box',
      colorMaterial: 'yellow plastic or galvanized steel',
      installMethod: 'nailed to stud, flush with finish surface',
    },
  },
  {
    id: 'rough-in-ceiling-box',
    label: 'Ceiling Box',
    stage: 'roughIn',
    category: 'Box',
    description: 'Adjustable ceiling box for fixture support',
    renderHints: {
      assetCategory: 'ceiling-box',
      colorMaterial: 'galvanized steel',
      installMethod: 'mounted between joists with bar hanger',
    },
  },
  {
    id: 'rough-in-old-work-box',
    label: 'Old Work/Remodel Box',
    stage: 'roughIn',
    category: 'Box',
    description: 'Box designed for installation in existing walls',
    renderHints: {
      assetCategory: 'old-work-box',
      colorMaterial: 'plastic tan or brown',
      installMethod: 'expanded behind drywall with mounting ears',
    },
  },
  {
    id: 'rough-in-nmb-14-2',
    label: '14/2 NM Branch Wiring',
    stage: 'roughIn',
    category: 'Branch Wiring',
    description: '14 AWG 2-conductor plus ground Romex for standard circuits',
    renderHints: {
      assetCategory: 'romex-14-2',
      colorMaterial: 'yellow plastic jacket with red/black/ground',
      installMethod: 'stapled every 4.5 feet, at least 1.25 inches from stud edge',
    },
  },
  {
    id: 'rough-in-nmb-12-2',
    label: '12/2 NM Branch Wiring',
    stage: 'roughIn',
    category: 'Branch Wiring',
    description: '12 AWG 2-conductor plus ground Romex for 20 amp circuits',
    renderHints: {
      assetCategory: 'romex-12-2',
      colorMaterial: 'yellow plastic jacket with black/red/ground',
      installMethod: 'stapled every 4.5 feet, 1.25 inches from stud edge',
    },
  },
  {
    id: 'rough-in-nmb-10-3',
    label: '10/3 NM Branch Wiring',
    stage: 'roughIn',
    category: 'Branch Wiring',
    description: '10 AWG 3-conductor plus ground for larger loads',
    renderHints: {
      assetCategory: 'romex-10-3',
      colorMaterial: 'yellow plastic jacket with red/black/white/ground',
      installMethod: 'secured with staples, protected in high-traffic areas',
    },
  },
  {
    id: 'rough-in-emt-conduit',
    label: 'EMT Conduit',
    stage: 'roughIn',
    category: 'Conduit',
    description: 'Electrical Metallic Tubing for exposed or commercial runs',
    renderHints: {
      assetCategory: 'emt-conduit',
      colorMaterial: 'galvanized steel metallic',
      installMethod: 'coupled with compression fittings, secured every 3 feet',
    },
  },
  {
    id: 'rough-in-pvc-conduit',
    label: 'PVC Conduit (Interior)',
    stage: 'roughIn',
    category: 'Conduit',
    description: 'Schedule 40 PVC for interior protected runs',
    renderHints: {
      assetCategory: 'pvc-conduit-interior',
      colorMaterial: 'gray plastic',
      installMethod: 'glued with PVC cement, supported every 3 feet',
    },
  },
  {
    id: 'rough-in-flex-conduit',
    label: 'Flexible Conduit',
    stage: 'roughIn',
    category: 'Flex',
    description: 'Flexible metal conduit for final connections to fixtures',
    renderHints: {
      assetCategory: 'flex-conduit',
      colorMaterial: 'aluminum spiral metallic',
      installMethod: 'connected with compression fittings, minimum 6 inches to fixtures',
    },
  },
  {
    id: 'rough-in-mc-cable',
    label: 'MC Cable',
    stage: 'roughIn',
    category: 'MC',
    description: 'Metal-Clad cable for protected branch circuits',
    renderHints: {
      assetCategory: 'mc-cable',
      colorMaterial: 'flexible metal armor with conductors',
      installMethod: 'stapled every 16 inches, run parallel to framing',
    },
  },
  {
    id: 'rough-in-service-panel',
    label: 'Main Service Panel',
    stage: 'roughIn',
    category: 'Panel',
    description: 'Primary electrical panel with main breaker and circuit breakers',
    renderHints: {
      assetCategory: 'service-panel',
      colorMaterial: 'gray metal enclosure with black door',
      installMethod: 'mounted on wall, minimum 4 feet above floor to center',
    },
  },
  {
    id: 'rough-in-sub-panel',
    label: 'Sub Panel',
    stage: 'roughIn',
    category: 'Panel',
    description: 'Secondary panel fed from main for branch circuit distribution',
    renderHints: {
      assetCategory: 'sub-panel',
      colorMaterial: 'gray metal enclosure',
      installMethod: 'mounted on wall, fed via larger gauge feeder',
    },
  },
  {
    id: 'rough-in-circuit-breaker',
    label: 'Circuit Breaker',
    stage: 'roughIn',
    category: 'Panel',
    description: 'Snap-in breaker for circuit protection',
    renderHints: {
      assetCategory: 'circuit-breaker',
      colorMaterial: 'black toggle switch',
      installMethod: 'installed in panel bus, labeled per plan',
    },
  },
  {
    id: 'rough-in-gfci-breaker',
    label: 'GFCI Breaker',
    stage: 'roughIn',
    category: 'Panel',
    description: 'Ground Fault Circuit Interrupter breaker for wet locations',
    renderHints: {
      assetCategory: 'gfci-breaker',
      colorMaterial: 'black with reset button',
      installMethod: 'installed in panel for bathroom/kitchen circuits',
    },
  },
  {
    id: 'rough-in-home-run',
    label: 'Home Run',
    stage: 'roughIn',
    category: 'Home Run',
    description: 'Main service conductor from meter to service panel',
    renderHints: {
      assetCategory: 'home-run',
      colorMaterial: 'black and red XHHW or large gauge NM',
      installMethod: 'routed through conduit from meter to panel',
    },
  },
  {
    id: 'rough-in-service-entrance',
    label: 'Service Entrance',
    stage: 'roughIn',
    category: 'Home Run',
    description: 'Conduit and support structure for service entry',
    renderHints: {
      assetCategory: 'service-entrance',
      colorMaterial: 'EMT or rigid conduit with clamps',
      installMethod: 'supported at 3-foot intervals, weatherhead installed',
    },
  },
  {
    id: 'rough-in-raceway-support',
    label: 'Raceway Support',
    stage: 'roughIn',
    category: 'Raceway Support',
    description: 'Clamp or support for securing conduit or cables',
    renderHints: {
      assetCategory: 'conduit-clamp',
      colorMaterial: 'galvanized steel or plastic',
      installMethod: 'attached to framing every 3-4 feet',
    },
  },
  {
    id: 'rough-in-j-box',
    label: 'Junction Box',
    stage: 'roughIn',
    category: 'Box',
    description: 'Accessible junction point for wire splices',
    renderHints: {
      assetCategory: 'junction-box',
      colorMaterial: 'galvanized steel gray',
      installMethod: 'mounted on wall or in accessible location, blank cover',
    },
  },
  {
    id: 'rough-in-lowvolt-pathway',
    label: 'Low Voltage Pathway',
    stage: 'roughIn',
    category: 'Low Voltage',
    description: 'Conduit or chase for data, phone, video cabling',
    renderHints: {
      assetCategory: 'lowvolt-conduit',
      colorMaterial: 'PVC gray with blue marking',
      installMethod: 'separate from power circuits, minimum 12 inches spacing',
    },
  },
  {
    id: 'rough-in-lowvolt-box',
    label: 'Low Voltage Box',
    stage: 'roughIn',
    category: 'Low Voltage',
    description: 'Box for data/phone outlet installation',
    renderHints: {
      assetCategory: 'lowvolt-box',
      colorMaterial: 'blue plastic or low-voltage marked',
      installMethod: 'separate from power boxes, clearly labeled',
    },
  },
]

/**
 * Trim stage catalog items.
 * Covers final trim and fixture installation.
 */
const TRIM_CATALOG: ElectricalCatalogItem[] = [
  {
    id: 'trim-standard-device',
    label: 'Standard Device',
    stage: 'trim',
    category: 'Device',
    description: 'Generic outlet or switch receptacle for standard use',
    renderHints: {
      assetCategory: 'standard-device',
      colorMaterial: 'white or almond thermoplastic',
      installMethod: 'screwed to box ears, inset 1/8 inch from finish surface',
    },
  },
  {
    id: 'trim-gfci-outlet',
    label: 'GFCI Outlet',
    stage: 'trim',
    category: 'Receptacle',
    description: 'Ground Fault Circuit Interrupter outlet for wet locations',
    renderHints: {
      assetCategory: 'gfci-outlet',
      colorMaterial: 'white thermoplastic with test/reset buttons',
      installMethod: 'installed near water sources, clearly labeled',
    },
  },
  {
    id: 'trim-usb-outlet',
    label: 'USB Outlet',
    stage: 'trim',
    category: 'Receptacle',
    description: 'Outlet with integrated USB charging ports',
    renderHints: {
      assetCategory: 'usb-outlet',
      colorMaterial: 'white with dark USB ports',
      installMethod: 'installed per plan, requires higher amperage breaker',
    },
  },
  {
    id: 'trim-240v-outlet',
    label: '240V Outlet',
    stage: 'trim',
    category: 'Receptacle',
    description: 'Heavy-duty outlet for appliances or equipment',
    renderHints: {
      assetCategory: '240v-outlet',
      colorMaterial: 'gray or black heavy-duty',
      installMethod: 'dedicated circuit, weatherproof cover if exterior',
    },
  },
  {
    id: 'trim-toggle-switch',
    label: 'Toggle Switch',
    stage: 'trim',
    category: 'Switch',
    description: 'Standard single-pole light switch',
    renderHints: {
      assetCategory: 'toggle-switch',
      colorMaterial: 'white thermoplastic lever',
      installMethod: 'installed at standard height 48 inches AFF',
    },
  },
  {
    id: 'trim-three-way-switch',
    label: 'Three-Way Switch',
    stage: 'trim',
    category: 'Switch',
    description: 'Switch for controlling light from two locations',
    renderHints: {
      assetCategory: 'three-way-switch',
      colorMaterial: 'white thermoplastic with internal reversible pole',
      installMethod: 'requires 3-conductor cable between switches',
    },
  },
  {
    id: 'trim-dimmer-switch',
    label: 'Dimmer Switch',
    stage: 'trim',
    category: 'Switch',
    description: 'Variable light intensity control',
    renderHints: {
      assetCategory: 'dimmer-switch',
      colorMaterial: 'white with sliding or knob control',
      installMethod: 'for LED/incandescent/halogen per rating',
    },
  },
  {
    id: 'trim-outlet-plate',
    label: 'Outlet Plate',
    stage: 'trim',
    category: 'Plate',
    description: 'Decorative cover plate for outlet',
    renderHints: {
      assetCategory: 'outlet-cover',
      colorMaterial: 'white or almond plastic or stainless steel',
      installMethod: 'screwed to device ears over outlet',
    },
  },
  {
    id: 'trim-switch-plate',
    label: 'Switch Plate',
    stage: 'trim',
    category: 'Plate',
    description: 'Decorative cover plate for switch',
    renderHints: {
      assetCategory: 'switch-cover',
      colorMaterial: 'white plastic or stainless steel',
      installMethod: 'screwed over switch device',
    },
  },
  {
    id: 'trim-blank-plate',
    label: 'Blank Plate',
    stage: 'trim',
    category: 'Plate',
    description: 'Cover plate for unused openings',
    renderHints: {
      assetCategory: 'blank-cover',
      colorMaterial: 'white plastic',
      installMethod: 'installed on empty boxes to maintain clean appearance',
    },
  },
  {
    id: 'trim-recessed-light',
    label: 'Recessed Light Trim',
    stage: 'trim',
    category: 'Light Trim',
    description: 'Trim ring and baffle assembly for recessed fixture',
    renderHints: {
      assetCategory: 'recessed-trim',
      colorMaterial: 'black or chrome baffle with trim ring',
      installMethod: 'inserted into housing after insulation barrier installed',
    },
  },
  {
    id: 'trim-ceiling-fixture',
    label: 'Ceiling Light Fixture',
    stage: 'trim',
    category: 'Light Trim',
    description: 'Mounted ceiling light fixture',
    renderHints: {
      assetCategory: 'ceiling-fixture',
      colorMaterial: 'chrome, brass, or bronze per spec',
      installMethod: 'screwed to ceiling box, wired per UL standard',
    },
  },
  {
    id: 'trim-wall-sconce',
    label: 'Wall Sconce',
    stage: 'trim',
    category: 'Light Trim',
    description: 'Wall-mounted decorative light fixture',
    renderHints: {
      assetCategory: 'wall-sconce',
      colorMaterial: 'brass, brushed nickel, or custom finish',
      installMethod: 'mounted on box with mounting bracket',
    },
  },
  {
    id: 'trim-fan-light-kit',
    label: 'Ceiling Fan with Light Kit',
    stage: 'trim',
    category: 'Light Trim',
    description: 'Integrated fan and light fixture',
    renderHints: {
      assetCategory: 'ceiling-fan-fixture',
      colorMaterial: 'bronze with wood or metal blades',
      installMethod: 'requires heavy-duty box with brace, dual switches',
    },
  },
  {
    id: 'trim-panel-directory',
    label: 'Panel Directory',
    stage: 'trim',
    category: 'Panel Directory',
    description: 'Labeled directory inside or on service panel',
    renderHints: {
      assetCategory: 'panel-label',
      colorMaterial: 'white labels on black or gray background',
      installMethod: 'affixed inside panel door, clearly printed legend',
    },
  },
  {
    id: 'trim-branch-circuit-label',
    label: 'Branch Circuit Label',
    stage: 'trim',
    category: 'Labels',
    description: 'Label for individual circuit breaker',
    renderHints: {
      assetCategory: 'breaker-label',
      colorMaterial: 'white plastic or adhesive',
      installMethod: 'attached to breaker handle or panel directory entry',
    },
  },
  {
    id: 'trim-outlet-label',
    label: 'Outlet Identification Label',
    stage: 'trim',
    category: 'Labels',
    description: 'Identification label for special outlets',
    renderHints: {
      assetCategory: 'outlet-label',
      colorMaterial: 'colored or white adhesive labels',
      installMethod: 'applied to plate or nearby wall surface',
    },
  },
  {
    id: 'trim-low-voltage-jack',
    label: 'Low Voltage Jack',
    stage: 'trim',
    category: 'Low Voltage',
    description: 'Data, phone, or video outlet',
    renderHints: {
      assetCategory: 'data-jack',
      colorMaterial: 'white or stainless steel faceplate with jack',
      installMethod: 'installed per low-voltage standard, separate from power',
    },
  },
  {
    id: 'trim-fixture-support-strap',
    label: 'Fixture Support Strap',
    stage: 'trim',
    category: 'Fixture Trim-Out',
    description: 'Strap or chain for fixture support',
    renderHints: {
      assetCategory: 'support-strap',
      colorMaterial: 'galvanized steel or chrome',
      installMethod: 'installed to box or structural member',
    },
  },
]

/**
 * Finished stage catalog items.
 * Represents the final as-built electrical system state.
 */
const FINISHED_CATALOG: ElectricalCatalogItem[] = [
  {
    id: 'finished-circuit-label',
    label: 'Labeled Circuit',
    stage: 'finished',
    category: 'Circuit Label',
    description: 'Fully labeled and functional circuit in operation',
    renderHints: {
      assetCategory: 'labeled-circuit',
      colorMaterial: 'white labels on black or gray panel',
      installMethod: 'directory complete, all breakers labeled per plan',
    },
  },
  {
    id: 'finished-outlet-coverage',
    label: 'Installed Outlet',
    stage: 'finished',
    category: 'Final Device',
    description: 'Finished outlet ready for use',
    renderHints: {
      assetCategory: 'finished-outlet',
      colorMaterial: 'white or custom color per design',
      installMethod: 'fully wired, tested, cover plate installed',
    },
  },
  {
    id: 'finished-light-fixture',
    label: 'Installed Light Fixture',
    stage: 'finished',
    category: 'Final Device',
    description: 'Fully installed and operational light fixture',
    renderHints: {
      assetCategory: 'finished-light',
      colorMaterial: 'per spec finish with bulbs installed',
      installMethod: 'wired and tested, fully functional',
    },
  },
  {
    id: 'finished-switch',
    label: 'Installed Switch',
    stage: 'finished',
    category: 'Final Device',
    description: 'Fully installed and operational switch',
    renderHints: {
      assetCategory: 'finished-switch',
      colorMaterial: 'white or custom per design',
      installMethod: 'operating correctly, cover plate installed',
    },
  },
  {
    id: 'finished-panel-complete',
    label: 'Service Panel As-Built',
    stage: 'finished',
    category: 'Panel',
    description: 'Complete service panel with all circuits installed and labeled',
    renderHints: {
      assetCategory: 'panel-as-built',
      colorMaterial: 'gray metal with fully labeled directory',
      installMethod: 'all circuits operational, no breaker left',
    },
  },
  {
    id: 'finished-room-ready',
    label: 'Room Electrical Complete',
    stage: 'finished',
    category: 'Room Space',
    description: 'Entire room electrical system finished and ready for occupancy',
    renderHints: {
      assetCategory: 'room-complete',
      colorMaterial: 'all finishes per design',
      installMethod: 'all outlets, switches, fixtures installed and tested',
    },
  },
  {
    id: 'finished-owner-annotation',
    label: 'Owner/As-Built Annotation',
    stage: 'finished',
    category: 'Annotation',
    description: 'Field notes or owner marks for future reference',
    renderHints: {
      assetCategory: 'field-note',
      colorMaterial: 'pen mark or label on plan or equipment',
      installMethod: 'documented for as-built records',
    },
  },
  {
    id: 'finished-as-built-drawing',
    label: 'As-Built Documentation',
    stage: 'finished',
    category: 'Annotation',
    description: 'Final as-built drawing reflecting actual installation',
    renderHints: {
      assetCategory: 'as-built-doc',
      colorMaterial: 'paper or PDF with red-line updates',
      installMethod: 'delivered to owner for records',
    },
  },
]

/**
 * Complete electrical scope catalog organized by stage.
 */
const ELECTRICAL_CATALOG: Record<VRStage, ElectricalCatalogItem[]> = {
  underground: UNDERGROUND_CATALOG,
  roughIn: ROUGH_IN_CATALOG,
  trim: TRIM_CATALOG,
  finished: FINISHED_CATALOG,
}

/**
 * Get all catalog items for a specific stage.
 *
 * @param stage - The VR stage
 * @returns Array of electrical catalog items for that stage
 */
export function getCatalogItemsByStage(stage: VRStage): ElectricalCatalogItem[] {
  return ELECTRICAL_CATALOG[stage] || []
}

/**
 * Get a specific catalog item by ID.
 *
 * @param itemId - The unique item ID
 * @returns The catalog item, or undefined if not found
 */
export function getCatalogItemById(itemId: string): ElectricalCatalogItem | undefined {
  for (const stage of STAGE_ORDER) {
    const item = ELECTRICAL_CATALOG[stage].find((c) => c.id === itemId)
    if (item) return item
  }
  return undefined
}

/**
 * Get all catalog items across all stages.
 *
 * @returns Array of all electrical catalog items
 */
export function getAllCatalogItems(): ElectricalCatalogItem[] {
  const items: ElectricalCatalogItem[] = []
  for (const stage of STAGE_ORDER) {
    items.push(...ELECTRICAL_CATALOG[stage])
  }
  return items
}

/**
 * Filter catalog items by category.
 *
 * @param category - The category name to filter by
 * @returns Array of items matching the category
 */
export function getCatalogItemsByCategory(category: string): ElectricalCatalogItem[] {
  return getAllCatalogItems().filter((item) => item.category === category)
}

/**
 * Get all unique categories in the catalog.
 *
 * @returns Array of unique category strings
 */
export function getAllCategories(): string[] {
  const categories = new Set<string>()
  for (const item of getAllCatalogItems()) {
    categories.add(item.category)
  }
  return Array.from(categories).sort()
}

/**
 * Export the raw catalog for direct access if needed.
 */
export { ELECTRICAL_CATALOG, UNDERGROUND_CATALOG, ROUGH_IN_CATALOG, TRIM_CATALOG, FINISHED_CATALOG }
