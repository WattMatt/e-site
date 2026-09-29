# 05 — PV Layout tab (`pv-layout`) and `src/components/floor-plan/`

**Source reviewed:** read-only export of `origin/main` of `WattMatt/greencalc-sa` at
`scratchpad/wmsolar-main`. All paths below are relative to that root unless stated.
Every file in `src/components/floor-plan/` (29 files, 17,062 lines) was read in full, plus
the call sites in `src/pages/ProjectDetail.tsx`, `src/components/proposals/ProposalPreview.tsx`,
`src/components/proposals/ProposalPrintView.tsx`, `src/hooks/useProjectStore.ts`, the four
`pv_layouts`/`pv_layout_folders` migrations, `src/integrations/supabase/types.ts`,
`supabase/functions/get-mapbox-token/index.ts`, `supabase/config.toml` and the
`results_json` writer in `src/components/projects/simulation/useAutoSave.ts`.

**Caveat:** the brief names `CLAUDE.md` and `docs/APP_SPEC.md` as context. **Neither exists in
this export** (`docs/` holds only `CSV_EXTRACTION_SPECIFICATION.md`), so nothing below relies on
them. Everything is derived from code.

**Legend for severity:** **S1** = wrong numbers / data loss / security; **S2** = feature broken or
unreachable; **S3** = UX defect / inconsistency; **S4** = cosmetic / dead code.

---

## 1. Purpose, placement, and consumers

### 1.1 What it is for (user terms)
A 2D "markup" tool that lets a designer:
1. Put a background under the design — the first page of a PDF drawing, or a captured Mapbox
   satellite image of the project site.
2. Calibrate the drawing scale by dragging a line over a known dimension.
3. Draw roof polygons ("roof masks"), give each a pitch and a downslope direction.
4. Drop rectangular PV arrays (rows × columns of one module type) onto roof masks.
5. Place inverters, main boards, DC combiners, AC disconnects, walkways and cable trays.
6. Draw DC and AC cable polylines that snap to equipment / modules / trays / other cables.
7. See totals (module count, kWp, cable metres, walkway/tray metres, DC/AC ratio per inverter)
   and compare module/inverter count against a linked simulation.
8. Export an A3 PDF drawing sheet, a "layered" SVG, and an A0 multi-viewport PNG, and view a
   read-only 3D preview.

It is **a manual layout tool**, not a design engine: there is no auto-fill, no setback, no
obstruction, no shading / row-spacing, no string sizing and no feedback of results into the
simulation (see §8, §9.2).

### 1.2 Where it lives
| Surface | File:line | Notes |
|---|---|---|
| Tab trigger "PV Layout" (Sun icon) with status dot | `src/pages/ProjectDetail.tsx:1279-1282` | status from `tabStatuses["pv-layout"]` (`:1154-1159`): "complete" iff first layout row has non-empty `pv_arrays` |
| Tab content | `src/pages/ProjectDetail.tsx:1407-1409` | `<FloorPlanMarkup projectId={id!} latestSimulation={latestSimulation} />` |
| Status query | `src/pages/ProjectDetail.tsx:1008-1021` | `pv_layouts.select("id, pv_arrays").eq("project_id", id).maybeSingle()` — **errors when a project has ≥2 layouts** (D-05) |
| Tab-switch hook | `src/pages/ProjectDetail.tsx:722-740` | switching **to** `pv-layout` forces `simulationRef.current.saveIfNeeded()` so `latestSimulation` is fresh; nothing flushes the floor plan when leaving it (D-12) |
| Proposal preview "System Design" page | `src/components/proposals/ProposalPreview.tsx:34-50, 704-713` | embeds `<FloorPlanMarkup projectId readOnly />` — renders blank (D-04) |
| Proposal print view | `src/components/proposals/ProposalPrintView.tsx:36-52, 302-313` | same, 400 px box |
| Project store "has PV layout" flag | `src/hooks/useProjectStore.ts:189-221` | `maybeSingle()`, error ignored |
| Code-review file browser (static list) | `src/components/code-review/ProjectFileBrowser.tsx:55-57` | lists two filenames only; no behaviour |

### 1.3 Props of the root component
`FloorPlanMarkup({ projectId, readOnly = false, latestSimulation })` — `FloorPlanMarkup.tsx:46-54`.
`latestSimulation` shape = `SimulationData` (`:35-44`): `id, name, solar_capacity_kwp,
battery_capacity_kwh, battery_power_kw, annual_solar_savings, roi_percentage, results_json`.

---

## 2. Architecture

### 2.1 File inventory (lines)
| File | Lines | Role |
|---|---|---|
| `FloorPlanMarkup.tsx` | 3002 | Root: state, history (undo/redo), persistence, keyboard, all handlers, modal wiring |
| `components/Canvas.tsx` | 2569 | 2D canvas: rendering loop, hit-testing, all mouse interactions, snapping calls |
| `components/SummaryPanel.tsx` | 1957 | Right panel: totals, per-item lists, visibility toggles, "System Details" tree |
| `utils/geometry.ts` | 1366 | All maths: area, length, pitch projection, snapping, edges, cable snap targets |
| `components/LayoutBrowser.tsx` | 918 | Landing view: layouts grouped in folders; CRUD, drag-to-folder |
| `components/Toolbar.tsx` | 886 | Left toolbar |
| `components/PlantSetupModal.tsx` | 868 | Templates: modules, inverters, walkways, cable trays, DC/AC cables |
| `utils/drawing.ts` | 786 | Canvas 2D draw routines + `renderAllMarkups` |
| `utils/a0Export.ts` | 492 | A0 multi-viewport PNG |
| `components/LayoutManagerModal.tsx` | 443 | **Unreachable** (D-20) |
| `components/ObjectConfigModal.tsx` | 407 | Right-click "change configuration" |
| `components/LoadLayoutModal.tsx` | 379 | PDF upload / satellite capture |
| `components/ThreeDViewer.tsx` | 375 | react-three-fiber preview |
| `types.ts` | 337 | All data types |
| `utils/pngExport.ts` | 314 | `exportProductionPNG` — **dead** (imported, never called) |
| `utils/pdfExport.ts` | 301 | A3 PDF sheet via pdfmake |
| `hooks/useMultiSelection.ts` | 239 | **Dead** (never imported) |
| `utils/svgExport.ts` | 212 | "Layered" SVG (embedded PNG rasters) |
| `components/PVArrayModal.tsx` | 199 | Rows/cols/orientation/spacing/elevation |
| `components/PlacementOptionsModal.tsx` | 170 | Orientation + min spacing before placing equipment/materials |
| `components/SimulationSelector.tsx` | 154 | Link layout ↔ `project_simulations` row |
| `components/AlignEdgesModal.tsx` | 106 | Pick edge to align |
| `components/SetDistanceModal.tsx` | 106 | Set edge-to-edge distance |
| `components/RoofMaskModal.tsx` | 105 | Pitch slider (+ Edit Direction) |
| `components/DimensionInput.tsx` | 97 | Number + m/cm/mm unit selector (stores metres) |
| `components/PVConfigModal.tsx` | 95 | **Never opened** (D-19) |
| `utils/elevation.ts` | 69 | Cable elevation interpolation — effectively dead (D-18) |
| `components/ScaleModal.tsx` | 64 | Enter real length for scale line |
| `constants.ts` | 46 | Colours, equipment sizes, default panel, compass labels |

### 2.2 Rendering technology
* **2D editor: plain HTML5 Canvas 2D, hand-written** — *not* Konva and *not* fabric
  (`fabric ^6.5.1` is a dependency in `package.json:54` but unused here).
  Two stacked canvases (`Canvas.tsx:2529-2546`):
  * `pdfCanvasRef` — the background image drawn **once at its natural pixel size**
    (`:345-358`) inside a `<div>` with CSS `translate(offset) scale(zoom)` (`:2535-2541`).
  * `drawingCanvasRef` — overlay sized to the container (`:367-368`), redrawn in full by one
    `useEffect` (`:361-953`) with `ctx.translate(offset); ctx.scale(zoom)`; `pointer-events:none`.
  * **World coordinates = background image pixels.** Everything (positions, polygon points,
    cable points) is stored in image pixels; metres come only from `scaleInfo.ratio`.
  * No devicePixelRatio handling → blurry overlay on HiDPI screens (D-41).
* **3D preview:** `@react-three/fiber` + `@react-three/drei` (`ThreeDViewer.tsx`), lazy-loaded
  (`FloorPlanMarkup.tsx:6`).
* **PDF input:** `pdfjs-dist 4.4.168` (lockfile), worker from cdnjs pinned to the same version
  (`LoadLayoutModal.tsx:19-22`). First page only, `scale: 2`, output PNG data URL (`:142-158`).
* **Satellite input:** `mapbox-gl ^3.16`, token from edge function `get-mapbox-token`
  (`verify_jwt = false`, `supabase/config.toml:12-13`), captured with `html2canvas`
  (`LoadLayoutModal.tsx:183-262`).
* **PDF output:** `pdfmake` (`utils/pdfExport.ts:20-21`).

### 2.3 State model (all in `FloorPlanMarkup.tsx`)
* `DesignState = { equipment, lines, roofMasks, pvArrays, placedWalkways, placedCableTrays }`
  (`types.ts:129-136`).
* **History:** `history: DesignState[]`, `historyIndex` + a ref (`:177-191`). Every mutation goes
  through `commitState(updater)` (`:201-220`), which truncates redo tail, appends a full new
  snapshot, and sets `hasUnsavedChanges`. Setters `setEquipment/setLines/setRoofMasks/
  setPvArrays/setPlacedWalkways/setPlacedCableTrays` (`:222-238`) each call `commitState` —
  **one history entry per call**, including every mouse-move during a drag (D-09).
* **Not in history** (cannot be undone): background image, scale, plant-setup templates,
  simulation link, visibility, layout name.
* View state: `viewState {zoom, offset}` (`:61`); `viewMode: 'browser' | 'editor'` (`:32, :55`).

### 2.4 Component tree
```
FloorPlanMarkup
 ├─ (viewMode==='browser' && !readOnly) LayoutBrowser            → returns early (:2579-2591)
 └─ editor
     ├─ Toolbar (hidden if readOnly)
     ├─ ThreeDViewer (if is3DView)  |  Canvas
     ├─ SummaryPanel (+ SimulationSelector as a slot)
     └─ (!readOnly) LoadLayoutModal, LayoutManagerModal(unreachable), ScaleModal,
        PVConfigModal(never opened), RoofMaskModal, PVArrayModal, PlantSetupModal,
        PlacementOptionsModal, SetDistanceModal, AlignEdgesModal, ObjectConfigModal
```

---

## 3. End-to-end workflow (as implemented)

1. **Open tab** → `LayoutBrowser` lists `pv_layouts` for the project grouped by
   `pv_layout_folders` (`LayoutBrowser.tsx:133-160`). On mount the root also fetches
   `projects.latitude, longitude` (`FloorPlanMarkup.tsx:753-775`) and derives the module from
   `latestSimulation` (`:778-839`).
2. **Start**: *New Design* (`handleNewDesign :855-858` → blank state, name "New Layout"),
   *Load PDF File* (`:861-866` → blank + opens LoadLayoutModal after 100 ms), or click an existing
   design (`handleSelectLayout :842-852` → `loadLayout :513-644`).
3. **Background**: File ▸ Load → LoadLayoutModal → *Upload PDF* (page 1 rasterised @2×) or
   *Satellite View* (enabled only if project lat/lng set) → *Capture View*. Result is a PNG data
   URL stored in React state and later in `pv_layouts.pdf_data` (TEXT).
4. **Scale**: General ▸ Set Scale → drag a line (Shift = 45° snap) → release (>10 px) →
   ScaleModal "Real-world distance" (m/cm/mm) → `ratio = realDistance / pixelDistance` m/px
   (`FloorPlanMarkup.tsx:2314-2320`). Toast shows mm/pixel.
5. **Roof masks**: Roof Masks ▸ Roof Mask → click vertices (Shift = 45°) → close by clicking
   within 15 screen-px of the first vertex, double-click, or Enter (≥3 points) → RoofMaskModal
   (plan area shown, pitch 0–45°, default 15°) → *Confirm & Draw Direction* → tool switches to
   ROOF_DIRECTION → drag from high point to low point → mask saved with `direction` = compass
   azimuth of the drag; tool returns to ROOF_MASK for the next mask (ESC to stop).
6. **Module / inverter templates**: taken automatically from `latestSimulation.results_json
   .inverterConfig` (module preset or custom module; inverter size × count), or edited in
   Plant Setup. Templates for walkways, cable trays, DC and AC cables must be created in Plant
   Setup before those tools are enabled (walkway/tray) or produce named cables.
7. **PV arrays**: Equipment ▸ Solar Module → PVArrayModal (rows, cols, portrait/landscape,
   advanced: min spacing, elevation) → *Ready to Place* → ghost follows cursor; auto-rotation =
   roof direction + 90°; R+wheel adds manual rotation; snapping to nearby arrays; click **inside a
   roof mask** to place (clicks outside masks are silently ignored). Repeats until ESC.
8. **Equipment / materials**: Inverter, Main Board, DC Combiner, AC Disconnect, Walkway, Cable
   Tray → PlacementOptionsModal (orientation, min spacing ≥ 0.05 m) → click to place (repeats;
   ESC to exit); R+wheel or toolbar *Rotate* (+45°) to rotate the ghost.
9. **Cables**: Materials ▸ DC Cable / AC Cable → click points; snapping to valid targets with a
   ring indicator; Tab cycles overlapping targets; clicking a *valid endpoint* after the first
   point auto-finishes (AC: inverter or main board; DC: inverter or PV module); otherwise finish
   with double-click. Cable stores `from`/`to` target ids.
10. **Edit**: Select tool — click/drag, Shift/Ctrl/Cmd-click toggle, marquee, group drag,
    R+wheel rotate, double-click array to edit, right-click (with a selection) to change
    template/properties, Delete/Backspace, Ctrl+C copy (enters placement of a clone), Distance
    Between and Edge Align tools.
11. **Link simulation** (SummaryPanel dropdown) → overrides module/inverter templates and shows
    placed vs target counts.
12. **Save**: auto-save 1.5 s after any change (`AUTO_SAVE_DEBOUNCE_MS :52`, effect `:950-968`),
    manual Save button or Ctrl/Cmd+S.
13. **Export**: Export SVG / Export Drawing (PDF) / Export A0 Layered Sheet; 3D View toggle.

---

## 4. Tools, modes, keyboard, mouse, touch, snapping, undo/redo

### 4.1 `Tool` enum (`types.ts:80-97`) — what each mode does
| Tool | Entered from | Canvas behaviour (Canvas.tsx) | Exit |
|---|---|---|---|
| `SELECT` | General ▸ Select; default; after most ops | click-select with priority **PV array → walkway → cable tray → equipment → cable endpoint handle → cable → roof mask** (`:1095-1281`); empty-space drag = marquee (`:1283-1286`, `:2169-2339`); drag single array/walkway/tray/equipment with snapping (`:1951-2091`); drag on an already multi-selected item = group drag (`:976-1020`, `:1816-1917`); dbl-click array = edit (`:2379-2392`) | — |
| `PAN` | General ▸ Pan (also middle mouse in any tool, `:1475-1478`) | drag pans | switch tool |
| `SCALE` | General ▸ Set Scale (disabled until a background is loaded) | mousedown sets start (`:1480-1483`), move updates end (Shift 45°) (`:2101-2105`), mouseup >10 px opens ScaleModal (`:2360-2367`) | ScaleModal confirm → SELECT |
| `ROOF_MASK` | Roof Masks ▸ Roof Mask (disabled until scaled) | click adds vertex; close by click near start (≤15 screen px, `SNAP_THRESHOLD :184`, `:1491-1504`), dbl-click, Enter (≥3) | ESC |
| `ROOF_DIRECTION` | automatically after RoofMaskModal confirm, or *Edit Direction* | drag high→low, >10 px; azimuth `atan2(dx, −dy)` (`:189-200`) | auto |
| `PV_ARRAY` | Equipment ▸ Solar Module (opens PVArrayModal first); also used as the **batch-paste** mode for multi-copy (`FloorPlanMarkup.tsx:1375`) | ghost + click-to-place inside a mask (`:1675-1716`); batch variant places the whole group anywhere (`:1592-1674`) | ESC |
| `PLACE_INVERTER`, `PLACE_MAIN_BOARD`, `PLACE_DC_COMBINER`, `PLACE_AC_DISCONNECT` | toolbar → PlacementOptionsModal → tool | ghost + click-to-place with equipment snapping (`:1717-1757`) | ESC |
| `PLACE_WALKWAY`, `PLACE_CABLE_TRAY` | toolbar → PlacementOptionsModal | ghost + click-to-place with material snapping (`:1758-1801`) | ESC |
| `LINE_DC`, `LINE_AC` | Materials ▸ DC/AC Cable | click-to-add vertex with target snapping and auto-complete (`:1489-1591`) | dbl-click / Enter(≥3 pts) / ESC |
| `DIMENSION` | Tools ▸ Distance Between | click object 1 (moves), click object 2 (reference) → SetDistanceModal (`:1290-1367`) | modal close / ESC |
| `ALIGN_EDGES` | Tools ▸ Edge Align | click object 1 (optionally near an edge, 20 screen px), click object 2; edge+edge = immediate align, otherwise AlignEdgesModal (`:1370-1474`, `FloorPlanMarkup.tsx:1646-1671`) | modal / ESC |

There is **no tool** for `SUB_BOARD` (enum value exists, drawable, never placeable — D-29),
no obstruction/keep-out tool, no setback tool, no text/annotation tool, no measure-only tool.

### 4.2 Keyboard shortcuts
| Key | Where | Effect |
|---|---|---|
| Ctrl/Cmd+Z | `FloorPlanMarkup.tsx:2025-2028` | Undo |
| Ctrl/Cmd+Y | `:2029-2032` | Redo (**Ctrl/Cmd+Shift+Z not supported**; `e.key==='z'` only) |
| Ctrl/Cmd+S | `:2033-2036` | Manual save |
| Ctrl/Cmd+C | `:2039-2113` | Single-selection "copy" = enter placement mode for a clone (PV array, roof mask(pitch only), equipment (not Sub Board), walkway, cable tray). No paste key. Intercepts system copy even when text is selected elsewhere. |
| Esc | `:2115-2189` (+ `Canvas.tsx:246-265`) | Cascading cancel: batch paste → PV placement → equipment/material placement → roof-mask drawing → pending roof mask → direction edit → dimension → align → clear selection → SELECT. Canvas also cancels in-progress polyline and endpoint edit (restores original points). |
| Delete / Backspace | `:2192-2195` | Delete selection (multi-delete **skips cables**, D-11) |
| R (hold) + wheel | `:2021-2024`, `:2217-2292` | Rotate ghost or selected item ±5°/tick; **Shift** → ±1° (uses `deltaX` because browsers map Shift+wheel to horizontal). Wheel zoom suppressed while R held. Each tick = one history entry. Toolbar hint "Press R to rotate" is misleading — R alone does nothing (D-31). |
| Shift (hold) | `Canvas.tsx:241, 276` | 45° snap for scale line, direction line, roof/cable vertices; "force align" (axis-align, 4× proximity) for array/equipment/material snapping; during drag also adopts snapped item's rotation |
| Tab | `Canvas.tsx:267-273` | Cycle overlapping cable snap targets (cable drawing and endpoint editing). When cycled (`index>0`) the snap point becomes the target's *centre* (`geometry.ts:1350-1359`) |
| Enter | `Canvas.tsx:242-245` | Finish polyline if ≥3 points (a 2-point cable cannot be finished with Enter) |

Guard: shortcuts ignored only when focus is in `<input>`/`<textarea>` (`:2018`); Radix
Select/combobox focus is not excluded.

### 4.3 Mouse
* **Wheel** = zoom about cursor, factor 1.1 / 0.9, clamped [0.1, 10] (`Canvas.tsx:2397-2412`).
  Attached via React `onWheel` → React registers wheel listeners as passive, so
  `e.preventDefault()` does not stop page scroll (D-42).
* **Middle button** = pan in any tool (`:1475`).
* **Right-click** = config modal for the *current selection only*; right-click on an unselected
  object does nothing (`:2424-2427`).
* **Double-click** = finish polyline / edit array. The two `mousedown`s of a double-click each
  add a vertex first, so every dbl-click-finished polyline ends with duplicate vertices (D-35).
* **Mouse leave** cancels drags/marquee (`:2508-2524`).

### 4.4 Touch
**None.** Only `onMouseDown/Move/Up/Leave/DoubleClick/Wheel/ContextMenu` are bound
(`Canvas.tsx:2505-2527`). No pointer or touch events, no pinch-zoom, no long-press. Unusable on
tablets (Mapbox capture map itself supports touch).

### 4.5 Snapping (all in `utils/geometry.ts`)
| Snap | Trigger | Rule |
|---|---|---|
| 45° angle | Shift | `snapTo45Degrees` (`:226-246`): keep length, round angle to 45° |
| Roof polygon close | click ≤15 screen px from first vertex | `Canvas.tsx:1491-1504` |
| PV array ↔ PV array | ghost or drag within 0.25 m edge gap (1.0 m with Shift) | `snapPVArrayToSpacing` (`:284-414`), see §6.5 |
| Equipment ↔ equipment | same thresholds; spacing hard-coded 0.3 m | `snapEquipmentToSpacing` (`:459-567`); callers `Canvas.tsx:524, 1728, 1999` |
| Walkway ↔ walkway, tray ↔ tray (same type only) | same thresholds; spacing = placement min spacing, min 0.01 m | `snapMaterialToSpacing` (`:598-700`) |
| Cable point → target | within 20 screen px | `snapCablePointToTarget` (`:1176-1366`): targets = inverters (DC & AC), main boards (AC), **every individual module centre** (DC), matching-type cable trays (continuous projection onto centreline), vertices of same-type cables. Priority cable-node → equipment → module → tray; Tab cycles. **DC combiners and AC disconnects are not targets** (D-28). |
| No grid snap, no snap to roof edges/vertices, no snap of arrays to mask edges, no snap across types (array ↔ walkway) | — | — |

### 4.6 Undo / redo
Unlimited linear history of full snapshots (`FloorPlanMarkup.tsx:177-254`). Undo/redo buttons in
toolbar bottom (`Toolbar.tsx:864-881`) and collapsed strip (`:323-328`). Loading a layout resets
history to `[loaded]` (`:624-625`). Drags and R+wheel create one entry per event (D-09), group
drag creates up to 6 entries per mouse-move (one per object type, `Canvas.tsx:1816-1916`).

---

## 5. Control inventory

Column key — **Handler → effect** cites file:line; **Data** lists DB tables/columns (only
`pv_layouts`, `pv_layout_folders`, `project_simulations`, `projects` are touched; **no storage
buckets are used** — images live in a TEXT column).

### 5.1 Layout Browser (`components/LayoutBrowser.tsx`)
| Control | Type | What it's for | Handler → effect | Data | Validation / disabled | Error & empty states |
|---|---|---|---|---|---|---|
| FILE ACTIONS / ADVANCED | collapsibles | group actions | local state `:91-92` | — | — | — |
| Load PDF File | button | start a new design from a PDF | `onLoadPDF` → `FloorPlanMarkup.handleLoadPDFFromBrowser :861-866` (reset, editor, open LoadLayoutModal after `setTimeout 100`) | none until autosave | — | — |
| My Saved Designs | button | scroll to list | `scrollIntoView('designs-section') :399` | — | — | — |
| Export as PDF | button | — | **STUB: `disabled`** `:404-412` | — | always disabled | — |
| View Saved Reports | button | — | **STUB: `disabled`** `:413-421` | — | always disabled | — |
| Settings | button | — | **STUB: `disabled`** `:431-439` | — | always disabled | — |
| Select Multiple / Cancel | toggle | bulk move | `setIsMultiSelectMode` `:476-481, 459-462` | — | — | — |
| Move (n) | button | move selected layouts to folder | opens Move dialog `:463-471` | — | disabled if 0 selected | — |
| Manage Folders / Done | toggle | show folder rename/delete icons | `:483-490, 517-520` | — | — | banner `:509-522` |
| New Folder | button → dialog | create folder | `handleCreateFolder :163-183` | INSERT `pv_layout_folders(project_id,name,sort_order=folders.length)` | blank name ignored silently | toast "Failed to create folder" |
| New Design | button | blank editor | `onNewDesign` → `:855-858` | — (name "New Layout") | — | **second unsaved "New Layout" can never be saved** (D-01) |
| Folder accordion rows | accordion + drop target | group; drop a card to move | `handleDragOver/Drop :280-296` → `handleMoveLayoutToFolder :254-268` | UPDATE `pv_layouts.folder_id` | — | "No designs in this folder" |
| Folder pencil (manage mode) | icon → dialog | rename folder | `handleRenameFolder :185-203` | UPDATE `pv_layout_folders.name` | blank ignored | toast |
| Folder trash (manage mode) | icon → AlertDialog | delete folder | `handleDeleteFolder :205-229`: UPDATE layouts `folder_id=null` (**error unchecked**), DELETE folder | both tables | — | toast |
| Uncategorized accordion | accordion + drop target | layouts with no folder | drop → `folder_id=null` `:611-613` | UPDATE | — | "No designs yet" + *Create your first design* button (→ New Design) |
| Design card | card (click / draggable) | open layout / toggle in multi-select | `onSelectLayout` → `handleSelectLayout :842-852` (spinner, `loadLayout`, editor) | SELECT `pv_layouts *`; maybe `project_simulations` | not draggable in multi-select | toast "Failed to load layout" |
| Card checkbox | checkbox | multi-select | `toggleLayoutSelection :349-357` | — | — | — |
| Card ⋮ ▸ Rename | menu → AlertDialog | rename | `handleRenameConfirm :305-318` → `renameLayout :702-718` | UPDATE `pv_layouts.name` | blank ignored; **UNIQUE(project_id,name)** → error toast | toast |
| Card ⋮ ▸ Duplicate | menu | copy | `handleDuplicate :339-347` → `createLayout(name+" (Copy)", id) :647-699` → INSERT then **`loadLayout(copy)` while still in browser** | INSERT copies scale, pv_config, roof_masks, pv_arrays, equipment, cables, pdf_data — **not plant_setup (walkways/trays/templates) nor simulation_id nor folder_id** (D-14) | second duplicate → unique-name error | toast |
| Card ⋮ ▸ Move to… | submenu | move | `handleMoveLayoutToFolder` | UPDATE `folder_id` | current folder disabled | toast |
| Card ⋮ ▸ Delete | menu → AlertDialog | hard delete | `handleDeleteConfirm :325-337` → `deleteLayout :721-750` (if current layout: load most-recent other or reset) | DELETE `pv_layouts` | — | toast |
| Folder colour | — | shown as icon colour | never editable (default `#3b82f6`) | `pv_layout_folders.color` | — | — |
| Date on card | text | last update | `format(updated_at,'yyyy/MM/dd') :914` | — | — | — |

### 5.2 Editor Toolbar (`components/Toolbar.tsx`)
| Control | Type | What it's for | Handler → effect | Data | Validation / disabled | Error & empty |
|---|---|---|---|---|---|---|
| Header: name, save status, "N panels • X kWp" | text | status | `:348-366`; `calculateTotalPVCapacity` | — | kWp line only if panels>0 | "Saved Ns ago" does not tick |
| Collapse / Expand | icon | narrow strip | `onToggleCollapse` `:369-372, 319-321` | — | — | collapsed strip keeps Undo/Redo/Save `:323-338` |
| Sections (accordion, one open) | collapsibles | organise | `toggleSection :299-309` | — | — | — |
| File ▸ Back | button | return to browser | `onBackToBrowser` → `setViewMode('browser')` `FloorPlanMarkup.tsx:2621` | — | — | **no unsaved-changes prompt** (autosave may still be pending) |
| File ▸ Load | button | set background | opens LoadLayoutModal `:2603` | — | — | — |
| File ▸ Save | button | save now | `handleSave :945-947` → `saveLayout(false) :874-942` | INSERT/UPDATE `pv_layouts` | disabled while saving; **silently no-op if an autosave is in flight** (`:878`) | toast success / "Failed to save layout: <msg>" |
| File ▸ Export SVG | button | layered SVG | `handleExportSVG :2453-2503` | — | — | "No layout loaded to export" if no background canvas |
| File ▸ Export Drawing (PDF) | button | A3 sheet | prop is named `onExportPNG` but wired to `handleExportPDF :2505-2538` | — | — | same |
| File ▸ Export A0 Layered Sheet | button | A0 PNG | `handleExportA0 :2540-2576` | — | — | same |
| General ▸ Select | tool | select/edit | `setActiveTool(SELECT)` | — | — | — |
| General ▸ Pan | tool | pan | — | — | — | — |
| General ▸ Set Scale (✓ badge when set) | tool | calibrate | `SCALE` | scale persisted as `scale_pixels_per_meter` | disabled until background loaded | — |
| General ▸ 3D View / 2D View | toggle | 3D preview | `setIs3DView` | — | disabled until scaled | Suspense spinner |
| Plant Setup ▸ Solar Module / Inverter / Walkway / Cable Tray / DC Cable / AC Cable (with count badges) | buttons | edit templates | `onOpenPlantSetup(tab)` → PlantSetupModal | `pv_layouts.plant_setup` | — | — |
| Roof Masks ▸ Roof Mask | tool | draw roof | `ROOF_MASK` | `roof_masks` | disabled until scaled | — |
| Equipment ▸ Solar Module | tool | place array | `handleToolSelect :476-485` opens PVArrayModal (pvPanelConfig always set) | `pv_arrays` | disabled until scaled | clicks outside a mask ignored silently |
| Equipment ▸ Solar Module ⚙ | popover radio | choose module template | `setSelectedModuleId` | — | only if >1 module | **choice is ignored everywhere** (D-26) |
| Equipment ▸ Inverter | tool | place inverter | → PlacementOptionsModal | `equipment` | disabled until scaled **and** ≥1 inverter template | — |
| Equipment ▸ Inverter ⚙ | popover radio | choose inverter template | `setSelectedInverterId` | — | only if >1 | **ignored — placement always uses the default inverter** (`Canvas.tsx:1741-1755`) (D-26) |
| Equipment ▸ Main Board | tool | place board | → PlacementOptionsModal | `equipment` | disabled until scaled | — |
| Materials ▸ DC Cable / AC Cable | tool | draw cable | `LINE_DC/LINE_AC` | `cables` | disabled until scaled | — |
| Materials ▸ DC/AC Cable ⚙ | popover radio | choose cable template | `setSelectedDcCableId/AcCableId` → used by `getSelectedDcCable/AcCable :424-435` | — | only if >1 | — |
| Materials ▸ DC Combiner / AC Disconnect | tools | place | → PlacementOptionsModal | `equipment` | disabled until scaled | — |
| Materials ▸ Walkway / Cable Tray (+⚙) | tools | place | → PlacementOptionsModal | `plant_setup.placedWalkways/placedCableTrays` | disabled until scaled and ≥1 template | — |
| Tools ▸ Copy / Copy (n) | button | clone selection | `handleCopySelected :1177-1377` | — | disabled with no selection | "No valid items to copy" |
| Tools ▸ Distance Between | tool | set gap | `DIMENSION` | positions | disabled until scaled | inline instructions `:809-821`; silently nothing if dims unresolvable |
| Tools ▸ Edge Align | tool | align edges | `ALIGN_EDGES` | positions | disabled until scaled | inline instructions `:824-836` |
| Rotate (N°) | button (only for equipment/material placement tools) | rotate ghost +45° | `rotateNext :311-313` | — | not shown for PV arrays | hint "Press R to rotate" wrong |
| Undo / Redo | icons | history | `onUndo/onRedo` | — | disabled at ends | — |
| (prop `onOpenLayoutManager`) | — | — | **destructured, never rendered** → LayoutManagerModal unreachable (D-20) | — | — | — |

### 5.3 Canvas direct interactions — see §4.1–4.5. Additional canvas-only UI:
| Control | What | Where |
|---|---|---|
| Empty state "Load a layout to begin" | shown whenever no background | `Canvas.tsx:2529-2532` |
| Drawing hint bar (roof/cable) | "Click to add points. Double-click or Enter to close. Esc to cancel." (Enter needs ≥3 pts) | `:2549-2555` |
| Direction hint bar | "drag from high point to low point" | `:2558-2564` |
| Cable endpoint handles (selected cable, SELECT tool) | 3-click edit: click handle → click to attach to cursor → click to commit (snaps; updates `from`/`to`, clears on empty space); ESC restores | render `:761-907`; logic `:1043-1093, 1208-1249` |
| Group bounding box + count badge | multi-selection | `drawing.ts:694-771` |
| Snap ring + "[Tab: i/n – type]" | cable targets | `Canvas.tsx:686-738, 868-903` |
| Dimension/Align highlights "1"/"2" + chosen edge | tool feedback | `drawing.ts:14-83, 773-785` |

### 5.4 Modals
**LoadLayoutModal** (`components/LoadLayoutModal.tsx`)
| Control | Type | For | Handler → effect | Data | Validation | Errors |
|---|---|---|---|---|---|---|
| Upload PDF tab ▸ Browse Files | file input (`accept=application/pdf`) | background from drawing | `handleFileChange :160-181` → `convertPdfToImage` (page 1, scale 2, PNG) → `onImageLoad` → `setBackgroundImage` + dirty `FloorPlanMarkup.tsx:2294-2298` | later `pdf_data` | non-PDF MIME rejected | "Failed to load PDF"; input value never reset (same file can't be re-picked); **existing objects/scale are kept in old pixel coords** (D-16) |
| Satellite View tab | tab | background from Mapbox | map init `:65-124` (centre = project lat/lng, fallback Johannesburg -26.2041, 28.0473; zoom 18; rotation enabled) | `projects.latitude/longitude` | tab disabled without coords | "No coordinates available"; "Failed to load map token"; token fetch on every open |
| Map nav control | zoom/compass/pitch | frame view | Mapbox | — | — | rotating/pitching silently breaks north & scale |
| Capture View | button | snapshot | `handleCaptureMap :183-262`: hides marker/controls/**logo & attribution**, `html2canvas(scale 2)` | later `pdf_data` | disabled until map `load` | "Failed to capture satellite view"; **metres-per-pixel from Mapbox is not used — user must still calibrate manually** (D-17) |

**ScaleModal** (`ScaleModal.tsx`): "Real-world distance" `DimensionInput` (m/cm/mm) → live mm/pixel
preview → *Set Scale* (disabled ≤0) → `handleScaleConfirm :2314-2320`; *Cancel*/close clears
`scaleLine`. **Scale change does not set `hasUnsavedChanges`** → not auto-saved on its own (D-07).
The drawn scale line stays on canvas with its label until the next calibration; it is not
persisted.

**RoofMaskModal** (`RoofMaskModal.tsx`): shows plan area; *Roof Pitch* slider 0–45° step 1
(default 15, or current when editing); *Cancel* (discards pending mask); *Edit Direction*
(editing only → ROOF_DIRECTION for that mask); *Confirm & Draw Direction* / *Update*
(`handleRoofMaskConfirm :2328-2349`). Opened from canvas completion or SummaryPanel pencil /
double-click on a roof row (`handleEditRoofMask :2383-2389`). No azimuth numeric entry.

**PVArrayModal** (`PVArrayModal.tsx`): Rows (1–50 hint), Columns (1–100 hint), Portrait /
Landscape (shows module dims), Advanced ▸ Minimum Spacing (DimensionInput, default 0.5 m) and
Elevation (m). Live panels / kWp / array size. *Ready to Place* / *Update*.
Validation: `parseInt(x) || 1` only — **negative rows/cols accepted** (D-24); HTML min/max not
enforced. **Elevation is collected and discarded** (`handlePVArrayConfirm :2400-2420`) (D-18).

**PlacementOptionsModal**: Orientation (portrait/landscape — only affects walkways/trays by
swapping width/length, `FloorPlanMarkup.tsx:2716-2741`; ignored for equipment), Minimum Spacing
(clamped to ≥0.05 m with warning, `:96-105`) — used for walkway/tray snapping only; equipment
always 0.3 m. Shows item size.

**SetDistanceModal**: shows current edge-to-edge distance, *New Distance* (DimensionInput),
preview "will move X m away/toward", *Apply* (disabled <0) → `handleDimensionApply :1483-1564`
(moves object 1, or the whole selection if object 1 is in a multi-selection, in one commit).
"No movement needed" toast when delta≈0.

**AlignEdgesModal**: radio Left/Right/Top/Bottom → `handleAlignEdgesApply :1674-1748` (one
commit; batch-moves the selection if object 1 is part of it). Skipped when both clicks were on
edges (`performDirectEdgeAlign :1571-1643`) — then object 1's clicked edge is used for both.

**ObjectConfigModal** (right-click): Properties ▸ Elevation (all types) and Cable Type (trays,
AC/DC); Configuration ▸ Template select + type-specific fields: Length (walkway/tray), Name
(inverter), Rows/Columns/Orientation (PV array). *Apply* → `handleApplyConfig :1917-2011`.
Empty state "No configurations available…" when no templates (`:301-317`).
Defects: elevation never applied (D-18); PV array template change stores `moduleConfigId` but
nothing reads it (D-26); walkway/tray template change resets `width` to the template width but
keeps `length` → a landscape-placed item collapses to width×width (D-27); header count uses all
selected ids even for mixed-type selections (D-33); multi-select currentProps for cable trays
uses `||` so a partially-uniform set pre-fills misleading values (`:1796`).

**PlantSetupModal**: six tabs (entered via toolbar; no tab strip inside the modal — the title
changes). Each list: Star (set default; not for walkways/trays), Pencil (edit), Trash (delete),
*Add …*. Forms: Module (name*, width, length via DimensionInput, Wp), Inverter (name*, AC kW,
count, width, height), Walkway/Tray (name*, width, length), DC cable (name*, "Diameter (mm²)"
4/6/10/16/25, Cu/Al), AC cable (name*, 16…120 mm², Cu/Al). *Sync from Simulation* (modules and
inverters tabs) → parent `onSyncFromSimulation :2900-2940`. Footer *Cancel* / *Apply* →
`onApply :2886-2899` sets config + dirty and, if a default module exists, `pvPanelConfig`.
Defects: name is the only validation (0 W, negative sizes accepted); Sync always toasts
"Synced" in the modal even when the parent toasts an error (double/contradictory toasts,
`:64-67`); Sync replaces parent config, and the reset effect (`:50-56`) then wipes any unapplied
local edits; deleting a walkway/tray template leaves placed instances with an orphan `configId`;
"Diameter (mm²)" is a cross-section area, and the SummaryPanel labels the same number "mm".

**PVConfigModal**: read-only module info. **Never opened** — `setIsPVConfigModalOpen(true)` is
never called (D-19).

**LayoutManagerModal**: layout list with search, New/Rename/Duplicate/Delete and an
**unsaved-changes warning** — **unreachable** (D-20). The live Back/select paths have no warning.

### 5.5 Summary panel (`components/SummaryPanel.tsx`)
| Control | For | Handler → effect | Data read | Notes |
|---|---|---|---|---|
| Collapse / expand | space | `onToggleCollapse` | — | collapsed strip shows rounded kWp |
| **Summary Contents** / **System Details** | accordion (mutually exclusive) | `:650-658` | — | — |
| SimulationSelector slot | link simulation | see §5.6 | `project_simulations` | — |
| Modules card `placed / target` | module count vs sim | red if fewer, green if more (`:729-761`) | `results_json.moduleCount` | no tolerance |
| Inverters card | inverter count vs sim | amber if mismatch | `results_json.inverterCount` | — |
| Walkways / Cable Trays cards | metres | `Σ max(width,length)` (`:601-602`) | placed items | — |
| Roof Areas section (eye, list, pencil, trash, dbl-click) | list/edit/delete masks | eye → `onToggleLayerVisibility('roofMasks')`; row click selects (+force-show); pencil/dbl-click → RoofMaskModal; trash → `handleDeleteItem` | live area recomputed from points | "No roof masks defined" |
| Main Boards section | list/select/delete | same pattern | — | "No main boards placed" |
| Modules section | per-array rows × cols, kWp | select/delete | — | no per-array orientation/tilt/azimuth shown |
| Inverters section | list | select/delete | `inv.name` | — |
| Walkways / Cable Trays grouped sections | per template group with subtotal; per-item eye/select/delete | `GroupedMaterialSection :150-398` | — | row shows `min×max` of dims |
| Cabling section | DC/AC by thickness, per cable length; eye per group / per item; "toggle all" | `:1225-1629` | 2D length recomputed; "3D" figure only if `elevations` exist | "toggle all" *inverts each* thickness instead of setting all (D-37) |
| System Details tree | Main Board → Inverters → Strings (DC cables) with panels and DC/AC ratio; cascade-select on click | `:1636-1953` | inferred by **1 m endpoint proximity**, not by `from/to` | see D-21/D-22 |

### 5.6 SimulationSelector (`components/SimulationSelector.tsx`)
Loads **all** simulations of the project **including full `results_json`** (`:46-50`) just to show
`name`, kWp, `moduleCount`, `inverterCount`. Dropdown: select a simulation → `handleSimulationChange
:971-1040` (sets `simulation_id`, rebuilds module & inverter templates from
`results_json.inverterConfig`, back-fills inverter `configId`, dirty); *Unlink simulation*
(clears link but leaves the simulation-derived templates in place). Empty states: "Loading…",
"No simulations" (also shown on fetch **error**), "No simulation linked". List never refreshes
while mounted.

### 5.7 3D viewer (`components/ThreeDViewer.tsx`)
Orbit/zoom/pan (drei `OrbitControls`), click to select (single), click empty to deselect.
*Reset View* button — **dead**: `controlsRef` is never attached (`:342-349`) (D-39). Roof masks
are rotated about the world origin, not the mask, so pitched masks are misplaced (`:69-74`);
arrays are flat boxes (no tilt), equipment sizes come from a third private size table
(`:47-53`); camera fixed at (15,20,15) while content sits at image-pixel×ratio coordinates
(often tens–hundreds of metres from origin) (D-40).

### 5.8 Exports
| Export | Implementation | Output | Defects |
|---|---|---|---|
| Layered SVG | `utils/svgExport.ts` | SVG with one `<g inkscape:groupmode="layer">` per layer, each an **embedded full-size PNG** (`:180-200`) — not vector | Not CAD-usable; opened in a new tab via blob URL (download fallback) |
| Drawing sheet PDF (A3 landscape) | `utils/pdfExport.ts` via pdfmake `.open()` | layout image + legend + info strip | Scale bar computed but **never drawn** (`:220-231`); "Scale: 1px = X mm" meaningless on paper; **no north arrow**; `projectName` is passed the *layout* name (`FloorPlanMarkup.tsx:2529`); revision fixed "REV001", drawn-by "—"; legend colours do not match canvas colours (roof orange vs purple, DC red vs orange, AC green vs blue); lengths from stored `line.length`/`mask.area` (stale after rescale) and `w.length` (wrong for landscape walkways); popup blockers |
| A0 layered sheet | `utils/a0Export.ts` | 7016×4961 PNG (A0 @150 dpi) with up to 6 viewports + legend + title strip; opened via `window.open('')` + `document.write` | ~35 MP canvas + one full-res offscreen per viewport → memory failures on iOS/low-RAM; **filename (layout name) interpolated unescaped into `document.write`** → stored XSS (D-44); same legend issues |
| PNG with legend | `utils/pngExport.ts` | — | **dead code** |
All exports draw **every** item regardless of visibility toggles, and use `zoom=1` line widths
(hairlines on high-res output).

---

## 6. Geometry and maths (with formulas and constants)

Notation: `r = scaleInfo.ratio` [m/px]; image-pixel coordinates; canvas y points down.

### 6.1 Scale
`r = realDistance / pixelDistance` (`FloorPlanMarkup.tsx:2315`), pixelDistance = Euclidean
length of the drawn line in image px (`Canvas.tsx:2361`), min 10 px. Persisted as
`scale_pixels_per_meter = 1/r` (`:887`) and restored as `r = 1/value` (`:599-607`).
One scale per layout (single raster).

### 6.2 Areas and lengths
* Polygon area (shoelace): `A = |Σ(xᵢyⱼ − xⱼyᵢ)|/2 · r²` (`geometry.ts:30-40`). **Plan
  (horizontal) area** — never divided by cos(pitch); the modal labels it "Roof Area".
* Polyline 2D length: `L = r · Σ‖pᵢ₊₁ − pᵢ‖` (`:46-55`).
* 3D length (if per-vertex elevations): `Σ √((Δx·r)² + (Δy·r)² + Δz²)` (`:64-82`) — no
  producer of elevations in practice (D-18).
* `mask.area` and `line.length` are **stored at creation time** and never recomputed on
  rescale/edit; the SummaryPanel recomputes, exports use the stored values (D-15).

### 6.3 Roof direction (azimuth)
`azimuth = round(atan2(dx, −dy)·180/π) mod 360` from high point → low point
(`Canvas.tsx:189-200`) — i.e. compass bearing of the **downslope** (= facing) direction, with
**image-up assumed to be true north**. There is no north-arrow/rotation input (D-13).
Label: nearest of N/NE/E/SE/S/SW/W/NW by absolute difference **without wrap-around**, so
340°–359° are labelled "NW" instead of "N" (`constants.ts:37-46`) (D-36).

### 6.4 PV array footprint
```
panelW_px = module.width  / r
panelL_px = module.length / r · cos(pitch)          // pitch of the mask containing the array centre
portrait : cellW = panelW_px, cellL = panelL_px
landscape: cellW = panelL_px, cellL = panelW_px
array width  = columns · cellW   (local x)
array height = rows    · cellL   (local y)
corners = rotate(±w/2, ±h/2 by rotation) + position
```
(`geometry.ts:153-192`, same code duplicated in `:251-278`, `:989-1032`, `drawing.ts:227-274`).
* **No gap between modules** (no inter-module clamp gap, no inter-row gap) inside an array.
* **Auto-rotation on placement:** `rotation = (mask.direction + 90) mod 360`
  (`geometry.ts:134-148`) + manual R-wheel offset.
* ⚠ **Foreshortening is applied to the module's *length* axis, which is local y; the auto-rotation
  of direction+90° maps local y onto the across-slope axis.** Worked example: north-facing roof
  (direction 0°) ⇒ rotation 90° ⇒ local y → world −x (E–W). The cos(pitch) shrink is therefore
  applied across the slope, not along it, and a "portrait" module lies with its long side across
  the slope. Unless `rotation` is meant to be interpreted differently (no code suggests so), every
  auto-rotated array on a pitched roof has the wrong footprint and the portrait/landscape labels
  are effectively swapped (D-10).
* Pitch lookup is by array **centre** point in a mask; an array straddling two masks uses one.
* Only the centre must lie inside a mask; arrays may overhang roof edges, overlap each other,
  overlap walkways, and batch-pasted arrays may lie outside any mask (pitch 0) (D-23).

### 6.5 Array/equipment/material snapping (`geometry.ts:284-700`)
For each existing item: rotated AABB half-sizes using the *existing* item's rotation for
both itself and the ghost:
`effHalfW = hw·|cosθ| + hh·|sinθ|`, `effHalfH = hw·|sinθ| + hh·|cosθ|`.
Edge gaps `gapX = max(0, |dx| − (effA+effB))`, `gapY` likewise;
`minEdge = hypot(gapX, gapY)`. Candidate if `minEdge ≤ 0.25 m/r` (×4 with Shift)
(`SNAP_PROXIMITY_THRESHOLD_METERS = 0.25`, `_FORCE_MULTIPLIER = 4`, `:8-9`). Closest centre wins.
* Normal: snap along the dominant world axis to `centre ± (effA + effB + spacing)` and match the
  other axis → **world-axis alignment even for rotated arrays** (an array rotated 30° is placed
  side-by-side on screen-x, not along its own row axis) (D-10b).
* Shift: align the non-dominant axis only.
* The snapped item adopts the neighbour's rotation.
* Spacing sources: PV ghost = `pendingPvArrayConfig.minSpacing`; **PV drag uses
  `pendingPvArrayConfig?.minSpacing ?? 0`** — normally 0 during Select, so dragging ignores the
  array's own `minSpacing` (`Canvas.tsx:1961`); equipment = hard-coded 0.3 m; walkways/trays =
  placement spacing, floored at 0.01 m (`:612`).

### 6.6 Distance / alignment tools (`geometry.ts:706-917`)
All on **axis-aligned bounding boxes** of rotated objects (`getObjectEdges :811-830`).
Edge distance: overlap on both axes → 0; else one-axis gap, or corner hypot. Set-distance moves
object 1 along the dominant centre-to-centre axis to `c₂ ± (hw₁+hw₂+d)`
(`calculateNewPositionAtDistance :757-803`). Edge clicked if within 20 screen px of a local edge
(`Canvas.tsx:1373-1374`, `detectClickedEdge :878-917`).
Equipment dimensions: `getEquipmentDimensions` table (inverter 0.7×0.5, DC combiner 0.4×0.3,
AC disconnect 0.3×0.2, main board 1.2×0.4, sub board 0.8×0.3 m; default inverter template
overrides) — **different** from the drawing/hit-test sizes (`EQUIPMENT_REAL_WORLD_SIZES`: 0.7,
0.4, 0.3, 1.2, 0.8 m squares) and from the 3D sizes (D-30).

### 6.7 Capacity and electrical figures
* `panelCount = Σ rows·columns`; `kWp = panelCount · module.wattage / 1000`
  (`geometry.ts:197-204`). Uses the single global `pvPanelConfig`; per-array
  `moduleConfigId` ignored.
* "String" (SummaryPanel) = one DC cable whose endpoint is within **1 m** of an inverter centre
  (`SummaryPanel.tsx:401-428`). Its panel count = **all panels of the PV array** the other end
  resolves to — by `from`/`to` equal to an array id (never true for module snaps, which store
  `"<arrayId>_module_<i>"`, D-21) or else by proximity (`:462-522`). Two cables from one array
  double-count that array; one array cannot be split into several strings.
* `DC/AC = Σ string kWp / inverter template acCapacity` for the item's `configId`
  (`:1711-1714`); "0.00" if no template.
* **No Voc/Vmp/temperature string sizing, MPPT allocation, cable sizing, voltage drop or
  losses anywhere.**

### 6.8 Cable elevation interpolation
`elevations[i] = s + (i/(n−1))·(e − s)` by **vertex index**, not by distance
(`utils/elevation.ts:39-69`), computed on save (`FloorPlanMarkup.tsx:893-896`).

### 6.9 Viewport
Screen→world `w = (s − offset)/zoom` (`Canvas.tsx:961-964`); wheel zoom keeps the cursor fixed:
`offset' = mouse − world·zoom'`. Container resize keeps the viewport centre (`:316-342`).

### 6.10 Hard-coded values
| Value | Where |
|---|---|
| Autosave debounce 1500 ms | `FloorPlanMarkup.tsx:52` |
| Default placement spacing 0.3 m; PV default 0.5 m; last-used array 2×10 portrait | `:265, :354-359` |
| New roof pitch 15° | `:2324`, `RoofMaskModal.tsx:30` |
| Pitch range 0–45° | `RoofMaskModal.tsx:73-74` |
| Default panel 1.134 × 2.278 m, 550 Wp (and DB default `pv_config`) | `constants.ts:20-24`; migration `20251213073801…sql:7` |
| Equipment sizes (three different tables) | `constants.ts:12-18`, `geometry.ts:425-431`, `ThreeDViewer.tsx:47-53` |
| Equipment snap spacing 0.3 m | `Canvas.tsx:524, 1728, 1999` |
| Snap proximity 0.25 m (×4 Shift); cable snap 20 px; polygon close 15 px; endpoint handle 10 px; cable hit 8 px; edge click 20 px; equipment hit padding 5 px | `geometry.ts:8-9, 964`; `Canvas.tsx:184-185, 1253, 1373, 1189` |
| Cable-node dedupe "1 cm" = 0.01 **pixels** | `geometry.ts:1265` (unit bug) |
| String/inverter association 1 m | `SummaryPanel.tsx:410, 439, 482` |
| Default cable thickness 6 (for grouping/visibility) | `drawing.ts:364`, `SummaryPanel.tsx:1241` |
| Walkway template default 0.6×10 m; tray 0.3×10 m; placement fallbacks 0.6×2 / 0.3×2 m | `PlantSetupModal.tsx:169, 202`; `FloorPlanMarkup.tsx:2721, 2734` |
| DC cable sizes 4–25 mm², AC 16–120 mm² | `PlantSetupModal.tsx:646-650, 739-745` |
| Zoom clamp 0.1–10, step ×1.1 | `Canvas.tsx:2399-2400` |
| PDF raster scale 2, page 1 only | `LoadLayoutModal.tsx:145-147` |
| Mapbox fallback centre Johannesburg, zoom 18, style satellite-v9 | `:83-92` |
| pdf.js worker URL cdnjs 4.4.168 | `:21` |
| A0 7016×4961, A3 1190.55×841.89 pt, REV001 | `a0Export.ts:65-70`, `pdfExport.ts:197-202` |
| Placement minimum spacing 0.05 m | `PlacementOptionsModal.tsx:96` |
| 3D fallback scale 0.01 m/px, grid 100 m | `ThreeDViewer.tsx:343, 266-274` |

---

## 7. Data model

### 7.1 Tables
**`public.pv_layouts`** (`supabase/migrations/20251213073801_…sql:2-16` + later adds)
| Column | Type | Written by | Read by |
|---|---|---|---|
| `id` | uuid PK | — | all |
| `project_id` | uuid FK→projects ON DELETE CASCADE | save/create | all queries |
| `name` | text NOT NULL default 'Default Layout'; **UNIQUE(project_id, name)** | save/create/rename | browser, editor |
| `scale_pixels_per_meter` | numeric | save (`1/r`) | load |
| `pv_config` | jsonb default `{panelWidth, panelHeight, orientation, tiltAngle:10, rowSpacing:0.5, panelWattage}` | save writes `{width,length,wattage}` (different keys) | **never read** (D-08) |
| `roof_masks` | jsonb `RoofMask[]` | save | load |
| `pv_arrays` | jsonb `PVArrayItem[]` | save | load; tab status & proposals (non-empty check) |
| `equipment` | jsonb `EquipmentItem[]` | save | load |
| `cables` | jsonb `SupplyLine[]` (elevations injected on save) | save | load |
| `pdf_data` | **text: PNG data URL of the whole background** | save (every autosave) | load |
| `plant_setup` | jsonb `PlantSetupConfig` incl. `placedWalkways`, `placedCableTrays` (20260129114931) | save | load |
| `simulation_id` | uuid FK→project_simulations ON DELETE SET NULL, indexed (20260129133900) | save | load |
| `folder_id` | uuid FK→pv_layout_folders ON DELETE SET NULL (20260128120247) | browser move | browser |
| `created_at`, `updated_at` (trigger) | timestamptz | — | browser (sort, date) |

**`public.pv_layout_folders`**: `id, project_id (CASCADE), name, color default '#3b82f6',
sort_order, created_at, updated_at`.

**RLS (both tables):** `FOR SELECT USING (true)`, `FOR INSERT WITH CHECK (true)`,
`FOR UPDATE USING (true)`, `FOR DELETE USING (true)` with no `TO` role — i.e. **public/anon
included** (`…073801…sql:22-25`, `…120247…sql:20-38`). The 2026-03-18 organisation migrations
re-gated `projects` but not these tables (D-43).

Also read: `projects.latitude, longitude`; `project_simulations.id, name, solar_capacity_kwp,
created_at, results_json` (+ battery/savings/roi on load of the assigned sim).
`supabase/functions/replicate-to-external/index.ts:30` lists `pv_layouts` for replication.

### 7.2 JSON shapes (from `types.ts`)
```ts
Point        = { x: number; y: number }                       // image pixels
RoofMask     = { id: `roof-${Date.now()}`; points: Point[]; pitch: deg; direction: deg /*0=N cw*/; area?: m² }
PVArrayItem  = { id: `array-${Date.now()}` | `array-${ts}-${i}`; position: Point /*centre*/;
                 rows; columns; orientation: 'portrait'|'landscape'; rotation: deg;
                 roofMaskId?: string; minSpacing?: m; moduleConfigId?: string /*unused*/; elevation?: m /*never set*/ }
EquipmentItem= { id: `eq-${Date.now()}`; type: 'Inverter'|'DC Combiner Box'|'AC Disconnect'|'Main Board'|'Sub Board';
                 position: Point; rotation: deg; name?: string; configId?: string /*inverters*/; elevation?: m /*never set*/ }
SupplyLine   = { id: `line-${Date.now()}`; name; type: 'dc'|'ac'; points: Point[]; length: m /*at draw time*/;
                 from?: string; to?: string;   // equipment id | "<arrayId>_module_<i>" | tray id | "<cableId>_node_<i>"
                 thickness?: mm²; configId?: string; material?: 'copper'|'aluminum'; elevations?: m[] }
PlacedWalkway  = { id; configId; name; width: m; length: m; position: Point; rotation: deg; minSpacing?; elevation? }
PlacedCableTray= PlacedWalkway & { cableType?: 'ac'|'dc' /*only via right-click; new trays have none → never snap*/ }
PlantSetupConfig = { solarModules: {id,name,width,length,wattage,isDefault?}[];
                     inverters: {id,name,acCapacity kW,count,width?,height?,isDefault?}[];
                     walkways: {id,name,width,length}[]; cableTrays: {id,name,width,length}[];
                     dcCables/acCables: {id,name,diameter mm²,material,isDefault?}[];
                     placedWalkways?; placedCableTrays? }
```
Simulation-derived template ids are fixed strings `'sim-module'`, `'sim-inverter'`.
IDs are `Date.now()`-based — two items created in the same millisecond (e.g. rapid clicks during
multi-commit) can collide; batch paste appends an index.

**Not persisted:** layer/subgroup/item visibility, view state, selection, scale line, last
array settings, selected template ids, `scaleInfo.pixelDistance/realDistance`.

### 7.3 Load / save semantics (important for migration)
* Load (`FloorPlanMarkup.tsx:513-644`): templates come from the **assigned simulation** if
  linked (overwriting saved `solarModules`/`inverters`), else from `plant_setup`.
  **`pvPanelConfig` (the module actually used for drawing and kWp) is *not* restored from the
  layout** — it stays whatever `latestSimulation` (or the default preset) set on mount, unless the
  layout has a linked simulation (D-08).
* Save (`:874-942`): full-row upsert of every column including `pdf_data`, every time.
* Tray `cableType` defaults to undefined → new trays are not cable snap targets until the user
  right-clicks and sets AC/DC (`geometry.ts:1243`) (D-28b).

---

## 8. How the layout feeds simulation and proposals

* **Simulation → Layout (one-way):** module dims/Wp from `results_json.inverterConfig
  .selectedModuleId` (preset via `getModulePresetById`) or `.customModule`; inverter template
  `"<inverterSize>kW Inverter"`, `acCapacity = inverterSize`, `count = inverterCount`
  (`FloorPlanMarkup.tsx:778-839, 971-1040, 535-590, 2900-2940`). Targets for the summary cards:
  `results_json.moduleCount`, `results_json.inverterCount` (written by
  `projects/simulation/useAutoSave.ts:117-144`).
* **Layout → Simulation: nothing.** Placed kWp, module count, per-roof tilt/azimuth, cable
  lengths are never written to `project_simulations` or read by the simulation engine. The
  simulation's own kWp/orientation remain independent inputs; the layout only *displays* the
  mismatch.
* **Proposals:** only test `pv_arrays` non-empty on the single `maybeSingle()` row, then embed
  `<FloorPlanMarkup readOnly />`, which skips the browser and **never calls `loadLayout`** →
  renders "Load a layout to begin" with zero totals (D-04). With ≥2 layouts `maybeSingle()`
  errors, so the System Design page simply disappears (D-05). No layout image, kWp or BOM ever
  reaches a proposal. `latestSimulation` is not passed in proposals, so the default module
  preset is used.

---

## 9. Defects, gaps, performance, security

### 9.1 Defects (numbered for cross-reference)
| # | Sev | Defect | Evidence |
|---|---|---|---|
| D-01 | S1 | A second "New Design" can never be saved: blank layouts are named "New Layout", `UNIQUE(project_id,name)` rejects the insert, autosave errors are swallowed (`silent`), and the editor has no rename. Work is lost on leaving. | `FloorPlanMarkup.tsx:502, 916-937`; migration `…073801…sql:15` |
| D-02 | S1 | Autosave concurrency: guard only blocks *non-silent* saves while one is in flight (`:878`); overlapping silent saves on a new layout race two INSERTs; manual Save during an autosave is silently dropped. | `:874-942` |
| D-03 | S1 | Edits in the last 1.5 s are lost when the tab unmounts (cleanup clears the pending timer, nothing flushes) and ProjectDetail does not flush the layout on tab change. | `:1043-1049`; `ProjectDetail.tsx:722-740` |
| D-04 | S2 | Proposal "System Design" page renders an empty canvas — readOnly mode never loads a layout. | `FloorPlanMarkup.tsx:2579`; `ProposalPreview.tsx:711`; `ProposalPrintView.tsx:311` |
| D-05 | S2 | `maybeSingle()` on a project with ≥2 layouts throws → tab status stuck "pending", proposal design page hidden, store flag false. | `ProjectDetail.tsx:1008-1021`; proposals `:34-50`; `useProjectStore.ts:189-221` |
| D-06 | S1 | Changing the background (new PDF/satellite) keeps all objects and scale in the old pixel space with no warning. | `:2294-2298` |
| D-07 | S2 | Setting the scale does not mark the layout dirty → not auto-saved on its own. | `:2314-2320`, effect gate `:951` |
| D-08 | S1 | Module used for drawing/kWp is not restored from the saved layout (`pv_config` written, never read); reload can change array sizes and kWp; saved `solarModules` are overwritten by simulation-derived ones on load and whenever `latestSimulation` changes. | `:599-635, 778-839, 888` |
| D-09 | S2 | Every mouse-move of a drag and every R-wheel tick is a separate undo step; group drag commits up to 6 per move; unbounded history of full snapshots. | `Canvas.tsx:1816-2091`; `FloorPlanMarkup.tsx:2250-2285` |
| D-10 | S1 | Pitch foreshortening applied across the slope for auto-rotated arrays (see §6.4); portrait/landscape effectively swapped. (b) Snapping aligns on world axes, not array axes. | `geometry.ts:134-192, 284-414` |
| D-11 | S2 | Multi-delete (Delete key with >1 selected) never deletes cables. | `:1107-1154` |
| D-12 | S3 | Back to browser / selecting another design has no unsaved-changes prompt (the modal that had one is unreachable). | `Toolbar.tsx:383-393` |
| D-13 | S1 | No north reference: azimuth assumes image-up = north; satellite capture allows rotation (`dragRotate: true`). | `Canvas.tsx:189-200`; `LoadLayoutModal.tsx:94` |
| D-14 | S2 | Duplicate omits `plant_setup` (all walkways, trays, templates), `simulation_id`, `folder_id`; duplicate loads the copy into editor state while in browser; second duplicate collides on name. | `:661-694`; `LayoutBrowser.tsx:339-347` |
| D-15 | S3 | Stored `mask.area` / `line.length` go stale after rescale or endpoint edit (endpoint edit recomputes; group drag doesn't need to); exports use stale values, summary recomputes → two different totals. | `pdfExport.ts:53, 102`; `SummaryPanel.tsx:576-587` |
| D-16 | S3 | PDF file input not reset; multi-page PDFs silently use page 1. | `LoadLayoutModal.tsx:142-181` |
| D-17 | S3 | Satellite capture ignores known Mapbox metres/pixel (zoom + latitude) and forces manual calibration; captured resolution tied to the 350 px modal. | `:183-262, 346-350` |
| D-18 | S2 | Elevation feature is dead: PVArrayModal and ObjectConfigModal collect elevation, nothing writes it; `from`/`to` of module/cable-node snaps never match an object id; so `elevations` are never produced and the "3D" cable length never appears. | `PVArrayModal.tsx:163-176`; `ObjectConfigModal.tsx:165`; `handleApplyConfig :1917-2011`; `elevation.ts` |
| D-19 | S4 | `PVConfigModal` never opened. | `:336, 2842-2847` |
| D-20 | S2 | `LayoutManagerModal` (search, create-named, unsaved warning) unreachable — toolbar never renders `onOpenLayoutManager`. | `Toolbar.tsx:172, 237` |
| D-21 | S2 | DC cables snapped to a module store `from/to = "<arrayId>_module_<i>"`; string resolution looks for an array id, falls back to 1 m / radius proximity. Cables routed via trays are never counted as strings. | `geometry.ts:1228-1235`; `SummaryPanel.tsx:462-522` |
| D-22 | S1 | String panel counts double-count arrays with >1 cable; per-inverter DC/AC is therefore unreliable. | `SummaryPanel.tsx:1696-1714` |
| D-23 | S1 | No containment/overlap validation: arrays may overhang roofs, overlap each other or walkways; batch paste ignores masks. | `Canvas.tsx:1609-1621, 1675-1716` |
| D-24 | S2 | Negative rows/columns accepted in PVArrayModal and ObjectConfigModal → negative panel counts/kWp. | `PVArrayModal.tsx:64-65`; `ObjectConfigModal.tsx:263, 274` |
| D-25 | S3 | Copying a roof mask discards the copied pitch (reset to 15 on completion). | `FloorPlanMarkup.tsx:2324, 2446-2451` |
| D-26 | S3 | Module and inverter selectors (toolbar ⚙, right-click template for arrays) have no effect; inverters always get the default template; all arrays use the single global module. | `Toolbar.tsx:606-644`; `Canvas.tsx:1741-1755`; `:1993-2006` |
| D-27 | S3 | Right-click template change on a landscape-placed walkway/tray yields width = length = template width. | `:1940-1974`, `:2723-2738` |
| D-28 | S2 | DC combiners and AC disconnects are not cable snap targets (so a real string→combiner→inverter path can't be connected); (b) new cable trays have no `cableType` and never snap until set by right-click. | `geometry.ts:1206-1221, 1243` |
| D-29 | S4 | `SUB_BOARD` type exists (drawn, listed, in 3D) but cannot be placed; copy of Sub Board silently does nothing. | `types.ts:67`; `:1215-1228` |
| D-30 | S3 | Three inconsistent equipment size tables (draw/hit vs snap/align vs 3D); inverter drawn from the *default* template for all inverters. | `constants.ts:12-18`; `geometry.ts:425-431`; `ThreeDViewer.tsx:47-53`; `drawing.ts:148-155` |
| D-31 | S4 | "Press R to rotate" hint wrong (needs R-hold + wheel); no PV array rotate button. | `Toolbar.tsx:853-855` |
| D-32 | S3 | Cable endpoints that sit on equipment or modules cannot be grabbed: endpoint-handle hit test runs *after* array/walkway/tray/equipment hit tests. | `Canvas.tsx:1095-1205` vs `:1208-1243` |
| D-33 | S4 | Right-click on mixed selection uses the first type but reports all ids as the count; right-click requires a prior selection. | `Canvas.tsx:2424-2495` |
| D-34 | S3 | No vertex editing for roof masks or intermediate cable vertices; roof masks and cables can't be dragged individually (only in a group). | `Canvas.tsx:1265-1281` |
| D-35 | S4 | Double-click finish adds duplicate trailing vertices. | `:1489-1591, 2379-2395` |
| D-36 | S4 | Compass label no wrap-around (350° → "NW"). | `constants.ts:37-46` |
| D-37 | S4 | Cabling "toggle all" inverts each thickness individually. | `SummaryPanel.tsx:1259-1265, 1454-1459` |
| D-38 | S3 | Moving equipment does not move attached cable endpoints; `from/to` ids go stale on delete. | — (no linkage code exists) |
| D-39 | S4 | 3D *Reset View* dead (ref not attached). | `ThreeDViewer.tsx:342-349` |
| D-40 | S3 | 3D roof masks rotated about world origin; camera not framed on content. | `:69-74, 353-355` |
| D-41 | S3 | Overlay canvas ignores devicePixelRatio (blurry on HiDPI). | `Canvas.tsx:367-368` |
| D-42 | S4 | React `onWheel` is passive → `preventDefault` ineffective; page may scroll while zooming. | `:2397-2398` |
| D-43 | S1 | See §9.4 RLS. | migrations |
| D-44 | S1 | See §9.4 XSS. | `a0Export.ts:470-478`, `pngExport.ts:292-300` |
| D-45 | S4 | `getCableTraySnapPoints` (unused) assumes length on local X while everything else uses local Y. | `geometry.ts:1038-1073` |
| D-46 | S4 | Dead code: `useMultiSelection`, `exportProductionPNG`, `downloadCanvasAsPNG`, `getObjectCenterDistance`, `isPointNear`, `getCableTraySnapPoints`; unused import `getModulePresetById` in SummaryPanel; `fabric` dependency unused. | grep counts |
| D-47 | S3 | Legend colours in PDF/A0 don't match the canvas; PDF `projectName` gets the layout name; scale bar never drawn. | §5.8 |
| D-48 | S4 | `[DEBUG]` `console.log`s left in the right-click path. | `:1752, 1761, 1833-1843` |

### 9.2 Functional gaps versus what the brief expects of a PV layout tool
| Expected capability | Status in WM Solar |
|---|---|
| Load plan/roof image or PDF | PDF page 1 only; no PNG/JPG/DWG upload; satellite via Mapbox |
| Scale calibration | Yes, single line, one scale per layout |
| Roof areas | Yes (polygon, pitch, direction); no vertex edit |
| Obstructions / keep-out zones | **Absent** |
| Setbacks / edge zones / fire paths | **Absent** (walkways are free rectangles that don't remove modules) |
| Module auto-fill / packing | **Absent** — manual rectangles only |
| Orientation / tilt / azimuth per array | Derived from mask (pitch, direction); no tilt racking on flat roofs; azimuth assumes north-up |
| Row spacing / inter-row shading | **Absent** (no sun-angle/ground-coverage calc; `pv_config.rowSpacing` in DB default unused) |
| Strings / MPPT | Only "string = DC cable" heuristic; no electrical sizing |
| Walkways, cable trays | Yes (rectangles) |
| Inverters / DBs | Inverter, Main Board, DC Combiner, AC Disconnect; Sub Board unplaceable |
| Cable routes & lengths | Yes (2D polylines, snapping); no rise/drop that works, no sizing, not linked to a cable schedule |
| kWp totals | Yes (count × Wp) |
| BOM / quantity export | **Absent** (legend counts only) |
| Export | A3 PDF (weak), raster "layered" SVG, A0 PNG |
| Feeds simulation | **No** |
| Feeds proposal | **No** (blank embed) |
| Multi-user / roles / versioning | None; any row editable by anyone |
| Touch / tablet | None |

### 9.3 Performance
* **`pdf_data` base64 PNG in a TEXT column, re-uploaded on every autosave** (every change,
  debounced 1.5 s). A 2× raster of an A1 sheet is several–tens of MB. Also replicated by
  `replicate-to-external`. Also loaded on every `select('*')` (load, duplicate).
* Full overlay redraw on every mouse-move (`mouseWorldPos` is state and an effect dependency,
  `Canvas.tsx:928`); every module is a separate `strokeRect`; during cable drawing
  `snapCablePointToTarget` rebuilds one target per module of every array per event
  (`geometry.ts:1224-1237`) and hit tests call `isPointInPolygon` over all masks per array.
* History snapshots unbounded; one per mouse-move during drags.
* SimulationSelector downloads every simulation's full `results_json` to show three numbers.
* A0 export allocates ~35 MP + a full-res offscreen per viewport and a giant data-URL string.
* Global keydown/wheel listeners re-bound on almost every state change (large dependency
  arrays, `FloorPlanMarkup.tsx:2211, 2292`).

### 9.4 Security
* **RLS wide open (S1):** `pv_layouts` and `pv_layout_folders` allow SELECT/INSERT/UPDATE/DELETE
  to anyone holding the public anon key, across all organisations — including client drawings
  and site imagery in `pdf_data`. No org or project-membership predicate.
* **Stored XSS (S1):** `downloadA0PNG` writes `<title>${filename}</title>` via
  `newWindow.document.write` where `filename` = layout name (`FloorPlanMarkup.tsx:2568`,
  `a0Export.ts:470-478`). A layout renamed to include `</title><script>…` executes in an
  `about:blank` window that inherits the app's origin when another user exports A0 — combined
  with the open RLS, any anon-key holder can plant it. (Same pattern in the dead
  `downloadCanvasAsPNG`.)
* `get-mapbox-token` runs with `verify_jwt = false` and returns the token to anyone; acceptable
  only if the token is URL-restricted in Mapbox.
* Removing Mapbox logo/attribution before capture (`LoadLayoutModal.tsx:210-224`) is a
  licensing risk for images reused in client deliverables.
* pdf.js worker loaded from a third-party CDN at runtime.

---

## 10. Reuse and overlap with E-Site (for the paid "Solar" add-on)

E-Site already has most of the infrastructure this module hand-rolls. Mapping:

| WM Solar piece | E-Site equivalent | Recommendation |
|---|---|---|
| Background = PDF page 1 @ `scale: 2` rasterised in the browser, stored as base64 in `pdf_data` | `floor_plans` rows + storage + Dropbox sync; `apps/web/src/lib/sheet/use-sheet-image` rasterises with pdf.js at the **same fixed `scale: 2`** with a page cache and signed URL | Reference `floor_plans.id` + `page_index` + `file_path`/`source_revision_id` anchor (the `00205` markup pattern). **Image space is compatible** (both use scale 2 of the same page), so coordinates could be migrated 1:1 if the same PDF page is used. Never store rasters in rows. Multi-page for free. |
| Satellite capture via Mapbox + html2canvas | none | Keep as an optional background source, but store as a file in storage and **derive scale from Mapbox (Mapbox GL, 512 px tiles: `78271.517·cos(lat)/2^zoom` m per CSS px, divided by the html2canvas `scale` of 2)** and lock bearing=0/pitch=0 or record bearing as a north offset. Keep attribution. |
| Single `scale_pixels_per_meter` | `calibrateFloorPlanAction` (role-gated) + `tenants.floor_plan_page_scales` per page + `floor_plans.calibration_points/_metres/_page_index` | Reuse directly; stop storing a private scale. Store `pixels_per_meter` on each solar object/segment at measure time like `route_segments`. |
| Hand-written Canvas 2D viewport, no touch, no DPR | `use-sheet-viewport` (zoom/pan/fit/wheel/pinch/middle-drag/space-drag; pure maths in `viewport-math.ts`) | Reuse — fixes D-41, D-42 and touch (§4.4). |
| Hand-written hit-testing/selection/drag/rotate | Konva `MarkupCanvas` (shapes, transformer, selection) | Build solar layers as Konva layers (like `RouteLayer`): roof polygons, array groups, equipment symbols. Use a Transformer for rotation instead of R+wheel. |
| Undo/redo snapshots per mouse-move | `lib/cable-route/route-history.ts` snapshot history + ⌘Z/⇧⌘Z | Reuse; commit on drag *end* only (fixes D-09). |
| 1.5 s autosave of the whole row | `lib/sheet/draft-store` (IndexedDB drafts) + explicit saves with `expectedUpdatedAt` stale-write refusal | Reuse: drafts locally, server writes per object/layer, conflict-safe (fixes D-01…D-03). |
| DC/AC cable polylines with snapping and lengths | Cable route tracing (`RouteCanvas`, `supply_routes`, `route_segments`, rise/drop in `AssignRoutePanel`, export sheet, `cable_schedule` supplies) | Do **not** rebuild cables in the solar module: model inverter→main board AC runs as `cable_schedule` supplies traced with the existing tool; DC strings either as a new supply class or a solar-specific route type sharing the same segment storage. Port the good parts of WM snapping (typed targets, Tab cycling, tray centreline projection). Rise/drop replaces the dead elevation feature. |
| Main Board / Sub Board free symbols | `structure.nodes` boards | Link placed boards to existing nodes instead of free-floating items. |
| Vector markup persistence | `tenants.floor_plan_markups` (vectors, file anchor, revision warning) | Store solar layout as a vector layer in a new table with the same anchor fields; **add it to `isAnnotated()`** (the schema-derived contract test will demand it) so cloud-sync won't swap the drawing under it. |
| PDF/PNG/SVG exports | Route-sheet export → versioned PDF in `projects.reports` (+ appendix into schedule packs) | New report kind (e.g. `solar_layout_sheet`), legend computed server-side, scale bar + north arrow; WinAnsi-safe strings (`lib/pdf/winansi.ts`) — `²`, `°` are safe, `Ω`/`≤` are not. Drop A0 `document.write`. |
| Open RLS | RESTRICTIVE write gates (`ORG_WRITE_ROLES`), `user_has_project_access` reads, verb-split policies, `@verify` blocks | Mandatory; plus a per-project paid-add-on entitlement gate (DB + route). |
| `latestSimulation` one-way sync | (Solar simulation will be a separate part of the add-on) | Make the layout the **source** of module count, kWp, per-array tilt/azimuth and strings for the simulation, with an explicit "push to simulation" and mismatch display. |

What is **genuinely new** (not in E-Site) and worth specifying fresh rather than porting:
array placement & packing (auto-fill with setbacks, obstructions, row pitch from sun angle),
per-array tilt/azimuth with a north reference, module-type per array, string/MPPT design with
Voc/Vmp temperature checks, BOM, and a real vector export. The WM implementation of the
parts that exist should be treated as a **behavioural reference only**, given D-08, D-10, D-22,
D-23.

---

## 11. Open questions a rebuild must answer (nothing here is decided by the code)
1. North reference: per sheet north arrow input, or per Mapbox bearing?
2. Is pitch foreshortening wanted at all on plan drawings (top-down), and along which axis
   (D-10)? Should arrays on flat roofs be tilted on racking with row spacing?
3. One module type per layout (as built) or per array (as the unused `moduleConfigId` implies)?
4. String definition: electrical strings (series modules) vs "a DC cable"?
5. Should layout results overwrite simulation inputs, or only be compared?
6. Multiple layouts per project: which one is "the" design for proposals/status (today:
   undefined — `maybeSingle` fails)?
7. Keep satellite capture (Mapbox licence, attribution) or use drawings only?
8. Which exports are contractual deliverables (A3 PDF with title block? DWG/DXF?)?
