import{s as c,r as w,q as f,t as v,v as b,l as A}from"./index-Dsl29sAf.js";const E=["estimating","dashboard","finance","marketing","projects","compliance","calendar","analysis","general","multi_agent"],S=["nexus","vault","pulse","ledger","spark","blueprint","ohm","chrono","scout"],O=["LOW","MEDIUM","HIGH","CRITICAL"];function k(e){return typeof e=="string"&&E.includes(e)}function C(e){return typeof e=="string"&&S.includes(e)}function I(e){return typeof e=="string"&&O.includes(e)}function R(e){if(!e||typeof e!="object")return null;const a=e;return typeof a.type!="string"||typeof a.value!="string"?null:{type:a.type,value:a.value,id:typeof a.id=="string"?a.id:void 0}}function T(e){if(!e||typeof e!="object")return{error:"Not an object"};const a=e;if(!k(a.category))return{error:`Invalid category: ${a.category}`};if(!C(a.targetAgent))return{error:`Invalid targetAgent: ${a.targetAgent}`};if(!I(a.impactLevel))return{error:`Invalid impactLevel: ${a.impactLevel}`};if(typeof a.confidence!="number"||a.confidence<0||a.confidence>1)return{error:`Invalid confidence: ${a.confidence}`};if(typeof a.requiresConfirmation!="boolean")return{error:`Invalid requiresConfirmation: ${a.requiresConfirmation}`};if(typeof a.reasoning!="string")return{error:`Invalid reasoning: ${a.reasoning}`};const l=[];if(Array.isArray(a.entities))for(const t of a.entities){const d=R(t);d&&l.push(d)}return{data:{category:a.category,targetAgent:a.targetAgent,confidence:a.confidence,entities:l,requiresConfirmation:a.requiresConfirmation,impactLevel:a.impactLevel,reasoning:a.reasoning}}}const D=`You are the intent classifier for NEXUS, the manager agent of PowerOn Hub — an AI platform for an electrical contracting business.

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

Return ONLY valid JSON. No markdown, no explanation outside the JSON.`;async function N(e,a,l){var s;const t="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",d=l.slice(-6).map(r=>`${r.role==="user"?"User":`Assistant (${r.agentId??"nexus"})`}: ${r.content}`).join(`
`),p=[a?`## Active Context
${a}
`:"",d?`## Recent Conversation
${d}
`:"",`## New Message
${e}`].filter(Boolean).join(`
`),u=await fetch("/api/anthropic/v1/messages",{method:"POST",headers:{"x-api-key":t,"anthropic-version":"2023-06-01","content-type":"application/json","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:512,system:D,messages:[{role:"user",content:p}]})});if(!u.ok){const r=await u.text();throw new Error(`Classifier API call failed: ${u.status} ${r}`)}const o=((s=(await u.json()).content[0])==null?void 0:s.text)??"";let i;try{i=JSON.parse(o)}catch{const r=o.match(/\{[\s\S]*\}/);if(!r)throw new Error(`Classifier returned non-JSON: ${o.slice(0,200)}`);i=JSON.parse(r[0])}const n=T(i);return"error"in n?(console.error("[Classifier] Validation failed:",n.error),{category:"general",targetAgent:"nexus",confidence:.3,entities:[],requiresConfirmation:!1,impactLevel:"LOW",reasoning:`Classification validation failed: ${n.error}. Falling back to NEXUS.`}):n.data}const j=`You are NEXUS, the Manager Agent for PowerOn Hub — an AI-powered operations platform for Power On Solutions, an electrical contracting business based in Southern California.

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
`,L={nexus:"NEXUS",vault:"VAULT",pulse:"PULSE",ledger:"LEDGER",spark:"SPARK",blueprint:"BLUEPRINT",ohm:"OHM",chrono:"CHRONO",scout:"SCOUT"},M={nexus:"",vault:"You are now acting as VAULT, the Estimating Agent. You specialize in bids, cost history, margin analysis, pricing, and material costs. Use the price book, material takeoffs, and project cost data to give precise answers. Always show your math.",pulse:"You are now acting as PULSE, the Dashboard Agent. You specialize in KPIs, charts, performance metrics, weekly revenue tracking, and business intelligence. Reference the 52-week tracker for revenue trends. Be data-driven and visual in your answers.",ledger:"You are now acting as LEDGER, the Money Agent. You specialize in invoices, accounts receivable, payments, cash flow, and collections. Track overdue amounts, payment patterns, and billing status. Be precise with dollar amounts and dates.",spark:"You are now acting as SPARK, the Marketing Agent. You specialize in leads, campaigns, reviews, social media presence, and GC relationship management. Reference gc_contacts for pipeline data and win rates.",blueprint:"You are now acting as BLUEPRINT, the Project Framework Agent. You specialize in project phases, templates, permits, RFIs, change orders, coordination items, field logs, and material takeoffs. Track project status and compliance requirements.",ohm:"You are now acting as OHM, the Electrical Coach. You specialize in NEC compliance, electrical safety, code questions, and training recommendations. Always cite specific NEC articles when relevant.",chrono:"You are now acting as CHRONO, the Calendar Agent. You specialize in job scheduling, crew dispatch, reminders, and agenda task management. Help organize daily tasks and upcoming deadlines.",scout:"You are now acting as SCOUT, the System Analyzer. You detect patterns, anomalies, and optimization opportunities across the entire system. Your proposals go through the MiroFish verification chain before implementation."};async function P(e,a,l){var p,u,_;const t=[],d=(p=l.find(o=>o.type==="project"))==null?void 0:p.id;(u=l.find(o=>o.type==="client"))==null||u.id,(_=l.find(o=>o.type==="invoice"))==null||_.id;try{const{data:o}=await c.from("projects").select("id, name, status, type, priority, estimated_value, contract_value, phase").eq("org_id",e).in("status",["in_progress","approved","estimate","pending","punch_list"]).order("updated_at",{ascending:!1}).limit(20);switch(o!=null&&o.length&&t.push({label:"Active Projects",data:o,count:o.length}),a){case"vault":{const{data:i}=await c.from("price_book_items").select("name, unit_cost, unit, supplier, category_name").eq("org_id",e).limit(50);if(i!=null&&i.length&&t.push({label:"Price Book (sample)",data:i,count:i.length}),d){const{data:r}=await c.from("material_takeoff_lines").select("phase, item_name, quantity, unit_cost, waste_factor, line_total").eq("takeoff_id",d).limit(30);r!=null&&r.length&&t.push({label:"Material Takeoff Lines",data:r,count:r.length})}const{data:n}=await c.from("project_cost_summary").select("*").eq("org_id",e).limit(10);n!=null&&n.length&&t.push({label:"Cost Summary",data:n,count:n.length});const{data:s}=await c.from("material_receipts").select("project_id, phase, total, mto_estimated, variance_amount, variance_pct, receipt_date").eq("org_id",e).order("receipt_date",{ascending:!1}).limit(20);s!=null&&s.length&&t.push({label:"Material Receipts (recent)",data:s,count:s.length});break}case"pulse":{const{data:i}=await c.from("weekly_tracker").select("week_number, active_projects, service_revenue, project_revenue, unbilled_amount, ytd_revenue").eq("org_id",e).order("week_number",{ascending:!1}).limit(12);i!=null&&i.length&&t.push({label:"52-Week Tracker (recent)",data:i,count:i.length});const n=new Date(Date.now()-30*864e5).toISOString().split("T")[0],{data:s}=await c.from("field_logs").select("project_id, log_date, hours, material_cost, pay_status").eq("org_id",e).gte("log_date",n).order("log_date",{ascending:!1}).limit(50);s!=null&&s.length&&t.push({label:"Field Logs (30d)",data:s,count:s.length});break}case"ledger":{const{data:i}=await c.from("invoices").select("id, invoice_number, status, total, balance_due, due_date, days_overdue").eq("org_id",e).in("status",["sent","viewed","partial","overdue"]).order("days_overdue",{ascending:!1}).limit(20);i!=null&&i.length&&t.push({label:"Outstanding Invoices",data:i,count:i.length});const{data:n}=await c.from("field_logs").select("project_id, log_date, hours, material_cost, pay_status").eq("org_id",e).eq("pay_status","unpaid").limit(30);n!=null&&n.length&&t.push({label:"Unpaid Field Logs",data:n,count:n.length});break}case"spark":{const{data:i}=await c.from("leads").select("name, status, lead_source, estimated_value, project_type, created_at").eq("org_id",e).order("created_at",{ascending:!1}).limit(20);i!=null&&i.length&&t.push({label:"Lead Pipeline",data:i,count:i.length});const{data:n}=await c.from("gc_contacts").select("name, company, fit_score, activity_score, historical_win_rate, relationship_health, total_projects, total_revenue").eq("org_id",e).order("fit_score",{ascending:!1}).limit(15);n!=null&&n.length&&t.push({label:"GC Pipeline",data:n,count:n.length});const s=new Date(Date.now()-90*864e5).toISOString(),{data:r}=await c.from("gc_activity_log").select("activity_type, description, activity_date, created_at").eq("org_id",e).gte("created_at",s).order("created_at",{ascending:!1}).limit(20);r!=null&&r.length&&t.push({label:"GC Activity (90d)",data:r,count:r.length});const{data:g}=await c.from("campaigns").select("name, campaign_type, start_date, budget, status").eq("org_id",e).order("start_date",{ascending:!1}).limit(10);g!=null&&g.length&&t.push({label:"Campaigns",data:g,count:g.length});const{data:m}=await c.from("clients").select("id, name, company, type, source, tags").eq("org_id",e).order("updated_at",{ascending:!1}).limit(15);m!=null&&m.length&&t.push({label:"Recent Clients",data:m,count:m.length});break}case"blueprint":{const{data:i}=await c.from("coordination_items").select("project_id, category, title, status, due_date").eq("org_id",e).in("status",["open","in_progress"]).order("due_date",{ascending:!0}).limit(25);i!=null&&i.length&&t.push({label:"Open Coordination Items",data:i,count:i.length});const n=new Date(Date.now()-30*864e5).toISOString().split("T")[0],{data:s}=await c.from("field_logs").select("project_id, employee_id, log_date, hours, material_cost, notes").eq("org_id",e).gte("log_date",n).order("log_date",{ascending:!1}).limit(30);s!=null&&s.length&&t.push({label:"Field Logs (30d)",data:s,count:s.length});break}case"ohm":{const i=new Date(Date.now()-2592e6).toISOString().split("T")[0],{data:n}=await c.from("field_logs").select("project_id, log_date, notes").eq("org_id",e).gte("log_date",i).limit(20);n!=null&&n.length&&t.push({label:"Recent Field Logs",data:n,count:n.length});const{data:s}=await c.from("coordination_items").select("project_id, category, title, status").eq("org_id",e).in("category",["permit","inspect"]).in("status",["open","in_progress"]).limit(15);s!=null&&s.length&&t.push({label:"Permit/Inspect Items",data:s,count:s.length});break}case"chrono":{const i=new Date().toISOString(),n=new Date(Date.now()+14*864e5).toISOString(),{data:s}=await c.from("calendar_events").select("title, event_type, start_time, end_time, location, address").eq("org_id",e).gte("start_time",i).lte("start_time",n).order("start_time",{ascending:!0}).limit(25);s!=null&&s.length&&t.push({label:"Upcoming Events (14d)",data:s,count:s.length});const{data:r}=await c.from("agenda_tasks").select("title, task_type, status, assigned_to, due_date, priority").eq("org_id",e).in("status",["pending","in_progress"]).order("due_date",{ascending:!0}).limit(20);r!=null&&r.length&&t.push({label:"Pending Agenda Tasks",data:r,count:r.length});const{data:g}=await c.from("job_schedules").select("calendar_event_id, employee_id, lead_role, job_status, estimated_hours").eq("org_id",e).in("job_status",["scheduled","confirmed","in_progress"]).limit(20);g!=null&&g.length&&t.push({label:"Active Job Schedules",data:g,count:g.length});const m=new Date(Date.now()-7*864e5).toISOString().split("T")[0],{data:h}=await c.from("field_logs").select("project_id, log_date, hours").eq("org_id",e).gte("log_date",m).limit(20);h!=null&&h.length&&t.push({label:"Field Logs (7d)",data:h,count:h.length});break}case"scout":{const{data:i}=await c.from("invoices").select("status, total, balance_due, days_overdue").eq("org_id",e).in("status",["overdue","sent","partial"]).limit(10);i!=null&&i.length&&t.push({label:"Outstanding Invoices",data:i,count:i.length});const{data:n}=await c.from("weekly_tracker").select("week_number, ytd_revenue, unbilled_amount").eq("org_id",e).order("week_number",{ascending:!1}).limit(4);n!=null&&n.length&&t.push({label:"Recent Weeks",data:n,count:n.length});break}case"nexus":default:break}}catch(o){console.error(`[Router] Context loading failed for ${a}:`,o)}return t.length===0?"":t.map(o=>`### ${o.label} (${o.count} records)
${JSON.stringify(o.data,null,2)}`).join(`

`)}async function x(e,a,l,t){var m;const d="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",p=e.targetAgent,u=L[p],_=await P(l,p,e.entities),o=M[p],i=[j,o?`
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
Entities: ${JSON.stringify(e.entities)}`].join(""),n=[...t.slice(-10).map(h=>({role:h.role,content:h.content})),{role:"user",content:a}],s=await fetch("/api/anthropic/v1/messages",{method:"POST",headers:{"x-api-key":d,"anthropic-version":"2023-06-01","content-type":"application/json","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:2048,system:i,messages:n})});if(!s.ok){const h=await s.text();throw new Error(`Agent ${u} API call failed: ${s.status} ${h}`)}const g=((m=(await s.json()).content[0])==null?void 0:m.text)??"No response generated.";return{agentId:p,agentName:u,content:g,impactLevel:e.impactLevel}}async function y(e,a){const l=await w(f.agentContext(e,a));return l||{agentId:a,orgId:e,currentTasks:[],recentDecisions:[],activeFlags:[],lastQuery:null,lastUpdatedAt:Date.now()}}async function $(e){const a={...e,lastUpdatedAt:Date.now()};await v(f.agentContext(e.orgId,e.agentId),a,b.AGENT_CONTEXT)}async function U(e,a,l){const t=await y(e,a);t.recentDecisions.unshift({...l,at:Date.now()}),t.recentDecisions.length>10&&(t.recentDecisions=t.recentDecisions.slice(0,10)),await $(t)}const q="sk-proj-...",G="text-embedding-3-small";async function H(e){const a=await fetch("https://api.openai.com/v1/embeddings",{method:"POST",headers:{Authorization:`Bearer ${q}`,"Content-Type":"application/json"},body:JSON.stringify({model:G,input:e.slice(0,8e3)})});if(!a.ok){const t=await a.text();throw new Error(`OpenAI embedding failed: ${a.status} ${t}`)}return(await a.json()).data[0].embedding}async function Y(e){try{const a=await H(e.query),{data:l,error:t}=await c.rpc("search_memory",{p_org_id:e.orgId,p_query_embedding:`[${a.join(",")}]`,p_agent_id:e.agentId??null,p_entity_type:e.entityType??null,p_limit:e.limit??10,p_threshold:e.threshold??.7});return t?(console.error("[Memory] searchMemory error:",t),[]):l??[]}catch(a){return console.error("[Memory] searchMemory failed:",a),[]}}async function F(e){const a=Date.now();let l="";try{const o=await y(e.orgId,"nexus"),i=[];o.activeFlags.length>0&&i.push(`Active Flags:
${o.activeFlags.map(n=>`  - [${n.severity}] ${n.type}: ${n.message}`).join(`
`)}`),o.recentDecisions.length>0&&i.push(`Recent Decisions:
${o.recentDecisions.slice(0,3).map(n=>`  - ${n.description}`).join(`
`)}`);try{const n=await Y({orgId:e.orgId,query:e.message,limit:5,threshold:.72});n.length>0&&i.push(`Relevant Memories:
${n.map(s=>`  - [${s.entity_type}] ${s.content.slice(0,200)}`).join(`
`)}`)}catch{console.warn("[NEXUS] Semantic search unavailable, continuing without it.")}l=i.join(`

`)}catch(o){console.warn("[NEXUS] Memory context loading failed, continuing:",o)}const t=await N(e.message,l,e.conversationHistory),d=await x(t,e.message,e.orgId,e.conversationHistory),p=t.requiresConfirmation||t.impactLevel==="HIGH"||t.impactLevel==="CRITICAL",u=Date.now()-a;try{await A({action:"send",entity_type:"agent_messages",description:`NEXUS processed message → ${d.agentName} (${t.category}, ${t.impactLevel}, ${t.confidence.toFixed(2)} confidence, ${u}ms)`,metadata:{user_message:e.message.slice(0,500),category:t.category,target_agent:t.targetAgent,confidence:t.confidence,impact_level:t.impactLevel,entities:t.entities,duration_ms:u,needs_confirm:p}})}catch(o){console.warn("[NEXUS] Audit log failed:",o)}try{await U(e.orgId,"nexus",{description:`Routed "${e.message.slice(0,100)}" → ${d.agentName} (${t.impactLevel})`,reasoning:t.reasoning})}catch{}try{await c.from("agent_messages").insert({org_id:e.orgId,from_agent:"nexus",to_agent:t.targetAgent,type:"delegation",priority:t.impactLevel==="CRITICAL"||t.impactLevel==="HIGH"?"high":"normal",subject:e.message.slice(0,200),payload:{user_message:e.message,intent:t,response_preview:d.content.slice(0,500)},status:"processed",processed_at:new Date().toISOString()})}catch(o){console.warn("[NEXUS] Agent message log failed:",o)}const _={role:"assistant",content:d.content,agentId:d.agentId,timestamp:Date.now()};return{intent:t,agent:d,needsConfirmation:p,conversationMessage:_}}export{F as p};
//# sourceMappingURL=index-BkGe_YAE.js.map
