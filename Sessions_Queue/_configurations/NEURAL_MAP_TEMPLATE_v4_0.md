# NEURAL_MAP_TEMPLATE_v4_0.md

**Document Type:** AI Neural Map Template  
**Version:** 4.0  
**Date Created:** April 12, 2026  
**Status:** ACTIVE  
**Parent Spec:** RUNTIME_ALIGNMENT_AUDIT_v4_0.md  

---

## Purpose

The AI Neural Map is a structured snapshot of the full operating context for any given session. It is filled out at session start (Phase 1 baseline) and updated at session close (Phase 3 compliance gate). It serves as a communication artifact between sessions and between human and AI operators.

The neural map makes session state legible. It answers the question: "At any point in this session, what does the AI know, what is it doing, and what has it produced?"

---

## How to Use This Template

Copy this template and fill it in at the start of each session. Save the completed map in `Sessions_Queue/_configurations/neural_maps/` with the naming convention:

```
NEURAL_MAP_[SESSION_KEY]_[YYYY-MM-DD].md
```

Update the Output Layer and Gate Layer at session close.

---

## Neural Map Template

```
=======================================
NEURAL MAP -- v4.0
=======================================

--- IDENTITY LAYER ---
Session Key:        [SESSION_KEY]
Session Date:       [YYYY-MM-DD]
Session Start Time: [HH:MM]
Active Model:       [Claude / Gemini / Other]
Channel Assignment: [A | B | Both | Read-Only]
Operator:           Christian

--- LAW LAYER ---
Active Laws Governing This Session:
- [ ] Channel B Interview Gate
- [ ] PIN-Gated Governance Updates
- [ ] Interview Alignment Check
- [ ] Codebase Isolation Architecture
- [ ] Prompt Format Lock
- [ ] Small Batch Quality Protocol
- [ ] Version Changelog Tracking
- [ ] Role Enforcement
- [ ] Mandatory AI Feedback Loop Law
- [ ] CrewAI Feedback Loop Protocol (if applicable)
- [ ] Remote Operation Protocol (if applicable)

Locked CHANGE_SPEC Reference:
  File:      [filename or N/A]
  Date:      [date or N/A]
  Approved:  [yes | no | PIN pending]

--- CONTEXT LAYER ---
Source Files Being Read:
  1. [filepath]
  2. [filepath]
  3. [filepath]

Ownership Buckets In Scope:
  - [bucket name / nav folder / config area]

Baseline Branch:    [branch name]
Baseline Commit:    [short hash]
Queue File:         [session_queue_X.json or N/A]

Expected Session Outcome:
  [One to three sentences describing what done looks like for this session]

--- OUTPUT LAYER (filled at close) ---
Claimed Changes:
  1. [change description]
  2. [change description]
  3. [change description]

Proof State:
  Screenshot captured:  [yes | no | N/A]
  Written proof:        [yes | no | N/A]
  Proof location:       [file path or N/A]

Drift Detected:       [yes | no]
Drift Detail:
  Requested:  [what was requested]
  Delivered:  [what was actually delivered]
  Gap Reason: [explanation or N/A]

--- GATE LAYER (filled at close) ---
Phase 1 -- Pre-Session Baseline:    [COMPLETE | PARTIAL | SKIPPED]
Phase 2 -- Execution + Visual Proof: [COMPLETE | PARTIAL | SKIPPED]
Phase 3 -- Compliance + Release Gate: [COMPLETE | PARTIAL | SKIPPED]

Role Compliance:      [pass | fail | flag]
Prompt Canon:         [pass | fail | flag]
Ownership Compliance: [pass | fail | flag]
Changelog Updated:    [yes | no | not required]
Push Readiness:       [READY | HOLD | ESCALATE]

--- HANDOFF LAYER (filled at close) ---
Next Session Intent:
  [What should the next session pick up]

Unresolved Items:
  1. [item]
  2. [item]

Escalation Flags:
  [None | description of escalation needed]

10 PM Interview Conducted: [yes | no | not required]
Post-Deployment Interview Required: [yes | no]

=======================================
END NEURAL MAP
=======================================
```

---

## Layer Descriptions

### Identity Layer

The Identity Layer establishes who is running the session and in what role. This layer must be filled before any work begins. If the channel assignment is unclear, stop and resolve before proceeding.

### Law Layer

The Law Layer lists which v4.0 laws are active and relevant to this session. Check off each law as confirmed. If a CHANGE_SPEC is required for this session, it must be identified and confirmed before proceeding.

### Context Layer

The Context Layer documents what the model is reading, what ownership boundaries apply, and what the expected outcome is. The expected outcome statement is used in Phase 2 to verify that the actual result matches the intent.

Gemini populates the source file list by reading all files before any changes are made.

### Output Layer

The Output Layer is filled at session close. It documents what was actually changed, what proof exists, and whether drift occurred. If drift occurred, the gap must be documented before the session can be marked complete.

### Gate Layer

The Gate Layer captures the Phase 1 / Phase 2 / Phase 3 completion status and the four compliance checks. Push readiness is the final gate. A session cannot be pushed if any compliance check fails without an explicit escalation decision.

### Handoff Layer

The Handoff Layer is the bridge to the next session. It ensures that unresolved items and context are not lost between sessions. The 24-hour memory refresh prompt uses this layer as its primary input.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-04-12 | Initial creation as part of RUNTIME-AUDIT session |

---

*End of NEURAL_MAP_TEMPLATE_v4_0.md*
