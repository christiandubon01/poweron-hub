const fs = require("fs");

const queueFile = "session_queue_3.json";

if (!fs.existsSync(queueFile)) {
  console.error("ERROR: session_queue_3.json not found. Run from Sessions_Queue\\PowerOn_Hub folder.");
  process.exit(1);
}

const q = JSON.parse(fs.readFileSync(queueFile, "utf8"));

const session = {
  id: "RUNTIME-AUDIT",
  bucket: "OTHER",
  name: "RUNTIME-AUDIT -- Runtime Alignment Audit v4.0 docs + templates",
  status: "pending",
  commit: "",
  prompt: `IGNITION CODE: RUNTIME-AUDIT-[IGNITION]
SESSION KEY: RUNTIME-AUDIT
ALLOWED TOOLS: Bash(*), Read(*), Write(*), Edit(*)
WORKING DIR: C:\\Users\\chris\\Desktop\\Power On Hub\\Sessions_Queue\\_configurations
ISOLATION FOLDER: Sessions_Queue\\_configurations
PROTECTED FILES:
- C:\\Users\\chris\\Desktop\\Power On Hub\\Sessions_Queue\\_configurations\\CLAUDE_HANDSHAKE.md
- C:\\Users\\chris\\Desktop\\Power On Hub\\Sessions_Queue\\_configurations\\AGENT_OPS_SPEC.md
- C:\\Users\\chris\\Desktop\\Power On Hub\\Sessions_Queue\\_configurations\\OWNERSHIP_MAP_v4_0.md
- C:\\Users\\chris\\Desktop\\Power On Hub\\Sessions_Queue\\_configurations\\COWORK_PROMPT_CANON_v4_0.md

CANARY FILE:
- C:\\Users\\chris\\Desktop\\Power On Hub\\Sessions_Queue\\_configurations\\RUNTIME_ALIGNMENT_AUDIT_v4_0.md

MISSION:
Create the runtime-alignment document set in Sessions_Queue\\_configurations using the locked CHANGE_SPEC for RUNTIME_ALIGNMENT_AUDIT_v4_0.md. This is documentation/config work only. Do not modify app code, queue utilities, or governance docs unless explicitly instructed in this prompt.

SOURCE OF TRUTH:
- Locked CHANGE_SPEC for RUNTIME_ALIGNMENT_AUDIT_v4_0.md dated April 12, 2026
- Existing v4.0 docs already saved tonight:
  - CLAUDE_HANDSHAKE.md
  - AGENT_OPS_SPEC.md
  - OWNERSHIP_MAP_v4_0.md
  - COWORK_PROMPT_CANON_v4_0.md
  - poweron_app_handoff_spec.md
  - poweron_v2_handoff_complete.md
  - VERSION_CHANGELOG_v4_0.md
  - CREWAI_PRESPEC_v4_0.md

REPO / FOLDER LOCK:
- Work only in: C:\\Users\\chris\\Desktop\\Power On Hub\\Sessions_Queue\\_configurations
- Do not work in the app repo
- Do not work in DaSparkyHub
- Do not modify queue scripts or JSON queue files
- Do not modify app source files under src/

PRIMARY DELIVERABLE:
- RUNTIME_ALIGNMENT_AUDIT_v4_0.md

SUPPORTING DELIVERABLES:
- NEURAL_MAP_TEMPLATE_v4_0.md
- TEN_PM_INTERVIEW_PROTOCOL_v4_0.md
- IDEA_REFINEMENT_LOOP_TEMPLATE_v4_0.md
- POST_DEPLOYMENT_INTERVIEW_v4_0.md
- NEURAL_WORLD_3D_SPEC_v4_0.md

SPEC STRUCTURE REQUIREMENTS:
1. Lock only the active spec target:
   - RUNTIME_ALIGNMENT_AUDIT_v4_0.md
2. Treat NAV1-FIX-VS and ISO1 as historical prior locked specs only if mentioned
3. Structure the primary document with:
   - Purpose
   - Scope
   - Primary Deliverable
   - Supporting Deliverables
   - Already Locked v4.0 Laws This Depends On
   - New Law Proposals Tonight
   - Runtime Implementation Rules
   - Three-Phase Verification System
   - Daily Living Audit Log
   - 10 PM Interview Protocol Integration
   - AI Neural Map Framework
   - Human Performance Framework
   - Post-Deployment Interview Protocol
   - Visual System Map / Bubble Map Framework
   - Multi-Day Idea Refinement Loop
   - Future 3D Neural World Specification Layer
   - Time-Stamped Version Control
   - Integration Points With Existing Docs
   - Success Criteria
   - Save Targets

ALREADY LOCKED v4.0 LAWS THIS SPEC DEPENDS ON:
- Channel B Interview Gate
- PIN-Gated Governance Updates
- Interview Alignment Check
- Codebase Isolation Architecture - src/views/ must move toward nav-bucket subfolder ownership with isolation boundaries enforced
- Prompt Format Lock
- Small Batch Quality Protocol
- Version Changelog Tracking
- Role Enforcement
- Mandatory AI Feedback Loop Law
- CrewAI Feedback Loop Protocol
- Remote Operation Protocol

NEW LAW PROPOSALS TONIGHT:
These are proposals only. Do not write them as already constitutional:
- Mandatory 10 PM Session Close Interview
- Post-Deployment Interview Window
- 30-Minute Feedback Check-In Alert

RUNTIME IMPLEMENTATION RULES:
Include and classify as operational behavior, not already constitutional law:
- baseline screenshots/descriptions before complex sessions
- after-state screenshots/proof after completion
- drift flag if requested result != actual result
- visual mockup before UI sessions as recommended operating standard when design AI is available
- 15-minute self-reports during active sessions
- 24-hour memory refresh prompts for models

THREE-PHASE VERIFICATION SYSTEM:
Use this exact framing:
Phase 1 - Pre-Session Baseline
- current visible state
- screenshots before
- expected outcome
- queue/repo baseline
- spec and version context
- Gemini reads source files to be touched

Phase 2 - Execution + Visual Proof
- session runs
- claimed changes logged
- screenshots or visual proof after
- visible match vs spec
- drift flagged if mismatch

Phase 3 - Compliance + Release Gate
- role compliance
- prompt canon compliance
- ownership compliance
- post-session compliance
- push readiness decision

INTEGRATION POINTS:
Reference these docs cleanly and format as a proper markdown table:
- CLAUDE_HANDSHAKE.md
- AGENT_OPS_SPEC.md
- OWNERSHIP_MAP_v4_0.md
- COWORK_PROMPT_CANON_v4_0.md
- poweron_app_handoff_spec.md
- poweron_v2_handoff_complete.md
- VERSION_CHANGELOG_v4_0.md
- CREWAI_PRESPEC_v4_0.md

FORMAT / QUALITY REQUIREMENTS:
- Professional, polished documentation
- Markdown only
- Clean headings and tables
- ASCII-safe punctuation preferred
- No broken flattened sections
- Save all files into Sessions_Queue\\_configurations only

HARD CONSTRAINTS:
- Do not modify existing v4.0 governance docs in this session
- Do not create app code
- Do not create queue mutations
- Do not invent new laws beyond the explicit proposed-law section
- Keep active runtime audit vs future 3D visualization clearly separated
- No unrelated cleanup

ACCEPTANCE CRITERIA:
- Primary doc created: RUNTIME_ALIGNMENT_AUDIT_v4_0.md
- All 5 supporting docs created
- Section 18 integration references are formatted correctly
- Save targets are correct: Sessions_Queue\\_configurations\\
- Active runtime audit and future visualization scope are separated
- New proposals are labeled as proposals, not already-locked law
- Content aligns with the existing v4.0 doc stack
- No existing governance doc was modified in this session

DELIVERY:
1. Review the created markdown files for formatting
2. git add .
3. git commit -m 'RUNTIME-AUDIT: add runtime alignment audit v4.0 doc set'
4. Commit hash only. Do not push.
5. When done: node done.js RUNTIME-AUDIT [hash]`
};

const idx = q.findIndex(x => x && x.id === session.id);

if (idx >= 0) {
  q[idx] = { ...q[idx], ...session };
  console.log("UPDATED existing session:", session.id);
} else {
  q.push(session);
  console.log("ADDED new session:", session.id);
}

fs.writeFileSync(queueFile, JSON.stringify(q, null, 2) + "\n");
console.log("WROTE", queueFile);
console.log("NEXT: node get.js RUNTIME-AUDIT");
