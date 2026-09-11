# 05 — AI-native construction field & reporting products: where the frontier is (Sept 2026)

Research date: 2026-09-09. Scope: products E-Site could learn from or be compared with, with the founder question "what does a small team with a rich structured dataset ship in 12 months?"

## Part 1 — Product-by-product

### Buildots (computer-vision progress tracking, "construction intelligence")
- **Problem / loop.** GC and owner site managers wear a 360° helmet camera on their normal walks; imagery is matched to BIM + schedule to produce per-activity progress, deviation alerts and a weekly "Delay Forecast" (at-risk activities, projected slip, recommended pace corrections). Loop: walk → automatic diff → weekly risk review. [TechCrunch](https://techcrunch.com/2025/05/29/buildots-raises-45m-to-help-companies-track-construction-progress/), [Delay Forecast](https://buildots.com/blog/deep-dive-into-delay-forecast/)
- **AI + data needed.** CV trained on construction imagery; needs a BIM model, a linked schedule, and regular full-site 360 walks. Oct 2025 Genda acquisition adds workforce/headcount sensors to relate labour to progress. [Construction Dive](https://www.constructiondive.com/news/buildots-acquires-genda-safety-data-workforce/803492/)
- **Adoption.** $45M Series D (May 2025), $166M total; ~50 firms incl. Intel, Turner, JE Dunn, HOCHTIEF, Bouygues; ~416 staff. Intel case: 4.3% rework-cost saving and ~4 weeks delay avoided per fab, 1,176 model updates per fab. Claims "up to 50%" schedule-slippage reduction. [Intel case](https://buildots.com/case-studies/intel-partners-with-buildots/), [PRN Apr 2026](https://www.prnewswire.com/news-releases/buildots-unveils-construction-intelligence-as-the-new-standard-for-construction-operations-302742982.html)
- **Working vs marketing.** Works on large, BIM-rich, repetitive builds (fabs, data centres, hospitals). Requires a model, a maintained schedule and disciplined walks — three things a typical SA retail/commercial electrical job does not have. The "50%" is a ceiling claim across hundreds of projects, not a median.

### OpenSpace (360 capture → "Visual Intelligence", Track, Field)
- **Problem / loop.** Hard-hat 360 camera, image every 0.5 s, auto-pinned to floor plans in ~15 min. Loop: walk daily → everyone remote sees the site → issues/punch raised on the image. [Capture](https://www.openspace.ai/products/capture/)
- **AI.** Oct 2025 bought Disperse: **CV + a human analyst team (architects/engineers) verify progress**; Track reports return in 24–48 h with 700+ visual components and 200+ schedule tasks. Feb 2026 **OpenSpace Field** GA: **AI Voice Notes** (fills form fields, interprets vague speech) and **AI Autolocation** (indoor position with no hardware). [Disperse](https://www.openspace.ai/press-releases/openspace-acquires-disperse/), [Field GA](https://www.openspace.ai/press-releases/openspace-announces-general-availability-of-openspace-field-bringing-visual-intelligence-directly-into-field-execution/)
- **Adoption.** 350k users, 125+ countries, 80k projects, 50–64B sq ft captured, 62% of ENR Top 400; claims 41% fewer insurance claims. Suffolk: **86% faster issue documentation** with Voice Notes + Autolocation. [2025 review](https://www.openspace.ai/blog/openspace-2025-review/)
- **Working vs marketing.** Capture-and-see is genuinely mainstream. Fully automatic progress is not: OpenSpace's own blog says AI-only tracking yields "estimates, not verified facts" and needs human review before it feeds pay apps. [AI vs manual](https://www.openspace.ai/blog/ai-vs-manual-progress-verification-in-construction/) The most-copyable win is Field: voice + auto-location cutting a punch item from minutes to seconds.

### Trunk Tools (document Q&A → "Cortex" agents)
- **Problem / loop.** Superintendents ask TrunkText (SMS/app) questions over drawings, specs, RFIs, contracts and get cited answers in 5–10 s instead of a 20–40 min trailer walk. Loop: question in the field → answer with source → fewer RFIs and rework. [CNBC](https://www.cnbc.com/2025/08/01/trunk-tools-ai-reduce-construction-error-waste.html)
- **AI + data.** LLM RAG over the project document set (Gilbane's Baird Center: 21,000 documents) plus, since June 2026, **Cortex** — drawing-reading layer powering RFI Prevention/Drafting/Impact agents, Submittal Register/Review agents, Bid Analysis. Needs nothing but the documents already in Procore/ACC/Box/SharePoint. [Gilbane](https://www.constructiondive.com/news/gilbane-trunk-tools-ai-baird-center/725378/), [Cortex](https://www.enr.com/articles/63178-trunk-tools-launches-cortex-ai-platform-to-interpret-construction-drawings)
- **Adoption.** $40M Series B (Jul 2025, Insight), $70M total; Gilbane fleet-wide rollout, Suffolk, DPR, HITT, Consigli, Torcon. Torcon: 1,100 queries in 4 months, 24.7 min saved each (453 h); Cleveland Construction 790 h / $60k on four projects; TrunkSubmittal flagged 99% of 64 submittals as non-/partially compliant. Baird Center **87% answer accuracy**, $100k+/month rework avoided. [Insight](https://www.insightpartners.com/ideas/trunk-tools-closes-40m-series-b-to-lead-constructions-ai-transformation/), [Teardown](https://www.teardown.ai/companies/trunk-tools)
- **Working vs marketing.** Document Q&A with citations is the most proven LLM use in construction — 87% accuracy is honest and still valuable because every answer links to the page. Agents that "prevent RFIs" are three months old; treat as unproven.

### Document Crunch (contract & spec compliance)
- **Problem / loop.** Contract risk review at kickoff, then "what does the contract say about X" for field PMs; notification-deadline tracking. 400+ customers (Balfour Beatty, DPR, Swinerton), 10,000+ project kickoffs, $350B volume; $21.5M Series B; **acquired by Trimble Apr 2026 for $246.4M**. [ENR](https://www.enr.com/articles/59492-contract-analysis-start-up-document-crunch-raises-215m-in-series-b-round), [Trimble](https://news.trimble.com/2026-04-02-Trimble-to-Acquire-Document-Crunch-to-Add-AI-Powered-Risk-Management-and-Document-Compliance-to-Trimble-Construction-One-Project-Delivery-Ecosystem)
- **Lesson.** Narrow, high-stakes document intelligence (clauses, notice periods, spec compliance) reached an exit at ~10× funding. For E-Site the JBCC module is the analogue: notice/time-bar chasing is the same product.

### Procore Helix / Procore AI agents
- **What shipped.** Groundbreak Oct 2025: Procore Assist (Q&A over specs/RFIs/submittals/codes, **photo analysis for safety/progress**, ES/PL/FR/PT, mobile) and no-code **Agent Builder** (open beta); customers built 1,000+ agents in three days. Jul 2026: **Digital Coworker packages** — Starter Pack of five agents (Deep Search, Submittal Review, RFI, **Daily Log**, Contract Review), Pro (20 agents), Enterprise (Agent Studio + "Procore Skills" to teach company standards). Helix pulls 100+ data connectors. [Groundbreak PR](https://www.procore.com/press/procore-advances-the-future-of-construction-with-new-ai-innovations), [Digital Coworker](https://www.procore.com/press/procore-introduces-digital-coworker-packages-expands-ai-agent-library-and-previews-skills-to-help-construction-teams-put-ai-to-work)
- **Working vs marketing.** The packaging is the signal: agents sold in tiers, "daily log agent" and "RFI agent" as SKUs, and "Skills" = customer-editable prompts. Outcome metrics are anecdotal (Mortenson quote). Procore is standardising the *shape* of what customers will expect from any PM tool by 2027.

### Autodesk Construction Cloud (now Forma) — Autodesk Assistant
- Assistant "Project Data agent" exited beta in the March 2026 release; queries RFIs, summarises, lists items. Also GA: Construction IQ (risk scoring on issues/RFIs), AutoSpecs, **Photo Autotags** (ML tags like "ductwork", "rebar"), automated drawing/symbol extraction. [Autodesk March 2026](https://www.autodesk.com/blogs/construction/autodesk-forma-march-2026-construction-releases-built-for-whats-next/), [Autotags](https://construction.autodesk.com/resources/artificial-intelligence/photo-autotags-2/)
- **Working vs marketing.** Autotags and Construction IQ have been quietly useful for years; the Assistant is a chat box over the same tables. No one cites productivity numbers.

### Togal.AI (AI takeoff)
- Deep-learning detection/measurement of spaces and features on plans; claims 98% floor-plan accuracy; Coastal Construction 14.5 h saved per plan set, ~$1M/yr, "$3.2M in 2025". $17.2M raised (incl. $10.4M note Aug 2025), Florida Funders + Coastal. [Case studies](https://www.togal.ai/case-studies), [Tracxn](https://tracxn.com/d/companies/togal/__oPkf2Ej7dzda234qYGn9A_m5EV50cLYKLMrNsK2PY0o)
- **Lesson.** Pre-con; not E-Site's loop. But drawing-to-structured-data (symbol detection on an electrical layout → DB/circuit list) is the same trick that Structured AI and Trunk Cortex are now betting on.

### Slate.ai (Slate Technologies — schedule/risk intelligence)
- Connects ERP, schedule, RFIs, submittals, field reports, email and historical projects; multi-agent "Project Intelligence" that mines past projects for delay-causing activity patterns; case study claims $600k cost exposure prevented in two months. 2025 AI Breakthrough "Agentic AI" award; Autodesk partner. No disclosed 2025 round. [PI case](https://slate.ai/pi-case-study/), [About](https://slate.ai/about/)
- **Working vs marketing.** Thin public evidence; gated case study. Illustrates the "predict delays from historical structured data" pitch that only works with many completed projects — E-Site has 14.

### Kojo (materials procurement for trades)
- Requisition → PO → delivery tracking for MEP and other specialty trades; 600+ contractors, $5B+/yr through the platform; $94M total after Wesco's $10M Series C extension (Oct 2025). AI: price comparison across vendors, buy-timing/vendor/quantity suggestions from history, and **agents for distributor follow-ups and scheduling**. [DC360](https://www.digitalcommerce360.com/2025/09/17/wesco-invests-kojo-ai-procurement-tools-construction/), [Kojo AI tools](https://theconstructiondata.com/kojo-launches-ai-tools-to-cut-material/)
- **Lesson.** The moat is the structured order ledger, not the model; the AI is a chase-and-suggest layer on top. E-Site's per-DB `node_orders` is a miniature of this.

### StructionSite → DroneDeploy (Ground / Progress AI / Safety AI)
- StructionSite (VideoWalk 360 mapping) was acquired Nov 2022 and is now DroneDeploy Ground. Jul 2025 **Progress AI**: vision-language model over drone + 360 walks giving % complete by location across 80+ trade types, "95%+ accurate reports within minutes"; **Safety AI** (OSHA hazards from 360 walks, 95% accuracy, 89% drop in unsafe conditions in beta); Sept 2025 break-even + $15M strategic round to fund AI/robotics. [Progress AI](https://www.dronedeploy.com/blog/dronedeploy-redefines-progress-tracking-in-construction-with-launch-of-progress-ai), [Break-even](https://www.dronedeploy.com/blog/dronedeploy-hits-break-even-raises-strategic-15m-to-fuel-construction-progress-ai-product)
- **Working vs marketing.** Break-even is real evidence the capture business pays. "95%" is on hyperscale data-centre sites with routine capture; the academic review notes field accuracy falls sharply with dust, lighting and occlusion. [ScienceDirect review](https://www.sciencedirect.com/science/article/pii/S2666165925002327)

### Voice capture and photo-to-report (the cheap frontier)
- **CompanyCam AI**: Quick Caption (speak → caption stays with the photo, feeds other AI), Walkthrough Note (talk + shoot → editable document → checklist), Daily Log from ≥3 captioned photos, Progress Recap. Photos + captions are the substrate; everything else is composition. [CompanyCam](https://companycam.com/resources/blog/talk-snap-done-how-companycam-ai-works-on-the-job)
- **Hardline** ($2M pre-seed, Mucker, Suffolk Tech): phone calls, site walks and meetings → daily logs, RFIs, punch, change orders, synced to Procore/ACC/Fieldwire. [Pulse2](https://pulse2.com/hardline-2-million-pre-seed-raised-to-build-voiceops-for-construction/)
- **Benetics AI**: speech → punch items, RFIs, daily progress with location, photo, timestamp, trade metadata; 30+ languages live-translated (relevant for SA multilingual crews); Procore-ready. [BusinessWire](https://www.businesswire.com/news/home/20251013960059/en)
- **FYLD** ($41M Series B Feb 2026; Kiewit, Quanta, Ferrovial): crews shoot a short video instead of a form; AI flags safety/quality risk, sequences tasks, enables remote approval; claims up to 48% fewer serious injuries, 82% YoY growth. [SiliconANGLE](https://siliconangle.com/2026/02/17/ai-field-operations-startup-fyld-raises-41m-help-build-large-scale-infrastructure/)
- **Structured AI** ($4.2M seed Jun 2026, YC, Syska Hennessy as design partner): QA/QC agents that scan whole drawing sets for MEP errors and check as-built against documents — an engineering-firm-first product. [ENR](https://www.enr.com/articles/63139-construction-quality-startup-structured-ai-raises-42m-seed-round)
- **Pillar** (€12M seed May 2026, 500+ contractors, 14 h/week saved): AI back office ingesting accounting, bank feeds, site data and **WhatsApp** into one system. [Tech.eu](https://tech.eu/2026/05/12/pillar-secures-eur12m-to-build-an-ai-powered-operating-system-for-construction/)
- **Market context.** H1 2026: 46 AEC-software startups raised $616M vs $318M for all of 2025; strategics (Autodesk, Trimble, Nemetschek, Procore, Hexagon) are the main buyers. [Memoori](https://memoori.com/investment-ai-aec-startups-doubles-to-616m-h1-2026/) Adoption surveys: 52% of firms use AI tools (Houzz, +20 pts), but only 27% of AEC professionals in Bluebeam's sample; 80% of adopters use it daily. [Roofing Contractor](https://www.roofingcontractor.com/articles/102644-ai-use-jumps-among-construction-firms-houzz-survey-finds), [Civils.ai](https://civils.ai/blog/ai-adoption-construction-statistics-2026/)

## Part 2 — Synthesis (founder view)

### Where the puck is going (next 3 years)
1. **Capture becomes a by-product of walking and talking.** Voice Notes that fill form fields (OpenSpace), Quick Captions (CompanyCam), calls-to-logs (Hardline), video-instead-of-forms (FYLD). Typing on site is ending; the form is filled *from* speech and location, then confirmed with a tap.
2. **Photos are data, not attachments.** Auto-location, auto-tags (Autodesk), caption-as-metadata (CompanyCam), safety and progress classification (Procore Assist, DroneDeploy). A photo without location, board reference and trade will look broken by 2028.
3. **Agents chase people.** Kojo's distributor follow-ups, Procore's RFI/submittal agents, Trunk's RFI-prevention agent, Document Crunch's notice deadlines. The unit of value moves from "record it" to "make sure it gets answered on time."
4. **Reports are composed, not written.** Procore's Daily Log agent, CompanyCam's Daily Log/Progress Recap, Buildots' weekly Delay Forecast. Humans review a draft assembled from the week's structured events; the PDF is the last step, not the work.
5. **Q&A with citations replaces search.** 87% accuracy is enough when every answer links to its page (Trunk). The next step is Q&A over *structured* records (cable schedule, orders, QC), which is more reliable than Q&A over PDFs because the answer is a query, not a guess.
6. **Verified progress stays human-in-the-loop; the moat is the ledger.** Even OpenSpace pays architects to verify CV output. The defensible asset is years of clean, structured, per-board data — which is what Kojo, Document Crunch and Buildots all monetise, and what strategics bought in 2026.
7. **Company "skills"/standards become configurable.** Procore Skills and Agent Builder mean firms expect to teach the tool their templates, wording and thresholds — a natural fit for a consulting engineer's house style.

### What a small team with E-Site's dataset can ship in 12 months
E-Site already holds the substrate the big vendors are trying to reconstruct from PDFs: tenant schedules, cable schedules with computed VD, per-DB procurement lines with status, diary entries, RFIs, QC entries with photos, site forms, and branded PDF generation from all of it. That makes the **composition and chasing layer** cheap and the **perception layer** expensive.

**Cheap and high-value (weeks each, Claude API + existing tables):**
- **Voice-to-diary / voice-to-snag / voice-to-QC.** Speech → structured fields with project vocabulary (board names, tenant names, cable tags from the DB as the transcription lexicon). OpenSpace/Suffolk's 86% figure is the benchmark. Confirmation screen, never auto-submit.
- **Weekly report narrative drafting** from the structured delta (orders moved to received, snags closed, RFIs overdue, cable revisions issued, forms submitted) — the human edits, the PDF pipeline already exists.
- **RFI answer suggestions with citations** over project documents already synced from Dropbox (drawings, specs) plus the structured record. Show sources; log acceptance rate.
- **"Chase" agent**: nightly job that lists overdue RFIs, open snags past due, orders with no supplier ETA, unsigned forms, and drafts per-assignee nudges (email/WhatsApp-style), escalating on a schedule. Pure SQL + templates + LLM tone.
- **Natural-language questions over the project record** as tool-use over typed queries (not RAG): "which DBs on KINGSWALK still have no incomer ordered?" is a query the model writes, not a document it reads — higher accuracy than Trunk-style RAG.
- **Photo-to-snag with location** using the board/tenant picker + optional floor-plan pin, plus Claude vision to pre-fill description, trade and severity. Auto-tag QC photos (board, equipment type) on upload.
- **Meeting/call → minutes and actions** (Hardline pattern) feeding the same chase agent.
- **House-style "skills"**: per-org prompt profiles for report tone, SANS wording, sign-off language.

**Medium (1–2 quarters):**
- Drawing-to-structure extraction (electrical layout → DB list / circuit legend) — Togal/Cortex/Structured AI show it works on clean CAD sets; needs an eval set from real SA drawings.
- Procurement lead-time forecasting from `node_orders` history once there are a few thousand lines (Kojo pattern) — currently data-thin.
- Multilingual voice (Zulu/Afrikaans/Sotho crews) — Benetics proves demand; STT quality varies by language, test first.

**Expensive or hype for a small team:**
- Computer-vision progress tracking against BIM (Buildots/Track): needs models, schedules, 360 hardware and, at OpenSpace, human verifiers. No SA retail fit-out has the inputs.
- 360 reality capture as a platform: commodity (OpenSpace, DroneDeploy) and hardware-bound; integrate, don't build.
- Predictive schedule risk from historical projects (Slate): needs hundreds of completed projects; E-Site has 14.
- Autonomous agents that act without review (auto-answer RFIs, auto-issue notices): legal exposure on a record that feeds a CoC or JBCC notice; keep drafts human-signed.

### Concrete lessons for E-Site (cheap / medium / expensive)
1. **Voice notes that fill the form, not a transcript field** — hold-to-talk on diary/snag/QC, structured extraction with project vocabulary, confirm before save. [OpenSpace Field] — *cheap*
2. **Auto-location on every photo and snag** via board/tenant/floor-plan pin at capture; no photo saved without a "where". [OpenSpace Autolocation, Benetics] — *cheap*
3. **Caption-as-metadata**: a one-line spoken caption stored on each photo becomes the input to reports and search. [CompanyCam Quick Caption] — *cheap*
4. **Daily/weekly log composed from events**: generate the narrative from the structured delta; user edits; existing PDF pipeline renders. [Procore Daily Log agent, CompanyCam Daily Log] — *cheap*
5. **Chase agent with escalation ladder** for RFIs, snags, orders and unsigned forms; log every nudge in the audit trail. [Kojo distributor follow-ups, Procore RFI agent] — *cheap*
6. **Cited answers or nothing**: any Q&A feature shows the source row/page; measure acceptance rate like Torcon's 24.7 min/query. [Trunk Tools] — *cheap*
7. **Structured Q&A via tool-use over typed queries** before any document RAG; the cable schedule and order ledger are the highest-accuracy corpus. [Trunk vs structured moat] — *cheap*
8. **JBCC notice/time-bar chaser**: deadline extraction + reminders is Document Crunch's $246M product in miniature. [Document Crunch/Trimble] — *cheap-medium*
9. **Photo pre-classification on upload** (board, equipment, defect type, PPE) using Claude vision; store as tags, never as verdicts. [Autodesk Autotags, Procore Assist photo AI] — *cheap*
10. **Org "skills" profile**: editable report tone, standard wording, thresholds per consulting firm. [Procore Skills] — *cheap*
11. **Call/meeting-to-actions** feeding the chase agent, with WhatsApp export ingest. [Hardline, Pillar] — *medium*
12. **Multilingual capture with live translation** for crews. [Benetics] — *medium*
13. **Drawing → DB/circuit legend extraction** to bootstrap the currently empty `node_circuits` table. [Togal, Trunk Cortex, Structured AI] — *medium*
14. **Instrumented evals from day one**: track answer accuracy, edit distance on drafts, nudge-to-response time — the metrics every funded vendor publishes. [Trunk, OpenSpace, Buildots] — *cheap*
15. **Do not build 360/CV progress tracking**; offer an OpenSpace/DroneDeploy link-out if a client asks. [Buildots, OpenSpace Track, DroneDeploy] — *expensive*
