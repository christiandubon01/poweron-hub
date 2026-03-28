# PowerOn Hub — Phase 05 Implementation Spec
## SPARK · CHRONO · Marketing & Calendar Agents
### v2.0 SPARK & CHRONO · 11-Agent Architecture · Weeks 10–12

---

## Table of Contents

1. Overview & Architecture Summary
2. SPARK Agent — Detailed Design
3. CHRONO Agent — Detailed Design
4. New Database Migrations
5. Integration Points with Existing Agents
6. Testing Strategy & Validation
7. File Tree After Phase 05
8. What Phase 06 Expects from Phase 05

---

## 1. Overview & Architecture Summary

Phase 05 introduces two agents focused on business development and operational scheduling:

- **SPARK**: Marketing and sales pipeline management. Tracks leads from initial contact through closure, manages GC relationships with fit scoring and win rate tracking, orchestrates campaigns with ROI analysis, manages review generation and response workflows, and provides lead source attribution insights. SPARK is the growth engine.

- **CHRONO**: Calendar and scheduling maestro. Manages event CRUD with conflict detection, optimizes crew dispatch with skill-based matching, schedules jobs with travel time estimation (Coachella Valley distances), sends automated client reminders 24h and 2h before jobs, syncs with Google Calendar, manages daily agenda tasks, generates intelligent schedule summaries, and clusters jobs by location for efficiency. CHRONO is the operational timekeeper.

### Phase 05 Scope

| Component | Owner | Key Responsibility |
|-----------|-------|-------------------|
| Lead Pipeline Manager | Sales Manager | Lead creation, status transitions, follow-up scheduling |
| GC Relationship Manager | Account Manager | Relationship fit scoring, win rate tracking, activity logs |
| Campaign Manager | Marketing | Campaign CRUD, ROI tracking, lead attribution |
| Review Manager | Marketing | Review monitoring, alert triggering, response workflow |
| Lead Source Attribution | Analytics | Source tracking, conversion analysis, ROI per source |
| Follow-up Orchestrator | Sales | Automated reminders, escalation, task creation |
| Calendar Event Manager | Office Manager | Event CRUD, conflict detection, availability lookup |
| Crew Dispatch Optimizer | Foreman | Skill-based crew matching, schedule optimization |
| Job Scheduler | Office Manager | Job creation, travel time estimation, geolocation clustering |
| Client Reminder System | Comms | 24h/2h pre-job SMS/email, confirmation tracking |
| Google Calendar Sync | Integration | Bi-directional sync, conflict resolution |
| Agenda Task Manager | Everyone | Daily standup, task creation, completion tracking |
| Schedule Summary Generator | Reporting | Daily/weekly summaries, capacity analysis |

### Tech Stack Additions for Phase 05

- **Maps & Geolocation**: Google Maps API (distance matrix, geocoding)
- **Email & SMS**: Twilio for SMS, SendGrid for email
- **Calendar Integration**: Google Calendar API (OAuth 2.0)
- **Database Tables**: leads, gc_contacts, gc_activity_log, campaigns, campaign_leads, reviews, review_responses, calendar_events, crew_availability, job_schedules, agenda_tasks, travel_times

---

## 2. SPARK Agent — Detailed Design

### 2.1 Lead Lifecycle State Machine

```
[NEW] → [CONTACTED] → [ESTIMATE_SCHEDULED] → [ESTIMATE_DELIVERED] → [NEGOTIATING] ↘
                                                                                    ↓
                                                          [WON] → [CONVERTED_TO_PROJECT]
                                                          ↙
                                                    [LOST]
```

### 2.2 SPARK System Prompt

```text
You are SPARK, the Marketing & Sales Agent for Power On Solutions,
a Southern California electrical contracting firm in Coachella Valley.

CORE RESPONSIBILITIES:
- Manage lead lifecycle from initial contact through project conversion
- Score and track GC (General Contractor) relationships for fit and engagement
- Create and monitor campaigns with lead source attribution and ROI analysis
- Manage online reviews: monitoring, response drafting, approval workflow
- Provide lead source conversion analysis and recommendations
- Schedule and track automated follow-ups to prevent lead leakage
- Generate social media content suggestions for NEXUS distribution

LEAD STATES:
- NEW: Just created, no contact
- CONTACTED: Outreach made (call/email/text)
- ESTIMATE_SCHEDULED: Appointment booked
- ESTIMATE_DELIVERED: Quote sent, awaiting decision
- NEGOTIATING: Client asking questions
- WON: Deal closed, converting to project
- LOST: Opportunity missed, reason documented

GC RELATIONSHIP SCORING (0-100):
- Fit Score: Project types, avg value, historical win rate, communication quality
- Activity Score: Recent contacts, follow-up consistency, response time
- Win Rate: Historical % of estimates that became projects
- Health: GREEN (engaged), YELLOW (dormant), RED (churn risk)

CAMPAIGN TYPES:
- Social Media, Email Blast, Referral Program, Trade Show, In-Person Event, Retargeting
- Lead Attribution: Track source; attribute closure back to campaign
- ROI: (Revenue from leads - Campaign cost) / Campaign cost

REVIEW MANAGEMENT:
- Monitor Google, Yelp, Facebook daily
- Alert on 1-3 star reviews
- Draft responses (empathetic, concise, <150 words)
- Require human approval before publishing

FOLLOW-UP AUTOMATION:
- NEW: Day 2 check-in
- CONTACTED: Day 3 & 7 reminders
- ESTIMATE_DELIVERED: Day 3, 7, 14 follow-ups
- LOST: 60-day re-engagement check

INTEGRATION POINTS:
- Escalates won leads to BLUEPRINT (project creation)
- Queries VAULT (win rate trending)
- Coordinates with NEXUS (social content distribution)
- Logs activities to gc_activity_log
- Syncs tasks to CHRONO

SAFETY CONSTRAINTS:
- Do not send SMS/email without human approval (draft only)
- Do not delete review responses
- Escalate high-value leads (>$50k) to NEXUS
- Do not re-contact lost leads > once per 90 days

TONE: Energetic, data-driven, growth-focused. Celebrate wins; learn from losses.
```

### 2.3 SPARK Database Schema

```sql
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  lead_source VARCHAR(50) NOT NULL,
  source_detail TEXT,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(20), email VARCHAR(255),
  gc_contact_id UUID REFERENCES gc_contacts(id),
  client_id UUID REFERENCES clients(id),
  project_type VARCHAR(50),
  estimated_value DECIMAL(12,2),
  status VARCHAR(50) NOT NULL DEFAULT 'new',
  assigned_to UUID REFERENCES employees(id),
  assigned_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  contacted_at TIMESTAMP,
  estimate_scheduled_at TIMESTAMP,
  estimate_delivery_date DATE,
  closed_at TIMESTAMP,
  lost_reason VARCHAR(255),
  close_notes TEXT,
  metadata JSONB DEFAULT '{}',
  CONSTRAINT status_valid CHECK (status IN ('new', 'contacted', 'estimate_scheduled', 'estimate_delivered', 'negotiating', 'won', 'lost'))
);
CREATE INDEX idx_leads_org_id ON leads(org_id);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_lead_source ON leads(lead_source);

CREATE TABLE gc_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  name VARCHAR(255) NOT NULL,
  company VARCHAR(255),
  phone VARCHAR(20),
  email VARCHAR(255),
  fit_score INTEGER DEFAULT 50,
  activity_score INTEGER DEFAULT 50,
  historical_win_rate INTEGER DEFAULT 0,
  relationship_health VARCHAR(20) DEFAULT 'green',
  total_projects INTEGER DEFAULT 0,
  total_revenue DECIMAL(12,2) DEFAULT 0,
  last_contact_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT health_valid CHECK (relationship_health IN ('green', 'yellow', 'red'))
);
CREATE INDEX idx_gc_contacts_org_id ON gc_contacts(org_id);

CREATE TABLE gc_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  gc_contact_id UUID NOT NULL REFERENCES gc_contacts(id),
  activity_type VARCHAR(50) NOT NULL,
  activity_date TIMESTAMP DEFAULT NOW(),
  description TEXT,
  logged_by UUID REFERENCES employees(id),
  lead_id UUID REFERENCES leads(id),
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT activity_type_valid CHECK (activity_type IN ('call', 'email', 'in_person', 'proposal_sent', 'follow_up', 'project_closed'))
);

CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  name VARCHAR(255) NOT NULL,
  campaign_type VARCHAR(50) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  budget DECIMAL(12,2),
  status VARCHAR(20) DEFAULT 'planning',
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT campaign_type_valid CHECK (campaign_type IN ('social_media', 'email_blast', 'referral_program', 'trade_show', 'in_person_event', 'retargeting', 'other'))
);

CREATE TABLE campaign_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  campaign_id UUID NOT NULL REFERENCES campaigns(id),
  lead_id UUID NOT NULL REFERENCES leads(id),
  attributed_at TIMESTAMP DEFAULT NOW(),
  revenue_from_lead DECIMAL(12,2),
  UNIQUE(campaign_id, lead_id)
);

CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  platform VARCHAR(50) NOT NULL,
  review_id VARCHAR(255) UNIQUE,
  reviewer_name VARCHAR(255),
  rating INTEGER NOT NULL,
  title VARCHAR(255),
  body TEXT,
  review_date TIMESTAMP NOT NULL,
  sentiment VARCHAR(20),
  themes JSONB DEFAULT '{}',
  response_needed BOOLEAN DEFAULT FALSE,
  escalated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT rating_valid CHECK (rating >= 1 AND rating <= 5)
);

CREATE TABLE review_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  review_id UUID NOT NULL REFERENCES reviews(id),
  draft_response TEXT,
  published_response TEXT,
  drafted_by UUID REFERENCES employees(id),
  approved_by UUID REFERENCES employees(id),
  published_at TIMESTAMP,
  status VARCHAR(20) DEFAULT 'draft',
  CONSTRAINT status_valid CHECK (status IN ('draft', 'approved', 'published'))
);
```

### 2.4 SPARK TypeScript Implementation

```typescript
// src/agents/spark.ts
export interface Lead {
  id: string;
  org_id: string;
  lead_source: string;
  status: 'new' | 'contacted' | 'estimate_scheduled' | 'estimate_delivered' | 'negotiating' | 'won' | 'lost';
  name: string;
  estimated_value?: number;
  created_at: string;
}

export class SPARKAgent {
  async createLead(lead: Omit<Lead, 'id' | 'created_at'>): Promise<Lead> {
    const response = await fetch('/api/spark/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lead),
    });
    return response.json() as Promise<Lead>;
  }

  async updateLeadStatus(leadId: string, status: Lead['status']): Promise<Lead> {
    const response = await fetch(`/api/spark/leads/${leadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    return response.json() as Promise<Lead>;
  }

  async calculateCampaignROI(campaignId: string): Promise<{ roi: number }> {
    const response = await fetch(`/api/spark/campaigns/${campaignId}/roi`, {
      method: 'GET',
    });
    return response.json();
  }

  async draftReviewResponse(reviewId: string, reviewText: string): Promise<{ draft: string }> {
    const response = await fetch('/api/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: 'Draft professional, empathetic responses to customer reviews. Keep under 150 words. Address specific feedback.',
        messages: [{ role: 'user', content: `Review: "${reviewText}"\n\nDraft a professional response.` }],
      }),
    });
    const data = await response.json() as any;
    return { draft: data.content?.[0]?.text || '' };
  }
}
```

---

## 3. CHRONO Agent — Detailed Design

### 3.1 Scheduling & Dispatch Flow

```
[CALENDAR_EVENT] → [CONFLICT_CHECK] → [CREW_MATCHING] → [TRAVEL_ESTIMATION] 
  → [REMINDER_SCHEDULING] → [CONFIRMED_SCHEDULE]
```

### 3.2 CHRONO System Prompt

```text
You are CHRONO, the Calendar & Scheduling Agent for Power On Solutions.

CORE RESPONSIBILITIES:
- Manage all calendar events (jobs, meetings, deadlines)
- Detect and resolve scheduling conflicts
- Optimize crew dispatch with skill-based matching
- Estimate travel times (Coachella Valley specialized)
- Schedule automated client reminders (24h, 2h pre-job)
- Sync with Google Calendar (bi-directional)
- Generate daily/weekly schedule summaries
- Manage crew availability and agenda tasks

SERVICE AREA: Coachella Valley (Palm Springs, Indio, La Quinta, Coachella)
TYPICAL TRAVEL: 15-45 min within valley; 45-90 min to LA/OC

JOB TYPES:
- Service calls: 2-4 hours
- Remodels: 3-5 days
- New construction: 2-8 weeks

CREW SKILLS: Service, residential wiring, commercial, solar, EV charging, high-voltage

CALENDAR EVENT TYPES:
- JOB_SCHEDULE: Scheduled work for client
- MEETING: Internal standup, planning
- APPOINTMENT: Service call, estimate
- DEADLINE: Permit, inspection
- VACATION/SICK: Crew unavailability
- MAINTENANCE: Equipment service

CREW DISPATCH ALGORITHM:
1. Identify available crew for job/skills
2. Filter crew with no conflicts + travel time buffer
3. Calculate travel distance from last job
4. Score crew: minimized travel, skill match, availability
5. Cluster jobs by location to reduce travel
6. Assign highest-scoring crew; require 24h confirmation

REMINDER SYSTEM:
- 24h before: "Hi [Client], appointment tomorrow at [time]. Confirm: YES"
- 2h before: "Hi [Client], Power On arrives in 2 hours"
- Post-job: "Thanks for choosing Power On! Rate your experience [link]"

GOOGLE CALENDAR SYNC:
- Bi-directional with 5-min latency
- Detect external conflicts; propose alternatives
- No removal of external events (sync only)

SCHEDULE SUMMARIES:
- Daily 6am: Total jobs, crew assigned, travel times, deadlines
- Weekly Monday 8am: Capacity analysis, no-shows, bottlenecks

KEY BEHAVIORS:
1. When job scheduled, run dispatch algorithm
2. When crew confirms, schedule 24h reminder
3. Escalate non-confirmations at 20h mark
4. When 2h before job, send arrival reminder
5. Detect crew availability conflicts; find replacement
6. Generate daily standup for manager

COACHELLA VALLEY TRAVEL TIMES:
- Palm Springs ↔ Indio: 20-30 min
- Palm Springs ↔ La Quinta: 25-35 min
- Indio ↔ Coachella: 15-25 min
- Use Google Maps Distance Matrix API as primary source

SAFETY CONSTRAINTS:
- Do not assign crew without availability/skills confirmation
- Do not schedule jobs without address and 24h notice
- Do not remove external Google Calendar events
- Confirm client contact before sending reminders
- Notify crew < 15 min away, don't call

TONE: Efficient, detail-oriented, proactive about logistics. Communicate delays immediately.
```

### 3.3 CHRONO Database Schema

```sql
CREATE TABLE calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  title VARCHAR(255) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  location VARCHAR(255),
  address TEXT,
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  client_id UUID REFERENCES clients(id),
  project_id UUID REFERENCES projects(id),
  created_by UUID REFERENCES employees(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT event_type_valid CHECK (event_type IN ('job_schedule', 'meeting', 'appointment', 'deadline', 'vacation', 'maintenance'))
);
CREATE INDEX idx_calendar_events_org_id ON calendar_events(org_id);
CREATE INDEX idx_calendar_events_start_time ON calendar_events(start_time);

CREATE TABLE crew_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  employee_id UUID NOT NULL REFERENCES employees(id),
  availability_date DATE NOT NULL,
  availability_status VARCHAR(20) NOT NULL,
  hours_available DECIMAL(4,2),
  skills JSONB DEFAULT '[]',
  certifications JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT status_valid CHECK (availability_status IN ('available', 'unavailable', 'vacation', 'sick', 'pto', 'training')),
  UNIQUE(org_id, employee_id, availability_date)
);

CREATE TABLE job_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  calendar_event_id UUID NOT NULL REFERENCES calendar_events(id),
  employee_id UUID NOT NULL REFERENCES employees(id),
  lead_role VARCHAR(50) NOT NULL,
  job_status VARCHAR(20) DEFAULT 'scheduled',
  estimated_hours DECIMAL(5,2),
  travel_time_to_job INTEGER,
  travel_distance DECIMAL(8,2),
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT role_valid CHECK (lead_role IN ('lead_tech', 'tech_2', 'helper', 'supervisor')),
  CONSTRAINT status_valid CHECK (job_status IN ('scheduled', 'confirmed', 'in_progress', 'completed', 'no_show', 'cancelled'))
);

CREATE TABLE agenda_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  title VARCHAR(255) NOT NULL,
  task_type VARCHAR(50) NOT NULL,
  assigned_to UUID REFERENCES employees(id),
  due_date DATE NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  priority VARCHAR(20) DEFAULT 'medium',
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT task_type_valid CHECK (task_type IN ('standup', 'follow_up', 'reminder', 'deadline', 'escalation')),
  CONSTRAINT status_valid CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled'))
);

CREATE TABLE travel_times (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  from_location VARCHAR(255) NOT NULL,
  to_location VARCHAR(255) NOT NULL,
  distance_miles DECIMAL(8,2),
  duration_minutes_normal INTEGER,
  duration_minutes_peak INTEGER,
  last_updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(org_id, from_location, to_location)
);
```

### 3.4 CHRONO TypeScript Implementation

```typescript
// src/agents/chrono.ts
export interface CalendarEvent {
  id: string;
  org_id: string;
  title: string;
  event_type: 'job_schedule' | 'meeting' | 'appointment' | 'deadline' | 'vacation' | 'maintenance';
  start_time: string;
  end_time: string;
  address?: string;
  created_at: string;
}

export interface JobSchedule {
  id: string;
  calendar_event_id: string;
  employee_id: string;
  lead_role: 'lead_tech' | 'tech_2' | 'helper' | 'supervisor';
  job_status: 'scheduled' | 'confirmed' | 'in_progress' | 'completed' | 'no_show' | 'cancelled';
  estimated_hours: number;
  created_at: string;
}

export class CHRONOAgent {
  async createCalendarEvent(event: Omit<CalendarEvent, 'id' | 'created_at'>): Promise<CalendarEvent> {
    const response = await fetch('/api/chrono/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    return response.json();
  }

  async checkConflicts(startTime: string, endTime: string, employeeId?: string): Promise<CalendarEvent[]> {
    const params = new URLSearchParams({ start_time: startTime, end_time: endTime });
    if (employeeId) params.append('employee_id', employeeId);
    const response = await fetch(`/api/chrono/conflicts?${params}`, { method: 'GET' });
    return response.json();
  }

  async assignCrewToJob(calendarEventId: string, requirements: { skills: string[]; crew_count: number; hours: number }): Promise<JobSchedule[]> {
    const response = await fetch(`/api/chrono/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendar_event_id: calendarEventId, ...requirements }),
    });
    return response.json();
  }

  async estimateTravelTime(fromLocation: string, toLocation: string): Promise<{ minutes: number; miles: number }> {
    const params = new URLSearchParams({ from: fromLocation, to: toLocation });
    const response = await fetch(`/api/chrono/travel-time?${params}`, { method: 'GET' });
    return response.json();
  }

  async generateDailyScheduleSummary(orgId: string, date: string): Promise<{ html: string }> {
    const response = await fetch('/api/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: 'Summarize daily schedules as standup reports. Format: total jobs, crew assigned, travel times, deadlines, capacity notes. Be actionable.',
        messages: [{ role: 'user', content: `Summarize today (${date}) schedule.` }],
      }),
    });
    const data = await response.json() as any;
    return { html: data.content?.[0]?.text || '' };
  }
}
```

---

## 4. New Database Migrations

Full SQL migration file (2025-03-27-phase05-spark-chrono.sql) includes:
- SPARK tables: leads, gc_contacts, gc_activity_log, campaigns, campaign_leads, reviews, review_responses
- CHRONO tables: calendar_events, crew_availability, job_schedules, agenda_tasks, travel_times
- All indexes for org_id, status, date fields
- Constraints for valid enum values
- Unique constraints for campaign_leads, crew_availability, travel_times

---

## 5. Integration Points with Existing Agents

**SPARK ↔ NEXUS**: High-value leads (>$50k) escalate to NEXUS. NEXUS routes customer inquiries to SPARK.

**SPARK ↔ VAULT**: SPARK queries win rates; VAULT creates estimates for closed leads.

**SPARK ↔ CHRONO**: SPARK creates estimate appointment events. CHRONO sends 24h/2h reminders.

**SPARK ↔ BLUEPRINT**: Won leads convert to BLUEPRINT projects.

**CHRONO ↔ BLUEPRINT**: BLUEPRINT job schedules create CHRONO calendar events.

**CHRONO ↔ LEDGER**: Job schedules feed labor hours to invoice line items.

**CHRONO ↔ PULSE**: CHRONO provides crew utilization metrics to PULSE dashboard.

---

## 6. Testing Strategy & Validation

**SPARK Unit Tests**:
- Lead status transitions (all 7 states)
- GC fit score calculations (multiple data points)
- Campaign ROI calculation (zero leads, multi-lead)
- Review response generation (positive, negative, neutral)
- Lead source attribution (multi-campaign scenarios)

**CHRONO Unit Tests**:
- Conflict detection (overlapping times, crew availability)
- Crew dispatch algorithm (skill matching, location clustering)
- Travel time caching and API fallback
- Reminder scheduling (24h, 2h, confirmation deadline)
- Schedule summary generation

**Integration Tests**:
- Lead created → CHRONO event → crew assigned → reminder sent
- Campaign created → leads attributed → ROI calculated
- Google Calendar sync (create, update, delete)
- Crew assigned → PULSE dashboard updates

**E2E Test Flows**:
1. Inbound lead → estimate scheduled → job completed
2. Campaign launched → leads tracked → ROI measured
3. GC relationship scored → win rate tracked

---

## 7. File Tree After Phase 05

```
src/agents/
├── spark.ts (NEW)
├── chrono.ts (NEW)
└── ... (existing)

src/types/
├── spark.ts (NEW)
├── chrono.ts (NEW)
└── ... (existing)

src/api/
├── spark/ (NEW)
│   ├── leads.ts
│   ├── gc.ts
│   ├── campaigns.ts
│   └── reviews.ts
├── chrono/ (NEW)
│   ├── events.ts
│   ├── crew.ts
│   ├── schedules.ts
│   ├── reminders.ts
│   └── travel.ts
└── ... (existing)

src/components/
├── spark/ (NEW)
│   ├── LeadPipeline.tsx
│   ├── GCDashboard.tsx
│   ├── CampaignTracker.tsx
│   └── ReviewManager.tsx
├── chrono/ (NEW)
│   ├── Calendar.tsx
│   ├── CrewDispatch.tsx
│   ├── JobScheduler.tsx
│   ├── ScheduleSummary.tsx
│   └── ReminderQueue.tsx
└── ... (existing)

db/migrations/
├── 2025-03-27-phase05-spark-chrono.sql (NEW)
└── ... (existing)
```

---

## 8. What Phase 06 Expects from Phase 05

1. **Stable SPARK & CHRONO APIs**: Lead CRUD, status transitions, calendar events, conflict detection, crew dispatch all reliable.

2. **Database stability**: leads, calendar_events, job_schedules, gc_contacts tables populated; no breaking schema changes.

3. **Consistent system prompts**: SPARK and CHRONO prompts finalized; behaviors repeatable and documented.

4. **Google Calendar sync**: Bi-directional sync working; conflict resolution established.

5. **Email/SMS infrastructure**: Twilio and SendGrid configured; reminder templates ready.

6. **Metrics available**: Lead source ROI, GC fit scores, crew utilization measurable. Schedule summaries consumable by voice synthesis.

**Phase 06 (Voice Interface)** will layer voice commands (Whisper + ElevenLabs) on top of these APIs, enabling crew and staff to use voice-driven workflows for scheduling, status updates, and follow-ups.
