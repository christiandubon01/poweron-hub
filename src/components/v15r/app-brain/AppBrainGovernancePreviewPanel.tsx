/**
 * App Brain Governance Preview Panel
 * 
 * Read-only governance preview component showing:
 * - Clean rules summary (v4.0 law stack active)
 * - Fresh skills registry overview
 * - Archive status (reference-only notation)
 * - Friction level distribution
 * - Helper function examples
 * 
 * Self-contained, not yet imported into V15rAppBrainTab.
 * No edit UI. No old PDF import.
 * 
 * Last Updated: 2026-06-07
 */

import React, { useMemo } from 'react'
import {
  buildGovernanceSummary,
  buildCleanRulesSet,
  buildSkillsRegistrySummary,
  getArchiveReferences,
  FRICTION_CONCEPTS,
  countRulesByFriction,
  countDomainRulesByFriction,
  countFileTypeRulesByFriction,
  countSessionTypeRulesByFriction,
  countAgentRulesByFriction,
  countSkillsActiveInactive,
  countSkillsByDomain,
  countSkillsByConfidence,
  type GovernanceSummary,
  type CleanRulesSet,
  type SkillsRegistrySummary,
} from './appBrainGovernanceSummary'

import type { FrictionLevel } from './appBrainRulesTypes'

// ============================================================================
// COMPONENT STATE & TYPES
// ============================================================================

interface GovernancePreviewPanelProps {
  className?: string
  showDetailedBreakdown?: boolean
}

type PreviewTab = 'summary' | 'rules' | 'skills' | 'archives'

// ============================================================================
// FRICTION DISPLAY COMPONENT
// ============================================================================

interface FrictionBadgeProps {
  level: FrictionLevel
  count?: number
  compact?: boolean
}

function FrictionBadge({ level, count, compact = false }: FrictionBadgeProps) {
  const concept = FRICTION_CONCEPTS[level]
  if (!concept) return null

  return (
    <div
      className={`rounded px-2 py-1 text-xs font-medium ${compact ? '' : 'flex items-center gap-2'}`}
      style={{
        backgroundColor: concept.bgColor.replace('bg-', '').toLowerCase(),
        color: concept.color.replace('text-', '').toLowerCase(),
      }}
    >
      {compact ? (
        <span>{concept.label}</span>
      ) : (
        <>
          <span className="font-bold">{concept.label}</span>
          {count !== undefined && <span className="text-gray-600">({count})</span>}
        </>
      )}
    </div>
  )
}

// ============================================================================
// STATS CARD COMPONENT
// ============================================================================

interface StatsCardProps {
  title: string
  value: number
  unit?: string
  color?: string
}

function StatsCard({ title, value, unit = '', color = 'text-blue-600' }: StatsCardProps) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white">
      <div className="text-sm font-medium text-gray-600">{title}</div>
      <div className={`text-3xl font-bold ${color} mt-2`}>
        {value}
        {unit && <span className="text-lg ml-1">{unit}</span>}
      </div>
    </div>
  )
}

// ============================================================================
// SUMMARY TAB
// ============================================================================

interface SummaryTabProps {
  summary: GovernanceSummary
}

function SummaryTab({ summary }: SummaryTabProps) {
  return (
    <div className="space-y-6 p-4">
      {/* Header */}
      <div className="border-b border-gray-200 pb-4">
        <h3 className="text-lg font-bold text-gray-900">Governance Status</h3>
        <p className="text-sm text-gray-600 mt-1">{summary.sourceNote}</p>
        <p className="text-xs text-gray-500 mt-2">Generated: {new Date(summary.timestamp).toLocaleString()}</p>
      </div>

      {/* Status Indicators */}
      <div className="grid grid-cols-3 gap-3">
        <div className={`rounded-lg p-3 ${summary.cleanRulesActive ? 'bg-green-50 border border-green-200' : 'bg-gray-50'}`}>
          <div className="text-xs font-medium text-gray-600">Clean Rules</div>
          <div className={`text-lg font-bold mt-1 ${summary.cleanRulesActive ? 'text-green-600' : 'text-gray-600'}`}>
            {summary.cleanRulesActive ? '✓ Active' : 'Inactive'}
          </div>
        </div>
        <div className={`rounded-lg p-3 ${summary.skillsRegistryActive ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50'}`}>
          <div className="text-xs font-medium text-gray-600">Skills Registry</div>
          <div className={`text-lg font-bold mt-1 ${summary.skillsRegistryActive ? 'text-blue-600' : 'text-gray-600'}`}>
            {summary.skillsRegistryActive ? '✓ Active' : 'Inactive'}
          </div>
        </div>
        <div className={`rounded-lg p-3 ${summary.archivesReferenceOnly ? 'bg-yellow-50 border border-yellow-200' : 'bg-gray-50'}`}>
          <div className="text-xs font-medium text-gray-600">Archives</div>
          <div className={`text-lg font-bold mt-1 ${summary.archivesReferenceOnly ? 'text-yellow-600' : 'text-gray-600'}`}>
            {summary.archivesReferenceOnly ? 'Reference' : 'Active'}
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Quick Stats</h4>
        <div className="grid grid-cols-2 gap-3">
          <StatsCard title="Total Rules" value={summary.stats.totalGlobalRules + summary.stats.totalDomainRules + summary.stats.totalFileTypeRules + summary.stats.totalSessionRules} color="text-blue-600" />
          <StatsCard title="Total Skills" value={summary.stats.totalSkills} color="text-purple-600" />
          <StatsCard title="Block Rules" value={summary.stats.blockFrictionRules} color="text-red-600" />
          <StatsCard title="Active Skills" value={summary.stats.activeSkills} color="text-green-600" />
        </div>
      </div>

      {/* Friction Distribution */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Friction Level Distribution</h4>
        <div className="space-y-3">
          {(['silent', 'warn', 'confirm', 'block'] as FrictionLevel[]).map(level => (
            <div key={level} className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-1">
                <FrictionBadge level={level} compact />
                <div className="flex-1">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${
                        level === 'silent' ? 'bg-gray-500' :
                        level === 'warn' ? 'bg-yellow-500' :
                        level === 'confirm' ? 'bg-blue-500' :
                        'bg-red-500'
                      }`}
                      style={{
                        width: `${Math.max(5, (summary.frictionLevels[level].count / (summary.stats.blockFrictionRules + summary.stats.warnFrictionRules + summary.stats.confirmFrictionRules + summary.stats.silentFrictionRules)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
              <div className="text-sm font-medium text-gray-700 ml-3 whitespace-nowrap">
                {summary.frictionLevels[level].count} rules
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Friction Concepts */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Friction Concepts</h4>
        <div className="space-y-2 text-sm">
          {(['silent', 'warn', 'confirm', 'block'] as FrictionLevel[]).map(level => {
            const concept = FRICTION_CONCEPTS[level]
            return (
              <div key={level} className="border border-gray-200 rounded-lg p-2 bg-gray-50">
                <div className="flex items-center gap-2 mb-1">
                  <FrictionBadge level={level} compact />
                  <span className="font-medium text-gray-700">{concept.description}</span>
                </div>
                <div className="text-xs text-gray-600 ml-2">{concept.use}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// RULES TAB
// ============================================================================

interface RulesTabProps {
  rulesSet: CleanRulesSet
}

function RulesTab({ rulesSet }: RulesTabProps) {
  const globalFriction = countRulesByFriction(rulesSet.globalRules)
  const domainFriction = countDomainRulesByFriction(rulesSet.domainRules)
  const fileTypeFriction = countFileTypeRulesByFriction(rulesSet.fileTypeRules)
  const sessionFriction = countSessionTypeRulesByFriction(rulesSet.sessionTypeRules)
  const agentFriction = countAgentRulesByFriction(rulesSet.agentRules)

  return (
    <div className="space-y-6 p-4">
      {/* Global Rules */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center justify-between">
          <span>Global Rules</span>
          <span className="text-xs font-normal text-gray-500">{rulesSet.globalRules.length} total</span>
        </h4>
        <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2">
          {rulesSet.globalRules.slice(0, 5).map(rule => (
            <div key={rule.id} className="text-sm">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-gray-700">{rule.name}</span>
                <FrictionBadge level={rule.friction} compact />
              </div>
              <div className="text-xs text-gray-600 ml-1">{rule.description}</div>
            </div>
          ))}
          {rulesSet.globalRules.length > 5 && (
            <div className="text-xs text-gray-500 pt-2 mt-2 border-t border-gray-200">
              +{rulesSet.globalRules.length - 5} more rules
            </div>
          )}
        </div>
      </div>

      {/* Domain Rules */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center justify-between">
          <span>Domain Rules</span>
          <span className="text-xs font-normal text-gray-500">{rulesSet.domainRules.length} total</span>
        </h4>
        <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2">
          {rulesSet.domainRules.slice(0, 4).map(rule => (
            <div key={rule.id} className="text-sm">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-gray-700">{rule.domain}</span>
                <FrictionBadge level={rule.friction} compact />
              </div>
              <div className="text-xs text-gray-600 ml-1">{rule.description}</div>
            </div>
          ))}
          {rulesSet.domainRules.length > 4 && (
            <div className="text-xs text-gray-500 pt-2 mt-2 border-t border-gray-200">
              +{rulesSet.domainRules.length - 4} more domains
            </div>
          )}
        </div>
      </div>

      {/* Agent Rules Preview */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Agent Rules Preview</h4>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(rulesSet.agentRules).slice(0, 4).map(([agentId, agent]) => (
            <div key={agentId} className="border border-gray-200 rounded-lg p-2 bg-gray-50 text-sm">
              <div className="font-medium text-gray-700">{agent.agentName}</div>
              <div className="text-xs text-gray-600">{agent.role}</div>
              <div className="text-xs text-gray-500 mt-1">{agent.ruleCount} rules</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// SKILLS TAB
// ============================================================================

interface SkillsTabProps {
  skillsSummary: SkillsRegistrySummary
}

function SkillsTab({ skillsSummary }: SkillsTabProps) {
  return (
    <div className="space-y-6 p-4">
      {/* Registry Metadata */}
      <div className="border border-gray-200 rounded-lg p-4 bg-blue-50">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Skills Registry Metadata</h4>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">Registry Version:</span>
            <span className="font-medium text-gray-900">{skillsSummary.version}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Created:</span>
            <span className="font-medium text-gray-900 text-xs">{new Date(skillsSummary.createdAt).toLocaleDateString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Last Updated:</span>
            <span className="font-medium text-gray-900 text-xs">{new Date(skillsSummary.lastUpdatedAt).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      {/* Skills Overview */}
      <div className="grid grid-cols-3 gap-3">
        <StatsCard title="Total Skills" value={skillsSummary.totalSkills} color="text-blue-600" />
        <StatsCard title="Active" value={skillsSummary.activeSkills} color="text-green-600" />
        <StatsCard title="Inactive" value={skillsSummary.inactiveSkills} color="text-gray-600" />
      </div>

      {/* Skills by Domain */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Skills by Domain</h4>
        <div className="space-y-2">
          {Object.entries(skillsSummary.byDomain).map(([domain, count]) => (
            <div key={domain} className="flex items-center justify-between text-sm border border-gray-200 rounded p-2 bg-gray-50">
              <span className="text-gray-700 font-medium">{domain}</span>
              <span className="text-gray-600">{count} skill{count !== 1 ? 's' : ''}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Skills by Confidence */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Skills by Confidence</h4>
        <div className="space-y-2">
          {Object.entries(skillsSummary.byConfidence).map(([bucket, count]) => (
            <div key={bucket} className="flex items-center justify-between text-sm border border-gray-200 rounded p-2 bg-gray-50">
              <span className="text-gray-700 font-medium">{bucket}</span>
              <span className="text-gray-600">{count} skill{count !== 1 ? 's' : ''}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// ARCHIVES TAB
// ============================================================================

function ArchivesTab() {
  const archives = getArchiveReferences()

  return (
    <div className="space-y-6 p-4">
      <div className="border-l-4 border-yellow-400 bg-yellow-50 p-4 rounded">
        <h4 className="text-sm font-semibold text-yellow-900 mb-2">⚠️ Archives are Reference-Only</h4>
        <p className="text-xs text-yellow-800">
          Old laws and skills archives are provided for historical reference. They do not represent active execution rules.
          Active rules come from the v4.0 law stack in APP_BRAIN_GLOBAL_RULES.json and APP_BRAIN_SKILLS.json.
        </p>
      </div>

      {/* Archive List */}
      <div className="space-y-3">
        {archives.map(archive => (
          <div key={archive.archiveType} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <div className="flex items-start justify-between mb-2">
              <div>
                <h5 className="font-semibold text-gray-900 text-sm">{archive.archiveType}</h5>
                <p className="text-xs text-gray-600 mt-1">{archive.description}</p>
              </div>
              <span className={`text-xs font-medium px-2 py-1 rounded ${
                archive.status === 'reference-only' 
                  ? 'bg-yellow-100 text-yellow-800' 
                  : 'bg-gray-200 text-gray-800'
              }`}>
                {archive.status}
              </span>
            </div>
            <div className="text-xs text-gray-600 mt-2">
              <div className="font-medium">Location: {archive.location}</div>
              <div className="mt-1">{archive.note}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Helper Functions Info */}
      <div className="border border-gray-200 rounded-lg p-4 bg-blue-50 text-sm">
        <h5 className="font-semibold text-gray-900 mb-2">Available Helper Functions</h5>
        <div className="space-y-1 text-xs text-gray-700 font-mono">
          <div>• countRulesByFriction(rules)</div>
          <div>• countDomainRulesByFriction(rules)</div>
          <div>• countFileTypeRulesByFriction(rules)</div>
          <div>• countSkillsActiveInactive(skills)</div>
          <div>• countSkillsByDomain(skills)</div>
          <div>• countSkillsByConfidence(skills)</div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const AppBrainGovernancePreviewPanel: React.FC<GovernancePreviewPanelProps> = ({
  className = '',
  showDetailedBreakdown = false,
}) => {
  const [activeTab, setActiveTab] = React.useState<PreviewTab>('summary')

  const summary = useMemo(() => buildGovernanceSummary(), [])
  const rulesSet = useMemo(() => buildCleanRulesSet(), [])
  const skillsSummary = useMemo(() => buildSkillsRegistrySummary(), [])

  return (
    <div className={`flex flex-col h-full bg-white border border-gray-200 rounded-lg shadow-sm ${className}`}>
      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-4">
        <h2 className="text-lg font-bold text-gray-900">Governance Preview</h2>
        <p className="text-xs text-gray-500 mt-1">Read-only preview of App Brain governance foundation</p>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 px-6">
        <div className="flex gap-4">
          {(['summary', 'rules', 'skills', 'archives'] as PreviewTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'summary' && <SummaryTab summary={summary} />}
        {activeTab === 'rules' && <RulesTab rulesSet={rulesSet} />}
        {activeTab === 'skills' && <SkillsTab skillsSummary={skillsSummary} />}
        {activeTab === 'archives' && <ArchivesTab />}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-200 px-6 py-3 text-xs text-gray-500">
        <div className="flex items-center justify-between">
          <span>Self-contained governance preview — read-only</span>
          <span>v1.0.0</span>
        </div>
      </div>
    </div>
  )
}

export default AppBrainGovernancePreviewPanel
