# POST_DEPLOYMENT_INTERVIEW_v4_0.md

**Document Type:** Post-Deployment Interview Protocol  
**Version:** 4.0  
**Date Created:** April 12, 2026  
**Status:** PROPOSED -- Pending PIN Approval  
**Parent Spec:** RUNTIME_ALIGNMENT_AUDIT_v4_0.md  

---

## Status Notice

**This protocol is a proposal.** It has not yet received PIN approval from Christian. It is documented here as a complete, ready-to-approve specification. Until PIN approval is confirmed and logged in VERSION_CHANGELOG_v4_0.md, this protocol operates as a recommended post-deployment practice, not a mandatory constitutional law.

---

## Purpose

The Post-Deployment Interview is a structured review conducted within 24 hours of any production deployment or staging push. Its purpose is to verify that the deployed output matches the specification, that no regressions were introduced, and that the changelog accurately reflects what was shipped.

Deployments often reveal gaps that were invisible during session execution. The post-deployment interview creates a formal window to catch those gaps before they compound.

---

## Trigger Conditions

The Post-Deployment Interview is triggered within 24 hours of:

- Any production push to the Power On Hub app
- Any staging deployment intended for customer-facing testing
- Any significant database migration or schema change
- Any update to the app's authentication or payment flows

The interview is **not required** for:

- Development-only commits with no deployment event
- Internal tool or script updates with no user-facing impact
- Documentation-only commits

---

## Interview Window

The interview must be conducted within **24 hours** of the deployment event. If Christian is unavailable within the 24-hour window, the deployment is flagged as INTERVIEW PENDING and noted in the Daily Living Audit Log. The interview is conducted at the earliest available time.

---

## Roles

| Role | Responsibility |
|------|---------------|
| Channel B | Conducts the interview, documents the output |
| Christian | Reviews deployed output, answers questions, approves or flags rollback |
| Gemini | Available as a read-only reference for code verification if needed |

---

## Interview Structure

The interview has four sections. Total expected duration: 15 to 20 minutes.

---

### Section 1 -- Deployment Confirmation

Questions:

1. What was deployed? State the version, commit hash, and deployment target.
2. When was the deployment event?
3. Who initiated the push?
4. Is the deployment live and accessible?

**Acceptance criteria:** Deployment identity is confirmed and traceable to a specific commit.

---

### Section 2 -- Output vs. Spec Verification

Questions:

1. Which locked CHANGE_SPEC governed the session that produced this deployment?
2. Walk through the CHANGE_SPEC item by item. Is each item visible and working in the deployed output?
3. Are there any items in the CHANGE_SPEC that are not reflected in the deployed output?
4. Are there any visible changes in the deployment that were not in the CHANGE_SPEC?

**Acceptance criteria:** Each CHANGE_SPEC item is confirmed present in the deployment. Out-of-spec changes are logged.

---

### Section 3 -- Regression Check

Questions:

1. Were any previously working features tested after this deployment?
2. Did any previously working feature break or behave unexpectedly?
3. Were there any console errors, crashes, or visible UI issues observed post-deployment?
4. Were any Supabase queries, RLS rules, or API integrations affected?

**Acceptance criteria:** Regression check is documented as CLEAN or REGRESSIONS FOUND. If regressions are found, rollback decision is made in this section.

---

### Section 4 -- Changelog and Version Accuracy

Questions:

1. Does VERSION_CHANGELOG_v4_0.md accurately describe what was shipped in this deployment?
2. Is the version number correct?
3. Are there any session contributions missing from the changelog that should be included?

**Acceptance criteria:** Changelog is confirmed accurate or updated during the interview.

---

## Rollback Decision Protocol

If regressions are found during Section 3, the following decision tree applies:

| Regression Severity | Action |
|--------------------|--------|
| Critical -- app is broken or data is at risk | Rollback immediately. Log rollback event. Open a new CHANGE_SPEC to address the regression before re-deploying. |
| High -- a major feature is non-functional | Hotfix session is prioritized. No new feature work until resolved. Rollback optional based on Christian's decision. |
| Medium -- a feature is degraded but app is usable | Hotfix session is scheduled. App remains deployed. Daily Living Audit Log entry created. |
| Low -- cosmetic issue with no functional impact | Logged. Scheduled for next regular session. No rollback. |

Christian makes the final rollback decision in all cases.

---

## Close Record Format

After the interview, Channel B records the following and saves it to the Daily Living Audit Log in `RUNTIME_ALIGNMENT_AUDIT_v4_0.md`:

```
POST-DEPLOYMENT INTERVIEW RECORD
Date:               [YYYY-MM-DD]
Deployment Event:   [description]
Commit Hash:        [short hash]
Deployment Target:  [production | staging]

Section 1 -- Deployment Confirmed: [yes | no]
Section 2 -- Spec Alignment:       [CONFIRMED | DEVIATIONS LOGGED]
Section 3 -- Regression Check:     [CLEAN | REGRESSIONS FOUND]
Section 4 -- Changelog Accurate:   [yes | updated during interview | still pending]

Rollback Decision:  [NOT REQUIRED | ROLLBACK INITIATED | HOTFIX SCHEDULED]
Rollback Detail:    [description or N/A]

Interview Conducted By: Channel B
Confirmed By: Christian
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-04-12 | Initial creation as part of RUNTIME-AUDIT session. Proposal status. |

---

*End of POST_DEPLOYMENT_INTERVIEW_v4_0.md*
