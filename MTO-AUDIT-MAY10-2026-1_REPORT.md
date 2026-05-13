# MTO-AUDIT-MAY10-2026-1 — Material Takeoff Render Path Forensic Audit

**Date:** 2026-05-10
**Type:** Read-only forensic audit (no code changes)
**Governance:** v5.0 Concept Audit Protocol
**Codebase root:** `C:\Users\chris\Desktop\Power On Hub\Power On Solutions APP - CoWork`

---

## Executive Summary

**The hypothesis from the previous session is DISPROVEN.**

The suspected root cause was "stale body-scope assignment of `backup` in V15rProjectInner line 57 and V15rMTOTab line 59, with render helpers closing over a one-shot allRows array." Code inspection shows this hypothesis does not hold:

- `backup` in both files is read on every render (body scope re-executes on each render), and parent V15rProjectInner has a working subscription to `poweron-data-saved` that forces re-renders on every save.
- `renderPhaseGroups` and `renderPlacementGroups` are redefined on every render, so they always close over the *current* `allRows`, never a stale snapshot.
- `getBackupData()` has **no in-memory cache** — every call parses fresh from `localStorage`. Both tabs read the same key.

**The actual divergence that explains the symptom is structural, not stale-closure:**

1. The empty-state branch added in the previous session at lines 1060–1069 of `V15rMTOTab.tsx` *does render a table head with no body* — meaning the visible symptom ("empty table headers but no rows") **is the empty-state branch firing**, i.e. `hasAnyRows === false` at MTO render time.
2. `V15rMTOTab` **ignores the `backup` prop passed by its parent** (line 14 destructures it as `initialBackup` but line 52 unconditionally calls `getBackupData()`), whereas `V15rEstimateTab` uses `initialBackup || getBackupData()` (line 18). This is the **only material read-path difference** between the two tabs.
3. If `p.mtoRows` is empty in MTO but populated in Estimate at the same moment, the cause is either: (a) the `$1,104.83` Estimate-tab number is sourced from a different place than `p.mtoRows` (e.g. `calculateProjectFinancials` from `backup.logs`, not from MTO data), so the two reads are not actually reading the same field; or (b) `backup.projects.find(x => x.id === projectId)` is returning a different `p` object than expected (duplicate-id race, stale projectId before tenant hydration, or a wrong-tenant key write).

The next session should target (3) — *not* a render-closure rewrite.

---

## PHASE A — Read-path reconciliation (Estimate vs MTO)

### A1. `V15rEstimateTab.tsx`

| Question | Answer | Line |
|---|---|---|
| How is `backup` obtained? | Prop with fallback: `const backup = initialBackup || getBackupData()` | 18 |
| Where is `p` obtained? | `backup.projects.find(x => x.id === projectId)` | 60 |
| How is `mtoRows` accessed? | Directly via `(proj.mtoRows || [])` inside `getMTOActivePhaseBreakdown(proj)` | 68 |
| Read scope? | Body scope — re-runs every render | — |
| Subscription to data saves? | **None.** No `useEffect` listening to `poweron-data-saved`. Relies entirely on parent re-render to refresh. | — |

### A2. `V15rMTOTab.tsx`

| Question | Answer | Line |
|---|---|---|
| How is `backup` obtained? | `const backup = getBackupData()` — **prop ignored** | 52 |
| Where is `p` obtained? | `backup.projects.find(x => x.id === projectId)` | 55 |
| How is `mtoRows` accessed? | `const allRows: any[] = p.mtoRows \|\| []` | 59 |
| Read scope? | Body scope — re-runs every render | — |
| Subscription? | One `useEffect(() => { forceUpdate() }, [projectId])` at line 61 (indented at column 0 — looks like an emergency patch). No subscription to `poweron-data-saved`. | 61 |

Note: prop is destructured as `initialBackup` at line 14 but never read.

### A3. `V15rEstimateMTO.tsx` (price-book panel — not the project-detail bridge)

| Question | Answer | Line |
|---|---|---|
| How is `backup` obtained? | `const backup = getBackupData()` (no prop) | 22 |
| Reads project `mtoRows`? | **No** — reads `backup.priceBook` only | 25–27 |

This component is unrelated to the bug. It only iterates the global price book; it is not the read path under inspection.

### A4. Side-by-side comparison

| Component | `backup` source | project lookup | rows access | scope | save-event subscription |
|---|---|---|---|---|---|
| `V15rEstimateTab` | `initialBackup \|\| getBackupData()` (line 18) | `backup.projects.find(x => x.id === projectId)` (line 60) | `(proj.mtoRows \|\| [])` inside `getMTOActivePhaseBreakdown` (line 68) | body | none — relies on parent |
| `V15rMTOTab` | `getBackupData()` (line 52) — **prop ignored** | `backup.projects.find(x => x.id === projectId)` (line 55) | `p.mtoRows \|\| []` (line 59) | body | none — relies on parent + a `useEffect([projectId])` self-forceUpdate at line 61 |
| `V15rProjectInner` (parent) | `(hasHydrated && isDemoMode) ? getDemoBackupData() : getBackupData()` (line 58) | `backup.projects.find(x => x.id === projectId)` (line 61) | n/a (passes `backup` and `projectId` as props) | body | **yes** — `useEffect` adding listener for `poweron-data-saved` calls `forceUpdate` (lines 52–56) |

**The only material difference in the read path** is that `V15rEstimateTab` uses the prop first (`initialBackup || …`) while `V15rMTOTab` ignores the prop and re-fetches. In practice both ultimately get their data from the same `getBackupData()` (which reads fresh localStorage), so the difference can only matter if (i) the prop and a subsequent `getBackupData()` return different objects (impossible without an intervening write), or (ii) parent and child render at different reactivity boundaries (parent re-renders, child doesn't).

---

## PHASE B — Prop/state chain up from V15rMTOTab

### B1. How V15rMTOTab is rendered

`V15rProjectInner.tsx` line 158:
```tsx
<ActiveComponent projectId={projectId} onUpdate={forceUpdate} backup={backup} />
```

`ActiveComponent` resolves at line 78:
```tsx
const ActiveComponent = tabs.find(t => t.id === localTab)?.component || V15rEstimateTab
```

So `V15rMTOTab` receives:
- `projectId` — straight from the prop the parent received from `AppShell` (`activeProjectId`)
- `onUpdate` — parent's `forceUpdate` callback
- `backup` — the parent's body-scope `backup` const

No memoization is applied. There is **no `React.memo` wrapper** on `V15rMTOTab`, `V15rProjectInner`, or `V15rEstimateTab` (grep confirms zero occurrences).

### B2. V15rProjectInner lines 50–100 (full text already captured above)

The relevant lines:
```tsx
51  // Re-render when remote data sync fires (cross-device realtime updates)
52  React.useEffect(() => {
53    const handler = () => forceUpdate()
54    window.addEventListener('poweron-data-saved', handler)
55    return () => window.removeEventListener('poweron-data-saved', handler)
56  }, [forceUpdate])
57
58  const backup = (hasHydrated && isDemoMode) ? getDemoBackupData() : getBackupData()
```

Line 58 is **body scope** (not wrapped in `useMemo`). It re-executes on every render of `V15rProjectInner`. **It is NOT a stale assignment** — each render produces a fresh `backup`.

The task text quotes "line 57" for `V15rProjectInner` and "line 59" for `V15rMTOTab`. In the *current* file, those exact lines are blank or off by one (`V15rProjectInner` line 57 is blank; the `backup` assignment is line 58). This is likely line-numbering drift from a prior in-session edit. Either way, the assignment is body-scope, not inside a memo.

### B3. What triggers V15rProjectInner re-render?

- `propActiveTab` change (parent `AppShell` switching views)
- `localTab` change (user clicking a tab button — line 41 `useState`)
- `tick` increment from `forceUpdate` (line 42–43, 53)
- `useDemoMode` hook subscription state change (line 40)
- `useEffect` at lines 46–49 calling `setLocalTab` after prop change

The `poweron-data-saved` listener (line 52–56) **does** trigger a re-render via `forceUpdate` whenever `saveBackupData(...)` is called anywhere in the app (since that function dispatches the event at line 616 of `backupDataService.ts`).

**Conclusion:** V15rProjectInner *does* re-render when data is saved. Line 58 *does* re-read the latest `backup`. The "stale body-scope" hypothesis fails on its own terms.

---

## PHASE C — Data layer: `getBackupData()`

### C1. Is there an in-memory cache?

**No.** `getBackupData` at `backupDataService.ts` line 465 begins:
```ts
const key = getEffectiveStorageKey(userId)
const raw = localStorage.getItem(key)
if (raw) {
  const data = JSON.parse(raw) as BackupData & ...
  ...
  return data as BackupData
}
```

Every call performs a `localStorage.getItem(...)` + `JSON.parse(...)`. There is **no module-level `cachedBackup` variable**. Module-level state is limited to:
- `_activeTenantUserId` (which key to read from — set by `setActiveTenantUser`, called from `loadFromSupabase` line 1368)
- `_tenantDataReady` (gate flag — does not affect reads)
- `_lastSyncMeta`, `_saveDebounceTimer`, `_dataChanged`, `_lastSyncedAt`, `_changedKeys` (sync orchestration)

Therefore: **two consecutive `getBackupData()` calls return objects with the same `mtoRows` length as long as `localStorage` was not mutated between them.**

### C2. `saveBackupDataSilent` and `saveBackupDataAndSync` callers

`saveBackupDataSilent` (writes localStorage **without** dispatching `poweron-data-saved`):

| File | Line | Context |
|---|---|---|
| `src/services/backupDataService.ts` | 1284 | inside `syncToSupabase` after successful upsert (embeds `_syncMeta`) |
| `src/services/backupDataService.ts` | 1321 | `hydrateRelationshipAccountsIntoLocalProjection` — followed by an explicit `window.dispatchEvent('poweron-data-saved')` at line 1325, so consumers DO get notified for this path |
| `src/services/backupDataService.ts` | 1389 | `loadFromSupabase` — first-time seed of empty cache |
| `src/services/backupDataService.ts` | 1403 | `loadFromSupabase` explicit-bootstrap branch (`explicitUserId` path) — no event dispatch in this branch |
| `src/services/backupDataService.ts` | 1419 | `loadFromSupabase` "no local" branch — no event dispatch in this branch |
| `src/services/backupDataService.ts` | 1431 | `loadFromSupabase` forceRemote/remote-newer branch — `hydrateRelationshipAccountsIntoLocalProjection` is awaited after, which dispatches the event |

`saveBackupDataAndSync` (writes + dispatches event + queues Supabase upsert) is used everywhere user-facing writes occur:

| File | Lines |
|---|---|
| `src/components/SnapshotPanel.tsx` | 531 |
| `src/components/v15r/V15rCoordinationTab.tsx` | 94, 120 |
| `src/components/v15r/V15rEstimateTab.tsx` | 362, 1669 |
| `src/components/v15r/V15rLeadsPanel.tsx` | 249, 355, 383, 713 |
| `src/components/v15r/V15rMoneyPanel.tsx` | 236 |
| `src/components/v15r/V15rProjectsPanel.tsx` | 275, 373, 422, 469 |
| `src/services/blueprintLibraryService.ts` | 245, 269, 504 (via `saveBackupDataAndSyncNow`) |

**Notable:** `V15rMTOTab` does **not** use `saveBackupDataAndSync`. It only uses `saveBackupData` (e.g. `editMTORow` line 77, `addMTORow` line 95, `delMTORow` line 105, `confirmAddToPriceBook` line 174, `doApplyBulk` line 218). `saveBackupData` does fire `poweron-data-saved`, but it does **not** queue a Supabase upsert — meaning MTO edits only push to Supabase via the 13-second periodic sync (`SYNC_INTERVAL_MS` in backupDataService line 105). That's a separate concern, not the visible bug, but worth noting for a follow-up audit.

### C3. Can `getBackupData()` return a `projects[i].mtoRows` that differs from raw localStorage parse?

**No** — they are the same operation. `getBackupData()` is `localStorage.getItem(key)` + `JSON.parse` + the inline migrations on lines 478–568 (priceBook reconciliation, `serviceLogs.statusEvents` backfill, paid-scalar backfill). **None of these migrations touch `mtoRows`** on any project. The function returns the parsed object directly (line 569) without ever rewriting `mtoRows`.

So if `JSON.parse(localStorage.getItem('poweron_backup_data_<userId>')).projects[i].mtoRows` is a 56-element array, `getBackupData().projects.find(x => x.id === <id>).mtoRows` is also a 56-element array — **provided `<id>` matches the same project**.

This is the load-bearing caveat: **the id used by `.find(...)` must match the id in localStorage.** If `projectId` drift exists, `.find(...)` returns `undefined` and the code falls through to "Project not found" (line 56 of V15rMTOTab). If `.find(...)` returns a *different* project, `p.mtoRows` may be empty even though some other project in the array has 56 rows.

---

## PHASE D — projectId correctness

### D1. projectId chain origin

```
AppShell.tsx line 365:   const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
AppShell.tsx line 769:   function handleSelectProject(projectId: string) { setActiveProjectId(projectId); ... }
AppShell.tsx line 798:   <V15rProjectInner projectId={activeProjectId} ... />
V15rProjectInner.tsx 39: function V15rProjectInner({ projectId, ... })
V15rProjectInner.tsx 158: <ActiveComponent projectId={projectId} ... backup={backup} />
V15rMTOTab.tsx line 14:  function V15rMTOTab({ projectId, ... })
V15rMTOTab.tsx line 55:  const p = backup.projects.find(x => x.id === projectId)
```

The id is a single state variable in `AppShell` (`activeProjectId`), set only via `handleSelectProject(projectId)` (line 769, passed to `V15rProjectsPanel`) or cleared to `null` via `handleCloseProject` / `handleNav` (lines 763, 777). It is passed straight through to MTO without transformation.

### D2. Does the resolved project drift?

`V15rProjectInner` does **not** default to "first project on hydration race." If `backup.projects.find(...)` returns `undefined`, the parent short-circuits to "Project not found" (line 62). It does not pick any other project.

### D3. Hydration race window

`V15rProjectInner` line 58 reads `getBackupData()` immediately when the component renders. If a user navigates into the project view while `_activeTenantUserId` is still `null` (i.e. `loadFromSupabase` hasn't finished setting it via `setActiveTenantUser` at backupDataService line 1368), `getBackupData()` will read from the legacy `poweron_backup_data` key instead of `poweron_backup_data_<userId>`. The legacy key may not contain `mtoRows` for the project, or may contain a stale snapshot.

**This is the most plausible mechanism by which MTO sees zero rows while Estimate sees data**: not stale closures, but tenant-key drift between renders. Specifically, if `V15rEstimateTab`'s `initialBackup` prop was captured AFTER tenant hydration completed (in the parent render that produced the snapshot), but then a later realtime sync (line 1431) writes silently — without dispatching the event in the right order — the prop snapshot held by Estimate could be different from a fresh `getBackupData()` call.

However: `V15rMTOTab` ignores `initialBackup` and re-reads. So in any race condition, MTO would see the LATEST localStorage state, not a stale one. If localStorage really has 56 rows at the moment MTO mounts, `p.mtoRows` should not be empty.

That points to the resolution-by-id question raised in C3: **is `projectId` finding the right `p`?**

---

## PHASE E — Render closure inspection

### E1. `renderPhaseGroups` and `renderPlacementGroups`

`renderPhaseGroups` is defined at `V15rMTOTab.tsx` line 710. `renderPlacementGroups` is defined at line 770. **Both are arrow-function constants declared at body scope** — they are recreated on every render. They close over: `phases`, `allRows`, `getPBItem`, `num`, `backup`, `fmt`, `renderTableHead`, `renderRow`, `addMTORow`. All of those are also body-scope and refreshed on every render. Neither is wrapped in `useCallback`.

**Conclusion:** these helpers always reference the freshest `allRows`. They cannot be holding a stale snapshot.

### E2. `hasAnyRows` / `hasAnyPlacement`

Both are body-scope expressions:
```
180  const hasAnyRows = allRows.length > 0
181  // IMPORTANT: grouping reads ONLY from committed row data, never from localPlacements
182  const hasAnyPlacement = allRows.some(r => r.placement && r.placement.trim())
```

They are recomputed every render from the same `allRows` array as the render helpers. No state, no memo.

### E3. Conditional at line 1058 (actually 1060 in current file)

Verified exact text on disk (lines 1059–1069):
```tsx
{/* MAIN CONTENT — phase view or placement view */}
{hasAnyRows ? (hasAnyPlacement ? renderPlacementGroups() : renderPhaseGroups()) : (
  <div style={{ backgroundColor: '#232738', borderRadius: '8px', marginBottom: '16px', overflow: 'hidden' }}>
    <div style={{ padding: '12px' }}>
      <table style={{ width: '100%', fontSize: '12px', color: 'var(--t2)', borderCollapse: 'collapse' }}>
        {renderTableHead()}
        <tbody />
      </table>
    </div>
  </div>
)}
```

This is the **ternary** form (the `?:` variant), not the previous session's `&&` short-circuit form. The empty branch contains the documented "fix" from the previous session: a single `<table>` with `renderTableHead()` and an empty `<tbody />`. **This exactly matches the user-visible symptom of "empty table headers but no rows".**

The implication is unambiguous: **the empty-state branch is what the user is seeing.** `hasAnyRows` is `false` at render time. The render path is correct; the data input is the problem.

---

## PHASE F — Reactivity / subscription check

### F1. V15rMTOTab subscriptions

```
V15rMTOTab.tsx 61: React.useEffect(() => { forceUpdate() }, [projectId])
```

That is the *only* `useEffect` in the file. It self-forces a re-render whenever `projectId` changes. It does **not** subscribe to any store (no Zustand selector, no React context for backup data, no `poweron-data-saved` listener of its own).

Therefore MTO depends entirely on its parent re-rendering to pick up data changes.

### F2. V15rProjectInner subscriptions

```
V15rProjectInner.tsx 52: React.useEffect(() => {
                        53:   const handler = () => forceUpdate()
                        54:   window.addEventListener('poweron-data-saved', handler)
                        55:   return () => window.removeEventListener('poweron-data-saved', handler)
                        56: }, [forceUpdate])
```

The parent **does** subscribe to `poweron-data-saved`. Every `saveBackupData(...)` (and `saveBackupDataAndSync(...)` via the same path) dispatches the event, the parent re-renders, line 58 re-reads `getBackupData()`, the new `backup` is passed to ActiveComponent. Since MTO ignores that prop and re-fetches anyway, MTO will also re-read the same fresh localStorage at the same instant.

### F3. Comparison

| Concern | V15rEstimateTab | V15rMTOTab |
|---|---|---|
| Own subscription to data saves? | **No** | **No** |
| Self-forceUpdate on `[projectId]`? | No | Yes (line 61) |
| Uses prop `backup`? | **Yes** (with fallback) | **No** — ignored |
| Refresh mechanism | Parent's `poweron-data-saved` listener → parent re-render → new `initialBackup` prop | Parent's `poweron-data-saved` listener → parent re-render → MTO re-renders too, calls `getBackupData()` fresh |

**Both ultimately rely on the parent's listener.** The subscription model is *not* materially different. So the bug is not "MTO doesn't subscribe" — it does, transitively.

---

## Cross-cutting evidence: where does the Estimate tab's "$1,104.83" really come from?

`V15rEstimateTab` reads MTO data in `getMTOActivePhaseBreakdown(proj)` (lines 63–95), which iterates `(proj.mtoRows || [])`. The values `t.matC`, `t.matSellingC` flow from this breakdown (line 96–98) and are rendered in the "Materials by Phase (from MTO)" section (lines 1418–1460). If the user sees a non-zero figure here, **`proj.mtoRows` was non-empty at the moment Estimate rendered**.

However, the `Mat Purchased` value on the Project Summary boxes at the top of the project view comes from `calculateProjectFinancials(project, backup.logs, …)` (ProjectSummaryBoxes.tsx line 55) — **that figure is derived from `backup.logs`, not from `mtoRows`.** It is possible for "$1,104.83" to refer to that box, not to the MTO-derived Estimate section. The next session should disambiguate which figure the user observed.

If the user's "$1,104.83" is from ProjectSummaryBoxes' `Mat Purchased`, that figure is independent of `mtoRows`, and *both* tabs being empty for MTO rows is consistent — meaning the rows in localStorage may not actually be on `p.mtoRows` for this project. This is the most likely scenario.

---

## Hypothesis verdict

> **HYPOTHESIS:** "stale body-scope assignment of `backup` in V15rProjectInner line 57 and V15rMTOTab line 59, with render helpers closing over a one-shot allRows array."

> **VERDICT: DISPROVEN.**

Evidence:
1. `V15rProjectInner` re-renders on `poweron-data-saved` via `forceUpdate` (lines 52–56). Body-scope `backup` is therefore re-evaluated on every save.
2. `V15rMTOTab`'s `allRows`, `renderPhaseGroups`, `renderPlacementGroups`, `hasAnyRows` are *all* body-scope and rebuilt on each render. No stale closure exists.
3. `getBackupData()` has no in-memory cache — it always parses fresh localStorage. The phrase "fresh getBackupData()" describes its default behaviour.

---

## What is actually happening (most likely)

The render path is correct. **The data input is wrong at the moment of MTO render** — specifically, `p.mtoRows` resolves to an empty array even though localStorage appears to have 56 rows somewhere. The plausible mechanisms, in priority order:

1. **The 56 rows are on a different project than `projectId` selects.** `backup.projects.find(x => x.id === projectId)` returns *a* Beauty Salon project that happens to have an empty `mtoRows`, while a different project in the same array has the 56 rows. This could be a duplicate-id artifact, a recent project rename / clone, or a stale `activeProjectId`.

2. **The 56 rows are on a different field on the same project.** `backupDataService.ts` line 185 documents `matRows?: any[]; mtoRows?: any[]` as separate fields. `embeddingService.ts` line 164 falls back: `p.matRows || p.mtoRows || []`. If a migration or import wrote rows to `matRows` (or `laborRows`) and not `mtoRows`, MTO would render empty while other consumers that check both fields still see them. The user's "$1,104.83" Estimate figure could be coming from ProjectSummaryBoxes (`backup.logs` → `Mat Purchased`), not from the MTO breakdown — in which case the two tabs are reading from *different* sources entirely and the Estimate's number is not evidence that `mtoRows` is non-empty.

3. **Tenant-key drift during hydration.** If `_activeTenantUserId` was `null` when V15rMTOTab first rendered (`loadFromSupabase` hadn't yet called `setActiveTenantUser` at line 1368), `getBackupData()` read from the legacy key `poweron_backup_data`, which has a stale or empty `mtoRows`. Once tenant hydration completed and the parent re-rendered, the same MTO body executes and *should* see the correct rows — but the user reports it doesn't. So either (a) the parent's re-render did not propagate (it should — see Phase B/F), or (b) the wrong-tenant data has been *persisted* into the active-tenant key by an earlier silent save, contaminating localStorage.

4. **The user's localStorage inspection key may not be the active-tenant key.** "localStorage confirming 56 mtoRows" likely came from inspecting `poweron_backup_data` (the legacy key). The app, however, reads from `poweron_backup_data_<userId>` (line 33). The two keys can drift. The 56 rows may be in the legacy key only.

---

## Recommended next-session investigation (do not act in this audit)

Before changing any code:

1. **Verify which localStorage key holds the 56 rows.** Open DevTools → Application → Local Storage → look at both `poweron_backup_data` and `poweron_backup_data_<userId>`. Find which key has `projects[].mtoRows` populated, and for which project id.
2. **Verify `projectId` at render time.** Add a one-line console.log at V15rMTOTab line 55: `console.log('[MTO]', projectId, 'p=', p, 'mtoRows=', p?.mtoRows?.length)`. Same in V15rEstimateTab line 60. Compare the project id, the project object identity, and the mtoRows length between the two tabs. If `projectId` matches but only one tab sees rows, the data layer is the issue.
3. **Check for `matRows` vs `mtoRows` split.** In DevTools: `JSON.parse(localStorage.getItem('poweron_backup_data_<userId>')).projects.find(p => p.name.includes('Beauty')).matRows?.length` vs `.mtoRows?.length`. If `matRows` is 56 and `mtoRows` is 0, the fix is a one-time migration that copies `matRows` → `mtoRows` (or unifies the field), not a render-path change.
4. **Confirm `_activeTenantUserId` at MTO render time.** Add `console.log('[MTO] tenant=', getActiveTenantUserId())` to V15rMTOTab. If it's `null`, hydration ordering is the bug.

Once one of those four checks identifies the actual data divergence, the fix is targeted (a migration, a tenant-hydration gate, a duplicate-project clean-up) — not a renderer rewrite.

---

## Audit artifacts (files inspected, no modifications)

- `src/components/v15r/V15rMTOTab.tsx` — 1357 lines, key lines 14, 52–61, 180–183, 710–767, 770–869, 1060–1069
- `src/components/v15r/V15rEstimateTab.tsx` — 2087 lines, key lines 4, 16, 18, 60, 63–95, 1418–1460
- `src/components/v15r/V15rEstimateMTO.tsx` — 252 lines, key lines 22, 25 (price-book panel, not relevant to the bug)
- `src/components/v15r/V15rProjectInner.tsx` — 162 lines, key lines 39–62, 78, 158
- `src/components/v15r/V15rProjectsPanel.tsx` — 1008 lines (callers only)
- `src/components/v15r/V15rLayout.tsx` — 2460 lines (not in the render path under inspection)
- `src/components/v15r/ProjectSummaryBoxes.tsx` — line 49–55 ($1,104.83 candidate source)
- `src/components/layout/AppShell.tsx` — lines 46, 365, 760–810
- `src/services/backupDataService.ts` — 1442 lines, key lines 29–67, 180–191, 461–639, 647–654, 1246–1438

No source file was modified during this audit. No npm/git write commands were executed.

---

## Closing note

The previous session's "fix" at lines 1060–1069 (empty-state table head render) achieved its stated goal — when `hasAnyRows` is false, headers render with an empty tbody. **That is the visible symptom, and the fix is faithful to that contract.** The bug is upstream of that render: `hasAnyRows` is false when it should be true. Fixing the renderer further (e.g., always calling `renderPhaseGroups` regardless of `hasAnyRows`) would mask the data problem, not solve it.

Diagnosis-first, fix-later: this report is the diagnosis. The fix is one of the four checks above, whichever turns up the actual divergence.
