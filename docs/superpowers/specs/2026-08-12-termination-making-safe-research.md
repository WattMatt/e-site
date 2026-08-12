# "Termination and Making Safe" Form — South African Regulatory & Design Research

**Prepared for:** Watson Mattheus / WM Consulting (wmeng.co.za) — E-Site site-forms module
**Date:** 2026-08-12
**Scope:** What a "Termination and Making Safe" form must contain to be professionally and legally credible in South Africa, for site electricians working on an **existing** installation (existing DBs, existing wiring) during a revamp/refurbishment.

---

## Executive summary — the seven findings that shape the form

1. **Neither SANS 10142-1 nor the Electrical Installation Regulations contain a safe-isolation procedure.** Both were searched exhaustively; both return nothing on lock-out, proving dead, or "making safe". The legal basis is **GMR 1988 regs 4(5), 5, 6(2)** (including *"positive means … shall not only be the mere tripping of a switch"*), **EMR 2011 regs 3, 4, 5, 7(3)–(6)**, **Construction Regulations 2014 regs 9, 13(1)(g), 14(4)(e), 24**, and **OHS Act s8**. Citing the wiring code for isolation would discredit the form.
2. **The form must not be, or resemble, a Certificate of Compliance.** CoC numbers come from the chief inspector; only a registered person may issue one (reg 9(1)); **no person may amend one** (reg 9(5)). This is a **works and safety record** that feeds a **supplementary CoC** under reg 7(4) — the mechanism the gazetted Annexure 1 already provides for.
3. **No prescribed South African LV isolation or make-safe form exists — and no UK one either.** ORHVS is HV-only; NICEIC, NAPIT, ECA, BS 7671 and Electrical Safety First publish none. Meanwhile the **NFDC explicitly requires a "termination certificate"** for exactly this work. WM is filling a real, documented gap.
4. **The best structural template is the BS 7671 MEIWC**, whose five-part spine — describe the works → **prove the existing earthing and bonding are adequate first** → circuit details → test results → declare *"does not impair the safety of the existing installation"* — is precisely the shape of "we touched an existing DB".
5. **The best South African template is the ECB's published Edition-3 test report and its seven annex pages**, whose row pattern `INSTRUMENT USED | # | LOCATION / IDENTIFIER | reading | IS COMPLIANT?` should be adopted verbatim for the repeating test tables.
6. **⚠ SANS clause 8 changed materially between editions.** Ed 2 → Ed 3: 15 inspection statements became 4, 16 tests became 15, a neutral-loop-impedance test was added, and **Table 8.1's earth-continuity limits were revalued by a factor of 2–3**. Building the test section from this document's Ed 2 numbers would produce wrong pass/fail verdicts. Seed limits from the licensed current edition and version them.
7. **Two units errors to avoid, both already present in the repo's `lv-coc.json`.** The South African earth-leakage test is a **current** test in **mA** (trip at 100 % I∆n, hold at 50 %) — there is **no millisecond criterion anywhere in SANS 10142-1 clause 8** — and **SANS has no tabulated maximum Zs**. "RCD trip time at 5× rated current" is a BS 7671 field that BS 7671 itself dropped after the 17th Edition.

---

## 0. How to read this document

Every factual claim is tagged:

- **[VERIFIED]** — read directly in the primary source (gazetted regulation text, or the SANS standard text itself). Clause/regulation numbers quoted here were read in the source document.
- **[SECONDARY]** — from an industry body, training provider, association or commentary page. Directionally reliable, but not a primary legal source.
- **[UNVERIFIED]** — could not be confirmed from any source I could reach. Treated as an open question, never as a fact.

**Nothing in this document invents a regulation number or a clause number.** Where a number could not be confirmed, that is said explicitly.

> **⚠ Standing caveat on SANS edition drift.** The full text I worked from is **SANS 10142-1:2017 Edition 2** (a copy hosted on archive.org). **SANS 10142-1:2024 (Edition 4)** has since been published and is the current edition; SANS 10142-1:2020 (Ed 3) sat between them. Clause numbering in clause 8 (Verification and certification) has been stable across Ed 1.x → Ed 2 → Ed 3, but **before this form ships, every clause reference below must be re-checked against the licensed current edition.** SABS text is copyrighted and paywalled — WM will need its own licensed copy. Do not hard-code clause numbers into the template until that check is done.

---

## 1. Regulatory context

### 1.1 The statutory stack (top to bottom)

| Layer | Instrument | Relevance |
|---|---|---|
| Act | **Occupational Health and Safety Act 85 of 1993 (OHS Act)** | Parent Act. General duties of employer (s8), duties to non-employees (s9), duty of employees (s14), written undertakings (s10(4)), incorporation of standards (s44). |
| Regulation | **Electrical Installation Regulations, 2009** — GN R242, *Government Gazette* 31975, 6 March 2009, in force 1 May 2009 | The CoC regime, who may certify, who is responsible for an installation. **[VERIFIED]** |
| Regulation | **Electrical Machinery Regulations, 2011** — GN R250, *Government Gazette* 34154, 25 March 2011 | Dead working, warning notices at locked-off switchgear, PPE, labelling of controlling apparatus. **[VERIFIED]** Reg 25 repealed the EMR 1988 (GN R1593 of 12 Aug 1988). |
| Regulation | **General Machinery Regulations, 1988** — GN R1521, 5 August 1988 | **The actual live-working regulation** (reg 5), the "positive means … not the mere tripping of a switch" lock-out clause (reg 6(2)), and the "competent person" definition that EIR regs 5(5)/5(6) cross-refer to. **[VERIFIED — consolidated reproduction, not gazette image]** |
| Regulation | **Construction Regulations, 2014** — GN R84, *Government Gazette* 37305, 7 February 2014 | Reg 24 electrical installations on construction sites; regs 13(1)(g)/14(4)(e) "render circumstances safe" before excavation/demolition affecting services; reg 9 risk assessment + safe work procedures. **[VERIFIED]** |
| Regulation | **General Safety Regulations, 1986** — GN R1031, 30 May 1986 | **[VERIFIED NEGATIVE]** — contains *no* provision on electrical work, live work, isolation or switching. Do not cite it for this form. |
| Incorporated standard | **SANS 10142-1** *The wiring of premises — Part 1: Low-voltage installations* | Incorporated under OHS Act s44 and given effect by EIR reg 5(1); s44(3) deems an incorporated standard to be a regulation. Clause 8 = Verification and certification, and it contains the actual test-report form. **[VERIFIED]** |
| Industry practice | Eskom **ORHVS** (Operating Regulations for High Voltage Systems), SANS 724 | Permit-to-work / S.I.T.E discipline for MV/HV. **[SECONDARY]** |

> **[UNVERIFIED]** The notice incorporating SANS 10142-1 into the EIR under s44 is widely cited as **GN R243 of 6 March 2009** (same gazette as R242), but that notice could not be retrieved. **Confirm the GN number before printing it on anything.** Note also that the EIR body text never names SANS 10142-1 — the only SANS references in the regulations are inside the "specialised electrical installations" definition (SANS 10086-1, 10089-2, 10108, 10142-1 for medical locations).

> **⚠ Trap.** The file on labour.gov.za named *"Regulation - OHS - Electrical Installation Regulations.doc"* is the **2005 DRAFT amendment**, not the 2009 regulations, and its regulation numbers differ. Use `eir2009.pdf` (the gazette).

Source URLs:
- EIR 2009 (gazette PDF): https://www.labour.gov.za/DocumentCenter/Regulations%20and%20Notices/Regulations/Occupational%20Health%20and%20Safety/eir2009.pdf
- EIR 2009 (consolidated, SAFLII — HTTP 403 to automated access): https://www.saflii.org/za/legis/consol_reg/eir342/
- EIR explanatory notes — GN 258 of 2012, GG 35180: https://www.gov.za/sites/default/files/gcis_document/201409/35180gen258.pdf
- EMR 2011 (gazette PDF, hosted by ECB): https://ecb.org.za/wp-content/uploads/2019/06/Electrical-Machinery-Regulations-2011.pdf
- EMR 2011 (Dept of Employment & Labour): https://www.labour.gov.za/DocumentCenter/Regulations%20and%20Notices/Regulations/Occupational%20Health%20and%20Safety/Electrical%20Machinery%20Regulations,%202011.pdf
- EMR 2011 incorporated standards (GN R251): https://ecb.org.za/wp-content/uploads/2019/06/Electrical-Machinery-Regulations-2011-Standards-incorporated.pdf
- Construction Regulations 2014 (gazette PDF): https://www.gov.za/sites/default/files/gcis_document/201409/37305rg10113gon84.pdf
- OHS Act 85 of 1993: https://www.gov.za/sites/default/files/gcis_document/201409/act85of1993.pdf
- General Machinery Regulations 1988 (consolidated reproduction): http://www.safetycon.co.za/documents/General%20Machinery%20Regulations.pdf
- General Safety Regulations 1986 (consolidated reproduction): http://www.safetycon.co.za/documents/General%20Safety%20Regulations.pdf
- Electrical Conformance Board CoC guide: https://ecb.org.za/coc/
- ECA(SA) contractor FAQ: https://ecasa.co.za/member-support/answering-the-questions-that-contractors-ask-frequently/
- SANS 10142-1:2017 Ed 2 (archive.org copy used for clause verification): https://archive.org/download/sans1014212017ed213/SANS10142-1_2017_Ed2-1%20(3).pdf

---

### 1.2 Electrical Installation Regulations 2009 — what the form must respect

All of the following were **read in the gazetted text** and are **[VERIFIED]**.

**Definitions (reg 1).**
- *"certificate of compliance"* — "a certificate with a unique number obtainable from the chief inspector … in the form of **Annexure 1** and issued by a **registered person**". **The CoC number is issued by the state, not by the contractor.** Your form must therefore capture a CoC number as a *reference to an externally-issued number*, never generate one.
- *"electrical contractor"* — "a person who undertakes to perform electrical installation work on behalf of any other person, but excludes an employee of such first-mentioned person."
- *"electrical tester for single phase"* — registered under **reg 11(2)**, limited to installations supplied by a **single-phase** supply at the point of control, **excluding specialised installations**.
- *"installation electrician"* — registered under **reg 11(2)**, for any electrical installation **excluding specialised installations**.
- *"master installation electrician"* — registered under **reg 11(2)** for verification and certification of "the construction, testing and inspection of **any** electrical installation" — **with no exclusion**, i.e. including specialised installations.
- *"user"* / *"lessor"* — **there is no compound "user or lessor" definition.** The EIR uses the phrase "the user or lessor … as the case may be" throughout. The OHS Act defines *"user"* as the person who uses plant or machinery for his own benefit or who has the right of control over its use, and **expressly excludes a lessor**; "lessor" is left undefined. GN 258 of 2012 §2.1.1 explains that the lessor was written into the EIR precisely *because* it is excluded from the Act's "user" definition. → *On the form, offer "User / Lessor / Lessee (by written undertaking) / Principal contractor" as distinct options; do not conflate them.*
- *"installation work"* — includes "**the installation, extension, modification or repair of an electrical installation**". **A revamp strip-out and making-safe is installation work.** It is therefore subject to reg 5(4) general control and reg 9(4).
- *"general control"* — "includes instruction, guidance and supervision in respect of that work."

**Reg 2 — Responsibility.** "the **user or lessor** … shall be responsible for the safety, safe use and maintenance of the electrical installation he or she uses or leases." Reg 2(2) extends that to the conductors between the installation and the point of supply where the point of supply is not the point of control. Reg 2(3) allows transfer **by written undertaking to a lessee only**.

> **[VERIFIED — important]** **The EIR contains no mechanism for transferring responsibility for an installation to a contractor.** During a revamp, statutory responsibility for the installation stays with the user/lessor (or a lessee under a reg 2(3) written undertaking). What the contractor carries instead is: reg 5(4) general control, reg 9(4) duty to ensure a CoC is issued for its work, reg 8(2) prohibition on connecting an uncertified installation, and reg 8(1) supplier notification. The OHS Act **s10(4)** written-undertaking mechanism (expressly cross-referenced by EIR reg 7(5)) is the general route by which a written undertaking can shift duty "to such an extent as may be reasonable having regard to the terms".
>
> → *Form implication: the handover section must name the party the installation is handed **back** to, and should not imply WM or the contractor "holds" the installation. Also note reg 2 is **not** listed as an offence in reg 15.*

**Reg 5(1)** — no person may authorise, design, install, permit or require installation other than in accordance with the incorporated health and safety standard (i.e. SANS 10142-1).
**Reg 5(4)** — "**A registered person shall exercise general control over all electrical installation work being carried out, and no person may allow such work without such control.**" → *This is the single most important regulation for this form: the making-safe work itself must be under a named registered person's general control. The form must name that person and carry their registration number.*
**Reg 5(6)** — where the intention is to supply five or more users from a **new** point of supply, an AIA / competent person (GMR 1988 competent-person definition paras (b)–(d)) / Engineering Profession Act registered person must ensure compliance from commencement to commissioning. (SANS 10142-1 test report §5.5 mirrors this.)

**Reg 6(1)** — no person may do electrical installation work **as an electrical contractor** unless registered as an electrical contractor; reg 6(2) registration is **annual**. Reg 6(4)(b) — a registered contractor must employ a registered person full-time, or be one.

**Reg 7 — Certificate of compliance.**
- 7(1) every user/lessor shall have a valid CoC **in the form of Annexure 1**, "**accompanied by a test report in the format approved by the chief inspector**". → *A CoC alone is not a CoC. The test report is a legal component of it.*
- 7(3) exemption for installations existing before 23 Oct 1992 with no change of ownership after 1 Mar 1994 — **but** "if any addition or alteration is effected to such an electrical installation, the user or lessor … shall obtain a certificate of compliance for the **whole** electrical installation."
- 7(4) — "**Where any addition or alteration has been effected to an electrical installation for which a certificate of compliance was previously issued, the user or lessor … shall obtain a certificate of compliance for at least the addition or alteration.**" → **This is the clause that makes a revamp form legally load-bearing.** Every revamp triggers a fresh CoC obligation for at least the altered part.
- 7(5) — a change of ownership may not be allowed if the CoC is **older than two years**. (Note: this is a *change-of-ownership* rule. It is a widespread myth that a CoC "expires" after two years in all cases — the regulation text does not say that.)
- 7(7) — an inspector / AIA / supplier who detects a fault **may** require a new CoC; if the fault is an **immediate danger**, they **shall** take steps to have the supply to that circuit **disconnected**.

**Reg 8(2)** — "No person shall connect or permit the connection of any completed or partially completed electrical installation to the electricity supply unless it has been inspected and tested by a registered person and a certificate of compliance … has been issued", with a proviso allowing the supplier to connect **for the purpose of testing and completing the CoC**. → *Directly relevant to the "re-energise" outcome on your form: energising a partially-completed revamped installation without a registered person's inspection and test is an offence.*

**Reg 9 — Issuing of certificate of compliance.**
- 9(1) "**No person other than a registered person may issue a certificate of compliance.**"
- 9(2) a registered person may issue only after satisfying himself/herself **by means of an inspection and test** that (a) a new installation complies and **was carried out under his or her general control**; or (b) a pre-existing installation complies with the general safety principles of the standard; or (c) for an existing installation with extensions/alterations, that **(i)** the existing part complies with general safety principles and **is reasonably safe** and **(ii)** the extensions/alterations comply and were **carried out under his or her general control**. → *9(2)(c) is exactly the revamp case. The form must let the registered person attest to both halves separately.*
- 9(3) — if any fault or defect is detected before issue, the registered person **shall refuse to issue** until rectified; if it is an immediate danger and electricity is already supplied, he/she **shall forthwith disconnect** the supply to that circuit and **notify the chief inspector**. → *Your form needs a "defect found — supply disconnected — chief inspector notified" branch. This is a statutory duty, not a nicety.*
- 9(4) — "Any person who undertakes to do electrical installation work shall ensure that a valid certificate of compliance is issued for that work."
- 9(5) — "**No person may amend a certificate of compliance.**" → *Design implication: once a CoC-class document is issued in the app it must be immutable; corrections happen by supersession, not edit. The E-Site inspections module's existing versioned-report pattern already fits this.*

**Reg 11 — Registration as a registered person.** 11(1) application in the form of Annexure 5. 11(2) a person who satisfies the chief inspector as to knowledge and practical experience "shall be registered as an **electrical tester for single phase**, an **installation electrician**, or a **master installation electrician**, as the case may be." 11(4) must produce the certificate of registration on request "to … **any person to whom he or she intends to issue a certificate of compliance**." 11(5) must notify changes within 14 days.

> **Correction of a common secondary-source error:** several commentary pages state registration is "in terms of regulation 13". In the **2009** regulations as gazetted, registration of persons is **regulation 11**; regulation 13 is *substitution of a lost, damaged or destroyed certificate*. **[VERIFIED]** Use reg 11.

> **Second correction — do not label the installation-electrician category "three-phase".** The strings "three-phase" and "3-phase" appear **nowhere** in EIR 2009 **[VERIFIED by exhaustive search of the gazette text]**. The only phase reference in the regulations is in the *electrical tester for single phase* definition ("supplied by a single-phase electricity supply at the point of control"). The **installation electrician** scope is defined by **exclusion** — "any electrical installation, **excluding specialised electrical installations**" — not by phase count. SANS 10142-1 **Annex M** does present a phase-based matrix (single-phase / two- and three-phase / DC / specialised), but Annex M is **informative**, and the binding definitions are the EIR ones. *Where the two framings differ, cite the EIR definition and use Annex M as guidance only.*

**"Personally" vs "general control" — two different duties, routinely conflated.** **[VERIFIED]**
- **Annexure 1 declaration (verbatim):** "a registered person, declare that I have **personally carried out the inspection and testing** of the electrical installation described in the attached test report". → *Inspection and testing must be done personally by the registered person who signs.*
- **Reg 5(4):** the *installation work itself* may be done by others, provided a registered person exercises **general control** (= "instruction, guidance and supervision"). GN 258 of 2012 §2.4.4 Note 2 adds that if the registered person does the work personally, general control is not separately required.
→ *Form implication: §13.2's declaration must not claim personal testing unless the signer actually did it. Keep the "who did the work" and "who did the testing" fields distinct.*

**Reg 15 — Offences and penalties.** Contravention of **regs 3(3), 4, 5, 6(1), 7, 8, 9, 11(4) and 11(5)** is an offence, "liable upon conviction to a fine or to imprisonment for a maximum period of 12 months", plus R200/day for a continuing offence (additional imprisonment capped at 90 days). → *Regs 5, 7, 8 and 9 are all criminal-liability regulations. This is the "legally credible" argument for the form.*

**Annexure 1 (the CoC form itself)** contains, as gazetted: certificate number; certificate **type** (Initial / Supplementary, with "Supplement No … to Initial Certificate No … issued on …"); identification of the installation (physical address, name of building, **GPS coordinates**, suburb/township, **pole number**, district/town/city, **Erf/Lot No.**); a **declaration by the registered person** that "**I have personally carried out the inspection and testing of the electrical installation described in the attached test report**" against reg 9(2)(a)/(b)/(c), and deeming the installation "reasonably safe when properly used"; confirmation that the certificate number has been entered on the attached test report(s); a declaration that the persons responsible for design, specification, procurement, construction, commissioning and inspection & test have completed the relevant test-report sections; **registration number + date of registration + type of registration** (tick: electrical tester for single phase / installation electrician / master installation electrician); signature and date; a separate **declaration by the electrical contractor** with contractor registration number and date of registration; and recipient name/signature/date. Two notes: the certificate "**is not valid unless all the sections have been completed correctly and the test report in the format approved by the chief inspector is attached**", and it "**will be invalid if any corrections have been made**". **[VERIFIED]**

> **The "Supplementary Certificate" mechanism in Annexure 1 is the natural legal home for revamp work under reg 7(4).** Your form should be designed to feed a supplementary CoC, and should capture the initial certificate number and issue date it supplements.

---

### 1.3 Electrical Machinery Regulations 2011 — the isolation / lock-off law

This is the regulation set that actually governs *making safe*, and it is the one most commonly missed. All **[VERIFIED]** from the gazetted text.

**Reg 1 definitions**
- *"dead"* means "**at or about zero potential and isolated from any live system**". → Note the two-part test: **zero potential AND isolated**. Proving dead alone is not "dead" in the legal sense; isolation must also be secured.
- *"live" or "alive"* means "electrically charged".
- *"earthed"* means connected to the general mass of earth "in such a manner as will ensure at all times an immediate safe discharge of electrical energy".

**Reg 3 — PPE.** "An employer or user shall provide **free of charge** and maintain in good condition such protective equipment as may be necessary … for use by persons engaged in working on or in close proximity to **live** electrical machinery **or dead electrical machinery which may become live**." → *Form field: PPE confirmed (arc-rated clothing, insulated gloves, face shield, insulated tools).*

**Reg 4 — Work on disconnected electrical machinery.** Where work is to be carried out on electrical machinery "which has been disconnected from all sources of electrical energy, but which is **liable to acquire or to retain an electrical charge**", the employer/user shall as far as practicable "cause precautions to be taken by **earthing or other means to discharge the electrical energy to earth** … **and to prevent any electrical machinery from being charged or made live while persons are working thereon.**" → *Two form obligations: (a) discharge/earth stored energy (capacitors, PFC banks, long cable runs, VSDs, UPS/inverter DC links); (b) prevent re-energisation — i.e. lock-off.*

**Reg 5 — Notices.** Notices must be displayed within, and at all entrances to, premises housing generating/transforming/switching/linking apparatus, prohibiting unauthorised entry and prohibiting "unauthorized persons from handling or interfering with electrical machinery", plus fire directions and **resuscitation directions for electric shock**. Proviso: does not apply to miniature substations and distribution boxes **on condition that their access doors can be locked or bolted and only authorized persons open them**.

**Reg 7(3)** — switchgear shall, whenever reasonably practicable, have "an **interlocking device** so arranged that the door or cover of the switch cannot be opened unless the switch is in the 'off' position and cannot be switched on unless the door or cover is locked."

**Reg 7(4)** — "The employer or user shall **mark or label all controlling apparatus permanently** so as to identify the system or part of the system or the electrical machinery which it controls, and where such control apparatus is accessible from the front and the back these markings shall be **on both the front and the back**." → *This is the statutory basis for the labelling requirement on your form. Relabelling after a revamp is not optional.*

**Reg 7(5)** — "**The employer or user shall post a notice at switchgear or control gear which has been switched off or locked out to enable persons to work on electrical machinery … warning against reclosing such switchgear or control gear.**"
**Reg 7(6)** — "**No person shall act contrary to a warning in terms of subregulation (5).**"
→ **This is South Africa's lock-out/tag-out law.** It mandates the *tag* (the notice warning against reclosing) explicitly, and reg 7(6) makes removing/overriding it an offence. Your form must capture: notice posted (Y/N), by whom, lock applied, lock/tag ID, and who holds the key.

**Reg 8(1)** — space at the back of switchboards "shall be kept **closed and locked** except for the purpose of inspection, alteration or repair" (with four listed exceptions).

**Reg 9(6)** — in **hazardous locations**, no work on electrical machinery "unless such machinery has been **rendered dead and effective measures have been taken to ensure that such machinery remains dead**." (Explicitly a hazardous-location clause; the equivalent general duty comes from reg 4 + OHS Act s8.) **[VERIFIED — and note the limitation: reg 9(6) is scoped to hazardous locations, not to all work. Do not cite it as a general dead-working rule.]**

**Reg 9(9)** — the person carrying out a hazardous-location examination "shall **enter, sign and date the results of each examination in a record book** which shall be kept by the employer or user". → *Precedent for signed, dated, retained records.*

> **[VERIFIED — two important negative findings]**
>
> **(a) SANS 10142-1 has no isolation procedure.** I searched the complete SANS 10142-1:2017 text for `lock off`, `lock out`, `de-energise`, `made safe`, `disused`, `redundant`. **Zero hits for all of them.** The wiring code does not contain a lock-out/tag-out procedure, does not define "making safe", and has no clause about redundant or abandoned conductors. **Anyone claiming "SANS 10142-1 clause X requires lock-out/tag-out" is wrong.**
>
> **(b) The EIR 2009 has no isolation provision either.** An exhaustive search of the gazetted EIR text returns only "isolating transformer" (in a definitional exclusion) and "switched off" twice inside the *point of control* definition. **The EIR contains nothing on live work, isolation, lock-out, earthing, permit-to-work or proving dead.** Its only disconnection duties are *reactive fault duties* — reg 7(7) and reg 9(3), both triggered by discovering an immediate danger.
>
> → **An "isolation / make safe" workflow cannot be sourced to either the EIR or SANS 10142-1.** Its legal authority is **EMR 2011 regs 3, 4, 5, 7(3)–(6)**, **GMR 1988 regs 4(5), 5 and 6(2)**, **Construction Regulations 2014 regs 9, 13(1)(g), 14(4)(e) and 24**, and **OHS Act s8**. The form's language must be accurate about this or it undermines its own credibility.

---

### 1.3b General Machinery Regulations, 1988 — the actual live-work and lock-out regulation

**[VERIFIED — from a reliable consolidated reproduction, corroborated by the Draft GMR 2025 gazette and by the EIR 2009 cross-reference; not gazette-image-verified. Confidence: high.]** GN R1521, 5 August 1988.

- **Reg 4(5)** — where machinery threatens safety "when it is unexpectedly set in motion **or made electrically alive**", the employer/user must ensure that it **cannot** be.
- **Reg 5 — "Working on Moving or Electrically Alive Machinery".** 5(1): "**No employer or user of machinery shall permit or require any person other than a competent person or a person who has been trained to the satisfaction of an inspector**" to do such work where it may endanger him. 5(2): must "take all reasonable precautionary measures in order to ensure that persons who perform such work are not injured."
- **Reg 6(2)** — the strongest lock-out wording anywhere in the OHSA family: there must be "**positive means for rendering the controls … inoperative while repairs or adjustments are being made, and such means shall not only be the mere tripping of a switch.**"

> **Reg 6(2) is the single best citation for the "secure the isolation" step on this form.** "Not only the mere tripping of a switch" is precisely the legal statement that switching a breaker off is *not* isolation — a lock or lock-off device is required. Pair it with EMR reg 7(5) (the warning notice) and you have the full statutory LOTO basis in two clauses.

**GMR reg 1 "competent person", paragraphs (b)/(c)/(d)** — cross-referenced by EIR regs 5(5) and 5(6):
- **(b)** engineering diploma (mechanical or electrotechnical heavy current) "at least T3 or N5, or of an equivalent level" + **2 years** relevant practical experience;
- **(c)** graduate engineer + **2 years** post-graduate experience + passed the Commission of Examiners exam on the Act;
- **(d)** a certificated engineer.

> **Paragraph (a) — the trade/apprenticeship route — is deliberately excluded from EIR 5(5) and 5(6).** A master installation electrician does **not** qualify as a "competent person" for HV design approval (>1 kV) or for the five-or-more-users supervision duty by virtue of that registration. *If the form's DB identification says "any part above 1 kV = Yes", the app should say so explicitly rather than letting an MIE sign it off.*

---

### 1.4 SANS 10142-1 — verification, certification, and who may sign

All **[VERIFIED]** against SANS 10142-1:2017 Edition 2.

**Clause 8 structure:** 8.1 Responsibility · 8.2 Installation characteristics · 8.3 Electricity supply system · 8.4 Prospective short-circuit current · 8.5 Inspection · 8.6 Testing · 8.7 Test reports.

**Clause 8 opening note:** "In South Africa, it is a statutory requirement that every user or lessor of an electrical installation shall have a valid Certificate of Compliance (CoC) for every such installation. **A CoC will only be valid when it is accompanied by a test report in the format of the test report in 8.7.**"

**8.1 Responsibility** maps to **section 5 of the test report**, with five separately-signed blocks:
- 5.1 **DESIGN** (8.1.1)
- 5.2 **MATERIAL SPECIFICATION / PROCUREMENT** (8.1.2)
- 5.3 **CONSTRUCTION** (8.1.3)
- 5.4 **INSPECTION AND TESTS** (8.1.4) — signed by the **registered person**
- 5.5 **COMPLIANCE FROM COMMENCEMENT TO COMMISSIONING** — only for a new point of supply feeding five or more users (mirrors EIR reg 5(6))

8.1.4 NOTE 1 is the revamp rule: "If the test report covers an installation … that existed before the publication of this part of SANS 10142 and extensions made since then, **sections 5.1 to 5.3 will cover the new extensions only** and, in section 5.4, **both blocks** that refer to installations which existed before and after the publication … should be marked." NOTE 2: "**If no signature appears in any of sections 5.1 to 5.3 of the test report, the signatory of section 5.4 takes that responsibility.**" → *Design implication: leaving signature blocks blank is not neutral — it transfers liability to the testing signatory. The form should make this explicit at the point of signing.*

**8.5 Inspection — 8.5.1:** "**Normally, inspection precedes testing and should be done with the installation isolated.**" → *The one place the wiring code does connect isolation to the certification workflow.*
**8.5.2:** "Complete the inspection table … by confirming the statements with 'Yes' … **'No' answers to any of the statements will prevent the issuing of the report.**"
**8.5.3** lists the 15 inspection statements. The ones that matter most for a revamp:
- (6) "disconnecting devices (isolators) are correctly located and that **all switchgear switches the phase conductors**"
- (8)/(9) connections and earthing/bonding are **mechanically sound** and **electrically continuous**
- (10) "circuits, fuses, switching devices, terminals, earth leakage units, circuit-breakers and distribution boards are **correctly and permanently identified, marked or labelled**"
- (11) "the integrity of the **fire barrier** has been maintained where an electrical system passes through a fire barrier" — *critical on a strip-out where cables are pulled out of penetrations*
- (13)(a)/(13)(b) the split-attestation: **(a)** new/added/altered work complies with this part of SANS 10142; **(b)** pre-existing installation "complies with the general safety principles of this edition … and is **reasonably safe**". NOTE: "Indicate (a) or (b) or (a) and (b)."

**8.6 Testing — 8.6.1 General:** "Conduct **all** the tests and complete a copy of Section 4: Tests **for each distribution board and supply** (normal and alternative supplies)." · "For cases where multiple tests are required, record the **worst-case** measurement." · "In the case of failure in any test, the test shall be **repeated after the fault has been rectified**. Other tests that might have been influenced by the fault shall also be repeated." · "**Measuring instruments shall be accurate to within 5 % or better.**" (Note: the standard specifies **accuracy**, not a calibration interval. See §1.6.)

Test-by-test limits **[VERIFIED]**:

| Clause | Test | Limit / method | Unit |
|---|---|---|---|
| 8.6.2 | Continuity of bonding (consumer's earth terminal ↔ all exposed conductive parts) | Source 4–24 V no-load d.c. or a.c., **≥ 0,2 A**; resistance **shall not exceed 0,2 Ω** | Ω |
| 8.6.3 | Resistance of earth continuity conductor | Shall not exceed **Table 8.1** values, indexed by rated current of protective device (e.g. 16 A → 0,70 Ω; 20 A → 0,55 Ω; 32 A → 0,41 Ω; 63 A → 0,24 Ω; 100 A → 0,14 Ω). All socket-outlets tested by **inserting a plug**, including the earth-pin resistance | Ω |
| 8.6.4 | Continuity of ring circuits | Remove both ends of each live conductor, separate, test continuity; **reconnect to the same terminal** afterwards | — |
| 8.6.5 | Earth fault loop impedance at the main switch | Impedance such that an earth fault current **≥ 2× rated current** of the main protective device auto-disconnects. Alternative per 8.6.5.2: earth-fault detection device limiting touch voltage to **25 V** for **≤ 5 s** | Ω |
| 8.6.6 | Elevated voltage on supply neutral | **Main switch off**; measure supply neutral to external earth. **> 25 V → notify supplier. > 50 V → disconnect the installation and notify (Annex H).** | V |
| 8.6.7 | Earth resistance at electrode | Per SANS 10199; optional where the supplier provides an earthing terminal | Ω |
| 8.6.8 | Insulation resistance | Test voltage ≥ 2× nominal, **minimum 500 V**; fuses in, switches/breakers closed, loads may be disconnected; **shall be at least 1,0 MΩ**. 8.6.8.3: if total < 1,0 MΩ with sub-DBs, section it — main→sub wiring, then each sub-DB with all its circuits — **each section still ≥ 1,0 MΩ** | MΩ |
| 8.6.9 | Voltage at main DB — no load | Per phase; notify supplier (Annex H) if outside 5.4.2 limits | V |
| 8.6.10 | Voltage at main DB — on load | Per phase | V |
| 8.6.11 | Voltage at available load | Worst-case point; ≥ 50 % of circuit load and **not less than 2 A**; **voltage drop shall not exceed 5 %** from point of supply to point of consumption | V / % |
| 8.6.12 | Operation of earth leakage units | Pass a.c. leakage current **= I∆n** between phase and earth continuity conductor → **shall trip**. Repeat at **50 % of I∆n** → **shall not trip** | mA |
| 8.6.13 | Earth leakage test button | Press → unit trips (function check, not a sensitivity check) | — |
| 8.6.14 | Polarity at points of consumption | Single-pole devices in the phase conductor; phase terminals correct; ES lampholder centre contact on phase; **phase rotation maintained on supply sides of all DBs** | — |
| 8.6.15 | Switching devices | Circuit is interrupted as intended | — |

> ### ⚠⚠ CRITICAL EDITION-DRIFT WARNING — the table above is Edition 2 and is partly superseded
>
> **[VERIFIED against the Eswatini SZNS adoption of SANS 10142-1:2021 Edition 3, and against the ECB's published Edition-3 test-report template.]** The clause 8.6 test set changed materially between Ed 2 (2017) and Ed 3 (2020/2021). **Do not build the test section from the Ed 2 table above.** Confirmed differences:
>
> | Aspect | Edition 2 (2017) | Edition 3 (2020/2021) |
> |---|---|---|
> | Inspection statements | **15** | **4** |
> | Tests | **16** | **15** |
> | Sub-clause numbering | 8.6.12 ELU operation · 8.6.13 test button · 8.6.14 polarity · 8.6.15 switching | 8.6.11 ELU operation · 8.6.12 test button · 8.6.13 polarity · 8.6.14 switching |
> | Neutral loop impedance | absent | **new test, 8.6.5.2** ("Neutral loop impedance test at main or local switch", Ω) — phased in six months after publication |
> | "Voltage at available load" (8.6.11 Ed 2, ≤5 % VD) | present | **not in the Ed 3 / ECB test list** |
> | **Table 8.1** max earth-continuity resistance | 6,3 A→1,7 · 10→1,1 · 16→0,70 · 20→0,55 · 25→0,53 · 32→0,41 · 40→0,33 · 50→0,26 · 63→0,24 · 80→0,19 · 100→0,14 · …→315→0,049 | **6 A→1,533 · 10→0,920 · 16→0,575 · 20→0,460 · 25→0,368 · 32→0,288 · 40→0,230 · 45→0,204 · 50→0,184 · 63→0,146**; above 63 A → table 6.28 |
>
> **The Table 8.1 values are roughly 2–3× different.** Seeding the Ed 2 numbers into the database and auto-evaluating against them would produce confidently wrong pass/fail results on live jobs. **This is the highest-risk item in this whole document.**
>
> **[UNVERIFIED]** The Ed 3 text extracted did not contain the "shall be at least 1,0 MΩ" acceptance value for insulation resistance (Ed 2 8.6.8.2 does), but the ECB's own Edition-3 insulation-resistance annex carries the footer *"If Main DB less than 1 MΩ"*. **1 MΩ remains the operative threshold in practice**; cite Ed 2 8.6.8.2 or the ECB annex, not an Ed 3 clause number, until the licensed current edition is checked.

Two notes on 8.6.8 that matter enormously for a revamp form:
- **8.6.8 NOTE 1:** "**Before power is connected to any new or altered circuit, the test for insulation resistance should be carried out to ensure there is no short-circuit or high impedance faults … and that it is safe to energize.**" → *This is the pre-energisation gate. Your form's "re-energise" outcome should be blocked behind an IR result.*
- **8.6.8 NOTE 2:** "In the case of existing installations where the power may not be switched off from certain circuits …, **the fact that the circuits are subject to the supply voltage can be regarded as evident that the insulation resistance is compliant.**" → *This is the legitimate "N/A — live circuit, cannot isolate" escape hatch. Model it as an explicit N/A reason, not a blank field.*
- **8.6 preamble:** "Certain tests might be **impractical in existing installations already under power**." → the standard anticipates partial testing on revamps.

**8.7 Test report** — the gazetted-format report has **five sections**:
- **Section 1 – LOCATION**: physical address, name of building (only required if not on the CoC).
- **Section 2 – INSTALLATION**: existing certificate (Yes/No, date issued, number); classification tick-set **Existing installation / Alteration-extension / New installation / Temporary installation**; type (Residential / Commercial / Industrial / Common area for multiple users (sectional title) / Other); supply system **TN-S / TN-C-S / TN-C / TT / IT**; supply earth terminal provided Y/N; voltage 230/400/525/other; number of phases 1/2/3; **phase rotation clockwise/anticlockwise**; frequency 50 Hz / other / d.c.; **PSCC at point of control (kA)** and how determined (**Calculated / Measured / From supplier**); main switch type (switch-disconnector (on-load isolator) / fuse switch / circuit-breaker / earth leakage circuit-breaker / earth leakage switch-disconnector); number of poles; current rating (A); short-circuit withstand rating (kA); **rated earth leakage tripping current I∆n (30 mA / other mA)**; surge protection Y/N; alternative power supply installed Y/N; any specialised installation Y/N; any part above 1 kV Y/N; is this one of five or more on the same new supply Y/N + name of the competent person who supervised.
- **Section 3 – DESCRIPTION OF INSTALLATION COVERED BY THIS REPORT** — free text plus drawing/spec references, **plus a two-column count table (Existing installation | New/altered/temporary installation), each split into Main DB | Sub-DBs**, counting: lighting circuits, lighting points, socket-outlet circuits, socket-outlets, three-phase socket-outlet circuits/outlets, socket-outlets for critical applications, mixed circuits, motor circuits, control circuits, air-conditioning circuits, motor-controlled assembly circuits, transformer circuits (lighting/bell/other), heating, fan, elevator/escalator, signage, fixed appliance circuits (cooking/geyser/pool pump/borehole pump/other), main switch, earth leakage (only socket-outlets), overhead busbars, alternative power supply connections, other circuits. → **The "existing vs new/altered" two-column split is exactly the shape a revamp form needs, and it comes straight from the gazetted report.**
- **Section 4 – INSPECTION AND TESTS**, itself split into the **15-row inspection table** and the **16-row test table**, each with separate result columns for **Existing installation** and **New/altered/temporary installation**, plus **Units** and **Instrument** columns, then **Comments** and **"Comments on parts of the installation not covered by this report"**.
- **Section 5 – RESPONSIBILITY** (5.1–5.5 as above). Section 5.3 CONSTRUCTION captures **Electrical Contractor's Registration Number, date of registration, expiry date of registration**, or employer name + employee number. Section 5.4 captures **name of registered person, registration certificate number, type of registration (tick: Master installation electrician / Installation electrician / Single-phase tester), signature, date, tel. no.**

**Annex H (informative) — Notification of a potential danger** (referenced from 8.6.6 and 8.6.10). A one-page form: To (the supplier) / From (the registered person) / stand no. / situated at / "I, ……, Registration No. ……, found the following potential danger:" with tick-lines for **Elevated voltage on neutral of …… V**, **Voltage not within limits …… V**, **Other ……**, signed and dated. → *Worth mirroring as a linked sub-form.*

**Annex M (informative) — Authority for issuing a test report and a Certificate of Compliance.** The scope matrix **[VERIFIED]**:

| Installation type | May be installed by | Test report + CoC may be issued **only** by |
|---|---|---|
| Single-phase | any person* | electrical tester for single phase, **or** installation electrician, **or** master installation electrician |
| Two-phase / Three-phase / DC | electrical contractor, or any person under the control of an installation electrician or master installation electrician | installation electrician **or** master installation electrician |
| Specialised (hazardous, medical, explosive, petroleum, etc.) | electrical contractor, or any person under the control of a master installation electrician | **master installation electrician** only |

\* Annex M footnote a: "Any person who undertakes to perform electrical installation work **on behalf of any other person**, but excluding an employee of such first-mentioned person, is **legally required to register as an electrical contractor**."

> **Terminology note for the form's UI.** "Wireman's licence" is the colloquial trade term; the legal instrument is a **certificate of registration as a registered person** under EIR reg 11, in one of three categories. The form should label the field **"Registration category"** + **"Registration certificate no."** and can carry "(wireman's licence)" as help text. Using only the colloquial term on a legal document reads as amateurish to an inspector.

---

### 1.5 Other SANS 10142-1 clauses that a revamp/making-safe form must reference

All **[VERIFIED]** in the 2017 Ed 2 text.

- **4.2 Notices, labels and rating plates** — "shall be **durable and not removable except by determined and deliberate action**. The inscriptions shall be **legible and indelible**." Table 4.2 indexes every mandated label. Two entries matter here: **6.6.1.21 warning labels on distribution boards** and **6.6.6.2(e) alterations or changes to a distribution board**.
- **6.3.7 Joints and terminations** — 6.3.7.1: joints/terminations per manufacturer instructions or SANS 10198; "**All joints shall be accessible, protected against strain, and protected in accordance with 5.2.1**, except for joints made and sealed permanently and intended to be maintenance free." 6.3.7.2: joints shall not adversely affect current-carrying capacity, insulation resistance or earth continuity; **shall not be made in any connector, bend, elbow or tee-piece of a conduit**; shall not allow strands to spread or require strands to be cut away. 6.3.7.3: armouring/sheathing shall be terminated in or on equipment, armour terminated by clamp or gland with an **earth tag washer**.
- **5.2.1 Live parts** — the general protection-against-contact clause that a capped-off conductor must satisfy. → *A "capped off" conductor left in a ceiling void is only "made safe" if it satisfies 5.2.1 + 6.3.7.1 (accessible, protected). Insulation tape over a conductor end is **not** compliant. The form should force a choice of termination method and a photo.*
- **6.6.1.12** — "A distribution board and the equipment mounted in or on it shall be so positioned and arranged that **any conductor can easily be disconnected from the terminals**."
- **6.6.1.13** — ring circuits: both ends of live and neutral conductors **crimped together**, ring circuits "clearly and permanently identified by either a notice or a tag."
- **6.6.1.19** — "**Each unoccupied opening of a distribution board shall be fitted with a blanking plate.**" → *Direct requirement after removing a redundant breaker.*
- **6.6.1.20** — "Unless obvious, **permanent labelling shall identify all incoming and outgoing circuits** of the distribution board."
- **6.6.1.21** — warning labels on all DBs: (a) indication of **where the DB is fed from** (except single-DB installations; other sources e.g. generators/UPS → 7.12.5); (b) if short-circuit rating exceeds 2,5 kA, the minimum fault current rating of switchgear that may be used; (c) cascaded-system label per 6.7.4(c); (d) busbar current rating where > 100 A; (e) label indicating the position of the readily accessible earthing terminal for bonding other services.
- **6.6.6 Alterations/extensions to DBs with a short-circuit rating above 10 kA** — 6.6.6.2 applies when a DB is modified or extended: (a) mechanical and electrical integrity shall not be infringed; (c) busbar extensions shall not adversely affect performance; (d) components selected for suitability, with a boxed **WARNING**: "Do not replace any component in the system with a component that is not of identical type and rating except when recommended by the manufacturer …"; **(e) "any changed properties due to alteration or extension of the distribution board shall be marked indelibly on a supplementary nameplate"**; (f) IP rating shall not be reduced. → **6.6.6.2(e) is the clause your form should cite for the "supplementary nameplate updated" field.**
- **6.9 Disconnecting devices** — 6.9.1.1 each installation shall have one disconnecting device for the whole installation; where there are multi-supplies, each supply has its own, **with a notice fixed next to each indicating that the installation has more than one main switch-disconnector**. 6.9.1.3: "A disconnecting device that is intended to disconnect equipment for **repair, maintenance, or inspection** shall have at least the safety isolating requirements of a **switch-disconnector**." 6.9.2.1: a neutral conductor shall not have a single-pole disconnecting device. 6.9.2.2: single-phase disconnecting device disconnects live **and** neutral. 6.9.3.1(b): a disconnector may be in a DB "**if the device is capable of being locked in the open position**". 6.9.3.2: where more than one disconnecting device is used, **each shall have a notice giving the location and function of the other**.
- **7.4 Construction and demolition site installations** — 7.4.1: applies to temporary installations for "building construction sites, **work of repair, alterations, extension or demolition of existing buildings**…"; "**Parts of buildings which undergo structural alterations such as extension, major repair, or demolition, are considered to be construction sites during the relevant period of work**"; "Where alterations to existing buildings are undertaken, **that part of the installation shall comply with the additional requirements of this sub-clause**. This might necessitate the temporary installation of an additional distribution board." 7.4.3: socket-outlets and (except emergency lighting) all final lighting circuits protected by **I∆n ≤ 30 mA**. 7.4.4.1: assemblies/equipment **at least IP32**. 7.4.6.5: final finish **orange**. **7.4.6.6: "Isolating devices shall be suitable for securing in the off position (for example, a padlock or location inside a lockable enclosure)."** 7.4.6.7(a): one or more multi-element robust LED indicator lamps **per phase** to show the board is alive.
  → **7.4 is the single most under-cited clause for revamp work. A refurbishment of an occupied building is, in SANS terms, a construction site for the duration — and 7.4.6.6 is the wiring code's only explicit "securing in the off position" requirement.** It applies to the temporary board, not to the existing DB, so cite it precisely.
- **7.8 Temporary installations**, incl. **7.8.3 Isolation** — applies to temporary installations generally; relevant where a revamp leaves a temporary builder's supply in place. *(Clause exists and is titled "Isolation" at 7.8.3; I did not extract its full body text — **[UNVERIFIED body]**.)*
- **7.12 Alternative supplies** — 7.12.2.1 label at the main switch where an alternative supply is installed. → *Essential on a making-safe form: generator/UPS/PV back-feed is the classic way a "dead" board becomes live.*

---

### 1.6 Test-instrument calibration — what the law actually says

This is the field most likely to be over-claimed, so it is worth being precise.

- **[VERIFIED]** SANS 10142-1:2017 **8.6.1**: "**Measuring instruments shall be accurate to within 5 % or better.**" That is the only instrument requirement in clause 8. **The standard does not, in this clause, prescribe a calibration interval or require a calibration certificate.**
- **[VERIFIED]** The gazetted **test report Section 4** has a dedicated **"Instrument"** column against every test row — so the report format itself expects the instrument used for each test to be identified.
- **[VERIFIED]** EMR 2011 reg 9(8)/(9) requires periodic examination and a signed, dated record book — but that is scoped to **hazardous locations**, not to instruments generally.
- **[UNVERIFIED]** I could **not** find a South African regulation or SANS clause that mandates annual calibration of test instruments for general LV installation testing. It is universal industry practice (and is required by SANAS-accredited laboratories, insurers, and most client specifications), and instrument accuracy cannot be demonstrated without it — but **do not write "as required by SANS 10142-1" next to a calibration-certificate field.** Word it as *"Calibration certificate (client/WM requirement — supports the SANS 10142-1 8.6.1 ±5 % accuracy requirement)"*.
- **Practical consequence for the form:** capture instrument make/model/serial and calibration date/certificate no. as **WM-policy mandatory**, and cite 8.6.1 only for the accuracy claim. Capturing it is what makes a disputed reading defensible years later; over-citing regulation is what makes the document attackable.

---

### 1.7 Construction Regulations 2014 — GN R84, GG 37305, 7 February 2014

All **[VERIFIED]** from the gazetted text. A building revamp/refurbishment is construction work; SANS 10142-1 **7.4.1** independently treats a building undergoing "structural alterations such as extension, major repair, or demolition" as a construction site for the duration.

**Reg 24 — "Electrical installations and machinery on construction sites"** (opening, verbatim): "A contractor must, **in addition to compliance with the Electrical Installation Regulations, 2009, and the Electrical Machinery Regulations, 1988** …, ensure that—"
- **(a)** before and during construction, "adequate steps are taken to **ascertain the presence of and guard against danger**" from any electrical cable or apparatus under, over or on the site;
- **(b)** all parts "are of adequate strength to withstand the working conditions on construction sites";
- **(c)** control of all temporary electrical installations "is **designated to a competent person who has been appointed in writing**";
- **(d)** temporary electrical installations "are **inspected at least once a week** by a competent person", findings "**recorded in a register kept on the construction site**";
- **(e)** all electrical machinery "is inspected by the authorized operator or user on a **daily basis using a relevant checklist**", recorded in a site register.

> **⚠ Live drafting defect in reg 24, worth flagging to the client's legal review.** Reg 24 cites the **Electrical Machinery Regulations, 1988 (GN R1593 of 12 August 1988)** — which **EMR 2011 reg 25 expressly repealed** roughly three years before CR 2014 was gazetted. The cross-reference was never corrected. Read it as attaching to **EMR 2011**. **[VERIFIED]**
>
> Note also: **reg 24 contains no permit-to-work and no lock-out requirement**, and no CoC obligation. Do not over-claim it.

**Reg 13(1)(g) — Excavation** and **Reg 14(4)(e) — Demolition** carry an identical, and much more directly relevant, duty: the contractor must ascertain "the location and nature of electricity, water, gas or other similar services which may in any way be affected", and before commencing work that may affect such a service, "**take the steps that are necessary to render the circumstances safe for all persons involved**".

> **Regs 13(1)(g) and 14(4)(e) are the closest statutory analogue to "making safe" anywhere in South African law, and they are the natural legal anchor for this form.** A strip-out that disturbs existing electrical services on a revamp falls squarely inside reg 14(4)(e). *The form should carry this citation prominently — it is the reason the document exists.*

**Reg 9 — Risk assessment.** Risk assessments must be carried out by a **competent person appointed in writing**, form part of the health and safety plan, and must include "**a documented plan and applicable safe work procedures to mitigate, reduce or control the risks**", plus a monitoring plan and a review plan. → **This is where a written safe work procedure is legally required.** The safe-isolation checklist in §3/§6 of this form *is* that safe work procedure, and the completed form is its record.

**Other relevant provisions:**
- **Reg 14(1)** — demolition: competent person appointed **in writing** to supervise and control all demolition work. **14(2)** — a detailed **structural engineering survey** before demolition.
- **Reg 12** — temporary works designer appointed in writing.
- **Reg 3** — construction work permit (issued by the provincial director). **Reg 4** — notification of construction work.
- **Reg 1 "competent person"** (CR sense — *different* from the GMR sense in §1.3b): a person who "has in respect of the work or task to be performed the required knowledge, training and experience" and "is familiar with the Act and with the applicable regulations". **Two different "competent person" tests exist in this stack — always say which one you mean.**
- **Reg 33 — Offences.** Contravention of regs 3–30 → fine or imprisonment max 12 months, plus a per-day continuing-offence fine. *(The gazette PDF renders the figure as "8200"; this is almost certainly an OCR artefact for **R200**. **[UNVERIFIED]** — verify against a clean copy before printing it.)*
- ⚠ CR 2014 **reg 25** refers to "the General Safety Regulations, 2003" — a date that does not match GN R1031 of 1986 (amended in 2003 by R928). Cite the GSR by **GN number**, not by year.

**Practical form hooks from the CR:** the **written appointment** of the competent person controlling temporary installations (reg 24(c)), the **weekly inspection register** (reg 24(d)), the **daily checklist register** (reg 24(e)), the **risk assessment / safe work procedure** reference (reg 9), and the **health and safety file** the record lives in. Capture all five as reference fields.

> **[UNVERIFIED — watch item]** **Draft Construction Regulations 2024** were published as Notice GN 5983, GG 52267, 12 March 2025 (comments closed 10 June 2025) and **would repeal CR 2014**. Promulgation status as at August 2026 is not confirmed. Likewise **Draft General Machinery Regulations 2025** (Notice 6532, GG 53210, 22 August 2025), which retains GMR regs 4(5), 5 and 6(2). Treat CR 2014 and GMR 1988 as operative, but re-check before publishing regulation numbers in a shipped product.

---

## 2. What "termination and making safe" means in practice on a revamp

There is **no statutory or SANS definition of "making safe"** **[VERIFIED — zero hits for "made safe"/"making safe" in SANS 10142-1:2017]**. It is a construction-industry term of art. In practice, on a South African revamp, it covers this sequence of physical work:

1. **Survey and mark up.** Trace what each existing circuit actually feeds — the existing legend card is almost always wrong on a 20-year-old board. Record the *as-found* state before touching anything (this is why the photo evidence matters; the as-found photo is the defence against "you broke my circuit").
2. **Identify the correct point of isolation.** Not always the obvious breaker: sub-mains, bus-tie arrangements, standby/generator interconnects, UPS-backed circuits, landlord vs tenant supplies, and neutral bars shared across circuits all move the true point of isolation upstream. On the E-Site data model this is exactly what the `structure.nodes` supply tree is for.
3. **Establish who is affected and get permission to isolate.** In an occupied building this is a commercial act as much as a technical one — the isolation window, the tenants affected, and the written approval to switch off.
4. **De-energise and isolate.** Open the disconnecting device, secure it (padlock / lock-off device / locked enclosure per SANS 10142-1 7.4.6.6 pattern), post the reg-7(5) notice.
5. **Prove dead.** (Full sequence in §3.)
6. **Discharge stored energy / apply earths where warranted** (EMR reg 4) — PFC capacitor banks, VSD DC links, UPS batteries, long cable runs, PV strings.
7. **Terminate / make safe the redundant conductors.** For each redundant circuit, one of:
   - **Removed entirely** back to the DB — the cleanest and the only one that ends the future risk.
   - **Disconnected at the DB and capped/terminated at both ends**, left in place (dead, unenergisable) — requires the DB-end conductor to be removed from the terminal, the way blanked (6.6.1.19), and the far end terminated in an accessible, protected enclosure (6.3.7.1, 5.2.1), and **labelled dead + date + who**.
   - **Left connected but locked off** — a temporary state, not an end state. Must appear on the form as "left isolated" with a named holder of the lock and a review date.
   - **Retained and reused** — becomes new work, requires full test and certification under EIR reg 9(2)(c)(ii).
   - **Made safe pending removal by others** — the most dangerous category; the form must record who is taking it over.
8. **Blank, label, and update the record.** Blanking plates on vacated ways (6.6.1.19); legend card / circuit identification updated (6.6.1.20, EMR 7(4)); supplementary nameplate for changed DB properties (6.6.6.2(e)); DB feed-from label still correct (6.6.1.21(a)) — often wrong after a revamp reshuffles feeds.
9. **Reinstate fire barriers** where cables were withdrawn from penetrations (8.5.3(11)).
10. **Temporary supplies.** Where the revamp requires builder's power or a temporary tenant supply: SANS 10142-1 **7.4** applies (30 mA earth leakage on socket-outlets and lighting finals, IP32, orange finish, isolators securable in the off position, per-phase live indication). A temporary supply is itself an installation that needs certification.
11. **Safe re-energisation.** IR test before energising any new or altered circuit (8.6.8 NOTE 1); confirm no one is still working; remove locks in the reverse order applied, by the person who applied them; re-energise progressively; confirm expected loads energised and no unexpected loads; retest earth leakage; re-label.
12. **Handover.** State the end state explicitly — **made safe / energised and in service / left isolated** — with the responsible party named, and the outstanding items listed.

### Failure modes this form exists to prevent

These should each map to a field. They are the real-world reasons making-safe goes wrong on a revamp:

| Failure | Field that catches it |
|---|---|
| Wrong board isolated (mislabelled DB, two boards with the same name) | DB identification + as-found photo of the nameplate + "fed from" verified |
| Circuit still live from a **second source** — generator, UPS, PV, bus-tie, landlord supply, borrowed neutral | "All sources of supply identified" checklist + alternative-supply question (7.12) |
| **Borrowed / shared neutral** — phase isolated, neutral still carrying current from another circuit | Explicit neutral check field; N-E voltage reading |
| Back-feed through a two-way / interlinked lighting circuit | Prove-dead at the point of work, not only at the DB |
| Proved dead with a faulty tester | Prove-tester → test dead → **re-prove tester** (three-point) |
| Lock removed by someone else | Lock/tag ID + key holder + reg 7(5) notice photo |
| Redundant conductor taped up and left in a ceiling — energised years later by someone reinstating "an old spare" | Termination method per circuit + "labelled DEAD" + photo |
| Blanking plates not fitted after breakers removed | 6.6.1.19 field + photo of DB with covers on |
| Legend card not updated — the *next* electrician isolates the wrong way | 6.6.1.20 field + photo of new legend card |
| Fire barrier left open after cable withdrawal | 8.5.3(11) field + photo |
| Stored energy (PFC bank, VSD, UPS) | EMR reg 4 discharge/earth field |
| Energised before testing | IR reading gates the "energised" handover state |
| **Rogue cabling in ceiling voids and wall cavities** — remotely fed circuits, light sensors, time clocks, all live from somewhere else entirely | §11A hazard sweep items 5, 7 and 10 (AS/NZS 3000 pre-demolition checklist) |
| Isolator is in a landlord switchroom the working electrician does not control | §6.0 "point of isolation under the control of the person doing the work" (SELECT/HSE) |
| Board blamed for pre-existing defects it did not cause | §2A "pre-existing damage" recorded *before* work starts |
| Third party (demolition crew) assumes the board is dead because someone said so | §12 "equipment demonstrated dead to the accepting person's satisfaction" |

---

## 3. The safe isolation procedure — the checklist backbone

> **Status of this section.** The step sequence below is the internationally taught safe-isolation procedure. Its *authority* in South Africa is:
> - **GMR 1988 reg 5** — only a competent (or inspector-satisfactory trained) person may work on electrically alive machinery;
> - **GMR 1988 reg 6(2)** — "positive means … shall not only be the mere tripping of a switch" (the lock-off duty);
> - **GMR 1988 reg 4(5)** — machinery that endangers when "made electrically alive" must be made incapable of it;
> - **EMR 2011 reg 4** — discharge stored energy and prevent re-energisation while persons work;
> - **EMR 2011 reg 7(5)/(6)** — post the warning notice against reclosing; nobody may act contrary to it;
> - **EMR 2011 reg 3** — PPE for work on live, or on dead-but-may-become-live, machinery;
> - **CR 2014 reg 9** — a documented safe work procedure is required, and this checklist is it;
> - **CR 2014 regs 13(1)(g) / 14(4)(e)** — "take the steps that are necessary to render the circumstances safe" before excavation/demolition affecting an electrical service;
> - **OHS Act s8** — the general employer duty.
>
> **Neither SANS 10142-1 nor the EIR 2009 contains a safe-isolation procedure** **[VERIFIED negative findings, §1.3]**. The step *articulation* below follows UK HSE practice (HSG85 *Electricity at work: Safe working practices*, and GS38 on test equipment for electrical engineers), which is what SA trade training and most SA client specifications actually mirror. See §5 for the source detail.

### The canonical sequence

| # | Step | What the form must capture |
|---|---|---|
| 1 | **Authorise** — permission to isolate obtained; affected parties notified; isolation window agreed | Permit/authorisation ref, who granted it, time window |
| 2 | **Identify** — identify the circuit/equipment and **every** source that can make it live (incl. alternative supplies, bus-ties, borrowed neutrals) | Circuit/DB identified; all sources listed; drawings/legend referenced |
| 3 | **Isolate** — operate the correct disconnecting device; isolate **all** live conductors as required (single-phase: L **and** N per 6.9.2.2) | Point of isolation (device + DB + way no.); all-poles confirmed |
| 4 | **Secure** — lock off with a unique lock/lock-off device; **post the warning notice against reclosing (EMR reg 7(5))**; single key held by the person at risk | Lock ID, tag ID, key holder name, photo of lock + notice in place |
| 5 | **Prove the tester works** — on a known live source or a proving unit, immediately before use | Tester proved: Y/N, on what (proving unit / known live source) |
| 6 | **Test dead** — at the point of work, **all combinations**: L–N, L–E, N–E (and L1–L2, L2–L3, L1–L3, each L–N, each L–E, N–E for three-phase) | Voltage readings per combination, in V |
| 7 | **Re-prove the tester** — immediately after the dead test, on the same known source | Tester re-proved: Y/N |
| 8 | **Discharge / earth stored energy** where the equipment can retain or acquire a charge (EMR reg 4) | Applicable Y/N/N-A; method; earths applied Y/N |
| 9 | **Sign and label** — the isolation is now recorded and owned by a named person | Signature + time |
| 10 | *(work proceeds)* | — |
| 11 | **Restore** — confirm all persons clear, covers refitted, IR tested (8.6.8 NOTE 1), locks removed **by the person who applied them**, notice removed, re-energise, verify | Restore checklist + who removed the lock + time |

Notes on the fine detail that separates a credible form from a generic one:

- **The "prove–test–prove" three-point rule is non-negotiable.** A form that has "tested dead: ☑" without the two proving steps is not a safe-isolation record. The tester-proved steps must be *separate* fields, before and after, each with the proving source named.
- **Test instrument for proving dead.** Trade practice (GS38) is a **two-pole voltage indicator with fused probes, minimal exposed tip (≈2–4 mm), shrouded/finger-guarded probes and no reliance on a multimeter's function switch**. A non-contact "volt stick" is **not** an acceptable primary means of proving dead. The form should record the *proving instrument* separately from the *test instruments* (IR tester, loop tester, RCD tester) because they are different devices with different requirements.
- **All combinations.** Testing L–N only misses a lost neutral; testing L–E only misses a live neutral. Record all three (single-phase) / all ten (three-phase) as numeric fields, not a single pass/fail.
- **Point of work, not point of isolation.** Proving dead at the DB proves the DB is dead. Prove dead where the hands go.
- **Lock discipline.** One lock per person at risk (multi-hasp for a crew), lock removed only by its owner, key never left in the lock. The form captures lock ID + key holder because that is what makes it auditable.

---

## 4. Recommended field-by-field form structure

### 4.1 Design decisions before the field list

1. **This form is not a CoC and must never look like one.** A CoC number is issued by the chief inspector; a CoC may not be amended (reg 9(5)); only a registered person may issue one (reg 9(1)). This form is a **works record and safety record** that *feeds* a supplementary CoC under reg 7(4). Put a standing footer on every page: *"This is a record of termination and making-safe work. It is not a Certificate of Compliance. A Certificate of Compliance in the form of Annexure 1 to the Electrical Installation Regulations, 2009, accompanied by the SANS 10142-1 test report, must be issued by a registered person for the altered part of the installation."* This one paragraph is what makes the document professionally credible rather than presumptuous.
2. **Mirror the gazetted test report's existing/new split.** Section 3 and Section 4 of the SANS test report both split every column into *Existing installation* vs *New/altered/temporary installation*. Using the same split makes your form legible to any SA inspector on sight, and makes the data directly transferable into the eventual test report.
3. **Fits the existing E-Site inspections engine.** The repo's template schema (`esite/packages/shared/src/inspections/types.ts`) already supports every control type this form needs: `pass_fail | number | text | textarea | dropdown | multi_select | date | photo | signature | file | header | computed | repeating_group`, with `required`, `unit`, `options`, `conditional_on`, `sans_ref`, `help_text`, `min_count`/`max_count`, `required_qualifications` (incl. `registered_person`, `master_installation_electrician`), and `item_label_template`. `deliverable_type` should be **`inspection_only`**, not `coc` — per decision 1. `requires_separate_verifier: true`.
4. **Follow WM's house photo style.** The existing `line-shop-handover.json` and `lv-line-shop-board-audit.json` templates use **named photo slots** ("Board (Closed)", "Internal Legend", "Main Breaker"), not a generic photo bucket. Do the same — named slots are what makes photographic evidence auditable, and it is already what WM's clients expect.
5. **One form per DB per isolation event.** SANS 8.6.1 requires a copy of the test section **per distribution board and per supply**. The ECB report header carries a **`DB/Supply No:`** field for exactly this. One form instance per board, linked to a parent project/visit. Multiple boards = multiple forms, not repeating sections inside one.
6. **Adopt the three-signature architecture, not a single sign-off.** Isolation applied and proved dead (registered person / authorised) → point-of-work prove dead (competent person doing the work) → return to service or made-safe handover (registered person / authorised). This is the pattern in every credible isolation document found, and it is what separates a record from a checkbox. Add the Watercare **per-isolation-point `Lock # / Applied by / Verified by`** register underneath it.
7. **Version the acceptance limits against the SANS edition.** Because Table 8.1 and the test set changed materially between Ed 2 and Ed 3 (§1.4), the app must store *which edition* a record was evaluated against and keep historical records evaluated against the edition in force when they were signed. Do not treat the limits as constants.
8. **There is no form to copy — and that is the opportunity.** §5.5 and §5.6.1 establish that no UK or SA body publishes an electrical isolation or make-safe certificate, while the NFDC explicitly **requires** a termination certificate for this work. WM's credibility therefore comes from citing the right regulations, mirroring recognisable structures, and being honest about what the document is — not from resembling a standard blank.

### 4.2 Section-by-section field specification

Legend for **Control**: PF = pass_fail (Pass/Fail/N-A) · YN = pass_fail used as Yes/No · TXT = text · TA = textarea · NUM = number · DATE = date · DT = date + time · DD = dropdown · MS = multi_select · SIG = signature · PH = photo · FILE = file · RG = repeating_group · CALC = computed.
**M** = mandatory. **C** = conditionally mandatory (condition stated).

---

#### Section 1 — Project & site identification

| Field | Control | M/C | Unit / options | Notes |
|---|---|---|---|---|
| Form / record number | TXT | M (auto) | — | System-generated, immutable, e.g. `TMS-{project}-{DB}-{seq}` |
| Project name | TXT | M | — | Prefill from E-Site project |
| Project number / WM job no. | TXT | M | — | |
| Client / employer | TXT | M | — | |
| Site / building name | TXT | M | — | Mirrors test report Section 1 "Name of building" |
| Physical address | TA | M | — | Mirrors test report Section 1 |
| Erf / Lot no. | TXT | — | — | Present on gazetted CoC Annexure 1 |
| GPS coordinates | TXT | — | lat, long | Present on gazetted CoC Annexure 1; auto-capture on mobile |
| Tenant / unit / shop no. | TXT | C | — | Mandatory for tenanted revamps |
| Existing CoC on record? | YN | M | — | Mirrors test report Section 2 "Existing certificate" |
| Existing CoC number | TXT | C | — | If previous = Yes |
| Existing CoC date issued | DATE | C | — | If previous = Yes |
| Original CoC obtained before commencement? | DD | M | Yes — copy on file / No — client could not produce it, client advised of remediation cost / Not applicable (pre-1992 exemption) | ECA(SA) advises obtaining it before starting work in an existing property and warning the client about remediation cost, "to prevent a dispute between the contractor and the client". A commercial-risk field as much as a technical one |
| Health & safety file reference | TXT | — | — | Construction Regulations, 2014 |
| Principal contractor | TXT | C | — | Where the revamp is notified construction work |
| Risk assessment / safe work procedure reference | TXT | M | — | **CR 2014 reg 9** — a documented safe work procedure is a legal requirement, and this form is its record |
| Competent person appointed in writing for temporary electrical installations | TXT | C | — | **CR 2014 reg 24(c)**; C: where a temporary installation exists on site |
| Weekly temporary-installation inspection register ref | TXT | C | — | **CR 2014 reg 24(d)** |

#### Section 2 — Distribution board / equipment identification

| Field | Control | M/C | Unit / options | Notes |
|---|---|---|---|---|
| DB reference / code | TXT | M | — | Link to `structure.nodes` where possible |
| DB description / name on nameplate | TXT | M | — | The *as-found* name, which may differ from the drawing |
| Location of DB | TXT | M | — | |
| DB fed from (upstream board + way) | TXT | M | — | SANS 6.6.1.21(a); verify, don't copy the label |
| Upstream protective device rating | NUM | — | A | |
| Supply system | DD | M | TN-S / TN-C-S / TN-C / TT / IT / Unknown | Mirrors test report Section 2 |
| Nominal voltage | DD | M | 230 V / 400 V / 525 V / Other | |
| Number of phases | DD | M | 1 / 2 / 3 | |
| Main switch type | DD | M | Switch-disconnector (on-load isolator) / Fuse switch / Circuit-breaker / Earth leakage circuit-breaker / Earth leakage switch-disconnector | Verbatim from the gazetted report |
| Main switch rating | NUM | M | A | |
| Short-circuit / withstand rating | NUM | — | kA | |
| Rated earth leakage tripping current I∆n | NUM | — | mA | Default 30 |
| DB short-circuit rating > 10 kA? | YN | M | — | Gates the 6.6.6.2 alteration questions |
| **Alternative / secondary supplies present?** | MS | M | None / Generator / UPS / PV or inverter / Bus-tie or interconnector / Landlord or house supply / Other | **The single most safety-critical field on the form.** SANS 7.12 |
| Alternative supply details | TA | C | — | If ≠ None |
| Is any part of this board above 1 kV? | YN | M | — | If Yes → out of scope of SANS 10142-1; route to SANS 10142-2 / ORHVS permit |
| Is this a specialised installation (hazardous / medical / explosive / petroleum)? | YN | M | — | If Yes → master installation electrician only (Annex M) |
| **Board sits in** | DD | M | Tenant installation / **Landlord sub-reticulation (SANS 10142-1 cl. 7.16)** / Common area (sectional title) / Supply authority side of the point of control | Determines which certificate the work eventually feeds and who the "user or lessor" is. ECA(SA) issues a separate **blue sub-reticulation certificate** for 7.16 systems. Critical on shopping-centre revamps |
| Lightning protection installed? | YN | — | — | Present on the ECB Edition-3 report |
| Photo — DB nameplate / label (as found) | PH | M | — | |
| Photo — DB closed, doors shut (as found) | PH | M | — | |
| Photo — DB open, covers on (as found) | PH | M | — | |
| Photo — existing legend card (as found) | PH | M | — | The as-found legend is the primary evidence of what was believed to be where |

#### Section 2A — Adequacy of existing earthing and bonding *(before touching the board)*

Lifted from **BS 7671 MEIWC Part 2**. There is no equivalent step in the South African test report, and it is the most valuable structural idea in the precedent research: you cannot make a circuit safe in an installation whose earthing you have not verified.

| Field | Control | M/C | Unit / options | Notes |
|---|---|---|---|---|
| System earthing arrangement confirmed on site | DD | M | TN-S / TN-C-S / TN-C / TT / IT / Could not determine | Confirm by inspection; do not copy from the drawing |
| Earth fault loop impedance at the DB supplying the affected circuits (Zdb) | NUM | M | Ω | MEIWC Part 2 item 2 |
| Earthing conductor present and adequate | PF | M | — | |
| Earthing conductor size | NUM | — | mm² | |
| Main protective bonding present to: | MS | M | Water / Gas / Oil / Structural steel / Lightning protection / Other / None found | MEIWC Part 2 item 3; SANS 6.13.2 lists what must be bonded |
| Bonding continuity verified (≤ 0,2 Ω) | NUM | M | Ω | `sans_ref: "8.6.2"` |
| Consumer's earth terminal accessible and identified | PF | M | — | `sans_ref: "6.11.5"` |
| Photo — main earth terminal and bonding | PH | M | — | |
| **Any pre-existing damage or defect noted before work commenced** | TA | M | — | From the C&G decommissioning certificate. On a revamp the contractor is routinely blamed for pre-existing defects — this field is the defence, and it must be answered before the work starts, not after |
| Photo — pre-existing damage | PH | C | — | C: if the above is non-empty |

#### Section 3 — Date, time and personnel

| Field | Control | M/C | Unit / options | Notes |
|---|---|---|---|---|
| Date of work | DATE | M | — | |
| Time isolation commenced | DT | M | — | |
| Time work completed | DT | M | — | |
| Electrician — full name | TXT | M | — | |
| Electrician — ID / employee no. | TXT | — | — | |
| Electrician — registration category | DD | M | Master installation electrician / Installation electrician / Electrical tester for single phase / Not a registered person — working under general control | Verbatim from EIR reg 11(2) and test report §5.4 |
| Electrician — registration certificate no. | TXT | C | — | Mandatory unless category = "Not a registered person"; help text "(wireman's licence no.)" |
| Electrician — registration expiry | DATE | — | — | Mirrors test report §5.3 "Expiry date of registration" |
| **Registered person exercising general control** — name | TXT | M | — | **EIR reg 5(4)** — required for *all* installation work, including when the person on site is not themselves registered |
| Registered person — registration no. | TXT | M | — | |
| Registered person — category | DD | M | Master installation electrician / Installation electrician / Electrical tester for single phase | Validate against Annex M scope vs the installation type captured in §2 |
| Electrical contractor (company) | TXT | M | — | |
| Electrical contractor registration no. | TXT | M | — | EIR reg 6; annual |
| Contractor registration expiry | DATE | — | — | |
| Other persons on site (crew) | RG | — | name, role | Each crew member who applies a lock should be listed |
| PPE confirmed appropriate and serviceable | YN | M | — | EMR reg 3 |

> **Validation rules worth building.** These are genuine legal constraints a paper form cannot enforce and your app can:
> 1. §2 "specialised installation" = Yes **and** registered-person category ≠ master installation electrician → block certification. *(EIR reg 1 definitions: only the MIE definition carries no "excluding specialised" exclusion.)*
> 2. §2 phases ≠ 1 **and** category = electrical tester for single phase → block. *(EIR defines that category as limited to "a single-phase electricity supply at the point of control".)*
> 3. §2 "any part above 1 kV" = Yes → the design of that part requires a **GMR reg 1 competent person under paragraph (b), (c) or (d)**, or an Engineering Profession Act registrant (**EIR reg 5(5)**). A master installation electrician does **not** qualify by virtue of that registration. Surface this as a blocking notice, not a warning.
> 4. Electrical contractor registration expiry < date of work → block. *(EIR reg 6(2): registration is **annual**.)*
>
> Note on framing rule 2: the phase-based scope matrix is SANS 10142-1 **Annex M**, which is *informative*. The binding text is the EIR reg 1 definition. Word the validation message using the EIR definition and offer Annex M as the explanatory table.

#### Section 4 — Scope of work

| Field | Control | M/C | Unit / options | Notes |
|---|---|---|---|---|
| Nature of work | MS | M | Termination of redundant circuits / Making safe for demolition or strip-out / Board modification or extension / Temporary supply installation / Decommissioning of board / Isolation for third-party work / Other | |
| Scope description | TA | M | — | Mirrors test report Section 3 "Description of installation covered by this report" |
| Reason for the work | TA | — | — | |
| Reference drawings | FILE / TXT | — | — | Drawing no. + revision; link to E-Site floor plans |
| Instruction / RFI / variation reference | TXT | — | — | Link to the E-Site RFI module |
| Areas / tenants affected by the isolation | TA | M | — | |
| **Written authorisation to isolate obtained** | YN | M | — | |
| Authorisation granted by (name + role) | TXT | C | — | If previous = Yes |
| Authorisation reference / permit no. | TXT | — | — | |
| Agreed isolation window | TXT | — | — | |
| Third-party permit to work required? | YN | M | — | Landlord/utility/Eskom systems |
| Permit to work number | TXT | C | — | If Yes |

#### Section 5 — Circuits affected (repeating)

`repeating_group`, `min_count: 1`, `item_label_template: "Way {{way_no}} — {{circuit_ref}}"`. One row per circuit acted upon.

| Sub-field | Control | M/C | Unit / options | Notes |
|---|---|---|---|---|
| Way / position no. | TXT | M | — | |
| Circuit reference | TXT | M | — | As per existing legend |
| Circuit description (as found) | TXT | M | — | What the legend *said* |
| Circuit description (as verified) | TXT | M | — | What it *actually* feeds — the two differ constantly on a revamp |
| Protective device type | DD | M | MCB / MCCB / RCBO / RCD or ELU / Fuse / Isolator / Contactor / None — direct | |
| Protective device rating | NUM | M | A | |
| Number of poles | DD | M | 1 / 1+N / 2 / 3 / 3+N / 4 | |
| Conductor size (phase) | NUM | M | mm² | |
| Conductor size (earth / CPC) | NUM | — | mm² | |
| Number of cores | DD | — | 2 / 3 / 4 / 5 / other | |
| Cable type | DD | — | Surfix / PVC in conduit / SWA / ECC / Flex / Busbar / Other | |
| **Action taken** | DD | M | **Terminated and removed** / **Disconnected and capped — left in situ** / **Disconnected at DB only — far end open** / **Left isolated — locked off** / **Retained and reconnected** / **Made safe pending removal by others** / **No action — reference only** | The core field. "Disconnected at DB only — far end open" is deliberately listed so it can be flagged as a defect, not hidden |
| Termination method | DD | C | Removed to source / Terminated in accessible junction box / Insulated crimp + enclosure / **Conductor coiled and insulated, labelled** (SELECT/HSE accepted method) / Gland-terminated into enclosure / Cut back flush and removed from wireway / Other | C: if action involves capping/leaving in situ. **"Taped up" is deliberately not offered** — PVC tape is not compliant with 5.2.1 / 6.3.7, and SELECT/HSE state explicitly that tape over a breaker "is not a safe means of isolation" |
| **Clear break made between feed and appliance** (conductor physically cut, break visible) | PF | C | — | **NFDC DRG108:2019** — *"physically cut to show a clear break from the 'feed' to the 'appliance'"*. The definitive evidence test for a made-safe conductor, and it is photographable |
| Termination compliant with SANS 10142-1 6.3.7 / 5.2.1 (accessible, protected, strain-relieved) | PF | C | — | `sans_ref: "6.3.7.1"` |
| Far end of conductor made safe? | YN | C | — | The half everyone forgets |
| Far-end location | TXT | C | — | |
| Conductor labelled "DEAD — DO NOT ENERGISE" + date + by whom | YN | M | — | SELECT/HSE: *"Suitable labelling of the disconnected conductors is important."* |
| Neutral of this circuit confirmed not shared / borrowed | PF | M | — | SELECT/HSE flag borrowed neutrals as a specific hazard on existing installations — a neutral can become live when disconnected. Record the N–E reading in §8A |
| Way blanked off (blanking plate fitted) | PF | C | — | `sans_ref: "6.6.1.19"`; C: where a device was removed |
| Proved dead at point of work | YN | M | — | |
| Notes / deviations | TA | — | — | |
| Photo — circuit termination | PH | M | — | Per-row photo. The E-Site engine already supports per-field photos inside repeating groups |

> Add a computed roll-up: `CALC` **"Circuits left energised or in a temporary state"** = count of rows where action ∈ {Left isolated — locked off, Made safe pending removal by others, Disconnected at DB only — far end open}. Surface it on the handover section — this number is what the next person needs to know.

#### Section 6 — Safe isolation checklist (the backbone)

Every field mandatory. Order is the procedural order and the UI should not allow skipping ahead.

| # | Field | Control | Unit / options | Notes |
|---|---|---|---|---|
| 6.0 | **The point of isolation is under the control of the person carrying out the work** | PF | — | SELECT/HSE fundamental principle. If it is not — e.g. the isolator is in a landlord switchroom — the form must escalate to a third-party permit (§4) |
| 6.1 | Point of isolation identified (device + board + way) **and described** | TXT | — | C&G decommissioning certificate pairs each isolation point with a written description, not just a device name |
| 6.2 | **All sources capable of making the circuit live have been identified** | PF | — | Cross-check against §2 alternative supplies |
| 6.2a | Circuit is TT or IT and therefore requires phase **and** neutral disconnection | PF | — | SELECT/HSE: single-pole isolation is not acceptable on TT/IT. N-A if TN-S / TN-C-S |
| 6.3 | Alternative supply (generator / UPS / PV / bus-tie) isolated or proven incapable of back-feed | PF | — | N-A permitted only if §2 = None |
| 6.4 | Circuit de-energised at the identified point of isolation | PF | — | |
| 6.5 | All required poles isolated (incl. neutral where required by 6.9.2.2) | PF | — | `sans_ref: "6.9.2.2"` |
| 6.6 | **Isolating device secured in the off position (padlock / lock-off device / lockable enclosure)** | PF | — | **GMR 1988 reg 6(2)** — "positive means … shall not only be the mere tripping of a switch"; also SANS 10142-1 **7.4.6.6** (temporary installations) and EMR 2011 reg 7(3) |
| 6.6a | Method of securing | DD | Safety padlock (unique key) / Breaker lock-out device / Lockable enclosure / **Multiple-locking hasp / lock-out box** (2+ persons) / Fuse removed and retained / **Lockable insulating blank in empty fuseway** / Plug withdrawn and locked out | HSG85 paras 49–51. **"Switch left off" is deliberately not an option** |
| 6.6b | Every person at risk has applied their own lock and holds their own key | PF | — | HSG85 para 51; N-A if single worker |
| 6.7 | Lock / lock-off device ID | TXT | — | |
| 6.8 | Key held by (name) | TXT | — | Single key, held by the person at risk; keys retained securely (HSG85 para 49) |
| 6.9 | **Caution notice posted at the point of disconnection, warning against reclosing** | PF | — | **EMR 2011 reg 7(5)**; HSG85 para 52 |
| 6.9a | **Danger notices posted on adjacent live equipment** | PF | — | HSG85 para 52; N-A where nothing adjacent remains live |
| 6.10 | Tag / notice reference | TXT | — | |
| 6.11 | Photo — lock and warning notice in position | PH | — | |
| 6.12 | Voltage indicator make / model / serial | TXT | — | Two-pole voltage detector, test lamp, or voltmeter with insulated probes and fused leads. **Multimeters and non-contact "volt sticks" are not acceptable for proving dead** (HSG85 para 54) |
| 6.13 | **Voltage indicator proved on a known source immediately before use** | PF | — | Step 1 of three-point |
| 6.14 | Proving source used | DD | Dedicated proving unit / Known live supply | |
| 6.15 | **Tested dead at the point of work — all conductor combinations** | PF | — | Step 2; readings in §8 |
| 6.16 | **Voltage indicator re-proved on the known source immediately after** | PF | — | Step 3 |
| 6.17 | Stored energy discharged / earths applied where the equipment can retain or acquire a charge | PF | — | **EMR 2011 reg 4**; N-A permitted with a stated reason |
| 6.18 | Stored-energy sources addressed | MS | None / PFC capacitor bank / VSD DC link / UPS battery / PV string / Long cable run / Other | |
| 6.19 | Adjacent live parts screened / barriered where work proceeds nearby | PF | — | |
| 6.20 | **Method by which the circuit will be prevented from being brought back into operation** | TA | — | From the C&G decommissioning certificate. A stated method, not a checkbox — this is what an incident enquiry reads |
| 6.21 | Relevant people informed that the isolation is in place | MS | Client / Building manager / Tenant(s) / Principal contractor / Other trades on site / Security / None required | C&G "informed relevant people"; pairs with §4 "areas/tenants affected" |
| 6.22 | Safe isolation confirmed — work may proceed | SIG | — | Signature + timestamp; this is the moment the isolation is owned |

**Section 6A — Lock and tag register** (`repeating_group`, one row per isolation point). Pattern taken verbatim from the Watercare Isolation Certificate.

| Sub-field | Control | M/C | Notes |
|---|---|---|---|
| # | CALC | M | Row number |
| Equipment / isolation point description | TXT | M | |
| Isolation method | DD | M | Same option set as §6.6a |
| Lock # | TXT | M | |
| Tag # | TXT | — | |
| Applied by (name + initial) | TXT | M | |
| **Verified by (name + initial)** | TXT | M | Second-person verification — the Watercare pattern, and the strongest control in the whole form |
| Date / time applied | DT | M | |
| Date / time removed | DT | C | Completed at return to service |
| Removed by | TXT | C | Must equal "Applied by" unless an exception reason is given |
| Exception reason (lock removed by someone else) | TA | C | Requires supervisor countersignature |

#### Section 7 — Test instruments used

`repeating_group`, `min_count: 1`. One row per instrument (voltage indicator, IR tester, low-ohm/continuity tester, loop tester, RCD/ELU tester, clamp meter, fault-current meter).

| Sub-field | Control | M/C | Unit / options | Notes |
|---|---|---|---|---|
| Instrument function | DD | M | Voltage indicator (proving dead) / Proving unit / Insulation resistance / Continuity — low ohm / Earth fault loop impedance / RCD-ELU tester / Multifunction tester / Clamp meter / Fault current meter / Other | The gazetted test report has an "Instrument" column per test — this table is what populates it |
| Make | TXT | M | — | |
| Model | TXT | M | — | |
| Serial number | TXT | M | — | |
| Calibration date | DATE | M | — | |
| Calibration due date | DATE | M | — | |
| Calibration certificate no. | TXT | — | — | |
| Calibration certificate attached | FILE | — | — | |
| Instrument accuracy within ±5 % | PF | M | — | `sans_ref: "8.6.1"` — this is the claim SANS actually makes |
| Measurement category (CAT rating) | DD | C | CAT II / CAT III / CAT IV | GS38 4th ed.: leads must be marked with the rated installation category. C: mandatory for the voltage indicator and any instrument used on a live circuit |
| Test leads rated at the same or higher CAT | PF | C | — | GS38: instruments and leads are separate entities — **CAT II leads on a CAT III instrument derate the whole set to CAT II** |
| Voltage indicator conforms to BS EN 61243-3 (or equivalent) | PF | C | — | C: instrument function = Voltage indicator |

> Build a validation: **calibration due date < date of work → hard warning, and block certification.** And label the calibration fields as a WM/client requirement, not a SANS requirement (see §1.6).

#### Section 8 — Voltage readings and tests

Split into 8A (proving dead) and 8B (electrical tests), because they answer different questions.

**8A — Proving dead** (all mandatory; three-phase fields conditional on §2 phases = 3)

| Field | Control | Unit | Notes |
|---|---|---|---|
| L–N | NUM | V | |
| L–E | NUM | V | |
| N–E | NUM | V | A non-zero N–E is the classic borrowed-neutral signature |
| L1–L2 / L2–L3 / L1–L3 | NUM ×3 | V | C: 3-phase |
| L1–N / L2–N / L3–N | NUM ×3 | V | C: 3-phase |
| L1–E / L2–E / L3–E | NUM ×3 | V | C: 3-phase |
| Point at which readings were taken | TXT | — | Point of work, not the DB |
| All readings ≤ 0 V (dead confirmed) | CALC | — | Formula over the above; drives a hard gate |

**8B — Electrical tests** (mirrors the gazetted test report's 16 rows; include only what the scope touches, with N-A + reason permitted)

| # | Test | Control | Unit | Limit / expected | `sans_ref` |
|---|---|---|---|---|---|
| 1 | Continuity of bonding | NUM | Ω | **≤ 0,2 Ω** | 8.6.2 |
| 2 | Resistance of earth continuity conductor | NUM | Ω | ≤ Table 8.1 value for the device rating | 8.6.3 |
| 3 | Continuity of ring circuits | PF | — | Correct; ends reconnected to same terminal | 8.6.4 |
| 4 | Earth fault loop impedance at main or local switch | NUM | Ω | Disconnection at ≥ 2× device rating. **There is no tabulated maximum Zs in SANS** — do not import BS 7671's "maximum permitted Zs" concept | 8.6.5 |
| 4a | **Neutral loop impedance at main or local switch** | NUM | Ω | **New in Edition 3 (8.6.5.2)** — not present in Ed 2. Present on the ECB Edition-3 report | Ed 3 8.6.5.2 |
| 5 | Prospective short-circuit current | NUM | kA | + how determined (Calculated / Measured / From supplier) | 8.4 |
| 6 | Elevated voltage, incoming neutral to external earth | NUM | V | **> 25 V notify supplier; > 50 V disconnect + Annex H** | 8.6.6 |
| 7 | Earth resistance at electrode | NUM | Ω | Optional where supplier provides an earthing terminal | 8.6.7 |
| 8 | **Insulation resistance** | NUM | MΩ | **≥ 1,0 MΩ**, test voltage ≥ 500 V | 8.6.8 |
| 8a | Insulation resistance — test voltage applied | NUM | V | ≥ 500 | 8.6.8.1 |
| 8b | IR — L–E / L–L / L–N (as applicable) | NUM ×n | MΩ | each ≥ 1,0 | 8.6.8.2 |
| 9 | Voltage at main DB, no load, per phase | NUM ×n | V | within 5.4.2 limits | 8.6.9 |
| 10 | Voltage at main DB, on load, per phase | NUM ×n | V | within regulatory limits | 8.6.10 |
| 11 | Voltage at available load (worst case) | NUM | V | voltage drop **≤ 5 %** | 8.6.11 |
| 12 | Earth leakage unit — measured tripping current | NUM | **mA** | Trips at 100 % of I∆n; **sustains 50 % of I∆n without tripping** | Ed 2 8.6.12 / **Ed 3 8.6.11** |
| 12a | Earth leakage trip time *(optional, WM engineering record only)* | NUM | ms | **⚠ NOT a SANS acceptance criterion.** An exhaustive search of the full Edition 3 text returned **zero millisecond values** anywhere in clause 8. The SA earth-leakage test is a **current** test recorded in **mA**. Label this field explicitly as supplementary or omit it — a "200 ms" or "5×I∆n" pass criterion on a South African form is a BS 7671 convention imported by mistake | — |
| 13 | Earth leakage test button | PF | — | Unit trips | 8.6.13 |
| 14 | Polarity at points of consumption | PF | — | Correct | 8.6.14 |
| 15 | Phase rotation (3-phase) | PF | — | Correct and maintained on supply sides of all DBs | 8.6.14(d) |
| 16 | Switching devices make and break correctly | PF | — | Correct | 8.6.15 |
| — | Instrument used (per test) | DD | — | Picks from Section 7 rows | 8.7 report format |
| — | N/A reason (per test) | TXT | — | e.g. "circuit could not be isolated — live per 8.6.8 NOTE 2" | 8.6.8 NOTE 2 |

> Every numeric test field should be **auto-evaluated against its limit** and drive the `pass_state`. The ECB's published Edition-3 report already carries an explicit **`IS COMPLIANT?`** column per test row — so computing it is not an invention, it is automating a column that already exists. That is the single biggest advantage a digital form has over the paper test report.
>
> ⚠ **But see the edition-drift warning in §1.4.** The Ed 2 and Ed 3 **Table 8.1** limits differ by a factor of 2–3, and the Ed 3 test list drops "voltage at available load" and adds neutral loop impedance. **Seed the limits from the licensed current edition, and version the limit set** so historical records are still evaluated against the edition in force when they were signed.

**Per-point test annexes.** Tests 1, 2, 4, 4a, 8 and 14 are not single readings — they are readings *per point of consumption*. Mirror the **ECB annex-page pattern** as `repeating_group`s with columns `INSTRUMENT USED | # | LOCATION / IDENTIFIER | reading + unit | IS COMPLIANT?`, pre-labelling row 1 as the ECB does (*"Main DB with sub DBs isolated"* for insulation resistance; *"Point of Supply to Main DB"* for loop impedance). SANS 8.6.1 also requires that where multiple tests are done, the **worst-case** value goes on the summary row — so the summary field should be a `computed` roll-up of the annex rows, not a separately typed number.

#### Section 9 — Labelling and board reinstatement

| Field | Control | M/C | `sans_ref` | Notes |
|---|---|---|---|---|
| Blanking plates fitted to all unoccupied openings | PF | M | 6.6.1.19 | |
| All incoming and outgoing circuits permanently labelled | PF | M | 6.6.1.20 | |
| Legend card / circuit schedule updated to as-left state | PF | M | 6.6.1.20 | Link to the E-Site DB legend-card module (PR #142) |
| "Fed from" label correct and current | PF | M | 6.6.1.21(a) | Frequently wrong after a revamp |
| Alternative-supply warning label at main switch (where applicable) | PF | C | 7.12.2.1 | C: alternative supply present |
| Multi-supply notice at each main switch-disconnector (where applicable) | PF | C | 6.9.1.1 | |
| Notice at each disconnecting device giving location/function of the other (where applicable) | PF | C | 6.9.3.2 | |
| **Supplementary nameplate updated for changed DB properties** | PF | C | 6.6.6.2(e) | C: §2 "DB > 10 kA" = Yes and board was modified |
| Labels durable, legible, indelible, not removable except deliberately | PF | M | 4.2 | |
| Controlling apparatus permanently marked (front and back where accessible from both) | PF | M | — | **EMR 2011 reg 7(4)** |
| IP rating not reduced by the alteration | PF | C | 6.6.6.2(f) | |
| Fire barrier integrity reinstated where cables were withdrawn | PF | C | 8.5.3(11) | The most commonly missed item on a strip-out |
| Board interior cleaned of debris, offcuts and dust | PF | M | — | WM house standard (`line-shop-handover.json`) |
| All covers, shrouds and doors refitted | PF | M | — | |

#### Section 10 — Photographic evidence

Named slots, mirroring WM house style. Minimum set:

| Slot | M/C |
|---|---|
| DB nameplate / identification (as found) | M *(captured in §2)* |
| DB closed — as found | M *(§2)* |
| DB open, covers on — as found | M *(§2)* |
| Existing legend card — as found | M *(§2)* |
| Point of isolation with lock and warning notice fitted | M *(§6.11)* |
| Voltage indicator proving on the known source | M |
| Test-dead reading at the point of work (meter display legible) | M |
| Each circuit termination | M *(per §5 row)* |
| **Clear break between feed and appliance, visible** | M *(per §5 row, where the conductor was cut)* — NFDC DRG108 |
| Terminated conductors labelled "DEAD" | M |
| Main earth terminal and bonding (§2A) | M |
| Pre-existing damage (§2A) | C |
| Blanking plates fitted / vacated ways | M |
| Updated legend card in position | M |
| DB open, covers on — as left | M |
| DB closed — as left | M |
| Fire barrier reinstatement | C — where penetrations were disturbed |
| Temporary supply board (where installed) | C |
| Any hazard or defect recorded in §11 | C — one photo per defect |

Implementation note: the repo's `compressImage` helper (`apps/web/src/lib/image/compress.ts`) and the inspections `useFieldPhotos` hook already handle client-side compression and per-field photo binding; the mobile app has the equivalent `usePhotoCapture`. Timestamp and GPS should be stamped at capture, not derived later — that is what makes a photo evidential.

#### Section 11 — Hazards, defects and deviations

| Field | Control | M/C | Notes |
|---|---|---|---|
**11A — Pre-work hazard sweep.** The 15-item AS/NZS 3000 pre-demolition checklist (§5.6.2), adapted, with **dual technician + supervisor sign-off per line** as in the original. Every item `pass_fail` with N-A allowed:

| # | Item |
|---|---|
| 1 | Disconnection planned before removal of power/lighting cabling; power isolated and tagged |
| 2 | No bare conductors can contact any live part |
| 3 | All circuit-breakers switched OFF, locked and tagged |
| 4 | Locking device used on the individual circuit to prevent operation of the MCCB in the OFF position |
| 5 | **Auxiliary circuits and alternative power supplies checked and CONFIRMED DEAD before commencing** |
| 6 | All power cables tested and isolated before removal of points and lights |
| 7 | Live cables in work zones isolated |
| 8 | Temporary light and power cabling clearly tagged with construction and danger tape |
| 9 | Danger tags placed at all points, not to be removed without supervisor approval |
| 10 | **All cabling tested for isolation in ceiling spaces and wall cavities — rogue cabling, remotely-fed cabling, light sensors, time clocks** |
| 11 | Existing cabling still in use in demolition areas labelled with danger tags |
| 12 | All power to demolition areas disconnected |
| 13 | All power to offices, consult rooms, workstations and partition walls isolated |
| 14 | All lighting, switches, exit and emergency lighting isolated in demolition areas |
| 15 | All areas for demolition isolated |
| 16 | **Borrowed / shared neutrals checked for** *(WM addition — SELECT/HSE flag this specifically on existing installations)* |
| 17 | **Back-feed prevented; anti-condensation heaters isolated and tagged; shutters locked** *(from the industrial isolation permit, where applicable)* |

Signature pair: `Technician name + signature` and `Supervisor name + signature`, each with date/time.

**11B — Defects and deviations**

| Field | Control | M/C | Notes |
|---|---|---|---|
| Hazards or defects identified? | YN | M | |
| Defect register | RG | C | Sub-fields: description · location · **classification code** · SANS/regulation reference · photo · action taken · action by · target date |
| — classification code options | DD | M | **`C1 – Danger present. Risk of injury. Immediate remedial action required`** · **`C2 – Potentially dangerous — urgent remedial action required`** · **`C3 – Improvement recommended`** · **`FI – Further investigation required without delay`** — adopted verbatim from BS 7671 EICR. Internationally recognised, unambiguous, and **C1 maps exactly onto the EIR reg 9(3) "immediate danger" trigger** |
| **Immediate danger present? (any C1)** | YN | M (computed) | Derived from the register; if Yes → the following three fields become mandatory |
| Supply to the affected circuit disconnected | PF | C | **EIR reg 9(3)** — this is a statutory duty, not a choice |
| Chief inspector notified | YN | C | **EIR reg 9(3)** |
| Notification reference / date | TXT | C | |
| Potential danger requiring supplier notification (elevated neutral voltage / voltage outside limits)? | YN | M | Triggered by §8B rows 6, 9, 10 |
| **Annex H notification issued to the supplier** | YN | C | `sans_ref: "Annex H"`; generate the Annex H form as a linked document |
| Deviations from specification or drawing | TA | — | |
| **Extent and limitations of this record** | TA | M | Adapted from EICR Section D. What was inspected, what was not, and why |
| **Limitations agreed with (name + role)** | TXT | M | EICR Section D "Agreed with:" — an agreed limitation is a defence; an unagreed one is an omission |
| Parts of the installation NOT covered by this record | TA | M | Verbatim concept from the gazetted test report Section 4 and the ECB Edition-3 report — a liability shield that should never be optional |
| Recommendations / further work required | TA | — | |

#### Section 12 — Handover status

| Field | Control | M/C | Notes |
|---|---|---|---|
| **As-left status of this board** | DD | M | **Made safe — de-energised and secured** / **Energised and returned to service** / **Left isolated — locked off, lock retained by WM** / **Left isolated — locked off, lock handed to client** / **Partially energised** / **Decommissioned and removed** |
| Number of circuits left in a temporary state | CALC | M | Roll-up from §5 |
| Insulation resistance test completed before energising | PF | C | **C: mandatory if status = Energised or Partially energised.** `sans_ref: "8.6.8 NOTE 1"` |
| All persons under the signatory's charge withdrawn and warned that it is no longer safe to work on the apparatus | PF | C | C: if energised. Wording adapted from the HSG85 permit Clearance section |
| All work equipment, tools and test instruments removed from the equipment | PF | C | C: if energised. HSG85 Clearance |
| Temporary earths removed | PF | C | C: if earths were applied per §6.17 |
| Covers, shrouds and doors refitted before energising | PF | C | C: if energised |
| Locks removed by the person who applied them | PF | C | C: if energised |
| Warning / caution / danger notices removed | PF | C | C: if energised |
| Post-energisation function check completed (expected loads live, no unexpected loads) | PF | C | C: if energised |
| Earth leakage unit re-tested after energising | PF | C | C: if energised |
| Locks remaining in place | RG | C | C: if left isolated. Reads from the §6A lock register — rows with no removal timestamp |
| Review / removal date for remaining isolations | DATE | C | C: if left isolated |
| **Temporary supplies left in place for the client** | TA | C | From the C&G decommissioning certificate ("ensured temporary services are available for client"). C: if any circuit was left energised for temporary use — and if so, SANS 7.4 / 7.8 apply to it |
| **Handover to demolition / strip-out contractor with safety clearance** | PF | C | Australian make-safe practice; C: where another trade takes over the area |
| Person accepting handover — name, company, role | TXT | C | |
| **Equipment demonstrated dead to the accepting person's satisfaction** | PF | C | UK DNO permit pre-issue duty. Where a third party takes over an isolated board, showing them it is dead is the control that prevents the next incident |
| Responsible party for the installation on handover | DD + TXT | M | **EIR reg 2** — User / Lessor / Lessee (by written undertaking, reg 2(3)) / Principal contractor. Note the EIR provides **no** mechanism to leave responsibility with the contractor |
| **Certificate of Compliance required for this alteration** | YN | M | Default Yes. `help_text`: EIR reg 7(4) |
| CoC / supplementary CoC number (if already issued) | TXT | — | |
| CoC to be issued by (registered person) | TXT | C | |
| Target date for CoC | DATE | C | |
| Outstanding items | TA | — | |

#### Section 13 — Declarations and sign-off

Three (optionally four) separate signature blocks. This mirrors the multi-signature structure of SANS 10142-1 test report Section 5, and separating them is what makes liability legible.

| Block | Field | Control | M/C | Notes |
|---|---|---|---|---|
| **13.1 Electrician** | Declaration text (fixed) | header | M | *"I certify that the work described in this record was carried out by me or under my direct supervision, that the safe isolation procedure recorded in Section 6 was followed in full, that the readings recorded are correct, and that **the work covered by this record does not impair the safety of the existing installation**. No attempt was made by me or by persons under my charge to work on any other apparatus or in any other area than that described in Section 4."* (First clause adapted from the BS 7671 MEIWC Part 5 declaration; second from the HSG85 permit Receipt.) |
| | Name | TXT | M | |
| | Registration category + number | TXT | C | |
| | Signature | SIG | M | |
| | Date | DATE | M | |
| **13.2 Registered person (general control)** | Declaration text (fixed) | header | M | *"I confirm that I exercised general control over this electrical installation work in terms of regulation 5(4) of the Electrical Installation Regulations, 2009, and that the altered part of the installation is, to the best of my knowledge, reasonably safe in its as-left state."* |
| | Name | TXT | M | |
| | Registration certificate no. | TXT | M | |
| | Type of registration | DD | M | Master installation electrician / Installation electrician / Electrical tester for single phase |
| | Contact tel. | TXT | M | Present on gazetted test report §5.4 |
| | Signature | SIG | M | `required_qualifications: ["registered_person"]` |
| | Date | DATE | M | |
| **13.3 Supervisor / engineer (WM)** | Name and position | TXT | M | |
| | Pr Eng / Pr Tech / ECSA registration no. | TXT | — | |
| | Signature | SIG | M | `required_qualifications: ["pr_eng"]` where the project warrants |
| | Date | DATE | M | |
| **13.4 Client / witness** | Name and organisation | TXT | C | Mandatory where the client witnessed the isolation or takes custody of a lock |
| | Role | DD | C | Client representative / Building manager / Tenant / Principal contractor / Other |
| | Acknowledgement text (fixed) | header | C | *"I acknowledge receipt of this record and the as-left status stated in Section 12. I confirm I have been informed of any circuits left isolated and of the Certificate of Compliance obligation under regulation 7(4)."* |
| | Signature | SIG | C | `required_qualifications: ["client"]` or `["witness"]` |
| | Date | DATE | C | |

**Fixed footer on every page:** the non-CoC disclaimer from §4.1 decision 1.

### 4.3 Cross-cutting behaviours worth building

- **Hard gates.** (a) Cannot mark status = Energised without an IR reading ≥ 1,0 MΩ or an explicit 8.6.8 NOTE 2 justification. (b) Cannot certify with any instrument past its calibration due date. (c) Cannot certify with §6.13/6.15/6.16 (prove–test–prove) incomplete. (d) Cannot certify if §11 immediate danger = Yes and the reg 9(3) disconnection/notification fields are unanswered. (e) Registration-category vs installation-type check against Annex M.
- **Immutability.** Once signed, versioned and superseded, never edited (mirrors EIR reg 9(5)'s spirit and the existing E-Site versioned-report pattern used by the snag module).
- **Offline-first.** Plant rooms have no signal. The mobile app must queue the whole form, photos included.
- **Auto-carry into the CoC test report.** Sections 2, 5, 7 and 8 map almost 1:1 onto test report Sections 2, 3, 4. Building that mapping now means the making-safe record becomes the first-draft test report later — which is the commercial argument for the module.
- **Sequence lock on Section 6.** The safe-isolation section should be answerable only in order. A checklist that can be back-filled after the fact is worth nothing in an incident enquiry.

---

## 5. Industry form precedents worth mirroring

### 5.0 The South African precedent nobody cites: ORHVS

**[SECONDARY — training-provider and tender-document sources; the ORHVS document itself (Eskom 32-846) could not be retrieved.]**

Eskom's **Operating Regulations for High Voltage Systems (ORHVS)**, document reference **32-846**, is the generally accepted South African industry standard for instructions governing operating, construction or maintenance work on an electrical power system, read together with the OHS Act. It is MV/HV, not LV — but it is the only *South African* formal isolation-document system, and mirroring its vocabulary makes a WM form instantly legible to anyone who has done ORHVS training.

Its structure, as taught:
- **Roles**: *authorised person*, *responsible person* (authorised to accept a work permit for work on isolated and earthed apparatus, to supervise persons, and for access to restricted and prohibited areas), *appointed person*.
- **The S.I.T.E principle** — **S**witching, **I**solating, **T**esting, **E**arthing. This is the SA-taught four-step equivalent of the UK prove-dead sequence, with earthing added because it is HV.
- **Operating instruction forms** — issuing, receiving and cancelling instructions.
- **Work permit system** — issue, receipt, clearance, cancellation, including for customer and contractor engagements.
- **Sanction for test** — "a written agreement on the sanction for test form, signed by the appointed person and by the responsible person in charge of the work, for the purpose of making known exactly how tests or activities are to be carried out under uninterrupted supervision."
- **Handing over and returning apparatus to service** — an explicit, documented step, which is exactly what §12 of the proposed form does.
- **Abnormal conditions** and working near live conductors.
- Related standard: **SANS 724** (referenced in ORHVS training material).

**What to borrow:** the **issue → receipt → clearance → cancellation** lifecycle for any isolation that outlives a single shift, the named-role vocabulary, and the discipline that *returning apparatus to service* is its own signed step and not merely the absence of an isolation.

**What not to borrow:** the permit itself. A full permit-to-work is HV/utility machinery and is disproportionate for LV DB work. The proposed form's §4 (authorisation to isolate) plus §6 (secured isolation, signed) plus §12 (handover status) is the right LV-scaled equivalent. Where a landlord, utility or Eskom system is involved, the form should capture *their* permit number rather than pretending to be one.

Sources: https://peganix.org.za/orhvs-operating-regulations-for-hv-mv-systems/ · https://www.hvtraining.co.za/orhvs-courses.html · https://limonite.co.za/digital-services/orhvs-training-mvhv-switching (HTTP 403 to automated access)

---

### 5.1 HSE **HSG85** *Electricity at work: Safe working practices* (3rd ed., 2013) — the safe-isolation backbone

**[VERIFIED — full PDF read.]** https://www.hse.gov.uk/pubns/books/hsg85.htm · PDF: https://www.hse.gov.uk/pubns/priced/hsg85.pdf

This is UK guidance under the Electricity at Work Regulations 1989, so it has **no legal force in South Africa** — but it is the clearest published articulation of the procedure that SA trade training, SA client specifications and most SA contractor safe-work-procedures actually follow. Cite it as **good practice**, never as a legal requirement in SA. Its statutory equivalents here are set out in §3.

**HSG85's "Working dead" section structure** (verbatim headings, with paragraph numbers) — this is the recommended shape for §6 of the form:

| HSG85 step | Paras | Substance |
|---|---|---|
| **Identification** | 47 | "it should **never be assumed that labelling is correct** and that work can be started without having first proved that the equipment or circuit is dead." |
| **Disconnection** | 48–51 | "Disconnect the equipment from **every source** of electrical energy…" and on equipment capable of storing charge (capacitors, HV cables) "ensure that any stored charge has been safely discharged." |
| **Secure isolation** | 49–51 | Isolating gap adequate for the voltage; "Switches, including circuit breakers, should be **locked in the OFF position preferably using a 'safety' lock, ie a lock or padlock having a unique key or combination**." Lock-out devices on breaker actuators; keys retained securely; withdrawn plugs made non-reconnectable; **removed fuses taken away or the box locked**, or a **lockable insulating blank** inserted in the empty fuseway. Para 51: where several people work, a **multiple locking hasp, lock-out box or key-safe** so all locks must be removed before re-energisation — "Everyone involved in the work should apply a lock … and **keep personal possession of the key**." |
| **Post notices** | 52 | A **'caution' notice** at the point of disconnection indicating someone is working; **'danger' notices** on adjacent live equipment. |
| **Proving dead** | 53–56 | Para 53: check the parts to be worked on are dead "**even if the isolation has been achieved automatically through an interlocking system**"; on three-phase or multi-supply equipment, "prove that **all** supply conductors are dead." Para 54: use "**two-pole voltage detectors, test lamps, or voltmeters with insulated probes and fused leads** (see HSE Guidance Note **GS38**)"; "**The use of multimeters, which can be set to the wrong function, is not recommended** for proving dead on low-voltage systems, neither is the use of **non-contact devices such as 'volt sticks'**." Para 55: "**It will be necessary to test the instrument before and after use**", by proving unit or (with precautions) a live circuit; training in correct use "is essential"; instruments "should be maintained and inspected frequently." |
| **Earthing** | 57–58 | Circuit main earths and local earths where necessary. |
| **Adjacent parts** | 59 | Precautions against adjacent live parts. |
| **Permit-to-work** | 60, 69–82 | Issued where necessary. |
| **Extra precautions for high-voltage work** | 23 | — |

> **Three things worth lifting verbatim into WM's form design:**
> 1. **"Never assume the labelling is correct"** (para 47) — this is the justification for the *as-found vs as-verified* circuit description pair in §5 of the field spec.
> 2. **Volt sticks and multimeters are explicitly not acceptable for proving dead** (para 54). The form should therefore capture the *proving instrument* as a distinct record with make/model/serial, and the dropdown should not offer "non-contact tester" as a valid means.
> 3. **Test the instrument before AND after use** (para 55) — the prove–test–prove sequence, stated as a requirement, not a nicety. Two separate mandatory fields.

**GS38** *Electrical test equipment for use by electricians* is the referenced companion covering probe and lead construction. **[UNVERIFIED — the HSE URLs for GS38 returned HTTP 404 in this research pass; GS38 has been withdrawn/superseded on the HSE site.]** Its substance (fused leads, insulated probes with minimal exposed tip, finger barriers) is quoted second-hand in HSG85 paras 32 and 54, which *is* verified. **Do not cite GS38 by clause; cite HSG85 para 54, which references it.**

### 5.2 Electrical permit-to-work — HSG85 Appendix

**[VERIFIED — the Appendix reproduced in full from the HSG85 PDF.]** HSG85 carries "**Appendix: Typical example of an electrical permit-to-work**", a two-sided form with a strict four-part lifecycle. This is the canonical structure and it is what ORHVS's work-permit system also implements:

| Part | Content (as printed) |
|---|---|
| **1 Issue** | "To ______ in charge of this work. I hereby declare that the following high-voltage apparatus in the area specified **is dead, isolated from all live conductors and is connected to earth**: ___" · "Treat all other apparatus and areas as dangerous" · "The apparatus is efficiently connected to **EARTH** at the following points: ___" · "The **points of isolation** are: ___" · "**CAUTION NOTICES** have been posted at the following points: ___" · "**SAFETY LOCKS** have been fitted at the following points: ___" · "The following **work is to be carried out**: ___" · **Diagram** · Signed / Time / Date |
| **2 Receipt** | "I **accept responsibility** for carrying out the work on the apparatus detailed on this permit-to-work and **no attempt will be made by me or by people under my charge to work on any other apparatus or in any other area**." Signed / Time / Date. Note: the permit is **retained by the person in charge at the place of work** until clearance is signed. |
| **3 Clearance** | "The work … is now **suspended*/completed*** and **all people under my charge have been withdrawn and warned that it is no longer safe to work** on the apparatus…" · "All work equipment, tools, test instruments etc **have been removed**." · "**Additional earths have been removed.**" · "The work is complete*/incomplete* as follows: ___" · Signed / Time / Date |
| **4 Cancellation** | "This permit-to-work is cancelled." Signed / Time / Date |

**What to take from this for an LV making-safe form:**
- The **four-signature lifecycle** (issue → receipt → clearance → cancellation) is the model for any isolation that outlives the shift. It maps onto §6.20 (issue/secure), §12 (clearance/handover) and a cancellation step.
- **"Points of isolation" / "safety locks fitted at" / "caution notices posted at" are three separate lists**, not one checkbox. The field spec's §6.1, §6.6–6.11 mirror this.
- The Receipt wording — *"no attempt will be made … to work on any other apparatus or in any other area"* — is the scope-limitation sentence worth adapting into WM's §13.1 declaration.
- The Clearance wording — *"all people under my charge have been withdrawn and warned that it is no longer safe to work"*, *"all work equipment, tools, test instruments etc have been removed"*, *"additional earths have been removed"* — is a better-drafted version of the pre-energisation checks in §12 and should be adopted almost verbatim.
- Note the permit form is explicitly for **high-voltage apparatus**. A full permit is disproportionate for LV DB work; adopt the *lifecycle and wording*, not the instrument.

### 5.3 The South African CoC + standard test report

The authoritative structure is already set out in **§1.2 (Annexure 1)** and **§1.4 (SANS 10142-1 clause 8.7)** above, both **[VERIFIED]** from primary sources. In short:

- **Certificate of Compliance** = a **one-page** certificate, EIR Annexure 1, unique number from the chief inspector, Initial or Supplementary. It carries declarations only — no test data.
- **Standard test report** = a separate **multi-page** document "in the format approved by the chief inspector" (EIR reg 7(1)); SANS 10142-1 clause 8.7 presents itself as that format. Five sections: 1 Location · 2 Installation · 3 Description + circuit/point counts (existing vs new/altered, main DB vs sub-DBs) · 4 Inspection (Yes/N-A statements) + Tests (readings, units, instrument, existing vs new columns) + Comments + "Comments on parts of the installation not covered by this report" · 5 Responsibility (5.1 Design, 5.2 Material specification/procurement, 5.3 Construction, 5.4 Inspection and tests, 5.5 Compliance commencement→commissioning).
- **The test report is not an annexure to the regulations.** It is a separate approved format, which is why editions of it circulate commercially.

**ECA(SA)** (Electrical Contractors' Association of South Africa, ecasa.co.za) is the trade association and the practical authority on how the test report is completed. **[SECONDARY]** Relevant positions from its published member material:
- *"An electrical Certificate of Compliance (CoC) is valid **indefinitely** for the installation it has been issued for provided that the electrical installation has not been altered in any way … when a property has been sold an electrical certificate can only be transferred if the certificate is less than two years old."* — consistent with the reg 7(5) reading in §1.2, and a direct contradiction of the "CoC expires every two years" myth.
- On alterations without the original CoC: where the pre-1992 exemption applies, an alteration triggers a CoC "**for the entire electrical installation**", and ECA(SA) advises obtaining the original CoC **before** starting work in an existing property, and warning the client about the cost of bringing the installation to standard — *"in order to prevent a dispute between the contractor and the client."* → **This is a commercial-risk field worth adding to §1 of the form: "Original CoC obtained before commencement? Y/N/Not available — client advised."**
- On labelling: *"SANS provides the minimum requirements for labelling as per **table 4.2**"* — consistent with §1.5.
- *"There is a **shortened version of the test report under development**, but it will only become a reality after the process has been concluded and it has been published in the code."* → **Watch item: do not hard-code the current long-form report layout as the only supported output.**
- ECA(SA) runs "CoC Completion & Practical Training" and publishes a technical series on the test report by its National Technical Manager.

> **⚠ Edition-drift evidence, and it matters.** ECA(SA)'s August 2026 technical series is subtitled *"A practical series on **the four inspection questions and 15 tests** in SANS 10142-1"*, and quotes as *"the first inspection question"*: "Conductors are of the correct rating and current-carrying capacity for the protective devices and connected load", citing **clause 8.5.2**. In **SANS 10142-1:2017 Ed 2** that statement is inspection item **#4 of 15**, and the test table has **16** rows. ECA(SA) also tags its content **"SANS 10142-1 Edition 3.2"**. **[SECONDARY]**
>
> → **The inspection and test tables appear to have been restructured since Ed 2.** Everything in §1.4 and §4.2 §8B of this document is Ed 2 numbering. **Do not build the inspection/test tables from this document — build them from the licensed current edition.** The *shape* of the form (existing-vs-new columns, per-DB copies, instrument column, five responsibility blocks) is what is durable; the row counts and clause numbers are not.

#### 5.3.1 The ECB's published Edition-3 test report and annex pages — the closest thing to a real SA template

**[VERIFIED — the published blank was read in full.]** https://ecb.org.za/coc/downloads/ · template: https://ecb.org.za/wp-content/uploads/2021/02/2020-TEST-REPORT-GENERAL-Template.pdf

The **Electrical Conformance Board** publishes, free, the Edition-3 general test report plus **seven annex-page templates**. This is the most directly mirrorable South African artefact found in the whole research, and it answers the "circuits tested table" question that the SANS report itself does not.

**Test report header:** `TEST REPORT (see 8.6 for guidelines)` · `FOR ALL GENERAL ELECTRICAL INSTALLATIONS TO SANS10142-1` · `Certificate Of Compliance (CoC) No.` · **`DB/Supply No:`** · `Date of Issue:` · `# of annex pages`.
- **NOTE 7 (verbatim):** *"In most circumstances this test report should be accompanied by **annex pages for circuits, earth continuity and ideally wiring diagrams and photographs**. Please query if not the case."*
- **NOTE 5:** *"It is suggested that the CoC Number be attached to the distribution board (DB)."*
- Section 3 includes a field: **`Is there photographic evidence? (at least of the DB)`** → *photographic evidence is already normalised in the SA test-report tradition; WM's photo-heavy house style is not an eccentricity.*
- Section 2 adds fields Ed 2 lacked: `Is lightning protection installed?`, and alternative supply broken out as **`Generator kVA / UPS kVA`**.
- Section 3 adds **`Alternative power supply connections — Before work started / After work completed`** and `The Earth Leakage Protects: The complete installation / Only partial installation`.
- Section 4's **test table columns are: `TESTS | UNITS | READING | INSTRUMENT | IS COMPLIANT?`** — note the explicit per-row **compliance verdict**, which is exactly the auto-evaluation this app should do.
- Section 5 declaration captures `Full name of registered person · ID number · Signature · Date · Tel · Email · ETSP | IE | MIE · Registration Certificate No. · Date of registration`.

**The seven ECB annex-page templates** (each requires the CoC number entered on the sheet before issue), all **[VERIFIED]**:

| Annex | Columns (verbatim) | Rows |
|---|---|---|
| Insulation resistance | `INSTRUMENT USED` · `#` · `LOCATION / IDENTIFIER / DB ID` · `MΩ Insulation resistance` · `IS COMPLIANT?` | 30; row 1 pre-labelled *"Main DB with sub DBs isolated"*; footer *"If Main DB less than 1 MΩ"* |
| Earth & neutral loop impedance | `INSTRUMENT USED` · `#` · `LOCATION / IDENTIFIER / SOCKET ID` · `Ω NL READING` · `Ω EL READING` · `IS COMPLIANT?` | 30; row 1 *"Point of Supply to Main DB"* |
| Resistance at points of consumption | `INSTRUMENT USED` · `#` · `LOCATION / IDENTIFIER / SOCKET ID` · `Ω READING` · `IS COMPLIANT?` | 30 |
| Polarity | `#` · `LOCATION / IDENTIFIER / SWITCH, LIGHT, APPLIANCE` · `IS COMPLIANT?` | 30 |
| Continuity of ring circuits | `INSTRUMENT USED` · `#` · `RING CIRCUIT IDENTIFIER` · `READING` | 30 |
| Number of circuits or points | `#` · `NUMBER OF CIRCUIT OR POINTS` · `NEW` · `EXISTING` | 30 |
| Responsibility sign-off | Four blocks — `DESIGN`, `MATERIAL SPECIFICATION/PROCUREMENT`, `CONSTRUCTION`, `DOCUMENT ACCEPTED BY` — each with `Name (in block letters)` · `Professional Registration No` · `Position` · `Telephone` · `Email address` · `For and on behalf of company` · **`CIPC No`** · `Address` · `Signature` · `Date`; CONSTRUCTION additionally has **`DoL Registered Person No:`** and **`DoL Contractor No:`** | |

> **Adopt the ECB annex row pattern verbatim for this form's repeating tables:** `INSTRUMENT USED | # | LOCATION / IDENTIFIER | reading + unit | IS COMPLIANT?`. It is South African, it is published, it is what registered persons already fill in, and it maps perfectly onto a `repeating_group`. The **"IS COMPLIANT?"** column is the field the app should compute rather than ask for.

**Other ECB downloads:** the EIR 2009 gazette, "Testing – SANS 10142-1 Edition 3" (the 7 test pages, published with SABS permission), and an **Additional Test Report** for multiple DBs under one CoC. The ECB does **not** publish a blank Annexure 1 CoC — because reg 1 requires a unique number from the chief inspector, CoC bodies are sold by issuing organisations, not downloaded.

#### 5.3.2 ECA(SA)'s two colour-coded certificates — and why the blue one matters to WM

**[VERIFIED]**
- ECA(SA) sells **legal blank CoC + test report forms**, hard copy and electronic; both are legal if completed and signed by the registered person. The blank CoC artwork is a **paid printed product**, not downloadable.
- **Edition 3 was published 23 July 2020**; the test report shrank to a single A4 and the **CoC went from four pages to two**. The old format remained valid in parallel until July 2021.
- **Yellow certificate** = the standard CoC / test report, covering point of control → point of consumption.
- **Blue certificate = a sub-reticulation certificate** for **SANS 10142-1 clause 7.16 distribution systems** — landlord / body corporate / HOA / centre-management reticulation.

> **This is directly relevant to WM's actual project mix.** On a shopping-centre or multi-tenant revamp (KINGSWALK, ITONKA and similar in the E-Site data), the boards being made safe frequently sit in the **landlord's sub-reticulation**, not in a tenant's installation. **The form should ask which side of the point of control the board sits on**, because it determines which certificate the work eventually feeds and who the "user or lessor" is. Add a field: *"Board is part of: Tenant installation / Landlord sub-reticulation (SANS 7.16) / Common area / Supply authority side"*.
- ECA(SA) also runs an **eCoC** platform (now open to non-members) — relevant competitive/interop context for a digital E-Site form.
- **❌ ECA(SA) publishes no isolation, make-safe or permit-to-work document.** **[VERIFIED NEGATIVE]**

Sources: https://ecasa.co.za/member-support/answering-the-questions-that-contractors-ask-frequently/ · https://ecasa.co.za/member-support/wired-to-comply-understanding-the-standard-test-report/ · https://ecasa.co.za/member-support/validity-of-certificate-of-compliance-formats/ · https://ecb.org.za/coc/downloads/ · https://ecb.org.za/coc/ (⚠ see the caution in §7)

---

### 5.4 BS 7671 / IET model forms — the **MEIWC is the best structural template available**

Primary source: **BS 7671:2018+A2:2022 model forms, all forms, v3.1** — https://electrical.theiet.org/media/2822/bs7671-all-forms-v31.pdf **[VERIFIED from the PDF]**. (Also compared: the 2018 original, and the A4:2026 pack at https://electrical.theiet.org/media/vasih5wg/bs7671_all_forms_a4.pdf. **There is no A3-specific model-forms pack.**)

UK forms carry no legal weight in South Africa. They are cited here purely as **drafting precedent** — and the MEIWC is the single closest analogue anywhere in the published record to "we altered part of an existing installation".

#### 5.4.1 Minor Electrical Installation Works Certificate (MEIWC) — **five** parts

Sub-header: *"To be used only for minor electrical work which does not include the provision of a new circuit"*

| Part | Fields |
|---|---|
| **1. Description of the minor works** | 1 `Details of the Client` + `Date minor works completed` · 2 `Installation location/address` · 3 `Description of the minor works` · 4 `Details of any departures from BS 7671… for the circuit altered or extended` + `Details of permitted exceptions` + tick `Risk assessment attached` · 5 **`Comments on (including any defects observed in) the existing installation`** |
| **2. Presence and adequacy of installation earthing and bonding arrangements** | 1 `System earthing arrangement:` TN-S / TN-C-S / TT · 2 `Earth fault loop impedance at distribution board (Zdb) supplying the final circuit ___ Ω` · 3 `Presence of adequate main protective conductors:` `Earthing conductor`; `Main protective bonding conductor(s) to:` `Water` `Gas` `Oil` `Structural steel` `Other` |
| **3. Circuit details** | `DB Reference No.` · `DB Location and type` · `Circuit No.` · `Circuit description` · `Installation reference method` · `Number & size of conductors: Live ___ mm² / cpc ___ mm²` · `Circuit OCPD: BS (EN) / Type / Rating (A)` · `RCD: BS (EN) / Type / Rating (A) / IΔn mA` · `AFDD: BS (EN) / Rating (A)` · `SPD: BS (EN) / Type` |
| **4. Test results for the altered or extended circuit** *(where relevant and practicable)* | `Protective conductor continuity: (R1+R2) ___ Ω or R2 ___ Ω` · `Continuity of ring final circuit conductors: L/L, N/N, cpc/cpc ___ Ω` · `Insulation resistance: Test voltage ___ V, Live-Live ___ MΩ, Live-Earth ___ MΩ` · `Polarity satisfactory` · `Maximum measured earth fault loop impedance: ZS ___ Ω` · `RCD disconnection time at IΔn ___ ms` + `Satisfactory test button operation` · `AFDD satisfactory test button operation` · `SPD functionality confirmed` |
| **5. Declaration** | *"I certify that the work covered by this certificate **does not impair the safety of the existing installation** and the work has been designed, constructed, inspected and tested in accordance with BS 7671… and that to the best of my knowledge and belief, at the time of my inspection, complied with BS 7671 except as detailed in Part 1 above."* + `Name` · `For and on behalf of` · `Address` · `Signature` · `Position` · `Date` |

> **Three things to lift:**
> 1. **Part 2 in its entirety.** *Prove the existing earthing and bonding are adequate before you touch the existing board.* There is no equivalent step in the SA test report and it is the single most valuable structural idea in this section. Add it to the field spec (see §4.2 Section 2A below).
> 2. **Part 1 item 5** — a dedicated field for *defects observed in the existing installation*, distinct from the work performed.
> 3. **The declaration clause "does not impair the safety of the existing installation."** That is precisely the liability statement a making-safe record needs, and it is *narrower and more honest* than claiming compliance.
>
> ⚠ Two of the fields above are **BS 7671 conventions with no SANS equivalent**: `RCD disconnection time at IΔn (ms)` and `Maximum measured Zs (Ω)` against tabulated limits. See the warning in §5.6.

#### 5.4.2 Electrical Installation Certificate (EIC) and EICR — the useful bits

**EIC** blocks: `DETAILS OF THE CLIENT` · `INSTALLATION ADDRESS` · `DESCRIPTION AND EXTENT OF THE INSTALLATION` (ticks **`New installation` / `Addition to an existing installation` / `Alteration to an existing installation`**) · `FOR DESIGN` (Designer 1 & 2) · `FOR CONSTRUCTION` · `FOR INSPECTION AND TESTING` · `NEXT INSPECTION` · `PARTICULARS OF SIGNATORIES` · `SUPPLY CHARACTERISTICS AND EARTHING ARRANGEMENTS` · `PARTICULARS OF INSTALLATION` · `Schedule of Inspections` · **`COMMENTS ON EXISTING INSTALLATION (in the case of an addition or alteration)`** · `SCHEDULES`. The three-role signature split (design / construction / inspection & testing) is the same idea as SANS test-report §5.1–5.4.

**EICR** — lettered A–K, with two structures worth stealing outright:
- **Section D `EXTENT AND LIMITATIONS OF INSPECTION AND TESTING`**, including **`Agreed limitations including the reasons`**, **`Agreed with:`** and `Operational limitations`. → *A revamp form must state what was NOT covered and who agreed to that. The SA report's "Comments on parts of the installation not covered by this report" is the same instinct, less well structured.*
- **Section K `OBSERVATIONS`** with **classification codes, verbatim**:
  - `C1 – Danger present. Risk of injury. Immediate remedial action required`
  - `C2 – Potentially dangerous - urgent remedial action required`
  - `C3 – Improvement recommended`
  - `FI – Further investigation required without delay`
  - Schedule outcome legend adds `N/V` not verified · `LIM` limitation · `N/A` not applicable.
> **Adopt C1 / C2 / C3 / FI as the defect severity scale.** It is internationally recognised, unambiguous, and maps directly onto EIR reg 9(3): **a C1 is precisely the "immediate danger" that triggers the statutory disconnect-and-notify duty.**

#### 5.4.3 Schedule of Test Results — and three corrections

A2:2022 splits this into a matched pair. **Schedule of Circuit Details** cols 1–16: circuit number · circuit description · type of wiring · reference method · number of points served · conductor size Live/cpc (mm²) · OCPD `BS (EN)`/`Type`/`Rating (A)`/`Breaking capacity (kA)` · `Maximum permitted Zs (Ω)` · RCD `BS (EN)`/`Type`/`IΔn (mA)`/`Rating (A)`. Header: `DB reference` · `Location` · **`Supplied from`** · distribution-circuit OCPD · SPD types.

**Schedule of Test Results** cols 17–31: circuit number · ring-final continuity `r1 (line)`/`rn (neutral)`/`r2 (cpc)` · `(R1+R2)`/`R2` · insulation resistance `Test voltage (V)`/`Live-Live (MΩ)`/`Live-Earth (MΩ)` · `Polarity` · `Zs (Ω) Maximum measured` · RCD `Disconnection time (ms)`/`Test button operation` · AFDD `Manual test button operation` · `Remarks`.

**Test-instrument block** — top-right of the Schedule of Test Results, **per distribution board**, headed **`Details of test instruments used (serial and/or asset numbers)`**, six rows: `Multifunction:` · `Continuity:` · `Insulation resistance:` · `Earth fault loop impedance:` · `RCD:` · `Earth electrode resistance:`.
> **This validates the §7 instrument table in the field spec** — and note it captures **serial/asset number**, but **not calibration date**. Calibration capture is WM's own addition. Defensible; just don't claim precedent for it.

**Corrections to assumptions in the original brief:**
- ❌ **RCD operating time at 5×IΔn is NOT a column** in 2018, A2:2022 or A4:2026. It was a 17th-Edition-era field. *(The existing repo template `lv-coc.json` has "RCD trip time at 5× rated current" — that is a BS 7671 anachronism imported into a South African CoC template, and it is wrong twice over. See §6.)*
- ❌ There is no `Max disconnection time` column; the nearest are `Maximum permitted Zs (Ω)` (design limit) and `Disconnection time (ms)` (measured).
- SPD is a **per-board** field, not per-circuit.
- The IET EIC has no `Position` / `For and on behalf of` on its signature rows — those are MEIWC/EICR features. Scheme-provider pads (NICEIC/NAPIT) add their own fields; **no scheme-provider blank was read — [NOT VERIFIED]**.

---

### 5.5 "Electrical Isolation Certificate" — the headline finding is that there isn't one

**[VERIFIED NEGATIVE — this is a real gap in the published record, not a search failure.]**

**No UK certification body publishes an electrical isolation certificate.** Not NICEIC, NAPIT, ECA (UK), SELECT, Stroma or SafeContractor. **BS 7671 has no model form for it.** Electrical Safety First's Best Practice Guide 2 prescribes no isolation certificate — its only documentation instrument is the permit-to-work, and it points at HSG85's example. The IET's own *Safe Isolation of low voltage installations* guide likewise contains no record form. Every "isolation certificate" in circulation is a vendor or contractor invention, which is why field sets vary wildly.

> **This is good news for WM.** There is no canonical form to be measured against — only credible patterns to borrow. The credibility comes from citing the right regulations and mirroring recognisable structures, not from copying a standard blank.

The four best published examples, all **[VERIFIED — blanks read in full]**:

**(a) electricaltestcertificates.co.uk — Electrical Isolation Certificate.** http://www.electricaltestcertificates.co.uk/Testing-Forms/Electrical-Isolation-Certificate.pdf
`Certificate reference` · **EQUIPMENT DETAILS**: `Plant / Location` · `Equipment to be isolated` · **`Other equipment affected`** · `Work order` · **ISOLATION REQUIREMENT**: `Switch-room` · `Panel / Cubicle` · `Rack` · **DETAILS OF ISOLATION** (tick + `Notes` each): `Fuses removed` · `Isolator off` · `MCB off` · `Racked out` · `Padlocks fitted` · `Tags fitted` · `Date and time` · then **three signature blocks**:
- **HANDOVER FOR SERVICE** — *"Isolations have been installed and prove dead test has been carried out by an Electrically **Authorised** Person"*
- **POINT OF WORK PROVE DEAD TEST** — *"A point of work prove dead test can be carried out by an Electrically **Competent** Person"*
- **RETURN TO SERVICE** — *"All work has been completed and isolations have been removed. To be completed by an Electrically **Authorised** Person"*
+ `ADDITIONAL COMMENTS`.
> **The three-signature architecture — isolation applied & proved dead (authorised) → point-of-work prove dead (competent) → return to service (authorised) — is the load-bearing idea.** Note it **separates proving dead at the isolation point from proving dead at the point of work**, which is exactly the failure mode described in §2. Notably absent from it: client, site address, reason for isolation, lock number, key holder, instrument serials — all of which WM should add.

**(b) MapTrack electrical isolation checklist** (published field list; template itself gated) — https://www.maptrack.com/templates/electrical-isolation-checklist. Nine areas: equipment/circuit details (description, asset ID, location, voltage rating) · isolation points · isolation method (switching, fuse removal, link removal, earth applied) · **lock and tag details (lock number, tag number, person who applied, date/time)** · **voltage test (tester ID, calibration date, test on known live source before, test at point of work, test on known live source after)** · permit details · personnel (isolating person, responsible person, **all workers under the isolation**) · de-isolation (all locks removed, all tags removed, **all personnel clear**, re-energised, tested operational) · signatures. *The only published isolation form found that captures **tester ID + calibration date**.*

**(c) Watercare (NZ) Isolation Certificate** — https://wslpwstoreprd.blob.core.windows.net/kentico-media-libraries-prod/watercarepublicweb/media/watercare-media-library/forms/watercare_nov_2019_isolation_certificate_final.pdf. Four-part utility-style form: **Isolation Request** (type: Mechanical / Electrical / Operational) · **Work Details** · **Isolations, Controls and Precautions** — a numbered table with columns **`Equipment Description | Lock # | Applied by (initial) | Verified by (initial)`** · **Receipt / Clearance / Cancellation**, each Name/Signature/Date/Time.
> **The per-isolation-point lock register with separate "Applied by" and "Verified by" initials is the best verified pattern for a lock table.** Adopt it as a `repeating_group`.

**(d) hsseworld Electrical Isolation Work Permit** — https://hsseworld.com/wp-content/uploads/2020/10/Electrical-Isolation-work-Permit.pdf. Six signed blocks: (A) Authorization · (B) Acceptance · (C) Completion/Cancellation · (D1) Permit Issuer *safe for re-commissioning* · (D2) Electrical Competent Person *supply restored by reversal, warning tags removed* · (D3) Permit Issuer *cancelled*. Page 2 is an 11-row checklist with `Done / Not Required / Not Applicable / Remarks`, including **back-feed of power prevented**, **anti-condensation heater isolated and tagged**, **shutters locked**.

**SELECT / HSE joint guidance — *Guidance on Safe Isolation Procedures*** (SELECT with HSE, LV construction sites): https://lclawards.co.uk/media/5avhrgdi/select-guidance-for-safe-isolation.pdf **[VERIFIED verbatim]**. Four statements that belong in WM's help text:
- *"the point of isolation should be **under the control of the person who is carrying out the work** on the isolated conductors."*
- *"It should **never be assumed** that equipment is dead because a particular isolation device has been placed in the off position… **All phases of the supply and the neutral** should be tested and proved dead."* Non-contact voltage indicators and multimeters *"should not be used"*.
- **On the making-safe act itself:** where lock-off hardware isn't available, *"it is acceptable to **disconnect the circuit from the DB as long as the disconnected tails are made safe by being coiled or insulated**. **Suitable labelling of the disconnected conductors is important.**"* → **This is HSE-endorsed guidance describing exactly the "termination and making safe" act.**
- *"The practice of **placing PVC insulating tape over a circuit breaker** to prevent inadvertent switch-on is **not** a safe means of isolation."*
- **Borrowed neutrals** are flagged as a specific hazard on existing installations — a neutral can become live when disconnected. For **TT/IT** systems, multi-pole switching disconnecting phase *and* neutral is mandatory; single-pole isolation is not acceptable.
- A verbatim caution-notice wording worth adopting: *"CAUTION: THIS DISTRIBUTION BOARD HAS A NUMBER OF CIRCUITS THAT ARE SEPARATELY ISOLATED. CARE SHOULD BE TAKEN WHEN REINSTATING THE SUPPLY TO AN INDIVIDUAL CIRCUIT THAT IT HAS BEEN CORRECTLY IDENTIFIED."*

**GS38 (4th edition, June 2015)** — HSE has withdrawn the direct PDF; content verified from Martindale's published 4th-edition summary (https://martindale-electric.co.uk/email_downloads/Guidance-Note-GS38-Fourth-Edition.pdf) **[VERIFIED from that document, not from GS38 itself]**:
- Two-pole voltage indicators must comply with **BS EN 61243-3**.
- Non-contact detectors *"should only be used for identifying live equipment, not for proving that it is dead… Only devices which make contact with the conductor… should be used for proving dead."*
- *"Such devices should be proved **before and after use**… preferably on a voltage proving unit… or otherwise on a known live source of similar voltage."*
- Test leads must conform to **BS EN 61010-031** (or BS EN 61243-3 for a 2-pole detector) and **be marked with the rated installation category CAT II, III or IV**. **Instruments and leads are separate entities** — CAT II leads on a CAT III instrument derate the whole set to CAT II.
- Fuses: multimeter leads *"usually should not exceed 500 mA"*; loop-impedance / RCD / multifunction testers typically **10 A**.
- **[UNVERIFIED — consistent across three secondary sources but not read in GS38 itself]** the 4 mm exposed-tip limit (recommended reduction to 2 mm) and finger barriers, attributed to GS38 para 9.
> **Form implication:** capture the voltage indicator's **CAT rating** alongside make/model/serial, and note that leads carry their own rating.

**UK DNO safety-document set** — described by a practitioner source (primary DNO rulebooks returned HTTP 403) **[SECONDARY]**: https://powerdistributionqa.wordpress.com/safety-documents/
- **Certificate of Electrical Isolation** — for **non-electrical** work near equipment that must be isolated.
- **Electrical Permit to Work** — for work requiring access to conductors, isolated/dead/earthed. Before issue, the issuer shall: physically mark the equipment **in the recipient's presence**; show the **Isolation and Earthing Diagram**; explain the exact extent of work; draw attention to special instructions; **demonstrate to the recipient's satisfaction that the equipment is dead**.
- **Sanction-for-Test** — for **testing** requiring access to HV conductors. Exists because testing requires earths removed and voltage applied, which a PTW forbids. Not issued while an existing Sanction-for-Test or PTW remains valid.
- **Limitation of Access** — for a task in a controlled location not requiring a PTW or Sanction-for-Test. The issuer accompanies the recipient, confirms extent/scope/limits, shows the working area, and **indicates all live equipment in or adjacent to the area, identified by Danger Signs**.
- Plus **Transfer of Control Certificate**, **RISSP**, **Isolation and Earthing Diagram**, **Switching Schedule**.
> **The "demonstrate to the recipient's satisfaction that the equipment is dead" duty is worth adopting** as an explicit two-person confirmation field where a third party (demolition crew, another trade) takes over an isolated board.

**Eskom ORHVS 32-846 Rev 0** — obtained and read **[VERIFIED]**: https://www.etenders.gov.za/home/Download/?blobName=544e9ab1-8edf-43d9-9c00-d6640c1c6d00.pdf&downloadedFileName=32-846+ORHVS+Regulations.pdf
> *"**Work permit** means a written declaration on the work permit form signed by the appointed operator or authorised person and issued to the responsible person."*
> *"**Work permit form** means a printed form containing the **application, work permit and clearance** for the authorisation of all work to be done on apparatus in terms of these regulations."*

Annexure list (the actual SA form set): 1 key safe requirements · **2 Live work declaration form** · 3 Work permit form for power stations · **4 Workers register form** (+ 4a–4f risk assessments, work-site standard, pre-work checklist) · **5 Work permit form for the distribution system** · 6/7/8 HV authorisation forms · 9/10 Operating instruction forms · 11 Computerised work permit form · **12 Earthing label** · **13 Prohibitory Sign** · 14 abbreviations · 15 amendment control. Lifecycle reported as **application → issue → acceptance → clearance**.

> **❌ Decisive negative finding: ORHVS is HV-only. There is no statutory or prescribed South African form for an LV isolation certificate, permit to work, or "make safe" certificate.** Neither the EIR 2009 (annexures 1–6 only) nor the Construction Regulations 2014 prescribe one. SA site LOTO paperwork is house-specific. **WM is not competing with a prescribed form — it is filling a real gap.**

---

### 5.6 Demolition / strip-out "make safe" precedents — the closest match of all

#### 5.6.1 NFDC DRG108:2019 *Disconnection of Services* — demands exactly this certificate

**[VERIFIED verbatim]** https://demolition-nfdc.com/wp-content/uploads/2022/07/DRG108_Disconnection_of_Services_2019.pdf

> *"Unless there is a clear unambiguous statement made within any project/contract documentation that states all services have been made safe or removed, one should always **assume that they are 'live'** and therefore must be attended to."*

> *"The redundant pipe or cable should always be **physically cut to show a clear break from the 'feed' to the 'appliance'**. A qualified and competent service engineer must always be employed for such works and a **termination certificate should be issued by the engineer carrying out the work**."*

> *"Following the completion of the disconnection works always insist on a **disconnection/termination certificate that has been signed by the contractor team carrying out the work**."*

> *"Where such isolation activities have been enacted they should be **securely locked off from accidental engagement and fitted with suitable warning signs**."*

NFDC's working definition of isolation in this context: *"separating or segregating those service cables or pipes etc from the origin of the power source to the feed point or user point being worked on and **may not necessarily constitute the 'killing' of the power source in its entirety**."*

> **This is the strongest single justification for WM's form.** A recognised demolition industry body **explicitly requires a termination certificate** for this exact work — and **nobody publishes one**. The **"clear break from feed to appliance"** is the definitive evidence test for a made-safe conductor, and it is photographable. **Make it a mandatory named photo slot and a mandatory pass/fail field per circuit.**

#### 5.6.2 Pre-Demolition Electrical Disconnection Checklist (AS/NZS 3000) — the best-matched published checklist found

**[VERIFIED — full blank read]** https://www.tamworthelectrician.com/wp-content/uploads/2025/08/Demo-Checklist.pdf

Header: `Date / Job Number / Customer Address / Site`. Columns: **`Task to Perform (in accordance with AS/NZS3000)` | `Technician` (Yes/No) | `Supervisor` (Yes/No)** — i.e. **dual sign-off per line item**. All 15 items, verbatim:

1. Plan disconnection prior to the removal of power and lighting cabling and ensure power is isolated and tagged.
2. Ensure no bare conductors can contact any live parts.
3. Ensure all circuit breakers are switched 'OFF', locked and tagged.
4. Ensure locking device used to lock individual circuit to prevent operation of MCCB in 'OFF' position.
5. **Check for auxiliary circuits and alternative power supplies and CONFIRM DEAD before commencing work.**
6. Have all the power cables been tested and isolated prior to the removal of power points and lights.
7. Isolate live cables in work zones.
8. Where temporary light and power cabling is in use, all cabling must be clearly tagged with construction and danger tape.
9. Danger tags shall be placed at all points and must not be removed without supervisor's approval.
10. **Test all cabling to ensure isolation in ceiling space and wall cavities — rogue cabling, cabling fed remotely, light sensor and time clock.**
11. Existing cabling in use in demolition areas must be labelled with danger TAGS.
12. All power to demolition areas has been disconnected.
13. All power to offices, consult rooms, workstations and partition walls have been isolated in all areas.
14. All lighting / switches / exits and emergency lighting have been isolated in demo areas.
15. All areas for demolition have been isolated.
*(rows 16–17 blank for site-specific additions)*
Footer: `Technician Name / Supervisor Name / Signature / Date Completed / Time Completed`

> **Items 5 and 10 are the ones that actually injure strip-out crews**: auxiliary circuits, alternative supplies, and **rogue cabling in ceiling voids and wall cavities — remotely fed circuits, light sensors and time clocks**. Adopt all 15 as a hazard sweep, add **borrowed neutrals**, and add the SANS 7.12 alternative-supply question.

#### 5.6.3 City & Guilds Generic Decommissioning Certificate

**[VERIFIED — full blank read; note it sits in the plumbing/building-services 6189 pack, not the electrical suite, so the structure transfers but the content does not]** https://www.cityandguilds.com/-/media/productdocuments/building_services_engineering/plumbing/6189/level_3/assessment_materials/onsite_assessment_forms/generic_decommissioning_certificate_v1-pdf.pdf

`Job no` · `Date` · `Brief description of the system to be decommissioned` · `Identify health and safety requirements` · **`Identified isolation points` + `Description of isolation points`** · `Identified drain points` · **`Ensured temporary services are available for client`** · **`Informed relevant people`** · **`Method of ensuring system will not be brought back into operation`** · `List tools and equipment` · **`Any pre-existing damage`** · `Identify property protection measures` · `Describe… decommissioning activity` · `System successfully decommissioned` · three signatures (candidate / workplace recorder / assessor) · `Date`

> Four transferable ideas: **isolation points paired with a written description** (not just a device name); **"method of ensuring the system will not be brought back into operation"** as an explicit stated method rather than a checkbox; **"informed relevant people"**; and **"any pre-existing damage"** — a genuinely valuable field on a revamp, where the contractor is routinely blamed for pre-existing defects.

#### 5.6.4 Australia — "make safe" as a formal trade term

**[SECONDARY for the process; VERIFIED for the CoES point]** https://makegood.melbourne/blog/electrical-make-safe-decommissioning-demolition/ · https://www.energysafe.vic.gov.au/sites/default/files/2025-07/COES_Fundamentals_Jan-2024.pdf

Definition: *"Electrical make safe is the process of safely decommissioning, isolating, and disconnecting all electrical installations within a tenancy or area prior to demolition."* Three phases — **Documentation Review** → **Isolation and Disconnection** (main power isolation with testing and documentation of isolation points; systematic circuit disconnection with **labelling of disconnected circuits** and testing to confirm no live connections remain; light fittings; power outlets; fixed appliances; comms) → **Testing and Certification** (dead testing, insulation resistance, earth continuity, polarity, documented results).

Their stated **handover documentation pack**: make-safe completion report · certificates of electrical safety · **photos of completed works** · updated electrical drawings if available · **lockout/tagout documentation** · handover to demolition contractor with **safety clearance**.

**Structurally important:** in Victoria the make-safe is certified on the **ordinary statutory Certificate of Electrical Safety**, not a bespoke make-safe certificate — because *"Electrical connection work means connecting or **disconnecting** electrical equipment to or from a supply of electricity."* **[VERIFIED]** ESV separately requires that before demolition the supply be permanently removed — **"abolishment of supply"**.
> **The Victorian model is a direct precedent for the §4.1 decision** that this form is a *works record* that feeds a statutory certificate, rather than a new certificate class of its own.

#### 5.6.5 Utility disconnection — nothing usable

**[VERIFIED NEGATIVE]** UK: the DNO deliverable on completion is a **Site Clear Certificate** (https://connections.nationalgrid.co.uk/disconnections) — no published blank, no field structure found; DNO disconnection is an *application* process. South Africa: no municipal demolition-disconnection certificate found; the City of Cape Town supply-service application carries "Disconnection and reconnection of supply" as a **checkbox on a general application form**, not a certificate.

---

### 5.7 Precedent summary — what to take from where

| Source | Take this |
|---|---|
| **EIR 2009 Annexure 1** | Certificate type (Initial / Supplementary + "Supplement No … to Initial Certificate No … issued on"); installation identification block incl. GPS, Erf/Lot; registration category + number; the "not valid unless… / invalid if corrected" notes |
| **SANS 10142-1 cl. 8.7 test report** | Existing vs new/altered two-column split; per-DB copies; Comments on parts NOT covered; five responsibility blocks |
| **ECB annex-page templates** | Row pattern `INSTRUMENT USED \| # \| LOCATION / IDENTIFIER \| reading \| IS COMPLIANT?`; "Is there photographic evidence? (at least of the DB)"; DoL Registered Person No / DoL Contractor No / CIPC No |
| **ECA(SA)** | The yellow-vs-blue distinction — ask which side of the point of control the board sits on (SANS 7.16 sub-reticulation) |
| **BS 7671 MEIWC** | The five-part spine; **Part 2 earthing/bonding adequacy of the existing installation**; "defects observed in the existing installation"; the declaration *"does not impair the safety of the existing installation"* |
| **BS 7671 EICR** | **C1 / C2 / C3 / FI** severity codes; "Extent and limitations… agreed with:" |
| **BS 7671 Schedule of Test Results** | Per-DB `Details of test instruments used (serial and/or asset numbers)` block |
| **HSG85** | The Working-dead step sequence; prove–test–prove; caution vs danger notices; multi-lock hasp; permit Issue/Receipt/Clearance/Cancellation wording |
| **SELECT/HSE** | "Point of isolation under the control of the person doing the work"; coiled-or-insulated-and-labelled tails as an accepted make-safe method; **tape over a breaker is not isolation**; borrowed neutrals; TT/IT phase+neutral |
| **UK isolation certificate** | Three-signature architecture: handover for service → point-of-work prove dead → return to service |
| **Watercare (NZ)** | Per-isolation-point lock register: `Equipment Description \| Lock # \| Applied by \| Verified by` |
| **MapTrack** | Tester ID + calibration date; "all personnel clear" on de-isolation |
| **NFDC DRG108** | **"Clear break from feed to appliance"**; assume live unless documented; the demand for a termination certificate |
| **AS/NZS 3000 demo checklist** | The 15-item hazard sweep; **dual technician/supervisor sign-off per line**; rogue cabling in voids, remotely-fed circuits, sensors and time clocks |
| **C&G decommissioning certificate** | Isolation points **with descriptions**; "method of ensuring the system will not be brought back into operation"; "informed relevant people"; **pre-existing damage** |
| **Eskom ORHVS** | Application → issue → acceptance → clearance lifecycle; earthing label; workers register |
| **Energy Safe Victoria** | Precedent that make-safe is certified on the ordinary statutory certificate, not a bespoke one |

---

## 6. Local repo findings (E-Site)

**[VERIFIED by direct inspection]**

- **No existing making-safe / isolation / permit content.** Repo-wide search for `making safe`, `make safe`, `lockout`, `permit to work` returned nothing. This is a genuinely new module.
- **SANS reference data lives in the `cable_schedule` schema**, not a general standards schema: `cable_schedule.sans_tables` (code, title, standard, section_number, cable_construction, description, `columns` JSONB, notes, source_ref), `cable_schedule.sans_rows` (table_id, sort_key, `row_data` JSONB), `cable_schedule.sans_overrides`. Seeded by migrations `00053`, `00056`–`00059`, corrected by `00167`. It holds current-carrying-capacity and derating tables (SANS 1507/1339/10142-1 tables 6.x), **not** clause 8 verification limits. → **SANS Table 8.1 (max earth continuity conductor resistance by device rating) is not yet in the database and would need seeding** if the form is to auto-evaluate test row 2. Everything else in §8B evaluates against a scalar constant (0,2 Ω · 1,0 MΩ · 500 V · 5 % · 25 V / 50 V) and needs no table.
- **The inspections module is the right host.** `esite/packages/shared/src/inspections/types.ts` defines the template schema, and it already supports every control this form needs, including `repeating_group` (single level, with `item_label_template`), `signature` with `required_qualifications` (`registered_person`, `master_installation_electrician`, `pr_eng`, `witness`, `client`), `conditional_on` (equals / not_equals / greater_than / less_than / in), `unit`, `sans_ref`, `pass_when`, and `computed` fields with a `formula`. `Template.deliverable_type` is `'coc' | 'inspection_only' | 'factory_test'` and `requires_separate_verifier` exists.
- **An LV CoC template already exists — and it has real defects.** `SPEC DOCS/inspection-templates/lv-coc.json` ("Electrical Installation Certificate (COC)", `deliverable_type: coc`) is **much thinner than the gazetted test report**: 4 sections, ~22 fields, no per-circuit repeating group, no instrument details, no inspection table, no existing-vs-new split, and a single signature. Worse, three of its fields are **BS 7671 conventions with no SANS basis**:
  - `RCD trip time at 1× rated current (ms)` and **`RCD trip time at 5× rated current (ms)`** — the SANS earth-leakage test (Ed 2 8.6.12 / Ed 3 8.6.11) is a **current** test recorded in **mA** (trip at 100 % I∆n, hold at 50 %). There is no millisecond criterion anywhere in SANS 10142-1 clause 8, and **5×I∆n is not even a current BS 7671 column** — it was dropped after the 17th Edition. This field is wrong twice over.
  - `Earth-loop impedance per circuit (Ω)` presented as a per-circuit pass criterion — SANS has **no tabulated maximum Zs**; the criterion is disconnection at ≥ 2× the device rating at the main switch.
  - It also omits the two-year/`Initial vs Supplementary` distinction, the registration-category tick, the contractor declaration, and the `Comments on parts not covered` field.

  **Treat it as a prototype, not a reference.** If WM intends to issue anything CoC-shaped, rebuild it against §1.4 and the ECB Edition-3 template (§5.3.1). **This is worth flagging to WM independently of the making-safe module** — a template labelled `deliverable_type: coc` that carries non-SANS pass criteria is a live liability.
- **`lv-db-inspection.json`** ("Distribution Board Inspection") is the closest existing sibling — Board Identification (DB code, location, supply source, reference drawing) / Visual Inspection / Circuit Protection. Worth reusing its identification block verbatim so the two forms agree.
- **WM house style is heavy named-photo evidence** — `line-shop-handover.json` has 18 named photo slots; `lv-line-shop-board-audit.json` has 20 across normal/emergency board states. The making-safe form's photo section should follow the same convention.
- **Related modules to link, not duplicate:** the DB legend-card module (`structure.node_circuits` + `tenant_details` legend columns, migration `00169`, PR #142) already models per-way circuit data and prints a legend card — §5 and §9 of this form should read from and write back to it rather than re-capturing circuit data. The snag module (PR #158/#159) provides the versioned-report + signed-URL export pattern to reuse.

---

## 7. Open questions / things to verify before build

Ordered by how much damage getting them wrong would do.

0. **⚠ HIGHEST RISK — the Table 8.1 earth-continuity limits differ between editions by a factor of 2–3.** Ed 2: 16 A → 0,70 Ω. Ed 3: 16 A → 0,575 Ω. 63 A: 0,24 Ω vs 0,146 Ω. **Auto-evaluating readings against the wrong edition would produce confidently wrong pass/fail verdicts on live certification work.** Seed the limit table only from the licensed current edition, and version it. **[Blocking.]**
1. **Re-verify every SANS clause number and every test row against the licensed current edition** (SANS 10142-1:2024 Ed 4; ECA(SA) tags its material "Edition 3.2"). Everything in this document is **2017 Ed 2**, cross-checked against an Ed 3 adoption and the ECB Ed 3 template. Confirmed changes so far: 15 → 4 inspection statements, 16 → 15 tests, new neutral-loop-impedance test, renumbered 8.6.11–8.6.14, "voltage at available load" dropped, Table 8.1 revalued. SABS text is paywalled; WM needs its own licensed copy. **[Blocking for any printed clause reference.]**
2. **GN R243 of 6 March 2009** — the notice incorporating SANS 10142-1 into the EIR under OHS Act s44. Widely cited, **could not be retrieved**. Confirm the GN number before printing it. **[UNVERIFIED]**
3. **Does the chief inspector's "approved format" test report differ from the SANS 10142-1 clause 8.7 report?** EIR reg 7(1) requires "a test report in the format approved by the chief inspector"; the test report is **not** an annexure to the regulations, and SANS 8.7 presents itself as that format. Confirm with ECA(SA) / ECB which document is currently accepted, and whether a **supplementary** CoC has its own approved test-report format. **[Open]**
4. **Test-instrument calibration interval** — no SA regulation or SANS clause mandating one was found. SANS 10142-1 8.6.1 specifies **accuracy** (±5 %), not an interval. Confirm against the current edition and against WM's client/insurer specifications, then word the field accordingly. **[UNVERIFIED]**
5. **CR 2014 reg 24's citation of the repealed EMR 1988** — legal review on how WM's form words the cross-reference. **[VERIFIED defect, unresolved question]**
6. **Draft Construction Regulations 2024** (GN 5983, GG 52267, 12 Mar 2025) would repeal CR 2014; **Draft General Machinery Regulations 2025** (Notice 6532, GG 53210, 22 Aug 2025) would replace GMR 1988. Promulgation status as at Aug 2026 **not confirmed**. Re-check before shipping regulation numbers. **[UNVERIFIED]**
7. **CR 2014 reg 33 continuing-offence figure** — the gazette PDF OCRs as "8200"; almost certainly **R200**. Verify against a clean copy if the figure is ever displayed. **[UNVERIFIED]**
8. **EIR 2009 amendments since promulgation** — none found, but SAFLII and lawlibrary block automated access, so this is absence of evidence, not evidence of absence. **[Open]**
9. **Whether WM wants this form to be issuable by a non-registered person** working under reg 5(4) general control. The field spec above allows it (with the registered person named and the "personally carried out testing" declaration kept separate); if WM's policy is stricter, tighten the validation. **[WM decision]**
10. **Retention period** for the record. Not established here. **[WM decision]**
11. **SANS Table 8.1** (max earth-continuity-conductor resistance by protective-device rating) is not in the E-Site database and would need seeding to auto-evaluate §8B test 2 — **edition-versioned**, per item 0. **[Build task]**
12. **`lv-coc.json` carries non-SANS pass criteria** (RCD trip time at 1× and 5× I∆n in ms; per-circuit max Zs). It is labelled `deliverable_type: coc`. **Fix or retire it — this is a live liability independent of the making-safe module.** **[Build task, arguably urgent]**
13. **ECA(SA) blue sub-reticulation certificate** (SANS 10142-1 cl. 7.16) — confirm with ECA(SA) how landlord reticulation boards on WM's multi-tenant sites should be certified, since much of WM's revamp work sits there. **[WM decision / commercial]**
14. **ECA(SA)'s eCoC platform** already digitises the CoC + test report. Confirm whether E-Site should interoperate with it or stay deliberately upstream of it as a works-record system. **[Product decision]**
15. **GS38 has been withdrawn from the HSE site**; its content here is second-hand via HSG85 para 54 and a Martindale summary. The 4 mm / 2 mm exposed-tip figures are **[UNVERIFIED]** — do not print them as a specification.

### A caution on secondary sources

The **Electrical Conformance Board (ecb.org.za)** is a **private industry body, not a statutory regulator**, and two of its headline CoC claims do not match the regulation text **[VERIFIED against the gazette]**:

| ECB claim | What the regulation actually says |
|---|---|
| "The User … IS RESPONSIBLE – NOT the property owner" | Reg 2(1) says "the user **or lessor**". An owner who leases the property out **is** the lessor and **is** responsible. |
| "no company can issue you a CoC unless the whole property has a valid certificate" | Reg 7(4) requires a CoC "for **at least** the addition or alteration". Reg 9(2)(c) requires assessing the existing part — but there is no rule that a whole-property CoC must pre-exist. |

The same caution applies to the widely repeated "a CoC expires after two years" claim — reg 7(5) only bars a **change of ownership** on a CoC older than two years. **Do not reproduce any of these in the product's help text.**

---
