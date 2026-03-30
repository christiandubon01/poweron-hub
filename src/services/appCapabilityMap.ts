// @ts-nocheck
/**
 * App Capability Map — static structured reference of every feature
 * currently built in Power On Hub.
 *
 * This is NOT generated dynamically from code — it's a maintained
 * reference document that gets updated as features are built.
 * NEXUS uses this to answer questions about what the app can and cannot do.
 */

export interface AppCapability {
  feature: string
  description: string
  agents: string[]
  voiceTriggerable: boolean
  currentlyWorking: boolean
  limitations: string[]
  relatedPanels: string[]
}

export const APP_CAPABILITY_MAP: AppCapability[] = [
  {
    feature: 'Voice command to NEXUS',
    description: 'Tap mic, speak a command, NEXUS routes to the right agent and responds via voice and chat',
    agents: ['NEXUS'],
    voiceTriggerable: true,
    currentlyWorking: true,
    limitations: ['ElevenLabs audio blocked on iOS Safari, works on Chrome iOS and Windows'],
    relatedPanels: ['NEXUS Voice Session'],
  },
  {
    feature: 'Calendar scheduling',
    description: 'View calendar with jobs, meetings, and scheduled events by week',
    agents: ['CHRONO'],
    voiceTriggerable: false,
    currentlyWorking: true,
    limitations: [
      'Calendar is display-only — events must be manually added',
      'CHRONO cannot automatically create calendar entries from voice commands yet',
      'No Google Calendar sync yet (Phase D)',
      'No auto-scheduling from job creation (Phase D)',
    ],
    relatedPanels: ['Calendar tab'],
  },
  {
    feature: 'Service call logging',
    description: 'Log service calls with client, description, hours, materials, collected amount',
    agents: ['LEDGER'],
    voiceTriggerable: false,
    currentlyWorking: true,
    limitations: ['Manual entry only — no voice-to-service-log creation yet'],
    relatedPanels: ['Service Calls tab'],
  },
  {
    feature: 'Project management',
    description: 'Track projects through phases, RFIs, coordination, MTO, estimates',
    agents: ['BLUEPRINT'],
    voiceTriggerable: false,
    currentlyWorking: true,
    limitations: ['Phase updates manual', 'No automatic phase progression'],
    relatedPanels: ['Projects tab', 'Active Project panel'],
  },
  {
    feature: 'Financial dashboard',
    description: 'KPI cards, CFOT chart, EVR chart, revenue vs cost, collection rate',
    agents: ['PULSE', 'LEDGER'],
    voiceTriggerable: true,
    currentlyWorking: true,
    limitations: ['Weekly Proj + Weekly SVC not yet pulling from actual logs'],
    relatedPanels: ['Graph Dashboard', 'Money tab'],
  },
  {
    feature: 'Estimating and price book',
    description: 'Build estimates from 240+ item price book, RMO adder calculations, MTO',
    agents: ['VAULT'],
    voiceTriggerable: false,
    currentlyWorking: true,
    limitations: ['Voice-triggered estimate building not yet implemented'],
    relatedPanels: ['Estimating tab', 'Price Book tab'],
  },
  {
    feature: 'Memory buckets',
    description: 'Create named capture containers, save voice notes, retrieve by name',
    agents: ['NEXUS'],
    voiceTriggerable: true,
    currentlyWorking: true,
    limitations: ['New feature — being tested'],
    relatedPanels: ['Voice session'],
  },
  {
    feature: 'NEC compliance coaching',
    description: 'Ask OHM about NEC 2023, OSHA, Title 24, CBC requirements',
    agents: ['OHM'],
    voiceTriggerable: true,
    currentlyWorking: true,
    limitations: ['Research only — no auto-population of compliance items yet'],
    relatedPanels: ['NEXUS Voice Session'],
  },
  {
    feature: 'Operational briefing',
    description: 'Ask how business is doing — two-bucket briefing with projects, service calls, milestone, handoff',
    agents: ['NEXUS', 'BLUEPRINT', 'LEDGER'],
    voiceTriggerable: true,
    currentlyWorking: true,
    limitations: [],
    relatedPanels: ['NEXUS Voice Session'],
  },
  {
    feature: 'Web research and industry benchmarks',
    description: 'NEXUS can search the web to compare your business against industry standards, lookup certifications, research NEC codes',
    agents: ['NEXUS'],
    voiceTriggerable: true,
    currentlyWorking: true,
    limitations: ['One search per query to control token cost'],
    relatedPanels: ['NEXUS Voice Session'],
  },
  {
    feature: 'Strategic branch analysis',
    description: 'Ask broad business questions and get 4 tappable strategic directions to explore',
    agents: ['NEXUS'],
    voiceTriggerable: true,
    currentlyWorking: true,
    limitations: ['Branch deep dive requires tap on card'],
    relatedPanels: ['NEXUS Voice Session'],
  },
  {
    feature: 'Leads management',
    description: 'Log leads with source, status, estimated value, follow-up tracking',
    agents: ['SPARK'],
    voiceTriggerable: false,
    currentlyWorking: true,
    limitations: [
      'No auto-lead scoring yet (V3)',
      'No market analysis or lead sourcing yet (V3)',
      'No voice-to-lead creation',
    ],
    relatedPanels: ['Leads tab'],
  },
  {
    feature: 'Cross-device sync',
    description: 'All data syncs to Supabase in real time across iPhone, iPad, Windows',
    agents: [],
    voiceTriggerable: false,
    currentlyWorking: true,
    limitations: ['30-second sync interval'],
    relatedPanels: ['All panels'],
  },
]

export function searchCapabilities(query: string): AppCapability[] {
  const q = query.toLowerCase()
  return APP_CAPABILITY_MAP.filter(cap =>
    cap.feature.toLowerCase().includes(q) ||
    cap.description.toLowerCase().includes(q) ||
    cap.relatedPanels.some(p => p.toLowerCase().includes(q)) ||
    cap.agents.some(a => a.toLowerCase().includes(q)) ||
    cap.limitations.some(l => l.toLowerCase().includes(q))
  )
}

export function getCapabilityAnswer(query: string): string | null {
  // Extract meaningful keywords from the query
  const keywords = query.toLowerCase()
    .replace(/(?:can you|do you|does the app|is there|do I have|can I|able to|feature|capability|currently|support|check if|look for|find|anywhere in the app)/gi, '')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 2)

  // Search each keyword individually and collect matches
  const matchedCaps = new Set<AppCapability>()
  for (const keyword of keywords) {
    for (const cap of searchCapabilities(keyword)) {
      matchedCaps.add(cap)
    }
  }

  // Also try the full cleaned query
  for (const cap of searchCapabilities(keywords.join(' '))) {
    matchedCaps.add(cap)
  }

  const results = Array.from(matchedCaps)
  if (!results.length) return null

  return results.map(cap => {
    const status = cap.currentlyWorking ? 'Built and working' : 'Planned'
    const voice = cap.voiceTriggerable ? 'Voice-accessible' : 'Manual only'
    const limits = cap.limitations.length
      ? `\nLimitations: ${cap.limitations.join('; ')}`
      : ''
    return `**${cap.feature}** — ${status} (${voice})\n${cap.description}${limits}`
  }).join('\n\n')
}
