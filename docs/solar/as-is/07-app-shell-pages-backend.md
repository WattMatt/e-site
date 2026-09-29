# 07 — WM Solar: app shell, non-project pages, backend, integrations, security

**Source reviewed:** read-only export of `origin/main` of `WattMatt/greencalc-sa` at `scratchpad/wmsolar-main` (no `.git` in the export, so no commit hash is available — the reviewer must stamp one). Cross-checked against the local branch notes `/Volumes/Extreme SSD/DEVELOPER/APPS/WM_Solar_Web/RECONCILIATION.md` and `CONFORMANCE.md`.
**Scope:** everything except the 14 project-detail tabs, which other reviewers cover. All paths are relative to the export root. `file:line` citations refer to that export. No secret values are reproduced.

**Headline for the E-Site rebuild:** very little of the shell or backend can be lifted unchanged.
- Row-level security (RLS) is effectively absent on around 30 of the 52 live tables. On about 20 of them, anonymous visitors can read and write.
- 27 of the 34 edge functions run with `verify_jwt = false`. Only `invite-user` and `upload-generation-csv` check who is calling.
- Self-signup is open to anyone.
- Every "calculation setting" lives in each browser's `localStorage`, not in the database.
- About a third of the non-project UI is stubs or mocks, or does not belong in a solar module (code review, tours, integrations, notifications, the project "dashboard").

What *is* worth carrying over:
- the tariff reference-data model (`provinces → municipalities → tariff_plans → tariff_rates`)
- the org and membership concept (E-Site already has a stronger one)
- the list of external data sources (PVGIS, Solcast, Global Solar Atlas, Mapbox, Google Places)

---

## 0. Environment facts (section C, part 1)

| Fact | Value | Evidence |
|---|---|---|
| Supabase project ref (production app) | `zhhcwtftckdwfoactkea` | `supabase/config.toml:1`; hard-coded in `src/hooks/useAuth.tsx:44` (the `sb-<ref>-auth-token` key) and as a fallback in `supabase/functions/fetch-project-files/index.ts` (the `VITE_SUPABASE_PROJECT_ID` default) |
| Second Supabase ref (migration or replica target) | `lyctmmqndqegptzkajhz` | `schema-dump.sql:3` ("Run this in the SQL Editor of https://lyctmmqndqegptzkajhz.supabase.co"). This is most likely the `TARGET_SUPABASE_URL` of `replicate-to-external` (the "independent infrastructure" move noted in RECONCILIATION §0). **The owner must confirm which ref production actually uses today.** The `useAuth.tsx:44` hack assumes `zhhcwtftckdwfoactkea`. |
| External Supabase that sync pulls from | `rsdisaisxdglmdmzmkyw` → `functions/v1/fetch-tenant-schedule` | `supabase/functions/sync-external-projects/index.ts:18`, `sync-external-sites/index.ts:18`. This is **not** E-Site's ref (`cbskbnvvgcybmfikxgky`). Its identity is not recorded anywhere in the repo, and it is called **without any credential**. |
| Client env vars | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` | `.env.example`; `src/integrations/supabase/client.ts:5-6` |
| Hosting | Vercel SPA rewrite, `sw.js`/`index.html` no-cache | `vercel.json`. Invite fallback origin `https://wm-solar.vercel.app` (`supabase/functions/invite-user/index.ts:162`) |
| Hard-coded secrets in the repo | **None found.** Scanned `supabase/`, `src/`, `public/`, `docs/`, `simulation/` and root files for JWT, `sb_secret`, Mapbox `pk.`, `sk-`, `AIza` and `ghp_` patterns: 0 hits. | — |
| Migrations | 97 files, `20251202…` → `20260318120000` | `supabase/migrations/` |
| `schema-dump.sql` | 724 lines, **stale**. It *does* contain `projects.tariff_id REFERENCES tariff_plans(id)` (`schema-dump.sql:187`), which no migration creates (see B.3). | CONFORMANCE C1 also flags it as untrusted |

## 0.1 Data volume (section C, part 2)

There are no seed files and no data dumps. **Live row counts cannot be inferred from the repo; they need a live `count(*)` per table against the production ref.** What the migrations seed:

| Migration | Seeded rows |
|---|---|
| `20251202142806` / `20251217150228` / `20251217151356` | provinces, municipalities, tariff_categories, tariffs, tariff_rates, tou_periods (legacy model). **All wiped** by `20260218094522` (DROP … CASCADE, lines 15-22). |
| `20260219121343` | 10 `INSERT INTO municipalities` statements (post-reset reference data) |
| `20251205042731` | `shop_type_categories` |
| `20260210062929` / `20260210065454` | `checklist_templates`, `checklist_document_links`, `checklist_template_groups` |
| `20260304070756:53-54` | one `user_roles` admin row for a fixed auth UUID (`912ffa08-…`) |
| `20260318090000:195-232` | `DO` block: creates org **"WM Solar"** owned by the first admin (or, failing that, the first auth user at all). Makes that user org admin, links their branding, and runs **`UPDATE public.projects SET org_id = _org_id` on every project**. |

Static data shipped publicly:
- `public/temp/` (6.7 MB): `Eskom-TCT-2025.xlsm` and `Eskom-TCT-202526.xlsm`. These are served to anyone at `/temp/...`.
- `public/icons/`: 5.3 MB.
- `simulation/data/meter_data.csv`: 7 lines.

---

## A. App shell and non-project pages

### A.1 Route table (every route in `src/App.tsx`)

The provider stack is `ThemeProvider` → `QueryClientProvider` (a single `new QueryClient()` with defaults, `App.tsx:44`) → `TooltipProvider` → `TourProvider` → `Toaster` + `Sonner` → `OfflineIndicator` + `InstallPrompt` → `BrowserRouter` → `AuthProvider` (`App.tsx:107-126`). `TourOverlay` is commented out (`App.tsx:114`).

`ProtectedRoute` (`App.tsx:46-62`) checks **only that a session exists**. It has no role, org or profile gates. Every protected page renders inside `AppLayout`.

| # | Path | Guard | Page component | Reachable from UI? | Notes |
|---|---|---|---|---|---|
| 1 | `/auth` | public | `pages/Auth.tsx` | yes (redirect target) | Sign in, **public Sign Up**, Google OAuth, forgot password |
| 2 | `/reset-password` | public (checks for *any* session) | `pages/ResetPassword.tsx` | via email link | |
| 3 | `/portal/:token` | **public** | `pages/ClientPortal.tsx` | via share link (`ShareLinkButton.tsx:37`, `ProposalManager.tsx:127`, `MonthlyReportManager.tsx:128`) | Anonymous proposal view and sign |
| 4 | `/accept-invite` | public | `pages/AcceptInvite.tsx` | via invite email (`invite-user` redirect) | |
| 5 | `/` | session | `pages/Dashboard.tsx` | sidebar | Tariff-database stats, not solar |
| 6 | `/tariffs` | session | `pages/TariffManagement.tsx` | sidebar "Reference Data" | 7 tabs (A.10) |
| 7 | `/load-profiles` | session | `pages/LoadProfiles.tsx` | sidebar | 5 tabs (A.10) |
| 8 | `/projects` | session | `pages/Projects.tsx` | sidebar "Modeling" | |
| 9 | `/projects/:id` | session | `pages/ProjectDetail.tsx` | Projects list | **Colleagues' scope** (14 tabs). Note: `ProjectDetail.tsx:1200` breadcrumb navigates to `/dashboard`, **which does not exist → 404** |
| 10 | `/projects/:id/dashboard` | session | `pages/ProjectDashboard.tsx` | **no link anywhere** | Hard-coded mock (A.5) |
| 11 | `/projects/:id/quick-estimate` | session | `pages/QuickEstimate.tsx` | `SimulationModes.tsx:148` | Back button → `/simulations` (**404**, `QuickEstimate.tsx:108`) |
| 12 | `/projects/:projectId/sandbox/:id` | session | `pages/SandboxWorkspace.tsx` | `SimulationModes.tsx:86` | Reads and writes `sandbox_simulations` (`SandboxWorkspace.tsx:49,69`) |
| 13 | `/projects/:projectId/proposal` | session | `pages/ProposalWorkspace.tsx` | `SimulationModes.tsx:252` | `?id=` param (`ProposalWorkspace.tsx:395`) |
| 14 | `/calculator` | session | `pages/Calculator.tsx` | sidebar | Stand-alone tariff cost and ROI calculator (A.10) |
| 15 | `/settings` | session (**no admin gate**) | `pages/Settings.tsx` | sidebar "System" | 11 tabs (A.6); `?tab=` deep link read from `window.location` (`Settings.tsx:29-30`) |
| 16 | `/profile` | session | `pages/ProfileSettings.tsx` | sidebar avatar | |
| 17 | `/install` | session | `pages/Install.tsx` | **no link** (URL only) | PWA helper |
| 18 | `/code-review` | session | `pages/CodeReview.tsx` | **no link** (URL only) | Developer tool; does not belong |
| 19 | `*` (inside protected) | session | `pages/NotFound.tsx` | — | Unauthenticated unknown URLs go to `/auth` first |

**Unrouted pages (dead files):** `pages/Index.tsx` (a wrapper for Dashboard), `pages/ProposalBuilder.tsx` (navigates to `/simulations`, which does not exist) and `pages/SchematicViewer.tsx` (reads `project_schematics`, uses public URLs from the `project-schematics` bucket, `SchematicViewer.tsx:24-43`).

**Broken external entry point:** the PWA manifest shortcut "Quick Estimate" → `/quick-estimate` (`vite.config.ts:64-67`) matches no route and produces a 404.

**Not on `origin/main` (exists only on the local PR #1 branch):** `UserManagement.tsx` (`/admin/users`), `/auth/set-password`, `/onboarding`. On main, user management lives in **Settings → Users** (A.6.3).

### A.2 Layout: `AppLayout` + `AppSidebar`

`components/layout/AppLayout.tsx:9-26`: `SidebarProvider` wraps the sidebar plus an inset. The header (`:15-17`) is an **empty 56 px bar containing only a spacer**. `WelcomeModal` is disabled (`:3,:23`).

`components/layout/AppSidebar.tsx`:

| Control | Type | What it's for | Handler → effect (file:line) | Data read/written | Validation/disabled | Error/empty states |
|---|---|---|---|---|---|---|
| Logo / company name | display | Branding | `useOrganizationBranding()` (`:53`). Logo shown if `logo_url` is set (`:87-97`). Name is split: the first 2 words are the title, words 3–4 the subtitle, and "WM Solar / Platform" is the fallback (`:100-106`) | `organization_members`, `organization_branding` | — | Falls back to a Zap icon |
| Theme toggle | icon button + tooltip | Light/dark | `toggleTheme` → `setTheme` (`:56-58,110-121`) | `next-themes` (localStorage) | Hidden when collapsed | — |
| Collapse trigger | `SidebarTrigger` | Collapse to icons | `:133` | sidebar cookie (shadcn) | — | — |
| Dashboard | `NavLink` `/` (end) | Nav | `:145-155` | — | — | — |
| Tariffs, Load Profiles | `NavLink` group "Reference Data" | Nav | `:34-37,166-181` | — | — | — |
| Projects, Calculator | `NavLink` group "Modeling" | Nav | `:39-42,190-205` | — | — | — |
| Settings | `NavLink` group "System" | Nav | `:44-46,214-229` | — | **Shown to every user; no role check** | — |
| Avatar / name / email | `NavLink` `/profile` | Profile | `:237-262` | `profiles` (`full_name, avatar_url, email`), fetched by `useEffect` (`:60-71`) | — | Initial-letter fallback |
| Sign Out | button | Logout | `handleSignOut` → `supabase.auth.signOut()` + toast (`:73-76,266-275`) | auth | — | No error handling |
| `SyncStatus` | — | Offline queue status | **Imported (`:11`) but never rendered** | — | — | Dead |

Pages that are not in the sidebar: `/install`, `/code-review`, `/projects/:id/dashboard`.

### A.3 `Dashboard.tsx` (`/`)

Purpose: four stat cards counting the **tariff reference database**, plus two static cards. Nothing on it is about solar projects.

| Control | Type | What it's for | Handler → effect | Data | Validation | Error/empty |
|---|---|---|---|---|---|---|
| 4 stat cards | display | Counts of provinces, municipalities, tariff plans and rate lines | `useQuery(["dashboard-stats"])` runs 4 × `select("id",{count:"exact"})` (`Dashboard.tsx:7-23`). This also downloads the rows. | `provinces`, `municipalities`, `tariff_plans`, `tariff_rates` | — | Errors are ignored and shown as `0` |
| "Browse Tariffs" | `<a href="/tariffs">` | Quick action | Full page reload, not a router link (`:65`) | — | — | — |
| "Calculate Solar ROI" | `<a href="/calculator">` | Quick action | Full reload (`:69`) | — | — | — |
| About card | static text | Marketing copy | `:76-91` | — | — | — |

### A.4 `Projects.tsx` (`/projects`) + `ProjectsOverviewMap`

Purpose: list, search, filter, sort, create and delete projects; grid, list and map views; pull projects from the external system.

| Control | Type | What it's for | Handler → effect (file:line) | Data read/written | Validation/disabled | Error/empty states |
|---|---|---|---|---|---|---|
| Sync External | button | Pull projects and tenants from the external Supabase | `handleSyncExternal` → `functions.invoke("sync-external-projects")`, toast with counts, invalidate `["projects"]` (`:30-49,166-169`) | Writes `projects` and `project_tenants` through the service role | Disabled while syncing | Toast on error |
| New Project | dialog trigger | Create a project | `:170-176` | — | — | — |
| Project Name / Location / Description | inputs | New project fields | `setNewProject` (`:187-207`) | — | Name required (button disabled `:212`) | — |
| Create Project | button | Insert | `createProject.mutate` → `projects.insert({name,description,location})`, navigate to `/projects/:id` (`:130-144,209-215`). **No `org_id` is set**, so the row lands with `org_id NULL`, which every authenticated user can see (B.3). | `projects` | Disabled while pending | `toast.error(error.message)` |
| Search | input | Match name, location or description | `:224-231`, filtered in `useMemo` (`:77-120`) | client-side | — | "No matching projects" card (`:315-328`) |
| Location filter | select | Exact location match | `:234-244`; options = distinct `location` values (`:68-74`) | — | — | — |
| Tariff filter | select | Has / hasn't a tariff | `:246-255` (`tariff_plans.name` present) | — | — | — |
| Sort | select | 6 orders (date, name, tenant count) | `:257-270`, sorting at `:102-119` | — | — | — |
| Clear | ghost button | Reset filters | `clearFilters` (`:124-128,272-277`) | — | Shown only when a filter is active | — |
| Count label | text | "N of M projects" | `:279-283` | — | — | — |
| Grid / List / Map | toggle group | View mode | `:286-296` | — | — | — |
| Card / row delete (trash) | icon button (hover) | Delete a project | `deleteProject.mutate(id)` → `projects.delete()` (`:146-156,367-377,474-484`) | `projects` (cascades) | **No confirmation dialog; a single click deletes** | Toast on error |
| Open Project / Open | button | Navigate | `:407-414,466-473` | — | — | — |
| Logo | img | Project logo | `:382-393,425-440`; hidden on load error | `projects.logo_url` (set by sync) | — | Building icon fallback |
| Tenants / Tariff stats | display | `project_tenants(count)`, `tariff_plans(name…)` embed | Query `:51-65`. The embed relies on an FK that **exists only in the live DB, not in any migration** (B.3). | `projects`, `project_tenants`, `tariff_plans`, `municipalities` | — | "Not set" |
| Loading | skeleton | — | `:301-314` | — | — | — |
| Empty (no projects) | card + "Create First Project" | — | `:329-342` | — | — | — |

`components/projects/ProjectsOverviewMap.tsx` (map view):

| Control | Type | What it's for | Handler → effect | Data | Validation | Error/empty |
|---|---|---|---|---|---|---|
| Map | Mapbox GL `light-v11` | Pins for projects that have lat/lng | Token from `functions.invoke("get-mapbox-token")` (`:36-49`); map init centred on SA (`:52-100`) | `projects.latitude/longitude` (filled by the geocode functions) | — | Token failure → only a `console.error`; the skeleton spins forever |
| Marker hover tooltip | Mapbox popup | Name + location | `setHTML` with **unescaped `project.name`/`location`** (`:142-152`) → **stored-XSS vector** (D) | — | — | — |
| Marker click popup + "Open Project →" | popup with raw `<button>` | Navigate | `popup.on("open")` attaches a click listener (`:169-199`); a new listener on every open (leak) | — | — | — |
| Expand / collapse | icon button | Height 250 ↔ 500 px (ignored when `fullHeight`) | `:253-259`, resize/fit at `:211-226` | — | — | — |
| Empty state | card | "No projects with coordinates yet" | `:228-240` | — | — | — |

Quality: the marker effect's dependency `projectsWithCoords` is a new array on every render (`:33,208`), so markers are torn down and rebuilt on every parent render.

### A.5 `ProjectDashboard.tsx` (`/projects/:id/dashboard`): **stub, recommend dropping**

It is unreachable from the UI. `useParams` `id` is read (`:53`) and **never used**. Nothing is loaded from the database.

| Control | Type | What it's for | Handler → effect | Data | Validation | Error/empty |
|---|---|---|---|---|---|---|
| Project Name, Location, Total Area (m²), Capacity (kVA), Client Name, Budget (R) | inputs | "Project parameters" | `handleParamChange` → local state only (`:89-91,119-219`) | none | none | — |
| Solar PV / Battery / Generator | `Toggle`s | System config | local state (`:168-195`) | none | — | — |
| Target Date | Popover + Calendar | Target date | local state (`:224-246`) | none | — | — |
| Save Parameters | button | Save | `handleSave` → **`console.log` + `// TODO: Implement database save`** (`:93-96,250-253`) | none | — | — |
| Workflow Progress (9 steps) | display | Pipeline | **Hard-coded** statuses: steps 1–2 "complete" (`:66-76`) | none | — | — |
| KPI grid (yield 245.8 MWh, savings R480 000, ROI 18.5 %, …) | display | KPIs | **Hard-coded** constants (`:78-85,305-365`) | none | — | — |

The `projects` table *does* have `client_name`, `budget`, `target_date`, `system_type` and `connection_size_kva` columns (added `20260119`/`20251213`). This page never touches them.

### A.6 `Settings.tsx` (`/settings`) + `src/components/settings/*`

`Settings` mounts a skeleton first (`:335-351`), then `SettingsContent` inside `SettingsErrorBoundary`. A `useEffect` counts DOM tabs against `EXPECTED_TAB_COUNT = 11` and only `console.warn`s (`:25,41-55`), which is a debugging leftover. There are **11 tabs** (`:69-112`). There is **no role gate on the page or on any tab**; admin-only behaviour exists only inside the Users tab.

**Persistence summary:** Branding, Users and Templates write to the database. **Diversity, Derating, Calculations, TOU Periods, Notifications and Onboarding progress are per-browser `localStorage`.** General → VAT/averages and Integrations are **not persisted at all**. Settings that drive financial results therefore differ between users and devices, and are lost when the cache is cleared.

#### A.6.1 General tab

| Control | Type | What it's for | Handler → effect | Data | Validation | Error/empty |
|---|---|---|---|---|---|---|
| Light / Dark / System | 3 buttons | Theme | `setTheme` (`:128-151`) | `next-themes` localStorage | — | — |
| "Include VAT in calculations" | switch | Stated: add 15 % VAT | `setIncludeVAT` local state (`:31,171-175`) | **none; not read anywhere** | — | **Dead control** |
| "Use average TOU rates" | switch | Stated: weighted average | `setUseAverageRates` (`:32,182-186`) | **none; dead** | — | **Dead control** |
| Onboarding tours count + "Reset All Tours" | text + button | Tour progress | `resetAllTours` from `TourContext` (`:33,201-208`); removes the `localStorage` completed-tours key (`onboarding/TourContext.tsx:108`) | localStorage | — | Tours are disabled app-wide (`App.tsx:114`), so this does nothing visible |
| About | static | Version "1.0.0", "2024/2025 Financial Year" (hard-coded, `:242-246`) | — | branding | — | — |

#### A.6.2 Branding tab: `BrandingSettingsCard.tsx`

| Control | Type | What it's for | Handler → effect | Data read/written | Validation/disabled | Error/empty |
|---|---|---|---|---|---|---|
| Company Logo upload | hidden file input + button | Logo | `handleFileUpload` (`:75-129,250-257`): deletes the old object, uploads `branding/<userId>/logo.<ext>` with upsert, stores the public URL plus a cache buster in state | Storage bucket `branding` (public) | `image/*`, ≤ 2 MB (`:80-89`); disabled while uploading | Toasts |
| Remove logo | button | Delete logo | `handleRemoveLogo` (`:131-148,270-271`): deletes the object immediately; **the DB row is updated only on Save** | `branding` bucket | — | Toast |
| Company Name | input | — | `updateField` (`:184-186,287-293`) | state | — | — |
| Primary / Secondary Color | colour picker + hex input (×2) | Theme colours | `:299-329` | state | none (free text) | — |
| Email / Phone / Website / Address | inputs | Contact block for proposals and reports | `:339-376` | state | none | — |
| Save Branding | button | Persist | `handleSave` → `organization_branding.upsert({user_id: user.id, …}, {onConflict:"user_id"})` then `notifyBrandingUpdate()` (`:150-182,380`) | `organization_branding` | Disabled while saving | Toast |

**Defect:** the card reads and writes the **user-scoped** row (`eq("user_id")`, `:39-43,167-169`). The app-wide reader `useOrganizationBranding` **prefers the org-scoped row** (`hooks/useOrganizationBranding.ts:50-67`). Once an org row exists (the seed links the first admin's row, `20260318090000`), every *other* admin's Save writes a private row that nobody sees. RLS also has **no INSERT policy for org rows**, so a new org cannot create shared branding from the UI.

#### A.6.3 Users tab: `UsersSettingsCard.tsx`, `InviteUserForm.tsx`, `OrgMembersList.tsx` (this is main's "UserManagement")

`useUserRole()` (`hooks/useUserRole.ts:15-95`) reads `organization_members` (`maybeSingle`, so it assumes **one org per user**) joined to `organizations(name)`.

| Control | Type | What it's for | Handler → effect | Data | Validation | Error/empty |
|---|---|---|---|---|---|---|
| Organization Name + "Create Organization" (shown when the user has no org) | input + button | Self-service org bootstrap | `createOrganization` → insert `organizations`, insert self as `admin` member, **then `user_roles.upsert({role:'admin'})`** with the result unchecked (`useUserRole.ts:47-86`; `UsersSettingsCard.tsx:39-77`) | `organizations`, `organization_members`, `user_roles` | Name required; default value "WM Solar" (`:14`) | Toast. The `user_roles` write is refused by RLS for non-admins and **silently ignored** |
| Org header | card | Name + "you are admin/member" | `:87-99` | — | — | — |
| Full Name / Email / Role (User, Moderator, Admin) + Send Invitation | form (admin only, `UsersSettingsCard.tsx:102`) | Invite | `handleSubmit` → `functions.invoke("invite-user", {email, full_name, role})`; the error body is parsed from `error.context.body` (`InviteUserForm.tsx:23-58`) | → `auth.admin.inviteUserByEmail` + `organization_members` upsert | Both fields required; HTML `type=email` | Toast |
| Member rows | list | Name, email, "You", "Pending" (`accepted_at` null) | Query `org-members`: members, then profiles fetched separately (`OrgMembersList.tsx:45-75,146-178`) | `organization_members`, `profiles` | — | Spinner / "No members found" |
| Role select (per other member, admin only) | select | Change role | `invite-user?action=update-role` (`:77-94,183-196`) | `organization_members.role` | Disabled while updating; hidden for self | Toast |
| Remove (trash + AlertDialog) | button + confirm | Remove member | `invite-user?action=remove` (`:96-113,198-231`) | `organization_members` delete | Confirm dialog | Toast |
| Non-admin view | badge | Role badge | `:233-237` | — | — | — |

Notes:
- The role vocabulary is the `app_role` enum `admin | moderator | user`. **`moderator` is granted nowhere and checked nowhere.**
- A profile can be read only by its owner (`profiles` RLS, B.3). The member list therefore shows other members as **"Unknown"** with a blank email, unless a newer policy exists in the live DB that is not in the migrations.
- Pending invitations cannot be resent (RECONCILIATION §1).

#### A.6.4 Diversity tab: `DiversitySettingsCard.tsx` (localStorage `diversity-settings`, `hooks/useDiversitySettings.ts:3,19,31`)

| Control | Type | What it's for | Handler → effect | Validation | Notes |
|---|---|---|---|---|---|
| Current Diversity Factor | slider | Global diversity factor | `handleSliderChange` → `updateSetting` (`:33,96`) | slider bounds | — |
| Reset to default | button | Back to 80 % "Shopping Centre" (`:58,128`) | — | — | — |
| 7 building-type presets | buttons | Shopping Centre 0.80, Office 0.85, Industrial 0.90, Mixed 0.75, Hotel 0.70, Educational 0.65, Healthcare 0.88 (`:13-19,153`) | set factor | — | Values are unsourced |
| Custom profiles: apply / delete / name input / save / cancel / add | buttons + input | Save the current factor under a name | `:185,193,207,211,214,219` | Name required (`:40`) | localStorage only |

#### A.6.5 Derating tab: `DeratingSettingsCard.tsx` (localStorage `derating-settings`, `hooks/useDeratingSettings.ts:3`)

Seven sliders, each through `updateSetting`:
- DC/AC ratio (`:65`)
- System losses (`:83`)
- Power factor (`:98`)
- Temperature derating (`:116`)
- Soiling (`:131`)
- Cable losses (`:149`)
- Annual degradation ÷1000 (`:167`)

There is also a **Reset to defaults** button (`:177`) and a static "About Derating" explainer card (`Settings.tsx:269-300`).

#### A.6.6 Calculations tab: `CalculationsSettingsCard.tsx` (localStorage, key in `hooks/useCalculationDefaults/index.ts:49,71`; also read outside React by `getCalculationVariables.ts:23`)

Collapsible sections of numeric inputs. Each input calls `updateValue(section,key,v)` with `parseFloat(...) || 0` (`:57`), and a modified value is highlighted (`:47`). There is a **Reset all** button (`:148`) and per-section resets (`:101`). Fields by section:

- **Solar system:**
  - `solarCostPerKwp` (`:169`)
  - `batteryCostPerKwh` (`:179`)
  - `defaultDcAcRatio` (`:189`)
  - `defaultPeakSunHours` (`:200`)
  - `defaultSystemLosses` (`:211`)
- **PVsyst loss chain:**
  - `nearShadingLoss` (`:234`)
  - `iamLoss` (`:244`)
  - `soilingLoss` (`:254`)
  - `spectralLoss` (`:264`)
  - `electricalShadingLoss` (`:274`)
  - `irradianceLevelLoss` (`:286`)
  - `temperatureLoss` (`:296`)
  - `moduleQualityLoss` (`:306`)
  - `lidLoss` (`:316`)
  - `mismatchLoss` (`:326`)
  - `ohmicLoss` (`:336`)
  - `inverterEfficiencyLoss` (`:348`)
  - `inverterClippingLoss` (`:358`)
  - `availabilityLoss` (`:368`)
- **Degradation:**
  - `annualPanelDegradation` (`:389`)
  - `firstYearDegradation` (`:399`)
  - `annualBatteryDegradation` (`:409`)
  - `batteryEolCapacity` (`:419`)
  - `projectLifetimeYears` (`:430`)
- **Financial:**
  - `discountRate` (`:452`)
  - `tariffEscalation` (`:463`)
  - `cpiInflation` (`:474`)
  - `vatRate` (`:485`)
  - `insuranceRatePercent` (`:496`)
  - `financeRate` (`:507`)
  - `reinvestmentRate` (`:518`)
- **Cost breakdown:**
  - `equipmentCostPercent` (`:541`)
  - `moduleSharePercent` (`:552`)
  - `inverterSharePercent` (`:563`)
  - `replacementYear` (`:576`)
  - `moduleReplacementPercent` (`:587`)
  - `inverterReplacementPercent` (`:598`)
  - `batteryReplacementPercent` (`:609`)
  - `professionalFeesPercent` (`:622`)
  - `projectManagementPercent` (`:633`)
  - `contingencyPercent` (`:644`)
- **Carbon:**
  - `gridEmissionFactor` (`:666`)
  - `transmissionLossPercent` (`:676`)
  - `recPricePerMwh` (`:687`)
  - `carbonTaxRate` (`:698`)
  - `kgCo2PerTreePerYear` (`:709`)
  - `kgCo2PerCarPerYear` (`:720`)

There is **no min/max validation**: the `|| 0` coercion turns any bad input into 0. **These are org-level financial assumptions stored per browser**, so two users modelling the same project get different results. For E-Site this must become an org- or project-scoped DB table, and each run should snapshot the values it used.

#### A.6.7 Notifications tab: `pwa/NotificationSettings.tsx` (**dead feature**)

| Control | Type | Handler | Notes |
|---|---|---|---|
| Enable notifications | button | `Notification.requestPermission()` (`:44-63,137`); disabled if denied | Permission is requested, then never used |
| Simulation Complete / Proposal Updates / System Alerts / Weekly Digest | switches | `updatePreference` → localStorage `notification-preferences` (`:36,70,161-203`) | **Nothing in `src/` ever calls `new Notification`/`showNotification`**, and no backend sends a digest. Purely cosmetic. |

#### A.6.8 Onboarding tab: `onboarding/ContentEnhancerDemo.tsx` (**developer demo; does not belong**)

| Control | Handler → effect | Backend |
|---|---|---|
| Feature-area `<select>` (`:199-209`) | `handleFeatureChange` | — |
| Generate All (`:171-184`) | explanation + FAQs + tips + glossary | `enhance-tour-content` (Anthropic) via `useContentEnhancer.ts:134`; results cached in Storage bucket **`tour-assets`** (public, `:73,104`) |
| Clear Cache (`:185-197`) | removes cached JSON from `tour-assets` (`useContentEnhancer.ts:203-224`) | Storage delete (any authenticated user can delete) |
| Generate Explanation / FAQs / Tips / Glossary (`:261,305,358,422`) | one LLM call each | `enhance-tour-content` |
| Ask AI Assistant textarea + button (`:474-490`) | `contextual-help` (uncached) | `enhance-tour-content` |

#### A.6.9 Templates tab: `ChecklistTemplatesCard.tsx` (handover checklist templates)

| Control | Handler → effect | Data |
|---|---|---|
| New group name + Add (`:314-319`) | insert `checklist_template_groups` (`:100-107`) | Global table with no org or owner column |
| Group row open (`:353`) / delete with AlertDialog (`:371,399`) | open → item view; delete group (`:115-122`) | `checklist_template_groups` |
| Back (`:195`) | return to groups | — |
| New item label + Add (`:214-219`) | insert `checklist_templates` (`:131-143`) | `checklist_templates` (RLS `USING (true)` for everyone, including anon) |
| Item delete + AlertDialog (`:258,286`) | delete (`:152-159`) | — |

Validation: trimmed label or name required.

#### A.6.10 TOU Periods tab: `TOUSettingsCard.tsx` (localStorage `tou-settings`, `hooks/useTOUSettings.ts:4-28`; also read by `getTOUSettingsFromStorage` in non-React code)

| Control | Handler | Notes |
|---|---|---|
| Lock / Unlock (`:130`) | local `locked` toggle; the grids only accept clicks when unlocked | — |
| High-season month chips ×12 (`:172`) | `toggleMonth` edits `highSeasonMonths` | — |
| 2 seasons × day types × 24 h grids (`HourGrid`, cell `:63`) | `handleCellClick` cycles off-peak → standard → peak (`:94-107`) | The global TOU definition that simulations use is **per browser**, which conflicts with the per-tariff TOU data in `tariff_rates.tou` |

#### A.6.11 Integrations tab: `APIIntegrationConfigPanel` + `APIIntegrationStatus` (**mock**)

The state is `useState(defaultAPIIntegrationConfig)` (`Settings.tsx:34,324-329`). It is **never persisted and never used**. The type file describes SCADA vendors (Schneider, Siemens, ABB, Honeywell), CRM (Salesforce, HubSpot, Zoho, Pipedrive), report scheduling and webhooks (`components/projects/simulation/APIIntegrationTypes.ts:1-100`). **No backend exists for any of it. Drop it.**

`SettingsErrorBoundary.tsx`: "Reload" button (`:45`).

### A.7 `ProfileSettings.tsx` (`/profile`)

| Control | Type | What it's for | Handler → effect (file:line) | Data | Validation/disabled | Error/empty |
|---|---|---|---|---|---|---|
| Avatar change | button → hidden file input | Upload avatar | `handleAvatarUpload` (`:73-129,248-262`): deletes the old object (path derived as the last 2 URL segments), uploads `avatars/<uid>/avatar.<ext>` with upsert, `profiles.update({avatar_url: publicUrl})` | Storage `avatars` (public), `profiles` | `image/*`, ≤ 2 MB; disabled while uploading | Toast |
| Email | read-only input | Display | `:281-290` | `profiles.email` | disabled | — |
| Full Name + Save | input + button | Update name | `handleSave` → `profiles.update({full_name})` (`:131-151,295-306`) | `profiles` | Disabled while saving | Toast |
| New Password / Confirm + Update | inputs + button | Change password | `handlePasswordChange` → `auth.updateUser({password})` (`:153-188,329-352`) | auth | ≥ 6 characters, must match. **No current-password check**: `currentPassword` state exists (`:43`) but has no input and is never verified | Toast |
| Danger Zone → Delete Account (AlertDialog, type "DELETE") | dialog + input + action | "Delete account" | `handleDeleteAccount` (`:190-209,390-409`). **It only signs out** and tells the user to "contact support". Nothing is deleted. | none | Enabled only when the text is `DELETE` | Toast |
| Loading | spinner | — | `:214-220` | — | — | `fetchProfile` errors → `console.error` only (`:63-64`) |

### A.8 Auth pages

**`Auth.tsx` (`/auth`)** uses the zod schema: email valid, password ≥ 6 (`:16-19`). A signed-in visitor is redirected to `/` (`:34-38`).

| Control | Type | Handler → effect | Validation | Errors |
|---|---|---|---|---|
| Sign In / Sign Up tabs | tabs | `:140-144` | — | — |
| Email / Password | inputs | `:213-235` | schema | — |
| Remember me | checkbox (default on) | Off → `sessionStorage.session_temporary = true`; `useAuth` `beforeunload` then deletes the **hard-coded** `sb-zhhcwtftckdwfoactkea-auth-token` key (`:62-67,237-249`; `useAuth.tsx:39-46`). Breaks silently if the ref changes. | — | — |
| Sign In | submit | `handleSignIn` → `signInWithPassword` → navigate `/` (`:40-71,252-254`) | schema | Mapped messages for invalid credentials and unconfirmed email (`:53-60`) |
| Forgot password? → email + Send Reset Link → "Check your email" + Back | link, form, buttons | `handleForgotPassword` → `resetPasswordForEmail(redirectTo:/reset-password)` (`:73-91,181-210,257-264`; `useAuth.tsx:94-99`) | zod email | Toast. The UI claims the link "expire[s] in 24 hours" (`:165`), which is **not** verified against GoTrue settings |
| Google | button | `signInWithOAuth('google', redirectTo /)` (`:275-314`; `useAuth.tsx:83-91`) | — | Toast |
| **Sign Up** email / password / submit | form | `handleSignUp` → `auth.signUp(emailRedirectTo /)` (`:93-117,349-386`) | schema | Already-registered message. **Open public self-signup** (see D-4) |
| "Create another account" | button | Resets the verification view (`:340-346`) | — | — |

**`ResetPassword.tsx`:** on mount, **any** session passes (`:28-38`), not only a `PASSWORD_RECOVERY` session. The form takes new password + confirm (zod ≥ 6, must match, `:13-19,102-125`) and calls `auth.updateUser({password})` (`:40-58`). On success it shows "Password Updated" and a "Go to sign in" button (`:60-80`); there is also a back link (`:132`).

**`AcceptInvite.tsx`:**
- Listens for `SIGNED_IN` from the URL hash token. **Only on that event** does it stamp `organization_members.accepted_at` for `user_metadata.org_id` (`:21-45`).
- If the session was already established, the `getSession()` path (`:48-55`) runs **without** stamping `accepted_at`, so the member stays "Pending" forever. This is a race condition.
- Form: password + confirm (≥ 6, must match), then `auth.updateUser`, then redirect to `/` after 2 s (`:60-89,149-174`).
- An invalid link shows a card with a "Go to login" button (`:102-114`).

### A.9 PWA: `Install.tsx` + `src/components/pwa/*` + `vite.config.ts`

- **`/install`:** OS detection by user agent (`Install.tsx:21-23`). When the app is already standalone or installed, it shows a success state (`:50`). Install button → `promptInstall()` from `beforeinstallprompt` (`:19,25,126`). There are iOS instruction cards (Share → Add to Home Screen, `:132-170`) plus Android and desktop cards (`:176-230`). Not linked from the UI.
- **`InstallPrompt` (global):** appears 2 s after `beforeinstallprompt` (`InstallPrompt.tsx:27,36`); has Dismiss (`sessionStorage pwa-prompt-dismissed`, `:62,80`) and Install (`:98`).
- **`OfflineIndicator` (global):** online/offline banner plus a "back online" toast (`OfflineIndicator.tsx:15-41`).
- **`SyncStatus`:** not rendered (A.2). The offline queue (`hooks/useOfflineSync.ts` + `lib/indexedDB.ts`) has **no producer** (nothing calls `queueOperation`), so offline sync is dead code.
- **Service worker** (`vite.config.ts:14-140`, `registerType: autoUpdate`, `skipWaiting`, `clientsClaim`):
  - precaches JS/CSS/HTML/fonts up to 5 MiB
  - runtime caches Solcast (NetworkFirst, 24 h)
  - **caches every `*.supabase.co` request (NetworkFirst, 5 min, 100 entries, including status 0)** (`:112-124`), see D-12
  - caches Mapbox (CacheFirst, 7 days)
- Manifest: "WM Solar", theme `#16a34a`, standalone, shortcuts `/quick-estimate` (**404**) and `/projects`.

For E-Site: drop all of this. E-Site owns its shell, install story and offline model.

### A.10 Other non-project pages (summary; the reference-data components are large, and only entry points are mapped here)

| Page | Purpose | Tabs / controls | Backend |
|---|---|---|---|
| `TariffManagement.tsx` (`/tariffs`) | Maintain SA municipal and Eskom tariff reference data | Tabs: Tariffs, Provinces, Municipalities, Tariff Builder, TOU Reference, Load Shedding, NERSA Guidelines (`:42-48`). Components: `MunicipalityManager`, `TariffBuilder`, `TariffList`, `TOUReference`, `NERSAGuidelines`, `GoogleSheetsImport`, `AISheetImport`, `FileUploadImport`, `MunicipalityMap`, `ProvinceFilesManager`, `LoadSheddingStages` (`:3-13`) | `process-tariff-file` (11 call sites, Anthropic extraction), `import-google-sheet` + `ai-import-sheet` (**both write the dropped legacy tables `tariff_categories`/`tariffs` → broken since `20260218094522`**), `cache-boundaries` (ArcGIS municipal boundaries cached into `tariff-uploads`), `geocode-location`, `google-places-search`, `get-mapbox-token` |
| `LoadProfiles.tsx` (`/load-profiles`) | Library of metered and SCADA load profiles and sites | Tabs: Dashboard, Sites, Meter Library, Cross-site comparison, Excel re-import (`:25-41`) | `scada_imports`, `sites`, `process-scada-profile`, `ai-import-loadprofiles` (Google Sheets + Anthropic), `google-places-search` |
| `Calculator.tsx` (`/calculator`) | Stand-alone monthly-cost and simple solar/battery ROI | Province → Municipality → User type → Tariff selects; rates table; usage pattern; season; monthly kWh; max demand kVA; solar kWp; battery kWh; system cost (`:292-512`) | Reads `provinces`, `municipalities`, `tariff_plans` + `tariff_rates` (`:60-109`) |
| `ClientPortal.tsx` (`/portal/:token`, **anonymous**) | Client views and signs a proposal | Name input, terms checkbox, Sign (`:113-126,298`) → `proposals.update({client_signature, client_signed_at, status:'accepted'}).eq(id).eq(share_token)` (`:85-111`) | Reads `proposals` by token, then `projects`, `project_tenants` and `shop_types` **as anon** (`:31-92`). Works only because those tables are world-readable (D-1/D-2) |
| `QuickEstimate.tsx`, `SandboxWorkspace.tsx`, `ProposalWorkspace.tsx` | Project-scoped modelling workspaces | — | Colleagues' scope. Note the `/simulations` 404 (`QuickEstimate.tsx:108`) and the auto-tours invoked with no overlay mounted (`QuickEstimate.tsx:37`, `SandboxWorkspace.tsx:28`) |

### A.11 Onboarding and tours (`src/components/onboarding/*`, 3 183 lines): **disabled; drop**

- **Tour content:** 5 tours in `tours.ts` (`quick-estimate`, `simulation-hub`, `profile-builder`, `sandbox`, `proposal-builder`).
- **Engine:** `TourContext` stores completed tours in localStorage (`:56-67,108`). `TourOverlay`, `DemoCursor`, `DemoProgress`, `TourBeacon` and `WelcomeModal` exist, but the **overlay and the welcome modal are disabled** (`App.tsx:114`, `AppLayout.tsx:3,23`). `useAutoTour` still starts tours with nothing to render them.
- **Infographics:** generated through `generate-tour-infographic` (Gemini) into bucket `tour-assets` (`useInfographicGenerator.ts:89`); managed by `InfographicManager`.
- **Unused elsewhere:** `ProcessFlow` only renders its own example; `HelpTooltip`, `DemoLauncher` and `TourButton` are used by `QuickEstimate` (`:118`) only.
- **Project onboarding checklist:** `hooks/useOnboardingProgress.ts` (localStorage per project).

### A.12 Code review (`/code-review`, `components/code-review/*`, and the `code-review`, `abacus-code-review`, `fetch-github-files`, `fetch-project-files` functions): **does not belong; drop**

- `pages/CodeReview.tsx:6` wraps the panel in **a second `AppLayout`**, so the page renders a sidebar inside a sidebar.
- `CodeReviewPanel.tsx`:
  - review type buttons: Full, Security, Performance, Quality (`:267`)
  - file tree `ProjectFileBrowser`, a **hard-coded tree of repo paths** with search, select-all and clear (`ProjectFileBrowser.tsx:282,385-401`)
  - context textarea (`:303`)
  - Run Review (`:322`, disabled with no selection) → `functions.invoke('code-review', {files, context, reviewType})` (`:201`)
  - Results render in `CodeReviewResults`.
- **The file contents sent are mock strings** (`MOCK_FILE_CONTENTS`, `:46-167`), or `"// Connect GitHub to fetch actual content"` (`:189-194`). The feature cannot review real code.
- `fetch-project-files` returns placeholders. `fetch-github-files` works but is dangerous (D-5). `abacus-code-review` (Abacus.AI) has **no caller**.

---

## B. Backend

### B.1 Edge functions (all 34)

"verify_jwt" comes from `supabase/config.toml`. Functions not listed there default to `true`. **Supabase's gateway accepts the public anon key as a valid JWT**, so `verify_jwt=true` alone does not authenticate a *user*. "In-code auth" means the function itself checks the caller. "Caller" means a real `supabase.functions.invoke` or `fetch` in `src/`; mentions in the code-review mock file tree do not count.

| # | Function | Purpose | Trigger / caller | verify_jwt | In-code auth | External API · secret(s) | Writes (service role?) |
|---|---|---|---|---|---|---|---|
| 1 | `abacus-code-review` | LLM code review through Abacus.AI (model string "claude-3-5-sonnet") | **none** | default true | reads header only | `api.abacus.ai` · `ABACUS_AI_API_KEY` | — |
| 2 | `ai-import-loadprofiles` | Read a Google Sheet, Anthropic maps columns to load profiles | `loadprofiles/GoogleSheetsImport.tsx:110,134` | **false** | none | Google Sheets/OAuth · `GOOGLE_SERVICE_ACCOUNT_JSON`; Anthropic · `ANTHROPIC_API_KEY` (claude-sonnet-4-20250514) | returns data |
| 3 | `ai-import-sheet` | AI tariff import from a Google Sheet | `tariffs/AISheetImport.tsx` | **false** | none | Google + Anthropic | service role → `provinces`, `municipalities`, **`tariff_categories`, `tariffs`, `tariff_rates` (legacy schema; broken)** |
| 4 | `batch-geocode-projects` | Mapbox-geocode every project's `location` | **none** | **false** | none | Mapbox · `MAPBOX_PUBLIC_TOKEN` | service role → `projects.latitude/longitude` |
| 5 | `batch-geocode-sites` | Same for `sites` | **none** | **false** | none | Mapbox | service role → `sites` |
| 6 | `cache-boundaries` | Fetch SA municipal boundary GeoJSON from ArcGIS and cache it | `tariffs/MunicipalityMap.tsx` | default true | none | `services7.arcgis.com` (public) | service role → Storage `tariff-uploads` |
| 7 | `code-review` | Anthropic code review | `CodeReviewPanel.tsx:201` | **false** | none | Anthropic (4 000 max tokens) | — |
| 8 | `compile-latex` | Proxy LaTeX source to texlive.net, return PDF | `lib/latex/SwiftLaTeXEngine.ts` | **false** | none | `texlive.net/cgi-bin/latexcgi` (third-party public service, no SLA) | — |
| 9 | `dropbox-proxy` | Proxy Dropbox `list_folder` with a caller-supplied token | **none** | default true | none | Dropbox (token from body) | — |
| 10 | `enhance-tour-content` | LLM tour explanations, FAQs, tips, glossary, help | `onboarding/useContentEnhancer.ts:134` | **false** | none | Anthropic | — (client caches in `tour-assets`) |
| 11 | `export-to-google-sheets` | Create or write a Google Sheet through the service account | **none** | **false** | none | Google Sheets/Drive · `GOOGLE_SERVICE_ACCOUNT_JSON` | — |
| 12 | `fetch-github-files` | Read files from GitHub | **none** | **false** | none | GitHub · `GITHUB_TOKEN` (+ `GITHUB_OWNER`/`GITHUB_REPO` defaults) — **owner and repo taken from the request body** (`index.ts:21,72`) | — |
| 13 | `fetch-project-files` | Placeholder file contents | `ProjectFileBrowser.tsx` | default true | none | — | — |
| 14 | `generate-pdf` | HTML → PDF | `lib/pdfshift/index.ts`, `capturePreview.ts` | **false** | none | PDFShift · `PDFSHIFT_API_KEY` (paid per conversion) | — |
| 15 | `generate-proposal-narrative` | LLM proposal text | `proposals/ProposalWorkspaceInline.tsx` | **false** | none | Anthropic | — |
| 16 | `generate-report-infographic` | Gemini image generation for reports | `hooks/useInfographicGeneration.ts` | **false** | none | Google Gemini `gemini-2.0-flash-exp` · `GEMINI_API_KEY` (key in the URL query) | — (client uploads to `report-infographics`) |
| 17 | `generate-tour-infographic` | Gemini images for tours | `TourInfographic.tsx`, `useInfographicGenerator.ts` | **false** | none | Gemini | service role → Storage `tour-assets` |
| 18 | `geocode-location` | Forward/reverse geocode; optionally save to a project | `MunicipalityMap.tsx`, `ProjectLocationMap.tsx`, `TariffSelector.tsx` | **false** | none | Mapbox · `MAPBOX_PUBLIC_TOKEN` | service role → `projects` update when `save_to_project` (`index.ts:43,295`) |
| 19 | `get-mapbox-token` | Return a Mapbox token to the browser | 9 call sites (maps, proposals, PDF capture) | **false** | none | returns `MAPBOX_ACCESS_TOKEN` | — |
| 20 | `global-solar-atlas` | GSA long-term averages at lat/lng | `hooks/useGlobalSolarAtlas.ts` | **false** | none | `api.globalsolaratlas.info` (no key) | — |
| 21 | `google-places-search` | Places autocomplete/search | 8 call sites (site, project and municipality maps) | default true | none | Google Places API (New) · `GOOGLE_MAPS_API_KEY` | — |
| 22 | `import-google-sheet` | Non-AI tariff import from a Sheet | `tariffs/GoogleSheetsImport.tsx` | **false** | none | Google | service role → **legacy tariff tables (broken)** |
| 23 | `invite-user` | Invite, update role, remove org member | `InviteUserForm.tsx`, `OrgMembersList.tsx` | default true | **yes**: `auth.getUser()` + caller must be `admin` in `organization_members` (`index.ts:56-79`) | Supabase Auth admin (`inviteUserByEmail`); redirect built from the **request `Origin` header**, falling back to `wm-solar.vercel.app` (`:162`) | service role → auth users, `organization_members`, `profiles` |
| 24 | `normalise-raw-data` | Batch-rewrite `scada_imports.raw_data` into a normalised format | **none** | default true (the anon key passes) | none | — | service role → `scada_imports` update (`:180-186`) |
| 25 | `process-scada-profile` | Parse SCADA/meter CSV into 24 h weekday/weekend profiles (672 lines, pure compute) | `loadprofiles/ScadaImport.tsx` | **false** | none | — | — |
| 26 | `process-tariff-file` | Extract tariffs from uploaded XLS/PDF with Anthropic; Eskom batch mode (1 666 lines) | 11 call sites (`ProvinceFilesManager`, `FileUploadImport`) | **false** | none | Anthropic | service role → `municipalities`, `provinces`, `tariff_plans`, `tariff_rates`, `eskom_batch_status`, `extraction_runs`; reads `tariff-uploads` |
| 27 | `pvgis-monthly` | PVGIS monthly irradiance | `hooks/usePVGISProfile.ts:287` | **false** | none | `re.jrc.ec.europa.eu` (EU JRC, free, no key) | — |
| 28 | `pvgis-tmy` | PVGIS typical meteorological year (hourly) | `hooks/usePVGISProfile.ts:232` | **false** | none | PVGIS | — |
| 29 | `replicate-to-external` | **Copy 49 tables** (including `profiles`, `user_roles`, `proposals`, …) from this project to another Supabase project by service-role upsert | **none** (manual/ops) | **false** | **none** | target · `TARGET_SUPABASE_URL`, `TARGET_SUPABASE_SERVICE_ROLE_KEY` | service role on **both** databases |
| 30 | `solcast-forecast` | Solcast radiation forecast (default 168 h) + daily peak-sun hours | `useSolcastForecast.ts`, `useSolcastPVProfile.ts` | **false** | none | `api.solcast.com.au` · `SOLCAST_API_KEY` (**quota-limited paid API**) | — |
| 31 | `sync-external-projects` | Pull projects + tenants from `rsdisaisxdglmdmzmkyw/fetch-tenant-schedule`, upsert locally **using the external IDs as local primary keys** | `Projects.tsx:33` ("Sync External") | **false** | none | external Supabase fn (**called with no credentials**) | service role → `projects` (no `org_id`), `project_tenants` |
| 32 | `sync-external-sites` | Match external schedule entries to `sites` by name; update fields | **none** | **false** | none | same external fn | service role → `sites` |
| 33 | `upload-generation-csv` | Ingest a generation CSV into monthly, daily and 30-min generation tables | **no `src/` caller** (external or API use) | **false** | **yes**: requires an `Authorization` header and validates the user through an anon client (`:55-80`). The project check goes through RLS (`:117-119`), which is open to all authenticated users | — | service role → `generation_records`, `generation_daily_records`, `generation_readings`, `generation_source_guarantees` |
| 34 | `upload-tariff-file` | Fetch a file from any URL and store it | **none** | **false** | none | **`fetch(fileUrl)` from the body, i.e. SSRF** (`index.ts`) | service role → Storage `tariff-uploads` |

Totals:
- `verify_jwt=false`: 27.
- Default `true` (anon key suffices): 7 — `abacus-code-review`, `cache-boundaries`, `dropbox-proxy`, `fetch-project-files`, `google-places-search`, `invite-user`, `normalise-raw-data`.
- Hold the service-role key: 15.
- Check the calling user in code: **2** (`invite-user`, `upload-generation-csv`).
- **No caller in `src/`: 11** — `abacus-code-review`, `batch-geocode-projects`, `batch-geocode-sites`, `dropbox-proxy`, `export-to-google-sheets`, `fetch-github-files`, `normalise-raw-data`, `replicate-to-external`, `sync-external-sites`, `upload-generation-csv` (external use), `upload-tariff-file`.
- Every function sets `Access-Control-Allow-Origin: *`.

### B.2 External integrations: cost and licensing

| Integration | Used for | Secret | Cost / licence notes for E-Site |
|---|---|---|---|
| **Mapbox GL JS v3** (`mapbox-gl@^3.16.0`) + Geocoding v5 | All maps, project geocoding | `MAPBOX_ACCESS_TOKEN` (served to browsers), `MAPBOX_PUBLIC_TOKEN` (server) | Since v2, **proprietary Mapbox ToS, not OSS**. Billed per map load (free tier ~50 k/month) and per geocode. Tokens handed to the browser must be URL-restricted public `pk.` tokens. Geocoding results must be displayed on a Mapbox map (ToS). `batch-geocode-*` stores results permanently, which Mapbox's temporary-geocoding terms do not allow; permanent storage needs the Permanent Geocoding API. |
| **Google Places API (New)** | Address and site search | `GOOGLE_MAPS_API_KEY` | Billed per request (Autocomplete/Text Search SKUs). Google ToS forbids showing Places results on a non-Google map, **and they are shown on Mapbox maps here**, so this is a compliance issue. |
| **Google Sheets/Drive** (service account) | Tariff and load-profile import, Sheets export | `GOOGLE_SERVICE_ACCOUNT_JSON` | Free within quotas. The service-account email must be shared on each sheet. |
| **PVGIS** (EU JRC) | Monthly + TMY irradiance | none | Free, no key. Rate-limited (~30 req/s). Must cite PVGIS/JRC. |
| **Solcast** | Forecasts, peak-sun hours | `SOLCAST_API_KEY` | Paid. The hobbyist tier (10 calls/day) is not for commercial use; commercial needs a paid licence. The endpoint is currently open to anon (D-6). |
| **Global Solar Atlas** (World Bank/Solargis) | Long-term GHI/PVOUT | none | The `api.globalsolaratlas.info` endpoint is undocumented. GSA data is **CC BY 4.0** (attribution required). Programmatic use of the API is not officially supported. |
| **Anthropic** (claude-sonnet-4-20250514) | Tariff extraction, Sheet mapping, proposal narrative, tour content, code review | `ANTHROPIC_API_KEY` | Pay per token. The model ID is pinned (will be retired). 5 of 6 callers are unauthenticated. |
| **Google Gemini** (`gemini-2.0-flash-exp`) | Infographic image generation | `GEMINI_API_KEY` | An experimental model, likely retired. The key is sent as a URL query parameter. |
| **Abacus.AI** | Alternative code review | `ABACUS_AI_API_KEY` | Unused. Drop. |
| **PDFShift** | HTML → PDF for reports, proposals, sandbox | `PDFSHIFT_API_KEY` | Paid per conversion. HTML is sent to a third party (client data leaves the platform). E-Site already renders PDFs server-side (pdf-lib/react-pdf), so drop this. |
| **texlive.net** | LaTeX compile for the proposal LaTeX workspace | none | A free community service with no SLA. Proposal content is sent to a third party. |
| **GitHub API** | Code-review file fetch | `GITHUB_TOKEN` | Drop, and **rotate the token** (D-5). |
| **Dropbox API** | Folder listing proxy | caller-supplied token | Unused. |
| **ArcGIS** (services7, SA local municipal boundaries) | Municipality map | none | Public FeatureServer. Check the layer's licence and attribution. |
| **External Supabase `rsdisaisxdglmdmzmkyw`** | Project, tenant and site mirror source | none (unauthenticated call) | See B.4. |
| **Target Supabase** (replicate) | Full DB mirror | `TARGET_SUPABASE_*` | See B.4. |

Other licensing: `xlsx@0.18.5` (SheetJS community build) is **no longer maintained on npm and has known CVEs** (prototype pollution CVE-2023-30533, ReDoS CVE-2024-22363) while parsing untrusted uploads. `pdfmake`, `jspdf` and `html2canvas` are MIT. `fabric` (floor plan) is MIT. `three`/`@react-three` are MIT. The app has **four separate PDF paths**: pdfmake, jspdf + html2canvas, PDFShift and LaTeX/texlive.

### B.3 Database tables (52 live after all migrations)

**RLS legend:**
- **ANON-RW** means the policies have no `TO` clause and `USING (true)`, so anonymous visitors holding the public anon key can read and write.
- **AUTH-ALL** means `USING (true)` or `auth.role()='authenticated'`, so every signed-up user can read and write every row.
- **OWN** means the row is scoped to `auth.uid()`.

Every table has RLS *enabled*; what matters is what the policies allow.

**Tariff and reference data**

| Table | Key columns | RLS | Weakness |
|---|---|---|---|
| `provinces` | id, name UQ, code UQ | Public read; **"Authenticated write" FOR ALL `TO authenticated` USING true** (`20260218094522:154-163`) | Any signed-up user can edit or delete national reference data |
| `municipalities` | id, province_id FK, name, nersa_increase_pct, financial_year, UQ(province_id,name) | same | same |
| `tariff_plans` | id, municipality_id, name, scale_code, category (`customer_category` enum), metering, structure, voltage, phase, min/max amps/kVA/kW, is_redundant, is_recommended, effective_from/to (`+20260219`) | same | same |
| `tariff_rates` | id, tariff_plan_id FK, charge (`charge_type` enum, 16 values), season, tou, block_number, block_min/max_kwh, consumption_threshold_kwh, is_above_threshold, amount NUMERIC(12,4), unit, notes | same | same |
| `extraction_runs` | municipality_id, run_type, tariffs_found/inserted/updated/skipped, corrections_made, ai_confidence, ai_analysis, status, source_file_path/name | Legacy ANON-RW policies from `20251204` **plus** "Authenticated write" FOR ALL with **no `TO`** → **ANON-RW** | Audit of AI extraction is writable by anyone |
| `eskom_batch_status` | municipality_id, batch_index, batch_name, status, tariffs_extracted | **ANON-RW** (as above) | — |
| `project_tariff_overrides` | project_id, source_tariff_plan_id, overridden_rates JSONB, overridden_plan_fields JSONB, UQ | AUTH-ALL | Any user can override any project's tariff |
| Function `calculate_monthly_cost(p_municipality_id, p_category, …)` | `20260218094522:201` | — | — |
| **Dropped** | `tariffs`, `tariff_categories`, `tou_periods` | — | `import-google-sheet` and `ai-import-sheet` still write them |

**Projects, tenants, org**

| Table | Key columns | RLS | Weakness |
|---|---|---|---|
| `projects` | id, name, description, location, total_area_sqm, **tariff_id** (FK in the live DB → `tariff_plans`, **not in migrations**: `20260218094522:8` drops the old FK and no migration re-adds it; `types.ts:1448-1455` and `schema-dump.sql:187` show it), connection_size_kva, logo_url, latitude, longitude, client_name, budget, target_date, system_type, meter_data_prefix, **org_id** (`+20260318`) | **The four legacy AUTH-ALL policies (`20251215`) were never dropped**, and the org policies (`20260318`) are ORed with them → **org isolation is a no-op**. The org policies also treat `org_id IS NULL` as visible and writable to all | Any authenticated user (and signup is open) reads, edits and deletes every project |
| `project_tenants` | project_id, shop_type_id, name, area_sqm, monthly_kwh_override, scada_import_id, shop_number, shop_name, include_in_load_profile, is_virtual, cb_rating | **ANON-RW** | Anonymous read and write |
| `project_tenant_meters` | tenant_id, scada_import_id, weight, UQ | **ANON-RW** | — |
| `shop_types` | name, description, load_profile_weekday/weekend NUMERIC[24], kwh_per_sqm_month, category_id | **ANON-RW** | Global reference profiles are anonymously writable |
| `shop_type_categories` | name, description, sort_order | **ANON-RW** | — |
| `sites` | name, description, location, total_area_sqm, site_type, latitude, longitude | **ANON-RW** | — |
| `organizations` | id, name, created_by, timestamps | INSERT own (`created_by = auth.uid()`); SELECT member or creator; UPDATE org admin | Anyone can create orgs (open signup) |
| `organization_members` | org_id, user_id, role `app_role`, invited_by, invited_at, accepted_at, UQ(org_id,user_id) | SELECT same org (via `get_user_org_id`); INSERT/UPDATE/DELETE by org admin; bootstrap self-insert (`20260318120000`) | `get_user_org_id` = `LIMIT 1` with no ORDER, so multi-org is undefined. The UPDATE policy lets an admin set any role, and nothing stops the last admin being demoted through RLS (the function guards self-demotion only) |
| `organization_branding` | user_id UQ, org_id, company_name, logo_url, primary/secondary_color, contact_email/phone, website, address | OWN (4 policies) + org SELECT + org-admin UPDATE | **No INSERT policy for org rows**; reader/writer mismatch (A.6.2) |
| `profiles` | id (= auth uid), email, full_name, avatar_url | OWN only (`20251215032946`); created by the `handle_new_user` trigger (SECURITY DEFINER) | Org members cannot see each other's names (member list shows "Unknown") |
| `user_roles` | user_id, role `app_role`, UQ(user_id,role) | OWN SELECT; admin SELECT/INSERT/DELETE through `has_role()` | A **global** admin concept that is parallel to org roles and used by nothing in main's UI (`useUserRole.ts:73` only tries to write it) |
| Functions | `get_user_org_id(uuid)`, `is_org_admin(uuid)`, `has_role(uuid, app_role)`: all SECURITY DEFINER with pinned `search_path`; `handle_new_user()`; `generate_share_token()` (16 random bytes, hex); `update_updated_at_column()` | — | — |

**Meters, load profiles, schematics**

| Table | Key columns | RLS |
|---|---|---|
| `scada_imports` | site_name, shop_number, shop_name, file_name, **raw_data JSONB** (full meter series), load_profile_weekday/weekend NUMERIC[24], data_points, date_range_start/end, weekday_days, weekend_days, category_id, project_id, meter_label, meter_color, area_sqm, site_id, processed_at, detected_interval_minutes, value_unit, csv_file_path | AUTH-ALL |
| `stacked_profiles` | project_id, name, description, meter_ids uuid[] | **ANON-RW** |
| `project_meter_connections` | parent_meter_id TEXT, child_meter_id TEXT, project_id | AUTH-ALL |
| `project_schematics` | project_id, name, description, file_path, file_type, page_number, total_pages, converted_image_path, uploaded_by | AUTH-ALL |
| `project_schematic_meter_positions` | schematic_id, meter_id, x/y_position, label, scale_x/y | AUTH-ALL |
| `project_schematic_lines` | schematic_id, from/to x/y, line_type, color, stroke_width, metadata | AUTH-ALL |

**Simulations, solar data, layouts**

| Table | Key columns | RLS |
|---|---|---|
| `project_simulations` | project_id, name, simulation_type, solar_capacity_kwp, solar_orientation, solar_tilt_degrees, battery_capacity_kwh, battery_power_kw, annual_grid_cost, annual_solar_savings, annual_battery_savings, payback_years, roi_percentage, **results_json**, sort_order | **ANON-RW** |
| `sandbox_simulations` | name, cloned_from_project_id, scenario_a/b/c JSONB, sweep_config, parameter_history, history_index, is_draft, draft_notes, project_snapshot | **ANON-RW** |
| `simulation_presets` | user_id, name, description, config JSONB, is_default | OWN |
| `project_solar_data` | project_id, data_type, latitude, longitude, data_json, fetched_at, UQ(project_id,data_type) (cache of PVGIS, Solcast and GSA responses) | **ANON-RW** |
| `pv_layouts` | project_id, name, scale_pixels_per_meter, pv_config JSONB, roof_masks, pv_arrays, equipment, cables, **pdf_data TEXT** (base64 PDF held inline in the row), folder_id, plant_setup, simulation_id, UQ(project_id,name) | **ANON-RW** |
| `pv_layout_folders` | project_id, name, color, sort_order | **ANON-RW** |

**Proposals and reports**

| Table | Key columns | RLS |
|---|---|---|
| `proposals` | project_id, simulation_id, sandbox_id, version, status, verification_checklist, verification_completed_at/by, branding JSONB, executive_summary, custom_notes, assumptions, disclaimers, prepared/reviewed/approved_by+_at, **client_signature, client_signed_at**, simulation_snapshot, **share_token UQ**, content_blocks, section_overrides, document_type | **ANON-RW** (4 "Anyone can…" policies) **plus** "Public can view via share token" (`share_token IS NOT NULL`) and "Clients can sign" (`share_token IS NOT NULL AND status='sent'`). **Critical** (D-1) |
| `report_configs` | proposal_id, name, template, segments, branding | **ANON-RW** |
| `report_versions` | report_config_id, version, snapshot, generated_by, notes | **ANON** select/insert/delete |
| `report_analytics` | user_id, event_type, report_config_id, metadata | OWN insert/select |

**Gantt (project schedule)**

| Table | RLS |
|---|---|
| `gantt_tasks` (project_id, name, description, start/end_date, status enum, owner TEXT, progress, sort_order, color); `gantt_milestones`; `gantt_baselines`; `gantt_baseline_tasks`; `gantt_task_dependencies` (predecessor, successor, type enum, UQ) | AUTH-ALL (`TO authenticated USING true`) |
| `gantt_task_segments` (task_id, start/end_date) | **ANON-RW** |

**Documents and handover**

| Table | Key columns | RLS |
|---|---|---|
| `project_documents` | project_id, folder_id, name, file_path, file_size, mime_type, uploaded_by | **ANON-RW** |
| `project_document_folders` | project_id, name, color, sort_order | **ANON-RW** |
| `handover_checklist_items` | project_id, label, sort_order, template_id | **ANON-RW** |
| `checklist_templates` | label, category, sort_order, group_id | **ANON-RW** |
| `checklist_template_groups` | name, description | SELECT anon; ALL authenticated |
| `checklist_document_links` | checklist_item_id, document_id, UQ | **ANON-RW** |

**Generation (operational monitoring)**

| Table | Key columns | RLS |
|---|---|---|
| `generation_records` | project_id, month, year, actual_kwh, guaranteed_kwh, expected_kwh, building_load_kwh, source, UQ(project_id,month,year) | AUTH-ALL |
| `generation_daily_records` | project_id, date, year, month, actual_kwh, building_load_kwh, source | AUTH-ALL |
| `generation_readings` | project_id, timestamp, actual_kwh, building_load_kwh, source | AUTH-ALL |
| `generation_source_guarantees` | project_id, month, year, source_label, guaranteed_kwh, meter_type, reading_source, UQ | AUTH-ALL |
| `downtime_comments` | **project_id TEXT** (not a UUID FK), year, month, day, comment, UQ | **ANON-RW** |
| `downtime_slot_overrides` | **project_id TEXT**, year, month, day, reading_source, slot_override, UQ | **ANON-RW** |

**Misc:** no `cron` or `pg_net` jobs exist in the migrations. 31 `updated_at` triggers plus `on_auth_user_created`. Enums:
- `app_role`
- `charge_type`
- `customer_category`
- `metering_type`
- `tariff_structure`
- `voltage_level`
- `season_type`
- `tou_period`
- `gantt_dependency_type`
- `gantt_task_status`

### B.4 Storage buckets (8)

| Bucket | Public? | Policies | Used by | Weakness |
|---|---|---|---|---|
| `tariff-uploads` | private | **INSERT, SELECT, DELETE for anyone** (`bucket_id` check only, `20251202153328`) | Tariff file upload, `process-tariff-file`, `upload-tariff-file`, `cache-boundaries` | Anonymous visitors can upload, read and delete |
| `avatars` | public | Upload/update/delete own folder (`<uid>/`); public read | `ProfileSettings` | OK |
| `tour-assets` | public | Public read; any authenticated user can write or delete | Tour infographics, LLM content cache | Any user can overwrite or delete shared cached content |
| `report-infographics` | public | Public read; any authenticated user can write or delete | Report infographics | Same |
| `branding` | public | Public read; own-folder writes | Logos | OK |
| `project-documents` | private | **INSERT, SELECT, UPDATE, DELETE with only `bucket_id` check and no `TO` role** (`20260210061040`) | Project documents tab | **Every project document can be read, replaced and deleted anonymously**, although the policies are named "Authenticated users can…" |
| `scada-csvs` | private | Authenticated insert, select, delete | Raw meter CSVs | Cross-tenant: any user reads every CSV |
| `project-schematics` | **public**, 50 MB limit | Public read; authenticated write | Schematics | Drawings are world-readable by URL |

### B.5 Sync functions: what they mirror

- **`sync-external-projects`** (the "Sync External" button):
  - POSTs with **no auth** to `https://rsdisaisxdglmdmzmkyw.supabase.co/functions/v1/fetch-tenant-schedule`.
  - Receives `{projects[], total_projects, tenants[], total_tenants}`: a **tenant schedule** (projects with city, province, logo, coords; tenants with shop_name, shop_number, area).
  - Upserts local `projects` keyed on **the external project id** (the `id` is copied verbatim; `description` ← `client_name`; `location` ← "city, province") and `project_tenants` (`name` ← shop_name or shop_number, `area_sqm` ← area). Last-writer-wins by `updated_at`.
  - Never sets `org_id` and never deletes.
  - The source is structurally the same concept as E-Site's own tenant schedule (`structure.nodes` + `structure.tenant_details`). **In the add-on this whole mechanism should be replaced by a direct read of E-Site's tenant schedule.** Owner to confirm what `rsdisaisxdglmdmzmkyw` is (not E-Site's ref).
- **`sync-external-sites`:** the same source, matched **by name** to `sites`, updating location and area. Has no caller.
- **`replicate-to-external`:**
  - A one-way full copy of 49 public tables (reference data, projects, tenants, scada_imports with raw_data, generation, simulations, layouts, gantt, proposals, documents metadata, **profiles and user_roles**) from this project to `TARGET_SUPABASE_URL`.
  - Paginated 1 000-row reads and 500-row upserts `onConflict: id`. No deletes, no storage objects, no auth users. `schema-dump.sql` is the matching target DDL.
  - This was the migration tool for the move to independent infrastructure. **It is still deployed, with no auth.**

---

## D. Security and quality findings (severity-ranked)

RECONCILIATION §5 independently confirms D-1, D-2, D-3 and D-4 as open on production `main`. The fixes exist only on the unmerged PR #1 branch.

### Critical

1. **D-1 `proposals` is world-readable, writable and deletable.**
   - The policies "Anyone can view/insert/update/delete proposals" have no `TO` role and `USING (true)` (`20251215031323`). The anon key ships in the JS bundle.
   - Anyone can list every proposal with its `share_token`, client name, executive summary and `simulation_snapshot`; can forge `client_signature`/`status='accepted'`; and can delete proposals.
   - The share-token policies (`20251215032330:18-29`) protect nothing: they check only `share_token IS NOT NULL`.
   - `ClientPortal.tsx:85-111` depends on this openness.
2. **D-2 About 20 more tables are ANON-RW**, and they hold client commercial data:
   - `project_tenants`, `project_tenant_meters`, `shop_types`, `shop_type_categories`, `sites`, `stacked_profiles`
   - `project_simulations`, `sandbox_simulations`, `project_solar_data`, `pv_layouts` (including embedded PDFs), `pv_layout_folders`
   - `report_configs`, `report_versions`, `project_documents`, `project_document_folders`
   - `handover_checklist_items`, `checklist_templates`, `checklist_document_links`, `gantt_task_segments`
   - `downtime_comments`, `downtime_slot_overrides`, `extraction_runs`, `eskom_batch_status`

   The `20260218` "Authenticated write" policies on `extraction_runs`/`eskom_batch_status` omit `TO authenticated`, so they are anon too.
3. **D-3 The `project-documents` storage bucket is anonymously readable, writable and deletable** (policies with only a `bucket_id` check and no role, `20260210061040`). **`tariff-uploads` is the same.** `project-schematics` is a public bucket.
4. **D-4 There is no tenant isolation, and signup is open.**
   - Public Sign Up and Google OAuth are live (`Auth.tsx:143,349-386`), and anyone can create an org (`useUserRole.ts:47-86`).
   - The legacy `projects` AUTH-ALL policies were never dropped, so the `20260318` org policies are ORed away.
   - `scada_imports`, generation, gantt, schematics and `project_tariff_overrides` are AUTH-ALL.
   - **Any stranger who registers can read and modify every client's projects, meter data and generation data.**
5. **D-5 `fetch-github-files`** (`verify_jwt=false`, no auth) uses the server's `GITHUB_TOKEN` for **caller-chosen `owner`/`repo`/`filePaths`** (`index.ts:21,72-76`). Anyone can read any repo that token can access, including private WattMatt repos. **Rotate the token and delete the function.**
6. **D-6 Service-role functions with no authentication** (`verify_jwt=false`, no in-code check):
   - `replicate-to-external` (bulk-copies all data, including `profiles`/`user_roles`, into another DB on demand)
   - `sync-external-projects` (writes `projects`/`project_tenants`)
   - `process-tariff-file` (writes national tariff tables)
   - `geocode-location` (updates any project's coordinates)
   - `batch-geocode-projects`/`-sites`
   - `ai-import-sheet`/`import-google-sheet`
   - `generate-tour-infographic` (writes `tour-assets`)
   - `normalise-raw-data` (default `verify_jwt`, but the anon key passes; rewrites every `scada_imports.raw_data`)
7. **D-7 SSRF plus a storage write:** `upload-tariff-file` does `fetch(fileUrl)` on any caller-supplied URL and writes the bytes into `tariff-uploads` through the service role, unauthenticated.

### High

8. **D-8 Paid APIs open to the internet.** These can be driven with only the anon key or nothing at all:
   - Anthropic: `code-review`, `enhance-tour-content`, `generate-proposal-narrative`, `ai-import-loadprofiles`, `process-tariff-file`
   - Gemini: 2 infographic functions
   - PDFShift: `generate-pdf`
   - Solcast (commercial quota): `solcast-forecast`
   - Google Places: `google-places-search`
   - `compile-latex`: an open relay to texlive.net

   There is no rate limiting.
9. **D-9 Stored XSS on the projects map.** `project.name` and `project.location` are interpolated into Mapbox `setHTML` unescaped (`ProjectsOverviewMap.tsx:147-152,171-190`). Names are writable by any user and by the unauthenticated sync.
10. **D-10 Account-security gaps:**
    - A password change needs no current password (`ProfileSettings.tsx:153-188`; unused `currentPassword` at `:43`).
    - `/reset-password` accepts any session, not only a recovery session (`ResetPassword.tsx:28-38`).
    - The minimum password length is 6.
    - "Delete account" only signs the user out (`ProfileSettings.tsx:190-209`), which is a POPIA erasure gap.
    - "Remember me" relies on a hard-coded token key (`useAuth.tsx:44`).
11. **D-11 `invite-user` builds the email redirect from the request `Origin` header** (`invite-user/index.ts:162`). A direct caller can pick the host, bounded only by the GoTrue redirect allowlist. It also has the latent bugs RECONCILIATION §1 lists: an ignored member-insert failure leaves orphan auth users, and `listUsers()` is unpaginated.
12. **D-12 The service worker caches authenticated Supabase REST and Storage responses** (NetworkFirst, 5 min, `vite.config.ts:112-124`) in a Cache Storage that survives sign-out. On a shared device the next user (or anyone with browser access) can read the previous user's data offline. The React Query cache is also not cleared on sign-out in main.
13. **D-13 `get-mapbox-token`** hands `MAPBOX_ACCESS_TOKEN` to anyone. This is acceptable **only** if it is a URL-restricted public `pk.` token; that needs verifying in the Mapbox dashboard.
14. **D-14 Schema drift.** The migrations do not reproduce the live DB: the `projects.tariff_id → tariff_plans` FK exists only live (`types.ts:1448-1455`, `schema-dump.sql:187`; migration `20260218094522:8` drops the old one). Two refs appear (`zhhcwtftckdwfoactkea` and `lyctmmqndqegptzkajhz`). **The live schema must be dumped and diffed before any data migration into E-Site.**
15. **D-15 Broken backend paths.** `import-google-sheet` and `ai-import-sheet` write the dropped `tariffs`/`tariff_categories` tables, so both Tariff-page import tabs fail at runtime.
16. **D-16 `xlsx@0.18.5` is vulnerable** (prototype pollution and ReDoS) and is used on user-uploaded workbooks.
17. **D-17 Unsafe destructive UX.** Project delete is a single hover-click with no confirmation (`Projects.tsx:367-377,474-484`) and cascades to all child data.

### Medium

18. **D-18 Financial and engineering assumptions live in `localStorage`** (Calculations, Derating, Diversity, TOU: A.6). Results are not reproducible across users or devices, and there is no audit of which assumptions produced a proposal.
19. **D-19 Branding reader/writer mismatch** and the missing org INSERT policy (A.6.2). The members list cannot show names because of the `profiles` RLS (A.6.3). `accepted_at` is never stamped on one of the two AcceptInvite paths (A.8).
20. **D-20 Multi-org is undefined:** `get_user_org_id` uses `LIMIT 1` with no ORDER, and `useUserRole` uses `maybeSingle()` (errors if there are 2 rows).
21. **D-21 Dead routes and 404s:**
    - `/projects/:id/dashboard` (mock)
    - breadcrumb `/dashboard` (`ProjectDetail.tsx:1200`)
    - `/simulations` (`QuickEstimate.tsx:108`, `ProposalBuilder.tsx`)
    - PWA shortcut `/quick-estimate`
    - unrouted `ProposalBuilder.tsx`, `SchematicViewer.tsx`, `Index.tsx`
22. **D-22 `sync-external-*` calls an external endpoint with no credentials**, so that endpoint is itself public. Synced projects get the external UUIDs as local PKs and `org_id NULL`.
23. **D-23 `public/temp/` publishes Eskom tariff workbooks** (6.7 MB).
24. **D-24 Mapbox and Google licensing:** Places results are shown on Mapbox maps (Google ToS), and geocodes are stored permanently (Mapbox ToS).
25. **D-25 `pv_layouts.pdf_data` stores whole PDFs as base64 TEXT** in the row, which bloats table scans and replication.

### Low / quality

26. Stubs and dead code:
    - `ProjectDashboard` (entirely mocked)
    - Settings → General VAT and TOU-average switches (not persisted or read)
    - Integrations tab (mock)
    - Notifications (never fire)
    - `SyncStatus` and the offline queue (no producer)
    - tours, welcome modal and infographic manager (disabled)
    - `ContentEnhancerDemo` in production settings
    - code-review suite (mock file contents; double `AppLayout` at `CodeReview.tsx:6`)
    - 11 edge functions with no caller
27. Dashboard uses `<a href>` (full reloads) and ignores query errors. Map markers are rebuilt on every render. Popup listeners leak. The Settings DOM tab-count check is a debugging leftover. The empty app header wastes 56 px.
28. `moderator` role exists everywhere and does nothing. `user_roles`/`has_role` is a parallel, unused global-admin model.
29. `downtime_*` tables key `project_id` as TEXT with no FK, so they are orphaned when a project is deleted.
30. Pinned model IDs (`claude-sonnet-4-20250514`, `gemini-2.0-flash-exp`) will be retired.

---

## E. Implications for the E-Site "Solar" add-on (from this scope)

| WM Solar element | Verdict for E-Site | Reason |
|---|---|---|
| App shell, sidebar, theme, header | **Replace** with E-Site's shell; add a Solar tab or section per project behind the paid per-project flag | E-Site owns navigation and RBAC |
| Dashboard (tariff DB counts) | **Drop** | Not a user-facing solar feature. Replace with a per-project solar summary fed by real simulation results |
| Projects list, create, sync | **Drop.** Solar attaches to existing E-Site projects | E-Site already has projects, geocoding and tenant schedules |
| `sync-external-projects/sites` | **Drop**; read E-Site `structure.nodes`/`tenant_details` directly | Same concept, native in E-Site |
| `ProjectDashboard` | **Drop** | Mock |
| Org, invite, members, AcceptInvite, Auth, Reset, Profile | **Drop**; use E-Site auth, `user_organisations`, `project_members`, `requireRolePage`/`requireRoleAPI` | E-Site's model is stronger and already hardened |
| Branding | **Map** to E-Site org branding, if present | — |
| Calculations, Derating, Diversity and TOU settings | **Keep the content, move it to the DB:** org-level defaults table + per-project overrides + a snapshot stored on each simulation run. Admin-only write | Reproducibility and audit (D-18) |
| Tariff reference data (`provinces`, `municipalities`, `tariff_plans`, `tariff_rates`, `calculate_monthly_cost`) + `process-tariff-file` extraction | **Keep the model**, as platform-level reference data: read for all, write restricted to platform admin, extraction runs audited | Core value; fix D-2/D-6 posture |
| Shop types and load-profile library, SCADA imports | **Keep**, org-scoped (profiles) or platform-scoped (shop-type archetypes) | Core modelling input |
| Handover checklist templates | Probably **fold into E-Site's existing forms or checklists** | Overlaps with E-Site |
| PWA, install, offline, notifications | **Drop** | E-Site owns these |
| Tours, infographics, content enhancer, code review, integrations mock | **Drop** (and their 8 functions: `enhance-tour-content`, `generate-tour-infographic`, `generate-report-infographic`?, `code-review`, `abacus-code-review`, `fetch-github-files`, `fetch-project-files`, `dropbox-proxy`) | Do not belong / dead |
| External data (PVGIS, Solcast, GSA, Mapbox, Google Places) | **Keep PVGIS and GSA** (free, attribution needed). **Decide on Solcast** (commercial licence). **Keep Mapbox or Places only with licence-compliant usage**; E-Site maps should use one provider consistently | B.2 |
| PDF generation (pdfmake, jspdf, PDFShift, LaTeX/texlive) | **Consolidate** on E-Site's server-side renderer. Mind the WinAnsi glyph lessons (E-Site CLAUDE.md) for `Ω`, `≤`, `→` in solar reports | Four paths → one |
| `replicate-to-external`, `upload-tariff-file`, `normalise-raw-data`, `batch-geocode-*`, `export-to-google-sheets` | **Drop** (ops leftovers); a one-time data migration should be a supervised script | D-6/D-7 |

**Open questions only the owner can answer:**
1. Which Supabase ref is production today (`zhhcwtftckdwfoactkea` or `lyctmmqndqegptzkajhz`), and what are its live row counts?
2. What is `rsdisaisxdglmdmzmkyw` (the tenant-schedule source)?
3. Is the Solcast licence commercial?
4. Is `MAPBOX_ACCESS_TOKEN` a URL-restricted `pk.` token?
5. Should existing WM Solar data (projects, simulations, proposals with client signatures) migrate into E-Site, or does the add-on start empty?
6. Should the GitHub token behind `fetch-github-files` be rotated now? (Recommended: yes, regardless of the rebuild.)
