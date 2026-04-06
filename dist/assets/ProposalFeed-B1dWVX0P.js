import{d as P,s as m,b8 as X,b4 as k,b6 as K,b2 as Z,b3 as ee,j as s,a3 as y,a0 as te,S as se,Y as ie,E as ae,u as re,aM as $,a as ne,X as oe}from"./index-Dq4_d5rS.js";import{r as x}from"./react-vendor-Cq6wvmBX.js";import{a as ce}from"./patternService-DZZpTpdr.js";import{A as le,g as de,f as ue,u as D,r as pe}from"./scoutQueue-CNyxausE.js";import{L as U}from"./loader-circle-Z5TPrcwd.js";import{R as M}from"./refresh-cw-DAptE-5Z.js";import"./supabase-vendor-AnTI2EX_.js";import"./redis-vendor-C_wJB7Oe.js";import"./patternLearning-4J6qBdVL.js";/**
 * @license lucide-react v0.383.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const me=P("Clipboard",[["rect",{width:"8",height:"4",x:"8",y:"2",rx:"1",ry:"1",key:"tgr4d6"}],["path",{d:"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",key:"116196"}]]);/**
 * @license lucide-react v0.383.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const E=P("Flag",[["path",{d:"M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z",key:"i9b6wo"}],["line",{x1:"4",x2:"4",y1:"22",y2:"15",key:"1cm3nv"}]]);/**
 * @license lucide-react v0.383.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ge=P("Inbox",[["polyline",{points:"22 12 16 12 14 15 10 15 8 12 2 12",key:"o97t9d"}],["path",{d:"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",key:"oot6mr"}]]);/**
 * @license lucide-react v0.383.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const fe=P("SkipForward",[["polygon",{points:"5 4 15 12 5 20 5 4",key:"16p6eg"}],["line",{x1:"19",x2:"19",y1:"5",y2:"19",key:"futhcm"}]]);function he(t){return new Date(Date.now()-t*864e5).toISOString().split("T")[0]}function I(t){const e=new Date(t);return Math.floor((Date.now()-e.getTime())/864e5)}async function xe(t){var a;const e={gatheredAt:new Date().toISOString(),orgId:t,fieldLogs:[],activeProjects:[],outdatedPricing:[],overdueItems:[],costVariances:[],dormantGCs:[],weeklyTracker:[],openInvoices:[]};try{const{data:i}=await m.from("field_logs").select("project_id, log_date, employee_id, hours, material_cost, pay_status, notes").eq("org_id",t).gte("log_date",he(30)).order("log_date",{ascending:!1}).limit(200);i&&(e.fieldLogs=i)}catch(i){console.warn("[Scout:gather] field_logs failed:",i)}try{const{data:i}=await m.from("projects").select("id, name, status, type, phase, priority, estimated_value, contract_value, updated_at").eq("org_id",t).in("status",["lead","estimate","pending","approved","in_progress","on_hold","punch_list"]).order("updated_at",{ascending:!1}).limit(50);i&&(e.activeProjects=i)}catch(i){console.warn("[Scout:gather] projects failed:",i)}try{const{data:i}=await m.from("price_book_items").select("id, name, unit_cost, unit, supplier, category_name, updated_at").eq("org_id",t).lt("updated_at",new Date(Date.now()-5184e6).toISOString()).limit(50);i&&(e.outdatedPricing=i.map(r=>({...r,days_stale:I(r.updated_at)})))}catch(i){console.warn("[Scout:gather] price_book_items failed:",i)}try{const i=new Date().toISOString().split("T")[0],{data:r}=await m.from("coordination_items").select("id, project_id, category, title, status, due_date").eq("org_id",t).in("status",["open","in_progress"]).lt("due_date",i).order("due_date",{ascending:!0}).limit(30);r&&(e.overdueItems=r.map(n=>({...n,days_overdue:I(n.due_date)})))}catch(i){console.warn("[Scout:gather] coordination_items failed:",i)}try{const{data:i}=await m.from("project_cost_summary").select("*").eq("org_id",t).limit(20);if(i){const r=[];for(const n of i){const l=n.project_id,o=e.fieldLogs.filter(w=>w.project_id===l),d=o.reduce((w,N)=>w+(N.hours||0),0),u=o.reduce((w,N)=>w+(N.material_cost||0),0),b=n.est_labor_cost||0,p=n.est_material_cost||0,f=n.est_overhead_cost||0,h=b+p+f,T=d*85+u,j=h>0?(T/h-1)*100:null;r.push({project_id:l,project_name:n.project_name||"Unknown",est_labor_cost:b,est_material_cost:p,est_overhead_cost:f,actual_hours:d,actual_material:u,variance_pct:j!==null?Math.round(j*10)/10:null})}e.costVariances=r.filter(n=>n.variance_pct!==null)}}catch(i){console.warn("[Scout:gather] cost variances failed:",i)}try{const{data:i}=await m.from("gc_contacts").select("id, company, pipeline_phase, fit_score, payment_rating, bids_sent, bids_awarded, win_rate, updated_at").eq("org_id",t).limit(50);if(i){const r=[];for(const n of i){const{data:l}=await m.from("gc_activity_log").select("created_at").eq("gc_contact_id",n.id).order("created_at",{ascending:!1}).limit(1),o=(a=l==null?void 0:l[0])==null?void 0:a.created_at,d=I(o||n.updated_at);d>=90&&r.push({id:n.id,company:n.company,pipeline_phase:n.pipeline_phase,fit_score:n.fit_score,payment_rating:n.payment_rating,bids_sent:n.bids_sent,bids_awarded:n.bids_awarded,win_rate:n.win_rate,last_activity:o||null,days_dormant:d})}e.dormantGCs=r}}catch(i){console.warn("[Scout:gather] gc_contacts failed:",i)}try{const{data:i}=await m.from("weekly_tracker").select("week_number, active_projects, service_revenue, project_revenue, unbilled_amount, ytd_revenue").eq("org_id",t).order("week_number",{ascending:!1}).limit(12);i&&(e.weeklyTracker=i)}catch(i){console.warn("[Scout:gather] weekly_tracker failed:",i)}try{const{data:i}=await m.from("invoices").select("id, invoice_number, status, total, balance_due, due_date, days_overdue").eq("org_id",t).in("status",["sent","viewed","partial","overdue"]).order("days_overdue",{ascending:!1}).limit(20);i&&(e.openInvoices=i)}catch(i){console.warn("[Scout:gather] invoices failed:",i)}return e}const ye=`You are SCOUT, the System Analyzer for PowerOn Hub — an AI-powered operations platform for Power On Solutions, an electrical contracting business in Southern California.

## Your Role
You are the analytical engine. You do NOT have conversations with users. Instead, you:
1. Receive structured data snapshots from across the platform
2. Detect patterns, anomalies, inefficiencies, and opportunities
3. Generate concrete, actionable proposals with supporting evidence
4. Assign impact and risk scores to every proposal

## Your Analytical Domains

FINANCIAL PATTERNS
- Revenue trends from the 52-week tracker
- Cost overruns: actual field_log hours/materials vs project cost estimates
- Invoice aging and payment velocity
- Margin erosion across project types
- Unbilled work accumulation

PROJECT HEALTH
- Projects stalled in a phase too long
- Coordination items past due date
- Field logs showing declining hours (crew pulled off?)
- Material takeoffs with outdated pricing (waste_factor drift)

OPERATIONAL EFFICIENCY
- Labor utilization patterns (hours per project per week)
- Material cost trends (price book items with significant unit_cost changes)
- Service call frequency and revenue per call
- Scheduling gaps and crew idle time

RELATIONSHIP INTELLIGENCE
- GC contacts with high fit_score but no recent bids
- GC contacts with declining win_rate
- Clients with repeat work patterns
- Dormant relationships (90+ days no activity)

COMPLIANCE & SAFETY
- Projects missing required coordination items (permits, inspections)
- Field logs with anomalous hour patterns (potential safety concern)

## Proposal Format
Return a JSON array. Each proposal object must have:
- title: Clear, specific action title (e.g., "Update 23 wire prices in price book — avg 12% increase since last update")
- description: 2-3 sentence explanation with specific data points
- category: One of: operations, financial, scheduling, compliance, relationship, pricing, staffing
- impact_score: 1-10 integer. How much would acting on this improve the business?
- risk_score: 1-10 integer. How risky is NOT acting on this?
- source_data: Object with the specific records/metrics that triggered this proposal
- reasoning: Your analytical reasoning chain — show your work

## Scoring Guide
Impact 8-10: Direct revenue impact or critical compliance issue
Impact 5-7: Meaningful operational improvement
Impact 1-4: Nice-to-have optimization

Risk 8-10: Financial loss or safety/compliance violation imminent
Risk 5-7: Growing problem that will compound
Risk 1-4: Opportunity cost only

## Rules
- Be specific. "Revenue is down" is useless. "Week 12 project revenue dropped 34% vs 4-week average, driven by 2 projects entering punch_list phase with no new projects in pipeline" is useful.
- Always cite the specific data that supports your proposal.
- Never propose something that requires information you don't have.
- Limit to 3-8 proposals per analysis run. Quality over quantity.
- Proposals must be actionable by the business owner or office manager.
- Do NOT include greetings, summaries, or conversational text. Return ONLY the JSON array.
- SILENT QUEUE ONLY: All SCOUT proposals output to the improvement queue silently. SCOUT NEVER interrupts an active user conversation with proposals or flagged items. If a user is in a conversation about scheduling, projects, or any other topic, SCOUT does not surface proposals mid-conversation. Proposals wait in queue for the user to review them at their own time.
- SCOUT does not produce conversational responses. SCOUT does not respond to general questions. If routed here for a general question (not an explicit "Scout, analyze..." trigger), return an empty array: [].
`,be=["operations","financial","scheduling","compliance","relationship","pricing","staffing"];function _e(t){return typeof t=="string"&&be.includes(t)}function we(t){if(!t||typeof t!="object")return null;const e=t;return typeof e.title!="string"||!e.title.trim()||typeof e.description!="string"||!e.description.trim()||!_e(e.category)||typeof e.impact_score!="number"||e.impact_score<1||e.impact_score>10||typeof e.risk_score!="number"||e.risk_score<1||e.risk_score>10||typeof e.reasoning!="string"?null:{title:e.title.trim(),description:e.description.trim(),category:e.category,impact_score:Math.round(e.impact_score),risk_score:Math.round(e.risk_score),source_data:e.source_data&&typeof e.source_data=="object"?e.source_data:{},reasoning:e.reasoning}}async function ve(t){var o;const e=je(t),a=await fetch("/.netlify/functions/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:4096,system:ye,messages:[{role:"user",content:`Analyze the following data snapshot and generate proposals.

${e}`}]})});if(!a.ok){const d=await a.text();throw new Error(`SCOUT analyzer API call failed: ${a.status} ${d}`)}const r=((o=(await a.json()).content[0])==null?void 0:o.text)??"";let n;try{n=JSON.parse(r)}catch{const d=r.match(/\[[\s\S]*\]/);if(!d)return console.error("[Scout:analyzer] Non-JSON response:",r.slice(0,300)),[];n=JSON.parse(d[0])}if(!Array.isArray(n))return console.error("[Scout:analyzer] Response is not an array"),[];const l=[];for(const d of n){const u=we(d);u?l.push(u):console.warn("[Scout:analyzer] Invalid proposal skipped:",d)}return l}function je(t){const e=[];if(t.activeProjects.length>0&&e.push(`## Active Projects (${t.activeProjects.length})
`+JSON.stringify(t.activeProjects.map(a=>({name:a.name,status:a.status,type:a.type,phase:a.phase,priority:a.priority,estimated_value:a.estimated_value,contract_value:a.contract_value,updated_at:a.updated_at})),null,2)),t.fieldLogs.length>0){const a=new Map;for(const i of t.fieldLogs){const r=a.get(i.project_id)??{hours:0,material:0,entries:0};r.hours+=i.hours||0,r.material+=i.material_cost||0,r.entries+=1,a.set(i.project_id,r)}e.push(`## Field Logs — Last 30 Days (${t.fieldLogs.length} entries across ${a.size} projects)
`+JSON.stringify(Array.from(a.entries()).map(([i,r])=>({project_id:i,total_hours:r.hours,total_material_cost:r.material,entry_count:r.entries})),null,2))}if(t.outdatedPricing.length>0&&e.push(`## Outdated Price Book Items (${t.outdatedPricing.length} items >60 days stale)
`+JSON.stringify(t.outdatedPricing.slice(0,20),null,2)),t.overdueItems.length>0&&e.push(`## Overdue Coordination Items (${t.overdueItems.length})
`+JSON.stringify(t.overdueItems,null,2)),t.costVariances.length>0){const a=t.costVariances.filter(i=>i.variance_pct!==null&&Math.abs(i.variance_pct)>10);a.length>0&&e.push(`## Cost Variances >10% (${a.length} projects)
`+JSON.stringify(a,null,2))}if(t.dormantGCs.length>0&&e.push(`## Dormant GC Relationships — 90+ Days (${t.dormantGCs.length})
`+JSON.stringify(t.dormantGCs,null,2)),t.weeklyTracker.length>0&&e.push(`## Weekly Tracker — Last ${t.weeklyTracker.length} Weeks
`+JSON.stringify(t.weeklyTracker,null,2)),t.openInvoices.length>0){const a=t.openInvoices.filter(r=>r.days_overdue>0),i=t.openInvoices.reduce((r,n)=>r+(n.balance_due||0),0);e.push(`## Open Invoices (${t.openInvoices.length} total, ${a.length} overdue, $${i.toLocaleString()} outstanding)
`+JSON.stringify(t.openInvoices.slice(0,15),null,2))}return e.length===0?`## No Data Available
No data was gathered from any tables. This may indicate the org has no records yet or a connectivity issue.`:`# SCOUT Data Snapshot — ${t.gatheredAt}
Org: ${t.orgId}

${e.join(`

`)}`}async function q(t,e){const a=[],i=()=>new Date().toISOString(),r=await Se(t,e);if(a.push({step:1,name:"data_accuracy",passed:r.passed,detail:r.detail,timestamp:i()}),!r.passed)return{passed:!1,finalStep:1,confidenceScore:0,log:a,rejectionReason:`Data accuracy: ${r.detail}`};const n=ke(t);if(a.push({step:2,name:"business_logic",passed:n.passed,detail:n.detail,timestamp:i()}),!n.passed)return{passed:!1,finalStep:2,confidenceScore:0,log:a,rejectionReason:`Business logic: ${n.detail}`};const l=Ne(t);if(a.push({step:3,name:"risk_assessment",passed:l.passed,detail:l.detail,timestamp:i()}),!l.passed)return{passed:!1,finalStep:3,confidenceScore:0,log:a,rejectionReason:`Risk assessment: ${l.detail}`};const o=await Ce(t,e);if(a.push({step:4,name:"duplicate_check",passed:o.passed,detail:o.detail,timestamp:i()}),!o.passed)return{passed:!1,finalStep:4,confidenceScore:0,log:a,rejectionReason:`Duplicate: ${o.detail}`};const d=Oe(t,a),u=d>=7;return a.push({step:5,name:"confidence_score",passed:u,detail:`Score: ${d}/10 (threshold: 7)`,timestamp:i()}),u?{passed:!0,finalStep:5,confidenceScore:d,log:a}:{passed:!1,finalStep:5,confidenceScore:d,log:a,rejectionReason:`Low confidence: ${d}/10 (minimum 7 required)`}}async function Se(t,e){var a,i;try{const r=(a=t.source_data)==null?void 0:a.project_id;if(r){const{data:l}=await m.from("projects").select("id, status").eq("id",r).eq("org_id",e).single();if(!l)return{passed:!1,detail:`Referenced project ${r} not found`};if(["completed","canceled"].includes(l.status))return{passed:!1,detail:`Referenced project is ${l.status} — no longer actionable`}}const n=(i=t.source_data)==null?void 0:i.invoice_id;if(n){const{data:l}=await m.from("invoices").select("id, status").eq("id",n).eq("org_id",e).single();if(!l)return{passed:!1,detail:`Referenced invoice ${n} not found`}}return{passed:!0,detail:"Source data verified — references are current"}}catch(r){return console.warn("[MiroFish:step1] Data check error:",r),{passed:!0,detail:"Data check completed with warnings (DB query error, passed by default)"}}}function ke(t){const e=t.title.toLowerCase(),a=t.description.toLowerCase(),i=`${e} ${a}`,n=["cryptocurrency","stock trading","real estate investment","social media influencer","dropshipping","nft"].find(l=>i.includes(l));return n?{passed:!1,detail:`Proposal references "${n}" — not relevant to electrical contracting`}:t.impact_score>=9&&t.risk_score<=1?{passed:!1,detail:"Implausible score combination: very high impact with negligible risk"}:t.reasoning.length<20?{passed:!1,detail:"Insufficient reasoning — must explain analytical basis"}:t.description.length<30?{passed:!1,detail:"Description too short — proposals need specific, actionable detail"}:{passed:!0,detail:"Business logic validated — proposal is relevant and well-formed"}}function Ne(t){return t.risk_score>=9&&t.impact_score<7?{passed:!1,detail:`CRITICAL risk (${t.risk_score}) with low impact (${t.impact_score}) — not worth the risk`}:["delete all","drop table","remove all","bulk delete"].some(i=>t.title.toLowerCase().includes(i)||t.description.toLowerCase().includes(i))?{passed:!1,detail:"Proposal involves destructive operations — rejected by policy"}:t.risk_score>=8?{passed:!0,detail:`High risk (${t.risk_score}) — approved but flagged for owner review`}:{passed:!0,detail:`Risk level acceptable (${t.risk_score}/10)`}}async function Ce(t,e){try{const{data:a}=await m.from("agent_proposals").select("id, title, status").eq("org_id",e).eq("proposing_agent","scout").eq("category",t.category).in("status",["proposed","reviewing","confirmed","integrating"]).limit(10);if(a&&a.length>0){const i=t.title.toLowerCase().split(/\s+/).filter(n=>n.length>4);if(a.some(n=>{const l=n.title.toLowerCase();return i.filter(d=>l.includes(d)).length>=Math.ceil(i.length*.5)}))return{passed:!1,detail:`Similar open proposal already exists in category "${t.category}"`}}return{passed:!0,detail:"No duplicate proposals found"}}catch(a){return console.warn("[MiroFish:step4] Duplicate check error:",a),{passed:!0,detail:"Duplicate check completed with warnings (passed by default)"}}}function Oe(t,e){let a=0;a+=(t.impact_score+t.risk_score)/2;const i=Object.keys(t.source_data);i.length>=3&&(a+=.5),i.length>=5&&(a+=.5),t.reasoning.length>100&&(a+=.5),t.reasoning.length>200&&(a+=.5);const r=e.filter(n=>n.detail.includes("warning"));return a-=r.length*.5,Math.max(0,Math.min(10,Math.round(a*10)/10))}const Te=`You are SCOUT's Idea Analyzer, a specialized module that evaluates user-submitted improvement ideas for PowerOn Hub.

## PowerOn Hub Architecture

The platform consists of 11 agents working in concert:

1. **SCOUT** — System Analyzer
   - Pattern detection from operational data
   - Proposal generation
   - Files: index.ts, analyzer.ts, dataGatherer.ts, mirofish.ts, systemPrompt.ts

2. **NEXUS** — Conversational AI & User Interface
   - Chat-based user interactions
   - Form understanding
   - Real-time user support
   - Files: index.ts, conversationManager.ts

3. **PULSE** — Project & Workflow Orchestration
   - Project lifecycle management
   - Coordination item tracking
   - Phase progression
   - Files: index.ts, orchestrator.ts, statusUpdater.ts

4. **VAULT** — Secure Document & File Management
   - Document storage and versioning
   - File encryption and access control
   - Attachment management
   - Files: index.ts, storageManager.ts, encryptionHandler.ts

5. **LEDGER** — Financial & Accounting Agent
   - Invoice generation and tracking
   - Cost accounting
   - Revenue recognition
   - Files: index.ts, invoiceManager.ts, costAllocator.ts, reconciliator.ts

6. **OHM** — Labor & Resource Management
   - Crew scheduling
   - Time tracking
   - Resource allocation
   - Files: index.ts, scheduler.ts, timeTracker.ts, capacityPlanner.ts

7. **BLUEPRINT** — Technical Documentation & Estimation
   - Material takeoffs
   - Labor estimates
   - Technical specifications
   - Files: index.ts, estimator.ts, takeoffCalculator.ts

8. **CONDUCTOR** — Integration & Workflow Automation
   - Process automation
   - Third-party integrations (QuickBooks, Salesforce, etc.)
   - Webhook management
   - Files: index.ts, workflowEngine.ts, integrationHub.ts

9. **ARCHIMEDES** — Analytics & Reporting
   - Dashboard generation
   - Performance metrics
   - Historical analysis
   - Files: index.ts, reportBuilder.ts, metricsCalculator.ts

10. **SENTINEL** — Compliance & Audit
    - Permission management
    - Audit logging
    - Regulatory tracking
    - Files: index.ts, auditLogger.ts, permissionManager.ts

11. **SYNTHESIS** — Data Integration & Sync
    - Database schema management
    - Cross-agent data consistency
    - External data imports
    - Files: index.ts, schemaManger.ts, syncOrchestrator.ts

## Your Task

Given a user-submitted idea (in plain text), you will:

1. Understand the core improvement being proposed
2. Map it to affected agents and systems
3. Generate 2-3 integration options, each showing:
   - What specifically changes
   - Which agents and files are affected
   - Implementation effort (Low/Medium/High)
   - Implementation risk (Low/Medium/High)
   - Expected business impact
4. Rate the overall feasibility (1-10 scale)
5. Provide a summary of the idea's fit within PowerOn Hub

## Scoring Guide

**Feasibility 8-10:** Idea aligns with existing architecture; minimal new dependencies
**Feasibility 5-7:** Idea is implementable but requires moderate integration changes
**Feasibility 1-4:** Idea requires significant architectural changes or new systems

**Effort:**
- Low: Changes to 1-2 agents, straightforward API additions, no schema changes
- Medium: Changes to 3-4 agents, new tables/columns, moderate refactoring
- High: Changes to 5+ agents, major schema refactoring, new subsystems

**Risk:**
- Low: Isolated changes, extensive test coverage possible, rollback is simple
- Medium: Cross-agent impact, moderate testing complexity, rollback requires coordination
- High: Critical path impact, extensive integration testing needed, rollback is complex

## Output Format

Return a JSON object matching the IdeaAnalysis interface. Include only the JSON, no other text.

{
  "idea": "User's original idea text",
  "submittedBy": "Username or email from request",
  "category": "One of: Operations / Financial / Compliance / Estimating / Scheduling / Other",
  "feasibility_score": 6,
  "options": [
    {
      "description": "What changes and why this approach works",
      "affected_agents": ["SCOUT", "NEXUS"],
      "affected_files": ["scout/analyzer.ts", "nexus/conversationManager.ts"],
      "effort": "Medium",
      "risk": "Low",
      "business_impact": "Clear description of expected business outcome"
    }
  ],
  "summary": "Overall assessment of feasibility and strategic fit",
  "analyzedAt": "ISO timestamp"
}
`;function Ie(t){return typeof t=="string"&&["Operations","Financial","Compliance","Estimating","Scheduling","Other"].includes(t)}function F(t){return t==="Low"||t==="Medium"||t==="High"}function Pe(t){if(!t||typeof t!="object")return null;const e=t;return typeof e.description!="string"||!e.description.trim()||!Array.isArray(e.affected_agents)||e.affected_agents.length===0||!Array.isArray(e.affected_files)||e.affected_files.length===0||!F(e.effort)||!F(e.risk)||typeof e.business_impact!="string"||!e.business_impact.trim()?null:{description:e.description.trim(),affected_agents:e.affected_agents.map(a=>a.trim()).filter(a=>a.length>0),affected_files:e.affected_files.map(a=>a.trim()).filter(a=>a.length>0),effort:e.effort,risk:e.risk,business_impact:e.business_impact.trim()}}function Ae(t){if(!t||typeof t!="object")return null;const e=t;if(typeof e.idea!="string"||!e.idea.trim()||typeof e.submittedBy!="string"||!e.submittedBy.trim()||!Ie(e.category)||typeof e.feasibility_score!="number"||e.feasibility_score<1||e.feasibility_score>10||!Array.isArray(e.options)||e.options.length===0||typeof e.summary!="string"||!e.summary.trim())return null;const a=[];for(const i of e.options){const r=Pe(i);r&&a.push(r)}return a.length===0?null:{idea:e.idea.trim(),submittedBy:e.submittedBy.trim(),category:e.category,feasibility_score:Math.round(e.feasibility_score),options:a,summary:e.summary.trim(),analyzedAt:typeof e.analyzedAt=="string"?e.analyzedAt:new Date().toISOString()}}async function $e(t,e,a){var d;if(!t.trim()||!e.trim())throw new Error("Idea and submittedBy are required");const i=await fetch("/.netlify/functions/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:2048,system:Te,messages:[{role:"user",content:`Analyze this user-submitted improvement idea for PowerOn Hub:

Idea: ${t}

Submitted by: ${e}
Category: ${a}

Provide 2-3 integration options showing how this could be implemented within the existing agent architecture.`}]})});if(!i.ok){const u=await i.text();throw new Error(`Idea analyzer API call failed: ${i.status} ${u}`)}const n=((d=(await i.json()).content[0])==null?void 0:d.text)??"";let l;try{l=JSON.parse(n)}catch{const u=n.match(/\{[\s\S]*\}/);if(!u)return console.error("[Scout:ideaAnalyzer] Non-JSON response:",n.slice(0,300)),null;l=JSON.parse(u[0])}const o=Ae(l);return o||(console.warn("[Scout:ideaAnalyzer] Invalid analysis response:",l),null)}async function H(t){var b;const e=crypto.randomUUID(),a=new Date().toISOString(),i=Date.now();console.log("[SCOUT] Gathering data...");const r=await xe(t);console.log("[SCOUT] Analyzing patterns...");const n=await ve(r);console.log(`[SCOUT] ${n.length} raw proposals generated`),console.log("[SCOUT] Running MiroFish verification...");const l=[],o=[];for(const p of n){const f=await q(p,t);if(f.passed){const h=await G(t,p,f);h&&l.push(h)}else await J(t,p,f),o.push({title:p.title,reason:f.rejectionReason??"Unknown"})}const d=new Date().toISOString(),u=Date.now()-i;console.log(`[SCOUT] Complete: ${l.length} proposed, ${o.length} rejected (${u}ms)`);for(const p of n){const f=`SCOUT finding: ${p.title}. ${((b=p.description)==null?void 0:b.slice(0,300))||""}. Category: ${p.category||"general"}. Impact: ${p.impact_score}/10.`,h=`scout_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;X("scout_finding",h,f,{title:p.title,category:p.category,impact_score:p.impact_score}).catch(()=>{}),ce("scout_finding",{finding:p.title,description:p.description,finding_type:p.category},t).catch(()=>{})}try{await k({action:"insert",entity_type:"agent_proposals",description:`SCOUT analysis run: ${n.length} proposals generated, ${l.length} passed MiroFish, ${o.length} rejected (${u}ms)`,metadata:{run_id:e,raw_count:n.length,proposed_count:l.length,rejected_count:o.length,duration_ms:u,proposal_ids:l,rejections:o.map(p=>({title:p.title,reason:p.reason}))}})}catch(p){console.warn("[SCOUT] Audit log failed:",p)}return{runId:e,startedAt:a,completedAt:d,durationMs:u,snapshot:r,rawProposals:n,verifiedCount:l.length,rejectedCount:o.length,proposalIds:l,rejections:o}}async function G(t,e,a){try{const{data:i,error:r}=await m.from("agent_proposals").insert({org_id:t,proposing_agent:"scout",title:e.title,description:e.description,category:e.category,source_data:e.source_data,impact_score:e.impact_score/10,risk_score:e.risk_score/10,status:"proposed",mirofish_step:5,mirofish_log:a.log}).select("id").single();if(r)return console.error("[SCOUT] Proposal insert failed:",r.message),null;try{await k({action:"insert",entity_type:"agent_proposals",entity_id:i==null?void 0:i.id,description:`SCOUT proposal created: "${e.title}" (impact: ${e.impact_score}, risk: ${e.risk_score}, confidence: ${a.confidenceScore})`,metadata:{category:e.category,impact_score:e.impact_score,risk_score:e.risk_score,confidence_score:a.confidenceScore}})}catch{}const n=e.impact_score>=7?"high":e.impact_score>=4?"medium":"low";return K({agentName:"SCOUT",actionType:"gap_detected",entityType:"proposal",entityId:i==null?void 0:i.id,entityLabel:e.title,summary:`SCOUT flagged: ${e.title} — impact: ${n}`,details:{title:e.title,category:e.category,impact_score:e.impact_score,risk_score:e.risk_score}}),(i==null?void 0:i.id)??null}catch(i){return console.error("[SCOUT] Proposal insert error:",i),null}}async function J(t,e,a){try{await m.from("agent_proposals").insert({org_id:t,proposing_agent:"scout",title:e.title,description:e.description,category:e.category,source_data:{...e.source_data,rejection_reason:a.rejectionReason},impact_score:e.impact_score/10,risk_score:e.risk_score/10,status:"rejected",mirofish_step:a.finalStep,mirofish_log:a.log});try{await k({action:"reject",entity_type:"agent_proposals",description:`SCOUT proposal rejected: "${e.title}" at MiroFish step ${a.finalStep} — ${a.rejectionReason}`,metadata:{category:e.category,failed_step:a.finalStep,rejection_reason:a.rejectionReason}})}catch{}}catch(i){console.warn("[SCOUT] Rejected proposal insert failed:",i)}}async function De(t,e,a,i){console.log("[SCOUT] Analyzing user idea:",t.slice(0,80));const r=await $e(t,e,i||"Other");if(!r)throw new Error("Failed to analyze user idea");console.log(`[SCOUT] Idea analyzed: ${r.options.length} integration options generated`);const n=[],l=[];for(const o of r.options){const d={title:`User Idea: ${r.idea.slice(0,50)}... — ${o.description.slice(0,40)}`,description:o.description,category:r.category.toLowerCase(),impact_score:6,risk_score:Re(o.risk),source_data:{source:"user_submitted",submitted_by:e,original_idea:t,affected_agents:o.affected_agents,affected_files:o.affected_files,effort:o.effort,business_impact:o.business_impact,feasibility_score:r.feasibility_score},reasoning:`User-submitted idea analyzed by SCOUT. Feasibility: ${r.feasibility_score}/10. ${o.business_impact}`},u=await q(d,a);if(u.passed){const b=await G(a,d,u);b&&n.push(b)}else l.push({option:o,reason:u.rejectionReason??"Unknown reason"}),await J(a,d,u)}new Date().toISOString(),console.log(`[SCOUT] User idea processing complete: ${n.length} proposed, ${l.length} rejected`);try{await k({action:"insert",entity_type:"agent_proposals",description:`User-submitted idea analyzed: "${r.idea.slice(0,60)}..." by ${e}. ${r.options.length} options generated, ${n.length} passed MiroFish, ${l.length} rejected.`,metadata:{submitted_by:e,original_idea:t,category:r.category,feasibility_score:r.feasibility_score,options_count:r.options.length,proposed_count:n.length,rejected_count:l.length,proposal_ids:n,rejections:l.map(o=>({description:o.option.description,reason:o.reason}))}})}catch(o){console.warn("[SCOUT] User idea audit log failed:",o)}return{analysis:r,proposalIds:n,rejections:l}}function Re(t){switch(t.toLowerCase()){case"low":return 3;case"medium":return 6;case"high":return 8;default:return 5}}const Le=[{regex:/missing.*(?:price|cost|material|item)/i,category:"financial",impactLevel:"high"},{regex:/incomplete.*(?:field|log|entry|record)/i,category:"operations",impactLevel:"medium"},{regex:/(?:error|fail|crash|exception).*agent/i,category:"feature",impactLevel:"high"},{regex:/repeated.*(?:correction|fix|redo)/i,category:"optimization",impactLevel:"medium"},{regex:/no.*(?:estimate|quote|bid)/i,category:"financial",impactLevel:"high"},{regex:/(?:compliance|code|nec|permit).*(?:gap|missing|fail)/i,category:"nec_compliance",impactLevel:"high"},{regex:/(?:schedule|crew|dispatch).*(?:conflict|gap|missing)/i,category:"operations",impactLevel:"medium"},{regex:/overdue.*(?:invoice|payment|collection)/i,category:"financial",impactLevel:"high"}];async function Ue(t,e){const a=e||localStorage.getItem("poweron_org_id")||"default";let i;for(const o of Le)if(o.regex.test(t)){i=o;break}const r=(i==null?void 0:i.category)??"operations",n=(i==null?void 0:i.impactLevel)??"medium",l=`SCOUT Gap: ${t.slice(0,80)}${t.length>80?"...":""}`;try{const o=await Z({orgId:a,proposingAgent:"scout",title:l,description:t,category:r,impactLevel:n,actionType:"gap_resolution",actionPayload:{gapContext:t,detectedAt:new Date().toISOString()},sourceData:{source:"scout_gap_detection",raw_context:t}});if(!o.id)return{detected:!0,error:"Proposal created but no ID returned"};const d=await ee(o.id);return console.log(`[SCOUT:detectGap] Proposal ${o.id} — review ${d.passed?"PASSED":"FAILED"} at step ${d.step}`),{detected:!0,proposalId:o.id,title:l,category:r}}catch(o){return console.error("[SCOUT:detectGap] Failed:",o),{detected:!0,error:o instanceof Error?o.message:"Unknown error"}}}typeof window<"u"&&(window.__scout={detectGap:Ue,runScoutAnalysis:H,analyzeUserIdea:De});const Me={operations:{label:"Operations",color:"text-blue"},financial:{label:"Financial",color:"text-gold"},scheduling:{label:"Scheduling",color:"text-chrono"},compliance:{label:"Compliance",color:"text-lime"},relationship:{label:"Relationship",color:"text-spark"},pricing:{label:"Pricing",color:"text-vault"},staffing:{label:"Staffing",color:"text-purple"}};function z({label:t,value:e,max:a=10,color:i}){const r=Math.min(e/a*100,100);return s.jsxs("div",{className:"flex items-center gap-2",children:[s.jsx("span",{className:"text-[10px] font-mono text-text-3 w-12 shrink-0",children:t}),s.jsx("div",{className:"flex-1 h-1.5 bg-bg-4 rounded-full overflow-hidden",children:s.jsx("div",{className:y("h-full rounded-full transition-all duration-500",i),style:{width:`${r}%`}})}),s.jsx("span",{className:"text-[10px] font-mono font-bold text-text-2 w-6 text-right",children:e.toFixed(0)})]})}function Ee({proposal:t,onConfirm:e,onSkip:a,onViewDetails:i}){const r=Math.round(t.impact_score*10),n=Math.round(t.risk_score*10),l=Me[t.category]??{label:t.category,color:"text-text-3"},o=r>=8,d=n>=8,u=Fe(t.created_at);return s.jsxs("div",{className:y("rounded-xl border p-4 transition-all duration-200 hover:shadow-card animate-fade-in",d?"bg-red-subtle border-[rgba(255,80,96,0.20)]":o?"bg-[rgba(58,142,255,0.06)] border-[rgba(58,142,255,0.20)]":"bg-bg-2 border-bg-4"),children:[s.jsxs("div",{className:"flex items-start justify-between gap-3 mb-3",children:[s.jsxs("div",{className:"flex-1 min-w-0",children:[s.jsxs("div",{className:"flex items-center gap-2 mb-1.5 flex-wrap",children:[s.jsx("span",{className:y("text-[10px] font-mono font-bold uppercase tracking-wider",l.color),children:l.label}),s.jsx(le,{agentId:t.proposing_agent}),s.jsx("span",{className:"text-[10px] font-mono text-text-4",children:u})]}),s.jsx("h4",{className:"text-sm font-bold text-text-1 leading-snug",children:t.title})]}),s.jsxs("div",{className:"flex items-center gap-1 shrink-0",children:[s.jsxs("div",{className:y("flex items-center gap-1 px-2 py-1 rounded-lg",o?"bg-blue-subtle":"bg-bg-3"),children:[s.jsx(te,{size:12,className:o?"text-blue":"text-text-3"}),s.jsx("span",{className:y("text-[10px] font-mono font-bold",o?"text-blue":"text-text-3"),children:r})]}),s.jsxs("div",{className:y("flex items-center gap-1 px-2 py-1 rounded-lg",d?"bg-red-subtle":"bg-bg-3"),children:[s.jsx(se,{size:12,className:d?"text-red":"text-text-3"}),s.jsx("span",{className:y("text-[10px] font-mono font-bold",d?"text-red":"text-text-3"),children:n})]})]})]}),s.jsx("p",{className:"text-xs text-text-2 leading-relaxed mb-3",children:t.description}),s.jsxs("div",{className:"space-y-1.5 mb-4",children:[s.jsx(z,{label:"Impact",value:r,color:r>=8?"bg-blue":r>=5?"bg-blue/60":"bg-bg-5"}),s.jsx(z,{label:"Risk",value:n,color:n>=8?"bg-red":n>=5?"bg-orange/60":"bg-bg-5"})]}),s.jsx("div",{className:"flex items-center gap-2 mb-4",children:s.jsxs("span",{className:"text-[9px] font-mono text-text-4 bg-bg-3 rounded px-1.5 py-0.5",children:["MiroFish ",t.mirofish_step,"/5 ✓"]})}),s.jsxs("div",{className:"flex items-center gap-2",children:[s.jsxs("button",{onClick:()=>e(t.id),className:"flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green text-bg font-bold text-xs hover:brightness-110 transition-all",children:[s.jsx(ie,{size:12}),"Confirm"]}),s.jsxs("button",{onClick:()=>a(t.id),className:"flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-3 border border-bg-5 text-text-3 font-bold text-xs hover:bg-bg-4 hover:text-text-2 transition-colors",children:[s.jsx(fe,{size:12}),"Skip"]}),s.jsxs("button",{onClick:()=>i(t.id),className:"flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-3 border border-bg-5 text-text-3 font-bold text-xs hover:bg-bg-4 hover:text-text-2 transition-colors ml-auto",children:[s.jsx(ae,{size:12}),"Details"]})]})]})}function Fe(t){const e=Math.floor((Date.now()-new Date(t).getTime())/6e4);if(e<1)return"just now";if(e<60)return`${e}m ago`;const a=Math.floor(e/60);return a<24?`${a}h ago`:`${Math.floor(a/24)}d ago`}function Qe(){const{profile:t}=re(),[e,a]=x.useState([]),[i,r]=x.useState(!0),[n,l]=x.useState(!1),[o,d]=x.useState(null),[u,b]=x.useState(null),[p,f]=x.useState(null),[h,T]=x.useState("proposals"),[j,w]=x.useState([]),[N,R]=x.useState(null),C=t==null?void 0:t.org_id,O=x.useCallback(()=>{w(de())},[]);x.useEffect(()=>{O()},[h,O]);const A=x.useCallback(async()=>{if(C){r(!0);try{const{data:c,error:g}=await m.from("agent_proposals").select("id, title, description, category, impact_score, risk_score, proposing_agent, source_data, mirofish_step, status, created_at").eq("org_id",C).eq("status","proposed").order("impact_score",{ascending:!1}).limit(20);if(g)throw g;a(c??[])}catch(c){console.error("[ProposalFeed] Fetch error:",c),f("Failed to load proposals")}finally{r(!1)}}},[C]);x.useEffect(()=>{A()},[A]);const L=async()=>{if(!(!C||n)){l(!0),f(null);try{const c=await H(C);d(c),await A()}catch(c){console.error("[ProposalFeed] SCOUT run failed:",c),f(c instanceof Error?c.message:"SCOUT analysis failed")}finally{l(!1)}}},Y=async c=>{if(t)try{await m.from("agent_proposals").update({status:"confirmed",confirmed_by:t.id,confirmed_at:new Date().toISOString()}).eq("id",c),await k({action:"approve",entity_type:"agent_proposals",entity_id:c,description:`Proposal confirmed by ${t.full_name}`}),a(g=>g.filter(v=>v.id!==c))}catch(g){console.error("[ProposalFeed] Confirm failed:",g)}},B=async c=>{try{await m.from("agent_proposals").update({status:"skipped"}).eq("id",c),await k({action:"reject",entity_type:"agent_proposals",entity_id:c,description:`Proposal skipped by ${t==null?void 0:t.full_name}`}),a(g=>g.filter(v=>v.id!==c))}catch(g){console.error("[ProposalFeed] Skip failed:",g)}},V=c=>{b(u===c?null:c)},W=c=>{D(c,"dismissed"),setTimeout(()=>{pe(c),O()},300),w(g=>g.filter(v=>v.id!==c))},Q=async c=>{const g=ue(c);try{await navigator.clipboard.writeText(g),D(c.id,"reviewed"),w(v=>v.map(S=>S.id===c.id?{...S,status:"reviewed"}:S)),R(c.id),setTimeout(()=>R(null),2e3)}catch{D(c.id,"reviewed"),w(v=>v.map(S=>S.id===c.id?{...S,status:"reviewed"}:S))}},_=e.find(c=>c.id===u);return s.jsxs("div",{className:"flex flex-col h-full bg-bg",children:[s.jsxs("div",{className:"flex items-center justify-between px-5 py-3 border-b border-bg-4 bg-bg-1/80 backdrop-blur-sm",children:[s.jsxs("div",{className:"flex items-center gap-3",children:[s.jsx("div",{className:"w-8 h-8 rounded-lg bg-red-subtle border border-[rgba(255,80,96,0.25)] flex items-center justify-center",children:s.jsx($,{className:"w-4 h-4 text-scout"})}),s.jsxs("div",{children:[s.jsx("div",{className:"text-sm font-bold text-text-1",children:"SCOUT Proposals"}),s.jsxs("div",{className:"text-[10px] text-text-3 font-mono",children:[e.length," active · MiroFish verified"]})]})]}),s.jsx("button",{onClick:L,disabled:n,className:y("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all",n?"bg-bg-3 text-text-4 cursor-not-allowed":"bg-scout/10 border border-[rgba(255,80,96,0.25)] text-scout hover:bg-scout/20"),children:n?s.jsxs(s.Fragment,{children:[s.jsx(U,{size:12,className:"animate-spin"})," Running..."]}):s.jsxs(s.Fragment,{children:[s.jsx(M,{size:12})," Run SCOUT"]})})]}),s.jsxs("div",{className:"flex items-center gap-1 px-5 py-2 border-b border-bg-4 bg-bg-1/60",children:[s.jsxs("button",{onClick:()=>T("proposals"),className:y("flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all",h==="proposals"?"bg-scout/10 border border-[rgba(255,80,96,0.25)] text-scout":"text-text-3 hover:text-text-1"),children:[s.jsx($,{size:11}),"Proposals",e.length>0&&s.jsx("span",{className:"ml-1 px-1 py-0.5 rounded bg-scout/20 text-scout text-[9px] font-mono",children:e.length})]}),s.jsxs("button",{onClick:()=>{T("queue"),O()},className:y("flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all",h==="queue"?"bg-scout/10 border border-[rgba(255,80,96,0.25)] text-scout":"text-text-3 hover:text-text-1"),children:[s.jsx(E,{size:11}),"Flagged Improvements",j.filter(c=>c.status==="pending").length>0&&s.jsx("span",{className:"ml-1 px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[9px] font-mono",children:j.filter(c=>c.status==="pending").length})]})]}),o&&s.jsxs("div",{className:"mx-5 mt-3 px-4 py-2.5 rounded-lg bg-bg-2 border border-bg-4 animate-fade-in",children:[s.jsxs("div",{className:"flex items-center justify-between",children:[s.jsxs("span",{className:"text-[10px] font-mono text-text-3",children:["Last run: ",o.rawProposals.length," analyzed · ",o.verifiedCount," proposed · ",o.rejectedCount," rejected · ",o.durationMs,"ms"]}),s.jsx("button",{onClick:()=>d(null),className:"text-text-4 hover:text-text-3 text-xs",children:"✕"})]}),o.rejections.length>0&&s.jsx("div",{className:"mt-2 space-y-1",children:o.rejections.slice(0,3).map((c,g)=>s.jsxs("div",{className:"text-[10px] text-text-4 font-mono truncate",children:["✕ ",c.title.slice(0,60)," — ",c.reason]},g))})]}),p&&s.jsxs("div",{className:"mx-5 mt-3 px-4 py-2 rounded-lg bg-red-subtle border border-[rgba(255,80,96,0.25)] text-xs text-red flex items-center justify-between",children:[s.jsx("span",{children:p}),s.jsx("button",{onClick:()=>f(null),className:"hover:text-text-1 text-xs",children:"✕"})]}),s.jsxs("div",{className:"flex-1 overflow-y-auto",children:[h==="queue"&&s.jsxs("div",{className:"px-5 py-4 space-y-3",children:[s.jsxs("div",{className:"flex items-center justify-between mb-2",children:[s.jsx("div",{className:"text-xs font-bold text-text-1 uppercase tracking-wider",children:"Flagged Improvements"}),s.jsxs("button",{onClick:O,className:"text-[10px] text-text-4 hover:text-text-2 flex items-center gap-1",children:[s.jsx(M,{size:10})," Refresh"]})]}),j.length===0?s.jsxs("div",{className:"flex flex-col items-center justify-center py-16 text-center",children:[s.jsx("div",{className:"w-12 h-12 rounded-xl bg-bg-2 border border-bg-4 flex items-center justify-center mb-3",children:s.jsx(E,{className:"w-6 h-6 text-text-4"})}),s.jsx("p",{className:"text-xs text-text-3 max-w-xs",children:"No flagged improvements yet. When SCOUT detects improvement ideas during your conversations, they'll appear here silently for your review."})]}):j.map(c=>s.jsxs("div",{className:y("rounded-xl border p-4 transition-all",c.status==="pending"?"bg-bg-2 border-bg-4":c.status==="reviewed"?"bg-bg-1 border-bg-3 opacity-60":"bg-bg-1 border-bg-3 opacity-40"),children:[s.jsxs("div",{className:"flex items-center justify-between mb-2",children:[s.jsx("span",{className:"text-[10px] font-mono text-text-4",children:new Date(c.timestamp).toLocaleString("en-US",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}),s.jsx("span",{className:y("px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider",c.status==="pending"?"bg-amber-500/15 text-amber-400 border border-amber-500/30":c.status==="reviewed"?"bg-green-subtle text-green border border-green-border":"bg-bg-3 text-text-4 border border-bg-4"),children:c.status})]}),s.jsx("p",{className:"text-xs text-text-1 leading-relaxed mb-2",children:c.suggestion}),s.jsxs("p",{className:"text-[10px] text-text-4 font-mono mb-3 truncate",children:['Context: "',c.context.slice(0,80),c.context.length>80?"…":"",'"']}),s.jsxs("div",{className:"flex items-center gap-2",children:[s.jsx("button",{onClick:()=>Q(c),className:"flex items-center gap-1.5 px-3 py-1 rounded-lg bg-bg-3 border border-bg-5 text-text-2 text-[10px] font-bold hover:bg-bg-4 transition-colors min-h-[36px]",title:"Copy as Cowork prompt",children:N===c.id?s.jsxs(s.Fragment,{children:[s.jsx(ne,{size:11,className:"text-green"})," Copied!"]}):s.jsxs(s.Fragment,{children:[s.jsx(me,{size:11})," Convert to Session"]})}),s.jsxs("button",{onClick:()=>W(c.id),className:"flex items-center gap-1 px-3 py-1 rounded-lg text-text-4 text-[10px] hover:text-text-2 hover:bg-bg-3 transition-colors min-h-[36px]",title:"Dismiss",children:[s.jsx(oe,{size:11})," Dismiss"]})]})]},c.id))]}),h==="proposals"&&s.jsxs("div",{className:"flex gap-4 h-full",children:[s.jsx("div",{className:y("flex-1 px-5 py-4 space-y-3 overflow-y-auto",u&&"max-w-[60%]"),children:i?s.jsx("div",{className:"flex items-center justify-center py-20",children:s.jsx(U,{size:20,className:"animate-spin text-text-3"})}):e.length===0?s.jsxs("div",{className:"flex flex-col items-center justify-center py-20 text-center",children:[s.jsx("div",{className:"w-16 h-16 rounded-2xl bg-bg-2 border border-bg-4 flex items-center justify-center mb-4",children:s.jsx(ge,{className:"w-8 h-8 text-text-4"})}),s.jsx("h3",{className:"text-sm font-bold text-text-2 mb-2",children:"No active proposals"}),s.jsx("p",{className:"text-xs text-text-3 max-w-sm mb-4",children:"Run SCOUT to analyze your platform data and generate improvement proposals."}),s.jsxs("button",{onClick:L,disabled:n,className:"flex items-center gap-1.5 px-4 py-2 rounded-lg bg-scout text-bg font-bold text-xs hover:brightness-110 transition-all",children:[s.jsx($,{size:14}),"Run Analysis"]})]}):e.map(c=>s.jsx(Ee,{proposal:c,onConfirm:Y,onSkip:B,onViewDetails:V},c.id))}),u&&_&&s.jsxs("div",{className:"w-[40%] border-l border-bg-4 bg-bg-1 px-5 py-4 overflow-y-auto animate-fade-in",children:[s.jsxs("div",{className:"flex items-center justify-between mb-4",children:[s.jsx("h3",{className:"text-sm font-bold text-text-1",children:"Proposal Details"}),s.jsx("button",{onClick:()=>b(null),className:"text-text-4 hover:text-text-2 text-xs",children:"✕"})]}),s.jsxs("div",{className:"space-y-4",children:[s.jsxs("div",{children:[s.jsx("div",{className:"text-[10px] font-mono text-text-4 uppercase tracking-wider mb-1",children:"Title"}),s.jsx("div",{className:"text-sm text-text-1 font-semibold",children:_.title})]}),s.jsxs("div",{children:[s.jsx("div",{className:"text-[10px] font-mono text-text-4 uppercase tracking-wider mb-1",children:"Description"}),s.jsx("div",{className:"text-xs text-text-2 leading-relaxed",children:_.description})]}),s.jsxs("div",{className:"grid grid-cols-2 gap-3",children:[s.jsxs("div",{children:[s.jsx("div",{className:"text-[10px] font-mono text-text-4 uppercase tracking-wider mb-1",children:"Impact"}),s.jsxs("div",{className:"text-lg font-bold text-blue",children:[Math.round(_.impact_score*10),"/10"]})]}),s.jsxs("div",{children:[s.jsx("div",{className:"text-[10px] font-mono text-text-4 uppercase tracking-wider mb-1",children:"Risk"}),s.jsxs("div",{className:"text-lg font-bold text-red",children:[Math.round(_.risk_score*10),"/10"]})]})]}),s.jsxs("div",{children:[s.jsx("div",{className:"text-[10px] font-mono text-text-4 uppercase tracking-wider mb-1",children:"Category"}),s.jsx("div",{className:"text-xs text-text-2",children:_.category})]}),s.jsxs("div",{children:[s.jsx("div",{className:"text-[10px] font-mono text-text-4 uppercase tracking-wider mb-1",children:"MiroFish Verification"}),s.jsxs("div",{className:"text-xs text-green font-mono",children:["Passed ",_.mirofish_step,"/5 steps ✓"]})]}),_.source_data&&Object.keys(_.source_data).length>0&&s.jsxs("div",{children:[s.jsx("div",{className:"text-[10px] font-mono text-text-4 uppercase tracking-wider mb-1",children:"Source Data"}),s.jsx("pre",{className:"text-[10px] text-text-3 font-mono bg-bg-3 rounded-lg p-3 overflow-x-auto max-h-48",children:JSON.stringify(_.source_data,null,2)})]}),s.jsxs("div",{children:[s.jsx("div",{className:"text-[10px] font-mono text-text-4 uppercase tracking-wider mb-1",children:"Created"}),s.jsx("div",{className:"text-xs text-text-3 font-mono",children:new Date(_.created_at).toLocaleString()})]})]})]})]})," "]})]})}export{Qe as ProposalFeed};
//# sourceMappingURL=ProposalFeed-B1dWVX0P.js.map
