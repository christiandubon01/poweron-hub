# SOLARUPGRADE_SHARED_CONTEXT.md

Branch:
solarupgrade

Goal:
Upgrade the Solar Training area in phases while keeping the existing subtabs and adding a new `Solar Estimate` subtab after `Retention`.

Existing subtabs to preserve:
1. Certifications
2. Training Modes
3. Scores
4. Rules Library
5. Quick Quiz
6. NEM 3.0
7. Retention

New subtab to add later:
8. Solar Estimate

User requirements:
- Keep work scoped.
- Avoid broad refactors.
- Match premium PowerOn dark visual language.
- Preserve existing calculations and behavior unless explicitly scoped.
- Fix Retention crash first.
- Build Solar Estimate in multiple phases.
- Each agent must update its context file and this shared context after each phase.
- Each agent must commit scoped files only.
- Each phase prompt must follow the user’s standard template.

Solar Estimate long-term target:
- Add address input.
- Use Google address suggestions/autocomplete.
- After address save, render map with location pin.
- Add shading selection:
  - No shade on my roof
  - A little shade on my roof
  - A lot of shade on my roof
- Add rent/own selection.
- Add property type:
  - Single family home
  - Condo/apartment
  - Mobile home
  - Commercial
- Add energy consumption interview:
  - Average electric bill
  - Home size
- Keep providers:
  - Southern California Edison Co
  - Imperial Irrigation District
- Use appropriate rates depending on location/provider.
- Use existing app rate data first if present.
- SCE rate option reference includes names such as `TOU-D-PRIME-NEM3`.
- Add system configuration:
  - Solar Only
  - Solar Plus Battery
- No solar item/catalog build in early phases.
- Generate estimate summary page later with:
  - system size
  - cost
  - savings breakdown
  - NEM 3.0-style graph/bill comparison
  - editable system configuration from summary page
  - bottom adjustable solar size and battery size controls inspired by Enphase reference

Privacy / external request requirement:
If inspecting public websites or docs for implementation details, do it anonymously and do not send customer/private app data. Prefer existing local code and existing local data over external requests.

Phase order:
1. Claude: audit Solar Training and fix Retention crash.
2. Codex: add Solar Estimate subtab shell only.
3. Claude: review shell, tighten integration, document component map.
4. Codex: build Solar Estimate interview flow.
5. Claude/Codex: summary page, edit controls, polish, final integration.

Latest phase status:
Phase 1 complete. Retention crash fixed. Solar Training audit complete. Ready for Phase 2 (Codex: add Solar Estimate shell).

## Phase 1 Audit Findings

### File Map
- **Main parent:** `src/views/SolarTrainingView.tsx` — has `// @ts-nocheck`; 7 subtabs rendered via `activeTab` state; all subtab panels are self-contained sub-components in the same file except NEM3Visualizer, SolarRetentionHeatmap, SolarQuizCard
- **Retention tab component:** `src/components/solarTraining/SolarRetentionHeatmap.tsx` — expects `topics`, `periods`, `data` props; renders a heatmap grid; fixed crash here
- **Quiz engine:** `src/services/solarTraining/SolarQuizEngine.ts`
- **Curriculum sequencer:** `src/services/solarTraining/SolarCurriculumSequencer.ts`
- **Retention tracker:** `src/services/solarTraining/SolarRetentionTracker.ts` — localStorage-first, Supabase sync stub not yet wired
- **NEM3 calculator:** `src/services/solarTraining/SolarNEM3Calculator.ts` — do not touch formulas
- **Daily scheduler:** `src/services/solarTraining/SolarDailyScheduler.ts`
- **Nexus integration:** `src/services/solarTraining/SolarNexusIntegration.ts`
- **NEM3 visualizer:** `src/components/solarTraining/NEM3Visualizer.tsx`
- **Quiz card:** `src/components/solarTraining/SolarQuizCard.tsx`

### Tab IDs (SolarTab type)
`certifications` | `training` | `scores` | `rules` | `quiz` | `nem3` | `progress`

The tab with label "Retention" uses id `progress` (legacy name).

### State / Data Flow
- `SolarTrainingView` holds only `activeTab` state; each panel manages its own state
- Supabase tables: `solar_certifications`, `solar_scenarios`, `solar_training_sessions`, `solar_rules`, `solar_study_queue`, `solar_debriefs`
- Retention heatmap receives NO data from Supabase in current implementation — called with zero props; shows empty/CTA state after fix
- No localStorage or persistence touches in the view itself (persistence is in SolarRetentionTracker service, not wired to the heatmap)

### Retention Crash Root Cause
`<SolarRetentionHeatmap />` was called with no props (line 1061 of SolarTrainingView.tsx). The component already had `safeTopics/safePeriods/safeData` guards at lines 123–125, but lines 253, 260, and 333 still referenced the raw `data` prop directly — `data.length`, `data.flat()`, `data.every()` — crashing on `undefined.length`.

### Fix Applied
`src/components/solarTraining/SolarRetentionHeatmap.tsx`:
1. Made `topics`, `periods`, `data` optional (`?`) in `SolarRetentionHeatmapProps`
2. Replaced `data.length` → `safeData.length` (line ~253)
3. Replaced `data.flat()` → `safeData.flat()` (line ~260)
4. Replaced `data.every(...)` → `safeData.every(...)` (line ~333)

### For Phase 2 (Solar Estimate Shell)
- Add new tab id `estimate` with label `Solar Estimate` and emoji `☀️` to the `TABS` array in `SolarTrainingView.tsx` after the `progress` entry (line ~1015)
- Render it in the panel content section after `progress` tab (line ~1061)
- Create `src/components/solarTraining/SolarEstimateTab.tsx` as the shell component
- The parent file has `// @ts-nocheck` so TypeScript errors in new JSX won't block typecheck, but new service/component files should be properly typed
- Keep existing tab order intact; Solar Estimate goes last (position 8)