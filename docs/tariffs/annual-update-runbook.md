# Tariff library — annual update runbook

**Owner:** platform tariff admins (`public.platform_tariff_admins`; today `arno@wmeng.co.za`).
**Dashboard:** `/admin/tariffs/cycle` shows, per regime, the year in force, what is published, in review, blocked or missing, the review queue, and the publish history. Every year in review links to its diff against the previous year.
**Written:** 2026-10-05 (E7). Update this file when the process changes.

## 1. When the new year arrives

| Regime | Financial year | NERSA publishes | The cron that flags a missing year |
|---|---|---|---|
| Eskom (direct and local-authority supplies) | 1 April – 31 March (local authority 1 July – 30 June) | Approval of the annual increase, February–March; Eskom then publishes the *Schedule of standard prices* and the xlsm tables | `tariffs-due-year-eskom`, 05:00 UTC on 1 April |
| Municipal and metro licensees | 1 July – 30 June | One *Reasons for Decision* (RfD) PDF per municipality, from May; the province workbooks follow later | `tariffs-due-year-municipal`, 05:00 UTC on 1 July |

The cron writes `tariffs.due_year_alert` rows; the overview and the cycle page list them. **Check …years now** on the overview runs the same check on demand.

## 2. Get the sources

1. Eskom: download the xlsm tables and the *Schedule of standard prices* PDF from eskom.co.za (Tariffs & charges). Keep the original filenames.
2. Municipal: download the RfD PDFs from nersa.org.za (Electricity → Decisions). Keep a `manifest.csv` (file, licensee, URL) beside them, as `scripts/tariffs/rfd-coverage.ts` expects.
3. Record the source URL of every file. A value in the library must always point back to a file and a page or cell.

## 3. Ingest (writes only draft years)

Dry run first, always. It parses, validates and diffs against the published year, and writes nothing:

```bash
pnpm --filter @esite/shared exec tsx ../../scripts/tariffs/ingest.ts <file> --parser eskom_xlsm --fy 2027/28 --url <source url>
```

Parsers: `eskom_xlsm` (Eskom tables), `province_xlsx` (NERSA province workbooks), `rfd_pdf` (one RfD; add `--licensee "<NAME>"`; needs `pdftotext`). Read the plan: each year shows `create`, `replace_draft` or a `skip_*` reason. Re-run with `--apply` (needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`). Workbooks can also be ingested from `/admin/tariffs/sources`; PDFs are queued there and processed by `scripts/tariffs/ingest-worker.ts`.

For a batch of RfDs, run `scripts/tariffs/rfd-coverage.ts <dir>` first: a file that parses to zero tariffs is not loaded (it would be an empty review item). Log it in §6 instead.

## 4. Review

Open each year from `/admin/tariffs/cycle` → *Not checked yet* or *Blocked*.

1. **Run the checks** (`validateTariffYearAction`). Publishing needs 0 blocking issues.
2. **Read the diff** against the previous year (*diff vs previous year*). A charge outside the NERSA-approved increase ± 3 pp is raised for review. A whole file moving by one uniform percentage that disagrees with the registry's previous year (Khai-Ma +21.9 %, Gamagara +15.7 % in 2026/27) usually means last year's figures are wrong, not this file.
3. **Inferred units.** Every charge whose unit was inferred must be approved, edited or rejected. Rules used for the 2026/27 publish (owner instruction, 2026-09-29):
   - energy is c/kWh when the value is 50–1500 and R/kWh when it is 0.5–15; a label that contradicts the magnitude is corrected to the magnitude;
   - a basic charge ≥ R30 is R/month;
   - a zero rate is kept as zero;
   - **hold, do not guess:** a `network_capacity` charge that could be R/month or R/kVA/month, and anything labelled as free basic electricity.
4. Fix parser defects in code, not by editing rows, when the same layout will come back next year (PR #225, #226, #228, #229 are the pattern: a failing fixture first, then the rule).

## 5. Publish

Publish from the year page (`publishTariffYearAction`), signed in as a tariff admin. The database guard refuses a year with an unreviewed inferred unit, a tariff without charges, a stale or missing validation, or blocking issues; publishing supersedes the previous published year. Then:

- open `/tariffs/<licensee>` and one tariff, and check one value against its cited page or cell with **View source**;
- for Eskom, check the TOU calendar still matches the new schedule (§7).

## 6. Known parse gaps (2026/27)

PR #229 read six of the twelve RfDs that had parsed to nothing. The other six stay unread, each for a stated reason:

| Licensee | Why it is not loaded | What would change that |
|---|---|---|
| NALA | Its % column and amount column are both headed "2026/27 Recommended % Increase"; one table prints Recommended as R0,00. | Owner accepts reading it with the Kgetleng rule (position-based). |
| SASOLBURG | One row, "Flat Rate (R/MWh)". R/MWh is not a stored unit. | Add `R_per_MWh` to the unit model, or accept a converted unit. |
| MERAFONG, UMUZIWABANTU | Tariff pages are images. | OCR, with the same row self-check the text parser uses. |
| AECI (Property Services) | Single values with no column header; the decision caps all tariffs at 9.50 %, so the listed figures cannot be proven approved. | A clearer source from the licensee. |
| VLEES BAAI | Labels wrap below their numbers; TOU has only Peak and Non-peak (the model has three periods); levy in R/annum. | A two-period TOU model. |

Also outstanding: 9 `network_capacity` charges and Coega's "Free Basic Electricity" held unreviewed; 217 years still `in_review` on 2026-10-05.

## 7. TOU calendars and holidays

- Eskom's hours come from the *Schedule of standard prices* (2026/27: Figure 2, p56; seasons p4; holidays p12). They were seeded by `00228` for both Eskom licensees, valid from 1 April / 1 July 2025 with no end date. **When Eskom changes its hours, add a new calendar row with a `valid_from`, do not edit the old one** — studies priced earlier keep their hours.
- Holidays: `tariffs.holiday_treatment` holds one row per holiday per tariff family (WEPS, Megaflex, Megaflex Gen, Municflex, Miniflex). The 2026/27 table runs to 30 June 2027: **add the 2027/28 rows from the new schedule before 1 July 2027.** Homeflex, Ruraflex, Ruraflex Gen and Nightsave Rural bill a holiday as its own weekday and need no rows. The Solar engine does not read `holiday_treatment` yet (it bills every Eskom holiday as its weekday).
- Municipalities publish seasons, not hours: the explorer shows Eskom's hours for them, labelled as assumed. Add a municipal calendar in `/admin/tariffs/calendars` only when the licensee publishes its own hours.

## 8. The map

`/tariffs/map` is off until the owner sets `TARIFF_MAP_ENABLED=1` (the MDB licence question: `docs/tariffs/mdb-boundaries-source.json`). Boundaries are MDB's 2021 local municipalities; **MDB's 2026 boundaries take effect on 4 November 2026.** Rebuild with `scripts/tariffs/build-municipal-boundaries.sh <new layer URL>`, then re-check `docs/tariffs/licensee-mdb-mapping.json` (eight municipalities are renamed and some areas move) and update `tariffs.licensee.mdb_code` in a migration.
