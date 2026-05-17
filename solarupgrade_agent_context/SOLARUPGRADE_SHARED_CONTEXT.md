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
Not started.