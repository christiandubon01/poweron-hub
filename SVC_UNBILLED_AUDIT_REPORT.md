# SVC Unbilled Data Audit — Session 10
**Date:** 2026-04-01
**Scope:** Trace the ~$368 discrepancy between SVC Unbilled header ("$2k") and identified balances (Luis $1,471 + Stephanie $160 = $1,631.98)

---

## ✅ ROOT CAUSE FINDING

**There is no missing entry and no arithmetic bug in the data.**

The apparent $368 discrepancy is 100% a **display rounding artifact**.

The SVC Unbilled header in `V15rLayout.tsx` displays:
```tsx
${Math.round(safeKpis.svcUnbilled / 1000)}k
```

**Actual svcUnbilled value = $1,631.00**

`Math.round(1631 / 1000)` = `Math.round(1.631)` = **2** → displays **"$2k"**

The header is not showing "$2,000" — it is showing "$2k" which means "approximately $2,000, rounded to the nearest thousand." Any value between $1,500.00 and $2,499.99 will display as "$2k". The actual calculation is correct to the penny.

---

## Step 1 — Complete Service Log Audit (Live Supabase Data)

**Source:** Supabase `app_state` table, key `poweron_v2`
**Last synced:** 2026-04-01T23:55:19 UTC
**Total entries:** 30

All entries sorted by remaining balance descending:

| # | Customer | Date | Job Type | Quoted | Add. Income | Total Billable | Collected | **Remaining** | Pay Status |
|---|----------|------|----------|--------|-------------|----------------|-----------|---------------|------------|
| 1 | Luis Hernandez (Brewery) | 2025-08-25 | Commercial | $1,471.00 | $0.00 | $1,471.00 | $0.00 | **$1,471.00** | N |
| 2 | Stephanie Turrentine | 2026-03-27 | Other | $160.00 | $0.00 | $160.00 | $0.00 | **$160.00** | N |
| 3 | Steven Chianglin | 2026-03-26 | EV Charger | $715.53 | $0.00 | $715.53 | $715.53 | $0.00 | Y |
| 4 | Dave Wagner | 2025-08-05 | Ceiling Fan | $532.54 | $0.00 | $532.54 | $532.54 | $0.00 | Y |
| 5 | Dave Wagner | 2025-08-24 | Low Voltage | $1,630.00 | $0.00 | $1,630.00 | $1,630.00 | $0.00 | Y |
| 6 | Dave Wagner | 2025-11-06 | Low Voltage | $567.48 | $0.00 | $567.48 | $567.48 | $0.00 | Y |
| 7 | Luis Hernandez (Kitchen Remodel) | 2025-08-24 | Remodel | $3,000.00 | $0.00 | $3,000.00 | $3,000.00 | $0.00 | Y |
| 8 | Silvia (Enso Properties) — Full Remodel | 2025-08-24 | Remodel | $3,528.00 | $0.00 | $3,528.00 | $3,528.00 | $0.00 | Y |
| 9 | Heather / Brett (WestCoast Plumbing) | 2025-12-27 | GFCI / Receptacles | $350.00 | $0.00 | $350.00 | $350.00 | $0.00 | Y |
| 10 | Claudio | 2026-01-05 | Lighting | $195.00 | $0.00 | $195.00 | $195.00 | $0.00 | Y |
| 11 | Andrjez | 2026-01-05 | Circuit Add/Replace | $225.00 | $0.00 | $225.00 | $225.00 | $0.00 | Y |
| 12 | Richard | 2026-01-07 | Troubleshoot | $280.50 | $0.00 | $280.50 | $280.50 | $0.00 | Y |
| 13 | Richard | 2026-01-12 | Lighting | $771.00 | $0.00 | $771.00 | $771.00 | $0.00 | Y |
| 14 | Eric Hanson | 2026-01-22 | Switches / Dimmers | $640.00 | $0.00 | $640.00 | $640.00 | $0.00 | Y |
| 15 | Eric Hanson | 2026-01-27 | GFCI / Receptacles | $470.01 | $0.00 | $470.01 | $470.01 | $0.00 | Y |
| 16 | Carlos | 2026-02-05 | Lighting | $500.00 | $0.00 | $500.00 | $500.00 | $0.00 | Y |
| 17 | Luis / Claudio | 2026-02-06 | Circuit Add/Replace | $369.35 | $0.00 | $369.35 | $369.35 | $0.00 | Y |
| 18 | Eric Hanson | 2026-02-10 | Switches / Dimmers | $174.95 | $0.00 | $174.95 | $174.95 | $0.00 | Y |
| 19 | Jose Rios | 2026-02-13 | Lighting | $375.00 | $0.00 | $375.00 | $375.00 | $0.00 | Y |
| 20 | Victor Gutierrez | 2026-02-20 | Circuit Add/Replace | $1,200.00 | $0.00 | $1,200.00 | $1,200.00 | $0.00 | Y |
| 21 | Theresa Faiola | 2026-02-26 | Troubleshoot | $450.00 | $0.00 | $450.00 | $450.00 | $0.00 | Y |
| 22 | Rafael Gonzalez | 2026-03-04 | Panel / Service | $1,800.00 | $0.00 | $1,800.00 | $1,800.00 | $0.00 | Y |
| 23 | Marc Cooper | 2026-03-07 | Lighting | $320.00 | $0.00 | $320.00 | $320.00 | $0.00 | Y |
| 24 | Heather / Brett | 2026-03-10 | GFCI / Receptacles | $280.00 | $0.00 | $280.00 | $280.00 | $0.00 | Y |
| 25 | Eric Hanson | 2026-03-14 | Switches / Dimmers | $395.00 | $0.00 | $395.00 | $395.00 | $0.00 | Y |
| 26 | Darla Rosales | 2026-03-17 | Troubleshoot | $225.00 | $0.00 | $225.00 | $225.00 | $0.00 | Y |
| 27 | Martin Torres | 2026-03-19 | Circuit Add/Replace | $540.00 | $0.00 | $540.00 | $540.00 | $0.00 | Y |
| 28 | Kevin Park | 2026-03-21 | EV Charger | $650.00 | $0.00 | $650.00 | $650.00 | $0.00 | Y |
| 29 | Sandra Mitchell | 2026-03-24 | Lighting | $310.00 | $0.00 | $310.00 | $310.00 | $0.00 | Y |
| 30 | Tommy Nguyen | 2026-03-25 | GFCI / Receptacles | $185.00 | $0.00 | $185.00 | $185.00 | $0.00 | Y |

---

## Step 2 — Sum Verification

| Item | Amount |
|------|--------|
| Luis Hernandez (Brewery) | $1,471.00 |
| Stephanie Turrentine | $160.00 |
| **Calculated svcUnbilled total** | **$1,631.00** |
| Header display (`Math.round(1631/1000)k`) | **"$2k"** |
| Perceived discrepancy (assumes "$2k" = $2,000) | ~$369 apparent gap |
| **Actual missing balance** | **$0.00** |

The header stat rounds the true value to the nearest thousand. $1,631 rounds up to 2, displaying as "$2k". The arithmetic in `backupDataService.ts` is correct.

---

## Step 3 — Is There a ~$368 Entry Not in Luis or Stephanie?

**No.** There are exactly **2 entries** with `remaining > 0` in the entire dataset:
- Luis Hernandez (Brewery): **$1,471.00**
- Stephanie Turrentine: **$160.00**

All 28 other entries have `remaining = $0.00` (fully collected, payStatus Y).

Notable: Entry #17 — **Luis / Claudio** (2026-02-06) — has `quoted: $369.35` which is suspiciously close to the perceived ~$368 gap. However, this entry is **fully paid** (collected = $369.35, payStatus = Y, remaining = $0). It does not contribute to svcUnbilled.

---

## Step 4 — Calculation Trace (backupDataService.ts lines 708–717)

```ts
const svcUnbilled = serviceLogs.reduce((s, l) => {
    const quoted = num(l.quoted)              // ← correct: reads l.quoted
    const collected = num(l.collected)        // ← correct: reads l.collected
    const adjustments = Array.isArray(l.adjustments) ? l.adjustments : []
    const addIncome = adjustments
      .filter((a: any) => a && a.type === 'income')
      .reduce((ac: number, a: any) => ac + num(a.amount), 0)
    const totalBillable = (quoted + addIncome) ?? 0  // ← correct
    return s + Math.max(0, totalBillable - collected) // ← correct
  }, 0)
```

**Trace for the two unbilled entries:**
- Luis (Brewery): `max(0, 1471 + 0 - 0)` = 1471 ✓
- Stephanie: `max(0, 160 + 0 - 0)` = 160 ✓
- All others: `max(0, x - x)` = 0 ✓
- **Running total: $1,631.00** ✓

No arithmetic bug found. The `?? 0` null-safety guard added in commit `92bd0bb` today is cosmetic and doesn't change the result.

---

## Conclusion

| Question | Answer |
|----------|--------|
| Is there a missing ~$368 entry? | **No.** |
| Is the svcUnbilled calculation correct? | **Yes — $1,631.00 exact.** |
| Why does the header show "$2k"? | `Math.round(1631/1000) = 2` → displays "$2k" |
| Is there a data integrity issue? | **No.** |
| Is there an arithmetic bug? | **No.** |

**The "$2k" header is accurate.** $1,631 legitimately rounds to $2k. The perceived $368 gap is the rounding delta — not a real discrepancy.

### Optional Display Improvement (not a required fix)

If you want the header to show more precision to avoid future confusion, consider changing the display in `V15rLayout.tsx` from:

```tsx
${Math.round(safeKpis.svcUnbilled / 1000)}k
```

to one of:

```tsx
// Option A: one decimal → "$1.6k"
${(safeKpis.svcUnbilled / 1000).toFixed(1)}k

// Option B: show full dollar amount under $10k
${safeKpis.svcUnbilled < 10000 ? '$' + safeKpis.svcUnbilled.toFixed(0) : '$' + Math.round(safeKpis.svcUnbilled/1000) + 'k'}
```

This is a display-only change — no data touched. Christian to decide.

---

*Audit performed: 2026-04-01 | Data source: Supabase app_state poweron_v2 (updated 2026-04-01T23:55 UTC) | 30 service log entries examined*
