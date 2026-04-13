# IDEA_REFINEMENT_LOOP_TEMPLATE_v4_0.md

**Document Type:** Multi-Day Idea Refinement Loop Template  
**Version:** 4.0  
**Date Created:** April 12, 2026  
**Status:** ACTIVE  
**Parent Spec:** RUNTIME_ALIGNMENT_AUDIT_v4_0.md  

---

## Purpose

The Idea Refinement Loop is a structured multi-day workflow for developing complex features, architectural decisions, or governance changes that cannot be safely executed in a single session. It prevents the pattern where a large idea gets partially captured in one session, partially executed in another, and ends up in an ambiguous or drift-prone state.

Every loop starts with a Channel B discovery interview and ends with a locked CHANGE_SPEC. Execution sessions do not begin until the loop is closed and the spec is locked.

---

## When to Use This Template

Use this template when:

- A feature or change requires more than one session to fully define
- The scope is unclear and needs discovery before execution
- The idea touches multiple ownership buckets or nav folders
- Christian needs time between interviews to reflect or gather input
- A governance proposal (like the ones in RUNTIME_ALIGNMENT_AUDIT_v4_0.md) is being developed toward PIN approval

Do **not** use this template for:

- Simple bug fixes or small patches with a clear scope
- Sessions with a locked CHANGE_SPEC already in place
- Documentation-only sessions with no ambiguous decisions

---

## How to Use This Template

Copy this template and fill it in at the start of the refinement loop. Save the completed loop file in `Sessions_Queue/_configurations/refinement_loops/` with the naming convention:

```
REFINEMENT_LOOP_[IDEA_SLUG]_[YYYY-MM-DD].md
```

Update the file at each day's close.

---

## Refinement Loop Template

```
=======================================
IDEA REFINEMENT LOOP -- v4.0
=======================================

--- LOOP IDENTITY ---
Loop ID:          [LOOP-XXX or descriptive slug]
Idea Title:       [Short title for this idea]
Start Date:       [YYYY-MM-DD]
Target Lock Date: [YYYY-MM-DD]
Status:           [OPEN | IN REFINEMENT | SPEC LOCKED | EXECUTING | CLOSED]
Lead Channel:     Channel B
Operator:         Christian

--- IDEA CAPTURE (Day 0 -- Discovery Interview) ---
Raw Idea Statement:
  [What Christian said in their own words at the start]

Initial Scope Guess:
  [Estimated files touched, nav buckets affected, complexity level]

Key Questions To Resolve Before Spec Lock:
  1. [question]
  2. [question]
  3. [question]

Discovery Interview Date: [YYYY-MM-DD]
Discovery Interview Notes:
  [Summary of the Channel B discovery interview]

--- DAY 1 -- DRAFT CHANGE_SPEC ---
Draft Spec Location:    [filepath or PENDING]
Draft Spec Summary:
  [One paragraph summary of what the draft spec proposes]

Open Questions From Draft:
  1. [question]
  2. [question]

Christian Review Status: [NOT STARTED | IN REVIEW | APPROVED WITH NOTES | APPROVED]
Christian Review Notes:
  [What Christian said after reviewing the draft]

--- DAY 2 -- REFINEMENT ROUND ---
Refinement Date:  [YYYY-MM-DD]
Questions Resolved:
  1. [question] -- Answer: [answer]
  2. [question] -- Answer: [answer]

Constraints Documented:
  1. [constraint]
  2. [constraint]

Scope Changes From Day 1:
  [What changed from the Day 1 draft -- or NONE]

Refined Draft Location: [filepath or PENDING]

--- DAY 3+ -- ADDITIONAL REFINEMENT ROUNDS (if needed) ---
Round N Date:  [YYYY-MM-DD]
Notes:
  [Additional refinement notes]

--- SPEC LOCK ---
Final CHANGE_SPEC Location: [filepath]
Spec Lock Date:             [YYYY-MM-DD]
Locked By:                  Christian (PIN: [confirmed | pending])
Spec Lock Notes:
  [Any notes from the lock event]

--- EXECUTION SESSIONS ---
Session 1:
  Date:         [YYYY-MM-DD]
  Session Key:  [SESSION_KEY]
  Commit:       [short hash]
  Status:       [COMPLETE | PARTIAL | DRIFT]

Session 2:
  Date:         [YYYY-MM-DD]
  Session Key:  [SESSION_KEY]
  Commit:       [short hash]
  Status:       [COMPLETE | PARTIAL | DRIFT]

--- LOOP CLOSE ---
Loop Close Date:     [YYYY-MM-DD]
Final Output:        [Description of what was built or decided]
Changelog Updated:   [yes | no]
Post-Deployment Interview Required: [yes | no]
Loop Status:         [CLOSED | ESCALATED]
Christian Acceptance: [confirmed | pending]

=======================================
END REFINEMENT LOOP
=======================================
```

---

## Loop Stage Descriptions

### Day 0 -- Discovery Interview

Channel B conducts an open-ended discovery interview with Christian. The goal is to capture the raw idea without imposing structure prematurely. No CHANGE_SPEC is written on Day 0. The output is a clean idea statement, an initial scope guess, and a list of questions that must be answered before the spec can be locked.

### Day 1 -- Draft CHANGE_SPEC

Channel B produces a draft CHANGE_SPEC based on the Day 0 discovery. The draft is reviewed by Christian before the end of the day. Christian's review feedback is documented. A second refinement round is scheduled if open questions remain.

### Day 2 -- Refinement Round

All open questions from Day 1 are resolved in a focused Channel B interview. Constraints are documented. The draft is updated. If the scope changed significantly, another refinement round is scheduled. If the draft is clean, it moves to spec lock.

### Day 3+ -- Additional Rounds

Complex ideas may require additional refinement rounds. There is no limit on the number of rounds, but each round must produce measurable progress toward spec lock. Stalled loops are escalated to Christian for a scope reduction decision.

### Spec Lock

The spec lock is the formal approval event. Christian reviews the final CHANGE_SPEC and confirms it with their PIN if it involves governance changes, or with a verbal confirmation if it is an execution spec. The spec lock date is recorded. Execution sessions may not begin before spec lock.

### Execution Sessions

Standard Cowork execution sessions run against the locked CHANGE_SPEC. Each session uses the Neural Map template and follows the Three-Phase Verification System.

### Loop Close

The loop closes when all execution sessions are complete, the changelog is updated, and Christian confirms acceptance. If a post-deployment interview is required, the loop is not fully closed until that interview is complete.

---

## 24-Hour Memory Refresh Protocol

At the start of each new day's work within an active refinement loop, the following memory refresh prompt is issued to the active model before any work begins:

```
MEMORY REFRESH -- [LOOP_ID] -- [YYYY-MM-DD]

You are returning to an active refinement loop. Before continuing, read the following files in order:

1. RUNTIME_ALIGNMENT_AUDIT_v4_0.md -- review active laws and verification system
2. NEURAL_MAP_[LAST_SESSION_KEY].md -- review last session's handoff layer
3. REFINEMENT_LOOP_[IDEA_SLUG].md -- review current loop state and open questions
4. [DRAFT_CHANGE_SPEC file] -- review current spec draft

After reading these files, confirm:
- Your channel assignment for this session
- The current loop status and today's objective
- Any open questions or constraints from the previous day

Do not begin any execution work until this confirmation is complete.
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-04-12 | Initial creation as part of RUNTIME-AUDIT session |

---

*End of IDEA_REFINEMENT_LOOP_TEMPLATE_v4_0.md*
