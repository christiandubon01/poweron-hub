# TEN_PM_INTERVIEW_PROTOCOL_v4_0.md

**Document Type:** Session Close Interview Protocol  
**Version:** 4.0  
**Date Created:** April 12, 2026  
**Status:** PROPOSED -- Pending PIN Approval  
**Parent Spec:** RUNTIME_ALIGNMENT_AUDIT_v4_0.md  

---

## Status Notice

**This protocol is a proposal.** It has not yet received PIN approval from Christian. It is documented here as a complete, ready-to-approve specification. Until PIN approval is confirmed and logged in VERSION_CHANGELOG_v4_0.md, this protocol operates as a recommended closing practice, not a mandatory constitutional law.

---

## Purpose

The 10 PM Interview Protocol defines a structured session-close interview that is conducted at the end of any active session running past 9:45 PM. Its purpose is to ensure that no session ends in an ambiguous or unverified state due to late-night fatigue, context loss, or model drift.

The interview is brief, structured, and always results in a documented session close record.

---

## Trigger Conditions

The 10 PM Interview is triggered when:

- An active session is still running at 9:45 PM or later
- A session began before 9:45 PM and is not yet formally closed
- Christian requests a session close interview at any time, regardless of hour

The interview is **not required** for:

- Sessions that are fully closed (Phase 3 complete) before 9:45 PM
- Automated sessions with no interactive human component
- Passive read-only sessions (Gemini context reads)

---

## Roles

| Role | Responsibility |
|------|---------------|
| Channel B | Conducts the interview, asks all questions, records the output |
| Christian | Answers questions, confirms session state, approves close decision |
| Channel A | Not present in interview -- no Cowork prompts issued during the interview |

---

## Interview Structure

The interview has five sections. Each section must be completed before moving to the next. Total expected duration: 10 to 15 minutes.

---

### Section 1 -- Session Output Review

Questions:

1. What was the stated goal of this session at the start?
2. What was actually completed in this session?
3. Is there a gap between the stated goal and the completed output?
4. If yes: is the gap documented as a drift flag?

**Acceptance criteria:** Completed output is clearly stated. Any gap is acknowledged and documented.

---

### Section 2 -- Drift Check

Questions:

1. Did any model output differ from the CHANGE_SPEC in a meaningful way?
2. Were there any unexpected file changes, scope expansions, or role violations?
3. Is there anything about this session that you would flag for review before push?

**Acceptance criteria:** All drift is surfaced. Undocumented surprises are flagged before close.

---

### Section 3 -- Spec Alignment Confirmation

Questions:

1. Which locked CHANGE_SPEC governed this session?
2. Was every change in this session traceable to that CHANGE_SPEC?
3. Were any changes made that were not in the CHANGE_SPEC?

**Acceptance criteria:** CHANGE_SPEC reference is confirmed. Out-of-spec changes are logged as drift or escalated.

---

### Section 4 -- Changelog and Commit Status

Questions:

1. Has VERSION_CHANGELOG_v4_0.md been updated for this session?
2. Has the session been committed to git?
3. Is the commit hash recorded in the session queue?
4. Is there anything preventing a clean push?

**Acceptance criteria:** Changelog is updated. Commit is confirmed. Push readiness is assessed.

---

### Section 5 -- Next Session Intent

Questions:

1. What is left unfinished from this session?
2. What should the next session begin with?
3. Are there any open blockers or questions that need to be resolved before the next session?
4. Should a 24-hour memory refresh prompt be queued for tomorrow?

**Acceptance criteria:** Next session intent is documented in the Neural Map handoff layer. Memory refresh prompt is queued if needed.

---

## Close Record Format

After the interview, Channel B records the following close record and saves it to the Daily Living Audit Log in `RUNTIME_ALIGNMENT_AUDIT_v4_0.md`:

```
10 PM INTERVIEW CLOSE RECORD
Date:           [YYYY-MM-DD]
Session Key:    [SESSION_KEY]
Interview Start: [HH:MM]
Interview End:   [HH:MM]

Output Review:   [CONFIRMED COMPLETE | CONFIRMED PARTIAL | DRIFT FLAGGED]
Drift Check:     [CLEAN | FLAGGED -- see detail]
Spec Alignment:  [CONFIRMED | DEVIATION LOGGED]
Changelog:       [UPDATED | NOT REQUIRED | PENDING]
Commit Status:   [COMMITTED | PENDING | HOLD]
Push Readiness:  [READY | HOLD | ESCALATE]

Next Session Intent:
  [summary]

Unresolved Items:
  1. [item]

Memory Refresh Queued: [yes | no]

Interview Conducted By: Channel B
Confirmed By: Christian
```

---

## Failure Mode Handling

| Failure | Response |
|---------|---------|
| Christian is unavailable past 9:45 PM | Session is placed in HOLD status. No push. Close record is incomplete. Resume next session with this as first agenda item. |
| Drift is discovered during interview that was not previously documented | Drift is logged immediately. Push is placed on HOLD until drift is resolved or formally accepted by Christian. |
| Changelog was not updated | Update changelog before ending the interview. Do not close the record until this is done. |
| No CHANGE_SPEC was in place for this session | Flag as a governance violation. Document in the audit log. Do not push. Escalate to Christian for PIN-level review. |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-04-12 | Initial creation as part of RUNTIME-AUDIT session. Proposal status. |

---

*End of TEN_PM_INTERVIEW_PROTOCOL_v4_0.md*
