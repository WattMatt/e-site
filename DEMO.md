# E-Site Demo Guide

Realistic demo dataset for the Watson Matthheus Electrical (WM Eng) organisation — a South African electrical contractor.

---

## Running the Seed

```bash
pnpm demo:seed
```

The script is **idempotent** — safe to re-run at any time. It reads credentials from `apps/web/.env.local` automatically.

To target a different environment, set env vars explicitly:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=service_role_xxx \
pnpm demo:seed
```

---

## Demo Credentials

All accounts use the same password: **`Demo@esite2025!`**

| Email | Role | Access Level |
|---|---|---|
| `demo.owner@wmeng.co.za` | Owner | Full access — org settings, billing, all projects |
| `demo.pm@wmeng.co.za` | Project Manager | Projects, snags, RFIs, diary, marketplace orders |
| `demo.field@wmeng.co.za` | Field Worker | Raise snags, diary entries, view compliance |
| `demo.client@wmeng.co.za` | Client Viewer | Read-only view of assigned projects |

**Organisation:** Watson Matthheus Electrical (professional tier)

---

## Demo Dataset

### Projects (3 active)

| Project | City | Client | Value |
|---|---|---|---|
| Sandton City Office Tower — DB Upgrade | Sandton | Growthpoint Properties | R 2,850,000 |
| Midrand Business Estate — Phase 2 New Build | Midrand | Eaton Development Group | R 5,420,000 |
| Centurion Industrial Park — Unit 12 Fitout | Centurion | Bateleur Logistics | R 980,000 |

### Snags (10 total, various priorities & statuses)

| Title | Priority | Status | Project |
|---|---|---|---|
| DB room door damaged — fire rating compromised | Critical | Open | Sandton |
| Phase reversal on MCC feeder | Critical | In Progress | Sandton |
| No isolation for HVAC disconnect — Unit 3 | Critical | Open | Midrand |
| Missing earth bonding on structural steel | High | Open | Sandton |
| Undersized cable on TPN board DB-04A | High | Pending Sign-off | Sandton |
| Emergency lighting battery below 3-hour | High | Signed Off | Centurion |
| Conduit penetration not fire-sealed | Medium | Open | Sandton |
| Cable tray supports insufficient — Level 9 | Medium | In Progress | Sandton |
| DB labelling incomplete — Unit 5 | Medium | Resolved | Midrand |
| Junction box cover plate missing | Low | Open | Centurion |

### Compliance Sites (3 sites, 23 subsections)

**Sandton City Office Tower** — 9 subsections
- Main Incomer & Metering ✅ Approved
- Distribution Board DB-Main ✅ Approved
- Distribution Board DB-L3 ✅ Approved
- Distribution Board DB-L4 🔄 Under Review
- Distribution Board DB-L5 📋 Submitted
- Earthing & Bonding System ❌ Rejected
- Surge Protection (SPD) ✅ Approved
- Emergency Lighting 🔄 Under Review
- Earth Leakage Protection ✅ Approved

**Midrand Business Estate** — 8 subsections (mix of approved / submitted / missing)

**Centurion Industrial Unit 12** — 6 subsections (mix of approved / submitted / missing)

### Marketplace Suppliers (5 verified)

| Supplier | Categories | Verified |
|---|---|---|
| CBI Electric Africa | Electrical | ✅ |
| Schneider Electric SA | Electrical, Mechanical | ✅ |
| Voltex Electrical Distributors | Electrical | ✅ |
| Stalcor Steel & Aluminium | Civil | — |
| Safety First PPE & Workwear | Safety, General | ✅ |

**Catalogue items:** 10 items (circuit breakers, cables, conduit, SPDs, PPE)

**Orders:** 2 active orders
- CBI Electric — R1,340 (Confirmed) — circuit breakers for Sandton DB upgrade
- Voltex — R18,750 (In Transit) — cable for Midrand Phase 2

### Site Diary (5 entries across all projects)

Mix of: Progress, Safety (toolbox talk), Delay (screed poured over conduit trench)

---

## Test Scenarios

### 1. Onboarding (new user)
1. Sign up with a new email
2. Complete 4-step wizard: Organisation → First Project → Invite Team → Done
3. Verify dashboard shows the new org's stats

### 2. Snag Capture (field worker)
1. Log in as `demo.field@wmeng.co.za`
2. Go to **Snags → + New Snag**
3. Pick a project, fill in title/location/priority, attach a photo
4. Verify snag appears in the list with correct priority badge
5. Change status to **In Progress**, then **Pending Sign-off**

### 3. COC Upload & Review (admin)
1. Log in as `demo.owner@wmeng.co.za`
2. Go to **Compliance → Sandton City Office Tower**
3. Open the **Earthing & Bonding** subsection (currently Rejected)
4. Upload a new COC PDF and submit for review
5. Verify status changes to `submitted`
6. Change status to `approved` and check the compliance score updates

### 4. Marketplace Order
1. Log in as `demo.pm@wmeng.co.za`
2. Go to **Marketplace**, filter by **Electrical**
3. Open **CBI Electric Africa** and browse catalogue items
4. Place an order for MCBs — specify quantity and delivery address
5. Go to **My Orders** and verify order appears with status `submitted`

### 5. Compliance Portfolio (overview)
1. Log in as `demo.owner@wmeng.co.za`
2. Go to **Compliance** — see 3 site cards with score rings
3. Sandton should show ~67% (6/9 approved), Midrand ~38%, Centurion ~50%
4. Click into Sandton to see subsection breakdown and colour-coded badges

### 6. Dashboard & KPIs
1. Log in as `demo.owner@wmeng.co.za`
2. Dashboard should show:
   - Active Projects: 3
   - Open Snags: 5
   - Pending COCs: multiple
   - Active Orders: 2
   - Compliance: aggregated % across all sites
3. Verify deadline dates show correct "Xd remaining" countdown

### 7. Site Diary
1. Log in as `demo.pm@wmeng.co.za`
2. Go to **Site Diary** — filter to Sandton project
3. Click **Weekly Summary** — see the week's entries exported as summary
4. Add a new diary entry with weather, workforce count, and progress notes

### 8. Role-based access (client viewer)
1. Log in as `demo.client@wmeng.co.za`
2. Should see only assigned projects (Centurion)
3. Verify they cannot raise snags or modify any data

---

## Resetting Demo Data

To wipe and re-seed:

```bash
# Remove demo data manually from Supabase dashboard, then:
pnpm demo:seed
```

Or target local Supabase:

```bash
pnpm db:reset && pnpm demo:seed
```

---

## Notes

- All demo emails are `@wmeng.co.za` to match the existing test account domain
- Monetary values are in ZAR (South African Rand) throughout
- Project names use real Gauteng suburb names (Sandton, Midrand, Centurion)
- SANS references are real: SANS 10142-1 (wiring code), SANS 10400-T (emergency lighting), SANS 10108 (hazardous areas)
