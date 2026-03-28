import{s as c,g as f,b as y,l as w,r as v}from"./auth-BpE4TH0M.js";const b=["estimating","dashboard","finance","marketing","projects","compliance","calendar","analysis","general","multi_agent"],A=["nexus","vault","pulse","ledger","spark","blueprint","ohm","chrono","scout"],S=["LOW","MEDIUM","HIGH","CRITICAL"];function k(e){return typeof e=="string"&&b.includes(e)}function O(e){return typeof e=="string"&&A.includes(e)}function E(e){return typeof e=="string"&&S.includes(e)}function C(e){if(!e||typeof e!="object")return null;const s=e;return typeof s.type!="string"||typeof s.value!="string"?null:{type:s.type,value:s.value,id:typeof s.id=="string"?s.id:void 0}}function R(e){if(!e||typeof e!="object")return{error:"Not an object"};const s=e;if(!k(s.category))return{error:`Invalid category: ${s.category}`};if(!O(s.targetAgent))return{error:`Invalid targetAgent: ${s.targetAgent}`};if(!E(s.impactLevel))return{error:`Invalid impactLevel: ${s.impactLevel}`};if(typeof s.confidence!="number"||s.confidence<0||s.confidence>1)return{error:`Invalid confidence: ${s.confidence}`};if(typeof s.requiresConfirmation!="boolean")return{error:`Invalid requiresConfirmation: ${s.requiresConfirmation}`};if(typeof s.reasoning!="string")return{error:`Invalid reasoning: ${s.reasoning}`};const d=[];if(Array.isArray(s.entities))for(const t of s.entities){const l=C(t);l&&d.push(l)}return{data:{category:s.category,targetAgent:s.targetAgent,confidence:s.confidence,entities:d,requiresConfirmation:s.requiresConfirmation,impactLevel:s.impactLevel,reasoning:s.reasoning}}}const I=`You are the intent classifier for NEXUS, the manager agent of PowerOn Hub — an AI platform for an electrical contracting business.

Analyze the user's message and return a JSON object with these fields:
- category: One of: estimating, dashboard, finance, marketing, projects, compliance, calendar, analysis, general, multi_agent
- targetAgent: One of: nexus, vault, pulse, ledger, spark, blueprint, ohm, chrono, scout
- confidence: 0.0 to 1.0 — how confident you are in the classification
- entities: Array of {type, value, id?} — extracted entities (project names, dates, amounts, etc.)
- requiresConfirmation: boolean — true if this action modifies data or has side effects
- impactLevel: One of: LOW, MEDIUM, HIGH, CRITICAL
- reasoning: Brief explanation of why you chose this classification

Agent routing guide:
- VAULT: estimating, bids, cost history, margins, pricing, material costs, price book
- PULSE: dashboard, KPIs, charts, reports, metrics, weekly tracker, performance
- LEDGER: invoices, payments, AR, cash flow, billing, collections, overdue
- SPARK: marketing, leads, campaigns, reviews, social media, GC contacts, outreach
- BLUEPRINT: projects, phases, permits, RFIs, change orders, coordination, field logs, MTOs
- OHM: NEC code, safety, electrical questions, code compliance, training
- CHRONO: calendar, scheduling, crew dispatch, reminders, agenda tasks
- SCOUT: system analysis, patterns, anomalies, optimization proposals, user improvement ideas, code analysis, migration analysis. Route here when: message starts with "Scout," OR contains "improvement idea" OR "I want to add" OR "suggest an improvement" OR "analyze this code" OR "code analysis" OR "migrate this"
- NEXUS: greetings, meta questions about the system, general conversation

Impact level guide:
- LOW: "Show me...", "What is...", "How many...", "List all..." — read-only
- MEDIUM: "Create a...", "Update the...", "Send a reminder...", "Add to..."
- HIGH: "Send invoice...", "Delete...", "Mark as paid...", "Change contract..."
- CRITICAL: "Delete all...", "Bulk update...", "Migration...", "Change permissions..."

Return ONLY valid JSON. No markdown, no explanation outside the JSON.`;async function T(e,s,d){var i;const t="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",l=d.slice(-6).map(r=>`${r.role==="user"?"User":`Assistant (${r.agentId??"nexus"})`}: ${r.content}`).join(`
`),p=[s?`## Active Context
${s}
`:"",l?`## Recent Conversation
${l}
`:"",`## New Message
${e}`].filter(Boolean).join(`
`),g=await fetch("/api/anthropic/v1/messages",{method:"POST",headers:{"x-api-key":t,"anthropic-version":"2023-06-01","content-type":"application/json","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:512,system:I,messages:[{role:"user",content:p}]})});if(!g.ok){const r=await g.text();throw new Error(`Classifier API call failed: ${g.status} ${r}`)}const o=((i=(await g.json()).content[0])==null?void 0:i.text)??"";let n;try{n=JSON.parse(o)}catch{const r=o.match(/\{[\s\S]*\}/);if(!r)throw new Error(`Classifier returned non-JSON: ${o.slice(0,200)}`);n=JSON.parse(r[0])}const a=R(n);return"error"in a?(console.error("[Classifier] Validation failed:",a.error),{category:"general",targetAgent:"nexus",confidence:.3,entities:[],requiresConfirmation:!1,impactLevel:"LOW",reasoning:`Classification validation failed: ${a.error}. Falling back to NEXUS.`}):a.data}const N=`You are NEXUS, the Manager Agent for PowerOn Hub — an AI-powered operations platform for Power On Solutions, an electrical contracting business based in Southern California.

## Your Role
You are the command layer. Every user message comes to you first. You:
1. Understand what the user needs
2. Determine which specialist agent should handle it
3. Delegate to that agent with the right context
4. Synthesize the response and present it clearly

## Your Personality
- Direct, professional, and efficient — like a great operations manager
- You speak in clear, concise language. No fluff.
- When you don't know something, you say so and explain what you'll do to find out.
- You refer to specialist agents by name when delegating: "Let me have VAULT pull those numbers."
- You always confirm before executing MEDIUM or HIGH impact actions.

## The Agent Network
You coordinate these specialist agents:

| Agent | Domain | When to Delegate |
|-------|--------|-----------------|
| VAULT | Estimating | Bids, cost history, margin analysis, pricing, material costs |
| PULSE | Dashboard | Charts, KPIs, trend data, performance metrics, reports |
| LEDGER | Money | Invoices, AR, payments, cash flow, billing, collections |
| SPARK | Marketing | Leads, campaigns, reviews, social media, GC relationships |
| BLUEPRINT | Projects + Compliance | Project phases, templates, permits, RFIs, change orders, coordination |
| OHM | Electrical Coach | NEC compliance, safety, code questions, training |
| CHRONO | Calendar | Jobs, scheduling, crew dispatch, reminders, agenda tasks |
| SCOUT | System Analyzer | Pattern detection, proposals, anomaly detection, optimization, user-submitted improvement ideas, code analysis & migration reports |

## Impact Levels
Every action you take has an impact level:
- **LOW**: Read-only queries, lookups, status checks. Execute immediately.
- **MEDIUM**: Creating records, sending reminders, updating statuses. Confirm with user first.
- **HIGH**: Financial transactions, deleting records, sending invoices, modifying contracts. Require explicit confirmation.
- **CRITICAL**: Bulk operations, data migrations, permission changes. Require confirmation + show detailed preview.

## Operations Hub Data (Migrated from v15r)

You have access to the following operational data streams from the field:

FIELD LOGS: Daily work entries per project — hours, mileage, materials, pay status.
  Query: field_logs (project_id, employee_id, log_date, hours, material_cost, pay_status)
  Also: service_logs for service-call variants with job_type classification.

PRICE BOOK: Master material catalog with 275+ items across 15 categories.
  Query: price_book_items (name, unit_cost, unit, supplier, waste_factor, category_name)
  Categories: Wire, Conduit, Boxes, Devices, Breakers, Panels, Lighting, EV, Solar, Hardware.

MATERIAL TAKEOFFS: Per-project bill of materials with phase breakdown.
  Query: material_takeoffs → material_takeoff_lines (phase, quantity, unit_cost, waste_factor, line_total)

52-WEEK TRACKER: Weekly revenue and activity KPIs for the fiscal year.
  Query: weekly_tracker (week_number, active_projects, service_revenue, project_revenue, unbilled_amount, ytd_revenue)

COORDINATION ITEMS: Per-project items across 6 categories (light, main, urgent, research, permit, inspect).
  Query: coordination_items (project_id, category, title, status, due_date)

AGENDA TASKS: Daily task management grouped by section (Today, This Week, etc.).
  Query: agenda_sections → agenda_tasks (text, status, assigned_to, due_date)

PROJECT COST BREAKDOWN: Estimated labor, material, and overhead line items per project.
  Query: project_labor_entries, project_material_entries, project_overhead_entries
  Summary view: project_cost_summary (est_labor_cost, est_material_cost, est_overhead_cost, est_margin_pct)

GC RELATIONSHIP DATABASE: General contractor pipeline with bid history and payment behavior.
  Query: gc_contacts (company, pipeline_phase, bids_sent, bids_awarded, win_rate, fit_score, payment_rating)
  Activity: gc_activity_log (activity_type, description, amount)

LEAD PIPELINE: Sales leads from initial contact through project conversion.
  Query: leads (name, status, lead_source, estimated_value, project_type, contacted_at, closed_at)
  Status flow: NEW → CONTACTED → ESTIMATE_SCHEDULED → ESTIMATE_DELIVERED → NEGOTIATING → WON/LOST

CAMPAIGNS: Marketing campaigns with lead attribution and ROI tracking.
  Query: campaigns (name, campaign_type, budget, status) + campaign_leads (lead_id, revenue_from_lead)

REVIEWS: Online review monitoring across Google, Yelp, Facebook.
  Query: reviews (platform, rating, body, response_needed) + review_responses (draft_response, status)

CALENDAR EVENTS: All scheduled jobs, meetings, appointments, deadlines.
  Query: calendar_events (title, event_type, start_time, end_time, location, address)

CREW AVAILABILITY: Daily crew scheduling with skills and certification tracking.
  Query: crew_availability (employee_id, availability_date, availability_status, skills)
  Dispatch: job_schedules (calendar_event_id, employee_id, lead_role, job_status, travel_time_to_job)

When a user asks about job costs, compare field_logs (actuals) against project cost entries (estimates).
When a user asks about materials, reference the price_book_items catalog and any active MTOs.
When a user asks about GC relationships, query gc_contacts and gc_activity_log for full pipeline context.
When a user asks about weekly/monthly performance, query weekly_tracker for the relevant date range.
When a user asks about leads or the sales pipeline, query leads table and summarize by status.
When a user asks about scheduling or who's available, query calendar_events and crew_availability.

## Special Routing Rules

SPARK MARKETING/LEADS:
- Messages about leads, prospects, new customers, sales pipeline → route to SPARK
- Messages about GC contacts, contractor relationships, win rates, fit scores → route to SPARK
- Messages about campaigns, marketing, advertising, ROI → route to SPARK
- Messages about reviews, Google reviews, Yelp reviews, reputation → route to SPARK
- Messages about follow-ups on leads or re-engagement → route to SPARK

CHRONO SCHEDULING:
- Messages about calendar, schedule, scheduling, appointments → route to CHRONO
- Messages about crew dispatch, crew availability, who's available → route to CHRONO
- Messages about reminders, upcoming jobs, daily agenda → route to CHRONO
- Messages about travel time, job assignments, standup → route to CHRONO
- Messages about conflicts, double-bookings, availability → route to CHRONO

SCOUT IDEA ANALYSIS:
- Messages starting with "Scout," → route to SCOUT with action: analyze_user_idea
- Messages containing "improvement idea" OR "I want to add" OR "suggest an improvement" → route to SCOUT with action: analyze_user_idea
- Messages containing "analyze this code" OR "code analysis" OR "migrate this" → route to SCOUT with action: analyze_code

## Response Format
- For simple queries: Answer directly with the data.
- For delegated tasks: Mention which agent is handling it and provide the result.
- For proposals/actions: Present a clear summary with impact level before asking for confirmation.
- Always be specific with numbers, dates, and names — never vague.
`,L={nexus:"NEXUS",vault:"VAULT",pulse:"PULSE",ledger:"LEDGER",spark:"SPARK",blueprint:"BLUEPRINT",ohm:"OHM",chrono:"CHRONO",scout:"SCOUT"},j={nexus:"",vault:"You are now acting as VAULT, the Estimating Agent. You specialize in bids, cost history, margin analysis, pricing, and material costs. Use the price book, material takeoffs, and project cost data to give precise answers. Always show your math.",pulse:"You are now acting as PULSE, the Dashboard Agent. You specialize in KPIs, charts, performance metrics, weekly revenue tracking, and business intelligence. Reference the 52-week tracker for revenue trends. Be data-driven and visual in your answers.",ledger:"You are now acting as LEDGER, the Money Agent. You specialize in invoices, accounts receivable, payments, cash flow, and collections. Track overdue amounts, payment patterns, and billing status. Be precise with dollar amounts and dates.",spark:"You are now acting as SPARK, the Marketing Agent. You specialize in leads, campaigns, reviews, social media presence, and GC relationship management. Reference gc_contacts for pipeline data and win rates.",blueprint:"You are now acting as BLUEPRINT, the Project Framework Agent. You specialize in project phases, templates, permits, RFIs, change orders, coordination items, field logs, and material takeoffs. Track project status and compliance requirements.",ohm:"You are now acting as OHM, the Electrical Coach. You specialize in NEC compliance, electrical safety, code questions, and training recommendations. Always cite specific NEC articles when relevant.",chrono:"You are now acting as CHRONO, the Calendar Agent. You specialize in job scheduling, crew dispatch, reminders, and agenda task management. Help organize daily tasks and upcoming deadlines.",scout:"You are now acting as SCOUT, the System Analyzer. You detect patterns, anomalies, and optimization opportunities across the entire system. Your proposals go through the MiroFish verification chain before implementation."};async function D(e,s,d){var p,g,_;const t=[],l=(p=d.find(o=>o.type==="project"))==null?void 0:p.id;(g=d.find(o=>o.type==="client"))==null||g.id,(_=d.find(o=>o.type==="invoice"))==null||_.id;try{const{data:o}=await c.from("projects").select("id, name, status, type, priority, estimated_value, contract_value, phase").eq("org_id",e).in("status",["in_progress","approved","estimate","pending","punch_list"]).order("updated_at",{ascending:!1}).limit(20);switch(o!=null&&o.length&&t.push({label:"Active Projects",data:o,count:o.length}),s){case"vault":{const{data:n}=await c.from("price_book_items").select("name, unit_cost, unit, supplier, category_name").eq("org_id",e).limit(50);if(n!=null&&n.length&&t.push({label:"Price Book (sample)",data:n,count:n.length}),l){const{data:r}=await c.from("material_takeoff_lines").select("phase, item_name, quantity, unit_cost, waste_factor, line_total").eq("takeoff_id",l).limit(30);r!=null&&r.length&&t.push({label:"Material Takeoff Lines",data:r,count:r.length})}const{data:a}=await c.from("project_cost_summary").select("*").eq("org_id",e).limit(10);a!=null&&a.length&&t.push({label:"Cost Summary",data:a,count:a.length});const{data:i}=await c.from("material_receipts").select("project_id, phase, total, mto_estimated, variance_amount, variance_pct, receipt_date").eq("org_id",e).order("receipt_date",{ascending:!1}).limit(20);i!=null&&i.length&&t.push({label:"Material Receipts (recent)",data:i,count:i.length});break}case"pulse":{const{data:n}=await c.from("weekly_tracker").select("week_number, active_projects, service_revenue, project_revenue, unbilled_amount, ytd_revenue").eq("org_id",e).order("week_number",{ascending:!1}).limit(12);n!=null&&n.length&&t.push({label:"52-Week Tracker (recent)",data:n,count:n.length});const a=new Date(Date.now()-30*864e5).toISOString().split("T")[0],{data:i}=await c.from("field_logs").select("project_id, log_date, hours, material_cost, pay_status").eq("org_id",e).gte("log_date",a).order("log_date",{ascending:!1}).limit(50);i!=null&&i.length&&t.push({label:"Field Logs (30d)",data:i,count:i.length});break}case"ledger":{const{data:n}=await c.from("invoices").select("id, invoice_number, status, total, balance_due, due_date, days_overdue").eq("org_id",e).in("status",["sent","viewed","partial","overdue"]).order("days_overdue",{ascending:!1}).limit(20);n!=null&&n.length&&t.push({label:"Outstanding Invoices",data:n,count:n.length});const{data:a}=await c.from("field_logs").select("project_id, log_date, hours, material_cost, pay_status").eq("org_id",e).eq("pay_status","unpaid").limit(30);a!=null&&a.length&&t.push({label:"Unpaid Field Logs",data:a,count:a.length});break}case"spark":{const{data:n}=await c.from("leads").select("name, status, lead_source, estimated_value, project_type, created_at").eq("org_id",e).order("created_at",{ascending:!1}).limit(20);n!=null&&n.length&&t.push({label:"Lead Pipeline",data:n,count:n.length});const{data:a}=await c.from("gc_contacts").select("name, company, fit_score, activity_score, historical_win_rate, relationship_health, total_projects, total_revenue").eq("org_id",e).order("fit_score",{ascending:!1}).limit(15);a!=null&&a.length&&t.push({label:"GC Pipeline",data:a,count:a.length});const i=new Date(Date.now()-90*864e5).toISOString(),{data:r}=await c.from("gc_activity_log").select("activity_type, description, activity_date, created_at").eq("org_id",e).gte("created_at",i).order("created_at",{ascending:!1}).limit(20);r!=null&&r.length&&t.push({label:"GC Activity (90d)",data:r,count:r.length});const{data:u}=await c.from("campaigns").select("name, campaign_type, start_date, budget, status").eq("org_id",e).order("start_date",{ascending:!1}).limit(10);u!=null&&u.length&&t.push({label:"Campaigns",data:u,count:u.length});const{data:m}=await c.from("clients").select("id, name, company, type, source, tags").eq("org_id",e).order("updated_at",{ascending:!1}).limit(15);m!=null&&m.length&&t.push({label:"Recent Clients",data:m,count:m.length});break}case"blueprint":{const{data:n}=await c.from("coordination_items").select("project_id, category, title, status, due_date").eq("org_id",e).in("status",["open","in_progress"]).order("due_date",{ascending:!0}).limit(25);n!=null&&n.length&&t.push({label:"Open Coordination Items",data:n,count:n.length});const a=new Date(Date.now()-30*864e5).toISOString().split("T")[0],{data:i}=await c.from("field_logs").select("project_id, employee_id, log_date, hours, material_cost, notes").eq("org_id",e).gte("log_date",a).order("log_date",{ascending:!1}).limit(30);i!=null&&i.length&&t.push({label:"Field Logs (30d)",data:i,count:i.length});break}case"ohm":{const n=new Date(Date.now()-2592e6).toISOString().split("T")[0],{data:a}=await c.from("field_logs").select("project_id, log_date, notes").eq("org_id",e).gte("log_date",n).limit(20);a!=null&&a.length&&t.push({label:"Recent Field Logs",data:a,count:a.length});const{data:i}=await c.from("coordination_items").select("project_id, category, title, status").eq("org_id",e).in("category",["permit","inspect"]).in("status",["open","in_progress"]).limit(15);i!=null&&i.length&&t.push({label:"Permit/Inspect Items",data:i,count:i.length});break}case"chrono":{const n=new Date().toISOString(),a=new Date(Date.now()+14*864e5).toISOString(),{data:i}=await c.from("calendar_events").select("title, event_type, start_time, end_time, location, address").eq("org_id",e).gte("start_time",n).lte("start_time",a).order("start_time",{ascending:!0}).limit(25);i!=null&&i.length&&t.push({label:"Upcoming Events (14d)",data:i,count:i.length});const{data:r}=await c.from("agenda_tasks").select("title, task_type, status, assigned_to, due_date, priority").eq("org_id",e).in("status",["pending","in_progress"]).order("due_date",{ascending:!0}).limit(20);r!=null&&r.length&&t.push({label:"Pending Agenda Tasks",data:r,count:r.length});const{data:u}=await c.from("job_schedules").select("calendar_event_id, employee_id, lead_role, job_status, estimated_hours").eq("org_id",e).in("job_status",["scheduled","confirmed","in_progress"]).limit(20);u!=null&&u.length&&t.push({label:"Active Job Schedules",data:u,count:u.length});const m=new Date(Date.now()-7*864e5).toISOString().split("T")[0],{data:h}=await c.from("field_logs").select("project_id, log_date, hours").eq("org_id",e).gte("log_date",m).limit(20);h!=null&&h.length&&t.push({label:"Field Logs (7d)",data:h,count:h.length});break}case"scout":{const{data:n}=await c.from("invoices").select("status, total, balance_due, days_overdue").eq("org_id",e).in("status",["overdue","sent","partial"]).limit(10);n!=null&&n.length&&t.push({label:"Outstanding Invoices",data:n,count:n.length});const{data:a}=await c.from("weekly_tracker").select("week_number, ytd_revenue, unbilled_amount").eq("org_id",e).order("week_number",{ascending:!1}).limit(4);a!=null&&a.length&&t.push({label:"Recent Weeks",data:a,count:a.length});break}case"nexus":default:break}}catch(o){console.error(`[Router] Context loading failed for ${s}:`,o)}return t.length===0?"":t.map(o=>`### ${o.label} (${o.count} records)
${JSON.stringify(o.data,null,2)}`).join(`

`)}async function M(e,s,d,t){var m;const l="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",p=e.targetAgent,g=L[p],_=await D(d,p,e.entities),o=j[p],n=[N,o?`
---

## Agent Mode
${o}`:"",_?`
---

## Live Data Context
${_}`:"",`
---

## Classification
Category: ${e.category}
Confidence: ${e.confidence}
Impact: ${e.impactLevel}
Entities: ${JSON.stringify(e.entities)}`].join(""),a=[...t.slice(-10).map(h=>({role:h.role,content:h.content})),{role:"user",content:s}],i=await fetch("/api/anthropic/v1/messages",{method:"POST",headers:{"x-api-key":l,"anthropic-version":"2023-06-01","content-type":"application/json","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:2048,system:n,messages:a})});if(!i.ok){const h=await i.text();throw new Error(`Agent ${g} API call failed: ${i.status} ${h}`)}const u=((m=(await i.json()).content[0])==null?void 0:m.text)??"No response generated.";return{agentId:p,agentName:g,content:u,impactLevel:e.impactLevel}}async function x(e){const s=Date.now();let d="";try{const o=await f(e.orgId,"nexus"),n=[];o.activeFlags.length>0&&n.push(`Active Flags:
${o.activeFlags.map(a=>`  - [${a.severity}] ${a.type}: ${a.message}`).join(`
`)}`),o.recentDecisions.length>0&&n.push(`Recent Decisions:
${o.recentDecisions.slice(0,3).map(a=>`  - ${a.description}`).join(`
`)}`);try{const a=await y({orgId:e.orgId,query:e.message,limit:5,threshold:.72});a.length>0&&n.push(`Relevant Memories:
${a.map(i=>`  - [${i.entity_type}] ${i.content.slice(0,200)}`).join(`
`)}`)}catch{console.warn("[NEXUS] Semantic search unavailable, continuing without it.")}d=n.join(`

`)}catch(o){console.warn("[NEXUS] Memory context loading failed, continuing:",o)}const t=await T(e.message,d,e.conversationHistory),l=await M(t,e.message,e.orgId,e.conversationHistory),p=t.requiresConfirmation||t.impactLevel==="HIGH"||t.impactLevel==="CRITICAL",g=Date.now()-s;try{await w({action:"send",entity_type:"agent_messages",description:`NEXUS processed message → ${l.agentName} (${t.category}, ${t.impactLevel}, ${t.confidence.toFixed(2)} confidence, ${g}ms)`,metadata:{user_message:e.message.slice(0,500),category:t.category,target_agent:t.targetAgent,confidence:t.confidence,impact_level:t.impactLevel,entities:t.entities,duration_ms:g,needs_confirm:p}})}catch(o){console.warn("[NEXUS] Audit log failed:",o)}try{await v(e.orgId,"nexus",{description:`Routed "${e.message.slice(0,100)}" → ${l.agentName} (${t.impactLevel})`,reasoning:t.reasoning})}catch{}try{await c.from("agent_messages").insert({org_id:e.orgId,from_agent:"nexus",to_agent:t.targetAgent,type:"delegation",priority:t.impactLevel==="CRITICAL"||t.impactLevel==="HIGH"?"high":"normal",subject:e.message.slice(0,200),payload:{user_message:e.message,intent:t,response_preview:l.content.slice(0,500)},status:"processed",processed_at:new Date().toISOString()})}catch(o){console.warn("[NEXUS] Agent message log failed:",o)}const _={role:"assistant",content:l.content,agentId:l.agentId,timestamp:Date.now()};return{intent:t,agent:l,needsConfirmation:p,conversationMessage:_}}export{x as p};
//# sourceMappingURL=index-Co-Z1aYF.js.map
