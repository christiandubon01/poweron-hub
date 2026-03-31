-- Migration 043: Trade Knowledge Base
-- Stores field-proven contractor judgment beyond NEC code compliance.
-- OHM queries this before calling Claude so field wisdom enriches every code answer.

CREATE TABLE IF NOT EXISTS trade_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario text NOT NULL,
  tags text[] DEFAULT '{}',
  code_answer text,
  field_answer text,
  material_options jsonb DEFAULT '[]',
  regional_factors text,
  failure_modes text,
  source text DEFAULT 'system',
  owner_notes text,
  org_id uuid,
  created_at timestamptz DEFAULT now()
);

-- Index for tag-based lookups (GIN for array containment @>)
CREATE INDEX IF NOT EXISTS trade_knowledge_tags_idx ON trade_knowledge USING GIN (tags);

-- Full-text index on scenario for text similarity queries
CREATE INDEX IF NOT EXISTS trade_knowledge_scenario_idx ON trade_knowledge USING GIN (to_tsvector('english', scenario));

ALTER TABLE trade_knowledge ENABLE ROW LEVEL SECURITY;

-- System entries (org_id IS NULL) are readable by everyone; org entries restricted to their org
CREATE POLICY "trade_knowledge_read" ON trade_knowledge
  FOR SELECT USING (
    org_id IS NULL
    OR org_id::text = current_setting('request.jwt.claims', true)::json->>'org_id'
  );

CREATE POLICY "trade_knowledge_write" ON trade_knowledge
  FOR ALL USING (
    org_id::text = current_setting('request.jwt.claims', true)::json->>'org_id'
  );

-- ── Seed: 10 Core Trade Knowledge Entries ────────────────────────────────────

INSERT INTO trade_knowledge (scenario, tags, code_answer, field_answer, material_options, regional_factors, failure_modes, source) VALUES

-- 1. Underground conduit under driveway
(
  'Underground conduit under driveway',
  ARRAY['conduit','underground','driveway','burial'],
  'NEC 300.5: PVC Schedule 40/80 requires 24" burial under driveways. RMC/IMC requires 6". Concrete encased PVC allows 18".',
  'PVC at 24" is the preferred long-term choice despite deeper trench. RMC corrodes from inside in wet or alkaline soil within 10-15 years — couplings fail first, water and roots follow. Callbacks on PVC jobs are near zero over 20 years. HDPE is premium option for irrigation-adjacent runs.',
  '[
    {"material": "PVC Sch 40", "depth": "24in", "cost": "low", "longevity": "30+ years", "notes": "Standard choice"},
    {"material": "RMC Rigid", "depth": "6in", "cost": "medium", "longevity": "10-15 years wet soil", "notes": "Shallow trench advantage offset by corrosion"},
    {"material": "HDPE", "depth": "24in", "cost": "high", "longevity": "50+ years", "notes": "Best for wet or corrosive soil"}
  ]'::jsonb,
  'Desert soil (Coachella Valley) is alkaline and sandy — PVC longevity is excellent. Avoid RMC in irrigated landscaping runs. Caliche layer common at 18-24" depth — plan for extra labor.',
  'RMC: internal rust, coupling failure, water infiltration, root intrusion. PVC: mechanical damage if burial too shallow, UV degradation if exposed above grade.',
  'system'
),

-- 2. Panel location and clearance requirements
(
  'Panel location and clearance requirements',
  ARRAY['panel','clearance','location','working-space'],
  'NEC 110.26: Minimum 30" wide x 36" deep x 6.5'' high clear working space in front of panels. 200A or less residential panels: 36" depth. Over 200A or 1000V: greater clearances apply. Panels must not be in bathrooms, clothes closets, or above stairs.',
  'The 36" depth requirement trips up almost every garage and laundry room installation. Measure before quoting — water heaters, shelving units, and washing machines eat that clearance instantly. Inspectors in the desert cities measure this strictly. Always plan panel location before framing is done; moving a panel after drywall is a major callback.',
  '[
    {"option": "Dedicated electrical room", "cost": "high", "notes": "Best for commercial, zero clearance fights"},
    {"option": "Garage flush-mount", "cost": "low", "notes": "Common residential, watch for parking clearance"},
    {"option": "Exterior NEMA 3R", "cost": "medium", "notes": "Good for service upgrades, keeps panel accessible"}
  ]'::jsonb,
  'Desert cities: panels in unconditioned garages face extreme heat (130°F+ in summer). Consider derating and breaker brand that handles high ambient temp. Palm Springs and Rancho Mirage HOAs may require panel concealment or aesthetic covers.',
  'Clearance encroachment: failed inspection, forced panel relocation. Improper location (bathroom, closet): code violation, safety hazard. Heat in unconditioned space: nuisance tripping, shortened breaker life.',
  'system'
),

-- 3. AFCI vs GFCI requirements by location
(
  'AFCI vs GFCI requirements by location',
  ARRAY['afci','gfci','protection','bedroom','bathroom','kitchen','garage'],
  'NEC 210.12: AFCI required for all 120V 15/20A circuits in dwelling bedrooms, living rooms, hallways, closets, and most habitable rooms (NEC 2023 expanded list). NEC 210.8: GFCI required for bathrooms, garages, outdoors, crawl spaces, unfinished basements, kitchens within 6'' of sink, and all 125V 15/20A receptacles in guest rooms, boathouses, and similar.',
  'The biggest source of confusion and inspection failures is which protection is required where. For new construction: wire everything for AFCI in habitable rooms and GFCI in wet/outdoor locations — the cost delta between breaker types is minimal compared to call-backs. Dual-function AFCI/GFCI breakers are the cleanest solution for kitchen and laundry circuits. Combo breakers add $15-25 per circuit vs. separate devices.',
  '[
    {"device": "Standard AFCI breaker", "cost": "~$35", "use": "Bedrooms, living areas, hallways"},
    {"device": "GFCI breaker", "cost": "~$40", "use": "Bathrooms, garages, outdoor, wet locations"},
    {"device": "Dual AFCI/GFCI breaker", "cost": "~$55", "use": "Kitchen, laundry, anywhere both required — cleanest solution"},
    {"device": "GFCI receptacle + standard breaker", "cost": "~$20 total", "use": "When panel space is premium, GFCI at first outlet"}
  ]'::jsonb,
  'California adopted NEC 2022/2023 AFCI expansion. AHJs in Riverside and San Bernardino County inspect AFCI closely. Desert vacation rental properties: GFCI outdoor receptacles fail frequently from dust and heat — use weather-resistant GFCI receptacles rated for 20A.',
  'Missing AFCI: failed rough inspection, nuisance re-inspection fees. Missing GFCI: safety hazard, electrocution risk in wet locations. Nuisance tripping in desert heat: use Eaton or Siemens AFCI — better heat tolerance than some competitor brands.',
  'system'
),

-- 4. Service entrance conductor sizing
(
  'Service entrance conductor sizing',
  ARRAY['service-entrance','conductor','sizing','service-upgrade','200A','400A'],
  'NEC 230.42, 310.15: 200A service entrance — 2/0 AWG copper or 4/0 AWG aluminum (USE-2 or SER). 400A service — parallel 350 kcmil copper or 600 kcmil aluminum, or utility-supplied conductors. Apply NEC 310.15 temperature correction for ambient heat. Aluminum SER is standard utility industry practice for service entrance.',
  'Aluminum SER for service entrance is the industry standard — do not let customers talk you into copper SE cable unless they have a specific reason. Al SER is half the cost and performs identically at service entrance voltages when properly terminated with anti-oxidant compound and rated connectors. The #1 failure point is the landing at the meter base and main breaker — use Al/Cu rated lugs, apply Noalox, and torque to spec. A loose lug causes more fires than the wire type.',
  '[
    {"size": "200A", "copper": "2/0 AWG", "aluminum": "4/0 AWG", "conduit": "2 inch min", "notes": "Standard residential upgrade"},
    {"size": "320A", "copper": "350 kcmil", "aluminum": "500 kcmil", "conduit": "3 inch min", "notes": "Common for EV + solar homes"},
    {"size": "400A", "copper": "2x 3/0 AWG parallel", "aluminum": "2x 350 kcmil parallel", "conduit": "2x 2 inch", "notes": "Requires parallel sets, utility coordination"}
  ]'::jsonb,
  'SCE and IID territory: utility will specify conductor requirements for meter base connections. Desert heat — service conductors in conduit exposed to direct sun require additional derating per NEC 310.15(B)(3)(c). Budget extra 15% for conductor sizing in desert installations.',
  'Undersized conductor: overheating, insulation failure, fire risk. Loose lugs: arcing, heat buildup, connector failure. Aluminum without anti-oxidant: oxidation increases resistance over time, creates hot spots.',
  'system'
),

-- 5. Generator interlock vs transfer switch
(
  'Generator interlock vs transfer switch',
  ARRAY['generator','interlock','transfer-switch','standby','backup-power'],
  'NEC 702.6: Transfer equipment required to prevent backfeed to utility. Interlock kits: listed mechanical device preventing simultaneous utility and generator breaker engagement — acceptable per NEC when listed for panel. Automatic Transfer Switch (ATS): dedicated device, faster switching, required for life-safety loads. Manual transfer switch: listed, standalone unit, most reliable.',
  'Interlock kits are the budget-friendly, code-compliant solution for owner-supplied portable generators. They work well when the customer understands they have to manually switch and manage loads. The failure mode is customers overloading a 5500W generator by running everything — build a load-shedding instruction sheet into every interlock job. Transfer switches are the right call for whole-home standby generators — the slight extra cost is justified by reliability and automatic operation. Never connect a generator without a listed transfer device regardless of what the customer says about "just needing it for the weekend."',
  '[
    {"option": "Panel interlock kit", "cost": "$50-150", "labor": "2-4 hours", "notes": "Best for portable generator, budget option, manual switching"},
    {"option": "Manual transfer switch (6-10 circuit)", "cost": "$300-600", "labor": "4-6 hours", "notes": "Cleanest solution, dedicated circuits, no overload risk"},
    {"option": "Automatic transfer switch", "cost": "$800-2000", "labor": "6-10 hours", "notes": "Required for whole-home standby, automatic operation"}
  ]'::jsonb,
  'Desert cities: power outages from SCE load management and wildfire shutoffs are increasing. Demand for generator interlock installs has tripled since 2020. Many customers also want battery backup — if they are asking about generators, mention Powerwall/Franklin WH as a cleaner long-term alternative.',
  'No transfer device: backfeed to utility, lineman safety hazard, utility disconnect risk. Undersized interlock/transfer switch rating: overheating, failed switching. Customer overload of portable generator: generator damage, nuisance breaker trips.',
  'system'
),

-- 6. EV charger circuit requirements
(
  'EV charger circuit requirements',
  ARRAY['ev','electric-vehicle','charger','level2','240v','circuit'],
  'NEC 625.40-625.54: EV charger circuits are classified as continuous loads — size at 125% of nameplate rating. EVSE at 48A requires 60A circuit minimum. Level 2 charger (240V/30-50A) requires 10 AWG or larger copper on 30A circuit, or 8 AWG on 40-50A circuit. GFCI protection required per NEC 625.54. Dedicated circuit required. California Title 24 requires EV-ready circuits in new construction and major remodels.',
  'The continuous load calculation is what trips up estimators. A 48A EVSE (Tesla Wall Connector, ChargePoint Home Flex) needs a 60A circuit — 6 AWG copper or 4 AWG aluminum, 60A breaker. Do not let customers overload panels by adding EV circuits without a service upgrade assessment. EV circuits added to a 200A panel serving a large house often require a load calculation first — document this. Home runs from panel are preferred over sub-panel taps for EV circuits to ensure maximum ampacity.',
  '[
    {"level": "Level 1 (120V)", "circuit": "15A dedicated", "wire": "14 AWG", "charge_rate": "~5 miles/hr", "notes": "Minimum viable, suitable for PHEVs only"},
    {"level": "Level 2 (240V 30A)", "circuit": "30A", "wire": "10 AWG", "charge_rate": "~20 miles/hr", "notes": "Most common residential, all EVs compatible"},
    {"level": "Level 2 (240V 48A)", "circuit": "60A", "wire": "6 AWG copper", "charge_rate": "~35 miles/hr", "notes": "Future-proof, maximum home charging speed"},
    {"level": "Level 2 (240V 80A)", "circuit": "100A", "wire": "3 AWG copper", "charge_rate": "~45 miles/hr", "notes": "High-load EVSE, commercial-grade home install"}
  ]'::jsonb,
  'Coachella Valley: EV adoption is high due to heat (gas engines inefficient in extreme heat) and solar installations. Many homeowners have 2+ EVs plus solar plus battery — always do a full load calc before quoting EV service. SCE rates favor EV charging at night — customers ask about time-of-use circuits.',
  'Undersized circuit: nuisance tripping, EVSE fault codes, fire risk. No GFCI: code violation, inspection failure. Shared circuit with other loads: continuous load violation, overheating.',
  'system'
),

-- 7. Solar interconnection at meter vs subpanel
(
  'Solar interconnection at meter vs subpanel',
  ARRAY['solar','interconnection','meter','subpanel','PV','backfeed'],
  'NEC 690.64, 705.12: Load-side interconnection (subpanel or main panel busbar) allowed up to 120% of busbar rating. Example: 200A busbar allows 40A solar backfeed breaker (200A × 120% = 240A, minus 200A main = 40A). Supply-side interconnection (line-side tap at meter main) requires utility coordination and line-side rated equipment. NEC 705.12(D): Solar inverter output breaker must be at opposite end of busbar from main breaker.',
  'The 120% busbar rule is the key calculation most customers and some inspectors misunderstand. A 200A panel with a 200A main breaker can only accept a 40A solar backfeed breaker without a service upgrade. This is often the deciding factor on whether a customer needs a panel upgrade before solar. Load-side interconnection is simpler and cheaper — use it when the math works. Supply-side (line-side tap) is more expensive but removes the 120% limitation and is sometimes required by larger solar systems or when the panel has no available breaker slots.',
  '[
    {"method": "Load-side busbar tap", "cost": "low", "complexity": "low", "limit": "120% busbar rule", "notes": "Standard residential solar connection, preferred method"},
    {"method": "Main breaker panel upgrade", "cost": "medium", "complexity": "medium", "limit": "New 320A or 400A service", "notes": "Required when 120% rule exceeded"},
    {"method": "Supply-side line-side tap", "cost": "high", "complexity": "high", "limit": "Utility-coordinated", "notes": "No 120% limitation, needed for large systems or full panels"}
  ]'::jsonb,
  'SCE and IID territory: both utilities have online solar interconnection applications. SCE Fast Track approval for systems under certain thresholds. IID often faster approval than SCE. Desert Hot Springs has geothermal grid — unusual load profile, confirm with IID before sizing inverter. Palm Desert: strict solar-ready requirements for all new construction.',
  'Exceeding 120% rule: failed inspection, fire risk from busbar overload. Incorrect breaker placement: failed inspection, arc flash risk. Missing rapid shutdown: California fire code violation, inspection failure.',
  'system'
),

-- 8. Underground service lateral sizing
(
  'Underground service lateral sizing',
  ARRAY['service-lateral','underground','utility','meter','sizing'],
  'NEC 230.31, 310.15: Underground service lateral conductors must be sized for the service amperage with temperature derating. For 200A underground service: 3/0 AWG copper or 350 kcmil aluminum (USE-2). For 400A: 600 kcmil aluminum parallel or utility-specified. Burial depth per NEC 300.5: 24" for USE-2 direct burial, 18" in rigid conduit, 6" for RMC under concrete.',
  'The utility (SCE/IID) almost always provides and owns the service lateral from the transformer to the meter base in residential installs — your scope starts at the meter base. For commercial or when utility specifies customer-furnished conductors, aluminum is standard. Always confirm scope with the utility before quoting — scope disputes are the #1 billing problem on service upgrade jobs. Meter base location and clearance must be utility-approved before you pull permit.',
  '[
    {"size": "100A", "conductor": "1 AWG aluminum", "conduit": "1.5 inch", "notes": "Small residential, being phased out"},
    {"size": "200A", "conductor": "350 kcmil aluminum", "conduit": "2 inch", "notes": "Standard residential service lateral"},
    {"size": "400A", "conductor": "2x 350 kcmil aluminum parallel", "conduit": "2x 2 inch", "notes": "Large residential or light commercial"}
  ]'::jsonb,
  'SCE desert territory: underground service laterals are standard for new construction. Above-ground service risers exist in older areas — upgrades often require going underground per utility rebuild standards. IID territory (eastern Coachella Valley): smaller utility, easier to coordinate, sometimes faster meter approval.',
  'Wrong scope assumption: contractor installs conductors utility was supposed to provide, no reimbursement. Incorrect burial depth: failed inspection, costly excavation rework. Aluminum without proper termination: connection failure, fire risk.',
  'system'
),

-- 9. Temp power setup on commercial job site
(
  'Temp power setup on commercial job site',
  ARRAY['temp-power','temporary','construction','job-site','commercial','spider-box'],
  'NEC 590: Temporary wiring allowed during construction, remodeling, and demolition. GFCI protection required for all 125V 15/20A receptacles on construction sites (590.6). Equipment grounding conductors required. Temporary feeders must be of adequate ampacity. GFCI assured equipment grounding conductor program acceptable as alternative. Spider boxes (portable power distribution) must be listed.',
  'Temp power is where corners get cut and injuries happen — set up yours right even when GC wants it done fast. Use listed spider boxes, not handmade boards. GFCI protection for every outlet, no exceptions. Pull a permit if the temp power will be energized more than 90 days or if the utility requires it. For ground-up commercial: coordinate temp power timing with the GC early — being the last sub to set up temp power creates enemies. Size the temp feeder for peak demand (all subs running equipment simultaneously is not unusual on push days).',
  '[
    {"option": "100A spider box (single phase)", "use": "Small commercial TI, residential construction", "notes": "Standard for most projects under 10,000 SF"},
    {"option": "200A panel (temp service)", "use": "Medium commercial, multi-story residential", "notes": "Pull temp permit, coordinate with utility"},
    {"option": "400A temp service", "use": "Large commercial, shopping center TI", "notes": "Full service upgrade-level coordination with utility"}
  ]'::jsonb,
  'Coachella Valley: extreme summer heat means temp power demand spikes for cooling during construction. HVAC subs run 240V portable AC units — size your spider box for this. Outdoor temp equipment in direct sun — derate conductors per NEC 310.15(B)(3)(c). Dust and wind common — use weatherproof GFCI covers on all outlets.',
  'No GFCI protection: OSHA violation, worker injury risk, substantial fines. Undersized temp feeder: nuisance tripping, work stoppages, GC conflict. Unlisted or homemade distribution board: inspection failure, OSHA citation.',
  'system'
),

-- 10. Aluminum wiring in older homes — splice and remediation
(
  'Aluminum wiring in older homes — splice and remediation',
  ARRAY['aluminum-wiring','older-home','remediation','splice','pigtail','copalum'],
  'CPSC and NEC: Aluminum branch circuit wiring (pre-1972, single-strand Al in 15/20A circuits) is a known fire hazard at connections. Code-compliant remediation options: (1) Complete rewire with copper; (2) CO/ALR rated devices at every outlet and switch; (3) AlumiConn or COPALUM crimp pigtails at every connection point. Al/Cu rated wire nuts are NOT an approved method. All splices must be in accessible junction boxes.',
  'Aluminum wiring remediation is a specialty niche with good margins — learn it well. The COPALUM crimp connector is the gold standard but requires a licensed tool and training. AlumiConn lugs are the practical field solution for most jobs and are widely accepted by inspectors. The most dangerous connections are at outlets, switches, and light fixtures where the aluminum was joined to copper devices without CO/ALR or listed connectors. When quoting remediation: always do a full inspection first — surprises (junction boxes in walls, added circuits over aluminum) will kill your margin if not caught upfront.',
  '[
    {"method": "COPALUM crimp pigtail", "cost": "high", "reliability": "highest", "notes": "Gold standard, requires certified tool, best for insurance claims"},
    {"method": "AlumiConn lug connector", "cost": "medium", "reliability": "very high", "notes": "Listed device, practical field solution, widely accepted"},
    {"method": "CO/ALR rated devices", "cost": "low", "reliability": "high at device only", "notes": "Only addresses device terminations, not junction splices"},
    {"method": "Full rewire to copper", "cost": "very high", "reliability": "eliminates hazard", "notes": "Only permanent solution, required for major remodels"}
  ]'::jsonb,
  'Desert cities: significant stock of 1960s-1970s homes in Palm Desert, Palm Springs, Cathedral City — aluminum wiring is common. Insurance companies increasingly requiring remediation certificates. Some homeowners discover the issue during solar installation when attic wiring is inspected.',
  'Al/Cu wire nut (not listed for Al): high-resistance connection, heat buildup, fire risk. Improper crimp on COPALUM: failed connection, fire risk. Missed junction boxes: incomplete remediation, liability exposure. Aluminum oxidation at loose terminations: progressive resistance increase, arcing.',
  'system'
);
