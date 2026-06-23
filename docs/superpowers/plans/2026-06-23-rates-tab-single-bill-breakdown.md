# Rates Tab — Single-Bill Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an imported BOQ has exactly one top-level bill (e.g. a mall-only tender with no tenant shops), the Rates tab should show that bill's section breakdown directly — not just a single summary row equal to the grand total.

**Architecture:** Pure display-layer change in one client component (`RatesTab.tsx`). When `sections` contains exactly one `kind:'bill'` row, render the existing `BoqSectionTree` for that sole bill immediately beneath the existing `BoqMainSummary` (which keeps owning the grand totals + Contract|Revised columns). Multi-bill tenders (e.g. KINGSWALK) are completely unchanged. No parser, importer, schema, or DB change.

**Tech Stack:** React 18 client component, Vitest + @testing-library/react (jsdom).

---

## Background (why this is needed)

Investigation (2026-06-23) proved the BOQ pipeline is correct end-to-end for the affected file (`SIYAYA - Mamaila Final.xlsx`): the parser produced **104 sections / 340 items**, `flattenForPersist` passed, the persist id-resolution simulated clean, and `reconcile` returned a fully *matched* result (R7,009,351 = R7,009,351, zero warnings). The user confirmed the tab shows a single "MALL PORTION" row + totals.

Root cause: the file has **one** bill (`MALL PORTION`) because every sheet is a `1.x` mall sheet — there are no tenant (`N-NN`) sheets. `BoqMainSummary` lists *bills*, so a one-bill tender renders a single row whose amount equals the grand total, with the entire breakdown hidden one drill-down click inside that row. KINGSWALK "looked populated" only because it had many tenant bills at the top level. This is a display/design gap, not data loss.

## Out of scope (do NOT do here)

- **Making `persistImport` transactional.** It currently commits the import row (total) before sections/items with no rollback ([packages/shared/src/services/boq.service.ts:195](../../../packages/shared/src/services/boq.service.ts)). It is a real latent hardening, but it is unrelated to this symptom and must be a separate change.
- Any change to `BoqMainSummary`, `BoqSectionTree`, the parser, or the DB schema.

## File Structure

- **Modify:** `apps/web/src/app/(admin)/projects/[id]/settings/rates/_components/RatesTab.tsx` — derive the sole bill; render its section tree below the summary.
- **Test:** `apps/web/src/app/(admin)/projects/[id]/settings/rates/_components/RatesTab.test.tsx` — add a single-bill auto-breakdown test and a multi-bill regression-guard test.

`RatesTab` already imports everything required: `useMemo` ([line 20](../../../apps/web/src/app/(admin)/projects/[id]/settings/rates/_components/RatesTab.tsx)), `BoqSectionTree` (line 31), and has `items`, `totals`, `revised`, `revisedTotals`, `handleItemUpdated`, `projectId`, `canEdit` all in scope in the populated branch.

---

### Task 1: Render the sole bill's breakdown beneath the summary

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/settings/rates/_components/RatesTab.tsx`
- Test: `apps/web/src/app/(admin)/projects/[id]/settings/rates/_components/RatesTab.test.tsx`

- [ ] **Step 1: Write the failing test**

Append this `describe` block to the end of `RatesTab.test.tsx`:

```tsx
describe('RatesTab — single-bill auto-breakdown', () => {
  const importRow = {
    id: 'imp1',
    projectId: 'p1',
    organisationId: 'o1',
    sourceFilename: 'mall.xlsx',
    storagePath: null,
    importedBy: null,
    importedAt: '2026-06-08T00:00:00Z',
    totalExVat: 100,
    vatAmount: 15,
    totalInclVat: 115,
    lineItemCount: 1,
    isCurrent: true,
  }
  // One bill (MALL PORTION) with one section node (1.1 P&G) nested under it.
  const sections = [
    { id: 'b1', importId: 'imp1', parentSectionId: null, kind: 'bill' as const, code: '1', title: 'MALL PORTION', sortOrder: 0, nodeId: null },
    { id: 's1', importId: 'imp1', parentSectionId: 'b1', kind: 'section' as const, code: null, title: '1.1 P&G', sortOrder: 1, nodeId: null },
  ]

  it('shows the sole bill’s section tree below the summary without a click', () => {
    render(
      <RatesTab
        projectId="p1"
        canEdit
        initial={{ import: importRow, sections, items: [], totals: { b1: 100, s1: 100 }, importedByName: null }}
      />,
    )
    // The Main Summary still renders (it owns the grand totals).
    expect(screen.getByText('Main Summary')).toBeTruthy()
    // The breakdown (section node) is visible WITHOUT selecting the bill.
    expect(screen.getByText('1.1 P&G')).toBeTruthy()
    expect(screen.getByText(/Breakdown/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && pnpm test RatesTab.test`
Expected: FAIL — `Unable to find an element with the text: 1.1 P&G` (the tree is not rendered for the sole bill yet; only `BoqMainSummary`'s `MALL PORTION` bill row exists).

- [ ] **Step 3: Implement the minimal change**

In `RatesTab.tsx`, immediately after the `const importRow = initial?.import ?? null` line (currently line 63), add the sole-bill derivation:

```tsx
  // Top-level bills (sections with kind='bill'). A tender with exactly ONE bill
  // — e.g. a mall-only BOQ with no tenant shops — would otherwise show a single
  // summary row equal to the grand total, hiding the whole breakdown one click
  // in. Render that sole bill's section tree directly below the summary instead.
  const soleBill = useMemo(() => {
    const bills = sections.filter((s) => s.kind === 'bill')
    return bills.length === 1 ? bills[0] : null
  }, [sections])
```

Then, in the populated-state `return`, replace the `else` branch that currently renders just `<BoqMainSummary … />` (currently lines 192-200):

```tsx
      ) : (
        <BoqMainSummary
          importRow={importRow}
          sections={sections}
          totals={totals}
          revisedTotals={revisedTotals}
          onSelectBill={(bill) => setSelectedBillId(bill.id)}
        />
      )}
```

with this fragment (summary unchanged, breakdown added below for the sole bill):

```tsx
      ) : (
        <>
          <BoqMainSummary
            importRow={importRow}
            sections={sections}
            totals={totals}
            revisedTotals={revisedTotals}
            onSelectBill={(bill) => setSelectedBillId(bill.id)}
          />
          {soleBill && (
            <div>
              <h3 style={{ margin: '0 0 8px', fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 600, color: 'var(--c-text)' }}>
                Breakdown · {soleBill.title}
              </h3>
              <BoqSectionTree
                bill={soleBill}
                sections={sections}
                items={items}
                totals={totals}
                revised={revised}
                revisedTotals={revisedTotals}
                projectId={projectId}
                canEdit={canEdit}
                onItemUpdated={handleItemUpdated}
              />
            </div>
          )}
        </>
      )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && pnpm test RatesTab.test`
Expected: PASS — the new test plus all existing `RatesTab` tests are green. (Existing single-bill tests still pass because `BoqMainSummary` still renders; they assert on its `Main Summary` / `MALL` / `Contract (ex VAT)` / `(edited)` content, none of which the added tree produces.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(admin\)/projects/\[id\]/settings/rates/_components/RatesTab.tsx apps/web/src/app/\(admin\)/projects/\[id\]/settings/rates/_components/RatesTab.test.tsx
git commit -m "feat(rates): show breakdown for single-bill BOQ imports"
```

---

### Task 2: Regression guard — multi-bill summary stays unchanged

**Files:**
- Test: `apps/web/src/app/(admin)/projects/[id]/settings/rates/_components/RatesTab.test.tsx`

This task adds a guard test confirming that a multi-bill import still shows the bill list and does NOT auto-render a breakdown (it only appears on click). It is expected to pass against Task 1's implementation (`soleBill` is `null` when there are 2+ bills).

- [ ] **Step 1: Write the regression-guard test**

Append this `describe` block to the end of `RatesTab.test.tsx`:

```tsx
describe('RatesTab — multi-bill summary unchanged', () => {
  const importRow = {
    id: 'imp1',
    projectId: 'p1',
    organisationId: 'o1',
    sourceFilename: 'centre.xlsx',
    storagePath: null,
    importedBy: null,
    importedAt: '2026-06-08T00:00:00Z',
    totalExVat: 150,
    vatAmount: 22.5,
    totalInclVat: 172.5,
    lineItemCount: 0,
    isCurrent: true,
  }
  // Two bills (MALL PORTION, SHOPRITE) + a section node under the first.
  const sections = [
    { id: 'b1', importId: 'imp1', parentSectionId: null, kind: 'bill' as const, code: '1', title: 'MALL PORTION', sortOrder: 0, nodeId: null },
    { id: 'b2', importId: 'imp1', parentSectionId: null, kind: 'bill' as const, code: '2', title: 'SHOPRITE', sortOrder: 1, nodeId: null },
    { id: 's1', importId: 'imp1', parentSectionId: 'b1', kind: 'section' as const, code: null, title: '1.1 P&G', sortOrder: 2, nodeId: null },
  ]
  const initial = { import: importRow, sections, items: [], totals: { b1: 100, b2: 50, s1: 100 }, importedByName: null }

  it('lists every bill and does NOT auto-render the breakdown', () => {
    render(<RatesTab projectId="p1" canEdit initial={initial} />)
    expect(screen.getByText('MALL PORTION')).toBeTruthy()
    expect(screen.getByText('SHOPRITE')).toBeTruthy()
    // The breakdown is hidden until a bill is clicked.
    expect(screen.queryByText('1.1 P&G')).toBeNull()
  })

  it('drills into a bill on click, showing its tree and a back control', () => {
    render(<RatesTab projectId="p1" canEdit initial={initial} />)
    fireEvent.click(screen.getByText('MALL PORTION'))
    expect(screen.getByText('1.1 P&G')).toBeTruthy()
    expect(screen.getByText(/Back to Main Summary/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd apps/web && pnpm test RatesTab.test`
Expected: PASS — both assertions hold against Task 1's code (`soleBill === null` for 2 bills, so no auto-breakdown; clicking sets `selectedBillId` and renders the drill-down with the "← Back to Main Summary" control).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(admin\)/projects/\[id\]/settings/rates/_components/RatesTab.test.tsx
git commit -m "test(rates): guard multi-bill summary behaviour"
```

---

### Task 3: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole rates test file**

Run: `cd apps/web && pnpm test RatesTab.test`
Expected: PASS — all `RatesTab` describes (empty state, populated state, Contract column §4.1, single-bill auto-breakdown, multi-bill unchanged).

- [ ] **Step 2: Type-check**

Run: `cd apps/web && pnpm type-check`
Expected: no errors.

- [ ] **Step 3: Manual / preview confirmation**

Start the dev server and open the affected project's Rates tab (`/projects/<id>/settings/rates`) after importing `SIYAYA - Mamaila Final.xlsx`.
Expected: the Main Summary still shows the `MALL PORTION` row + grand totals, and below it a "Breakdown · MALL PORTION" heading with the 1.x section nodes (1.1 P&G, 1.3 Low Voltage, …) each expandable down to the 340 priced line items. Re-confirm a multi-bill project (KINGSWALK) is visually unchanged.

---

## Self-Review

**1. Spec coverage**
- "Single-bill tender shows its breakdown without a click" → Task 1 (test + impl). ✓
- "Grand totals / Contract|Revised columns preserved" → `BoqMainSummary` left untouched and still rendered. ✓
- "Multi-bill unchanged" → Task 2 guard test; `soleBill` is `null` for 2+ bills. ✓
- "No parser/DB change" → only `RatesTab.tsx` + its test are touched. ✓

**2. Placeholder scan** — no TBD/TODO/"handle edge cases"; every code step shows complete code. ✓

**3. Type consistency**
- `soleBill` is `BoqSection | null`; passed to `BoqSectionTree`'s `bill: BoqSection` prop. ✓
- `BoqSectionTree` props used (`bill, sections, items, totals, revised, revisedTotals, projectId, canEdit, onItemUpdated`) match its `Props` interface exactly. ✓
- Test section fixtures include every `BoqSection` field used elsewhere in the file (`id, importId, parentSectionId, kind, code, title, sortOrder, nodeId`). ✓
- `getByText(/Breakdown/)` matches the rendered `Breakdown · MALL PORTION` heading substring. ✓
- Section titles (`1.1 P&G`) render in `SectionNode`'s always-visible button label, so the assertion holds even though the node is collapsed by default. ✓
