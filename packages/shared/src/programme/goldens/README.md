# Programme engine golden fixtures

Each `*.json` file in this folder is either one fixture or an array of fixtures. A fixture is:

```ts
{
  name: string
  source: 'hand' | 'msp' | 'p6'
  notes: string
  input: ProgrammeInput
  expected: Record<activityId, { es, ef, ls, lf, tf }>   // dates as displayed 'YYYY-MM-DD', tf a number
}
```

`goldens.test.ts` runs `scheduleProgramme(input)` on every fixture and requires each listed activity's
`earlyStart`, `earlyFinish`, `lateStart`, `lateFinish` and `totalFloat` to match exactly.

**Real files.** The owner's real MS Project and P6 programmes are added here as `msp-*.json` and `p6-*.json`
by P4's importers, with the dates and floats the source tool printed as `expected`. The engine is not switched
on for users until every one of them passes.

**Hand fixtures.** Every expected value below was worked by hand from the rules in the global constraints,
BEFORE the engine was run against the fixture. If the engine and the working disagree, neither is edited to
match the other until the wrong one is found.

## Notation

Calendar `C` works Monday to Friday; there are no holidays in March–April 2026. The project starts Monday
2026-03-02. A *position* `p` counts whole working days from the project start:

- a start at position `p` is the start of working day `p + 1`;
- a finish at position `p` is the end of working day `p` (the boundary after it).

So a task with early start `ES` and duration `d` has `EF = ES + d`, and shows `WD(ES + 1)` .. `WD(EF)`.

| WD | date | WD | date | WD | date |
|---|---|---|---|---|---|
| 1 | Mon 03-02 | 7 | Tue 03-10 | 13 | Wed 03-18 |
| 2 | Tue 03-03 | 8 | Wed 03-11 | 14 | Thu 03-19 |
| 3 | Wed 03-04 | 9 | Thu 03-12 | 15 | Fri 03-20 |
| 4 | Thu 03-05 | 10 | Fri 03-13 | 16 | Mon 03-23 |
| 5 | Fri 03-06 | 11 | Mon 03-16 | 17 | Tue 03-24 |
| 6 | Mon 03-09 | 12 | Tue 03-17 | 18 | Wed 03-25 |

Link rules in positions (lag `L` in working days; on a uniform calendar the engine's `addWork` is plain
addition):

| link | forward (successor) | backward (predecessor) |
|---|---|---|
| FS L | `ES ≥ pred.EF + L` | `LF ≤ succ.LS − L` |
| SS L | `ES ≥ pred.ES + L` | `LS ≤ succ.LS − L`, so `LF ≤ succ.LS − L + d` |
| FF L | `EF ≥ pred.EF + L`, so `ES ≥ pred.EF + L − d` | `LF ≤ succ.LF − L` |
| SF L | `EF ≥ pred.ES + L`, so `ES ≥ pred.ES + L − d` | `LS ≤ succ.LF − L`, so `LF ≤ succ.LF − L + d` |

Every start is also `≥ 0` (project start). Every `LF ≤` the project finish (ruling 4b). `LS = LF − d`.
`TF = min(LS − ES, LF − EF)`, which is `LF − EF` for a task on this calendar.

## `hand-textbook-cpm.json`

Ten activities, all four link types, a positive and a negative lag, diverging logic out of A and E, converging
logic into E, G, H, I and M, and a `finish_milestone` M at the end.

| id | d | predecessors |
|---|---|---|
| A | 3 | — |
| B | 4 | A FS +2 |
| C | 2 | A SS +1 |
| D | 5 | C FS −1 |
| E | 3 | B FS 0, D FF +2 |
| F | 6 | D SS +3 |
| G | 4 | F FS 0, E SS +1 |
| H | 2 | E SF +5, C FS 0 |
| I | 3 | H FF 0, G FS −2 |
| M | 0 (finish_milestone) | I FS 0, G FS 0, H FS 0 |

### Forward pass

- **A:** no predecessors, `ES = 0`, `EF = 3`. Shows 03-02 .. 03-04.
- **C:** SS +1 from A: `ES ≥ 0 + 1 = 1`. `ES = 1`, `EF = 3`. Shows 03-03 .. 03-04.
- **B:** FS +2 from A: `ES ≥ 3 + 2 = 5`. `ES = 5`, `EF = 9`. Shows 03-09 .. 03-12.
- **D:** FS −1 from C: `ES ≥ 3 − 1 = 2`. `ES = 2`, `EF = 7`. Shows 03-04 .. 03-10.
- **E:** FS 0 from B: `ES ≥ 9`. FF +2 from D: `EF ≥ 7 + 2 = 9`, so `ES ≥ 6`. `ES = 9`, `EF = 12`.
  Shows 03-13 .. 03-17.
- **F:** SS +3 from D: `ES ≥ 2 + 3 = 5`. `ES = 5`, `EF = 11`. Shows 03-09 .. 03-16.
- **G:** FS 0 from F: `ES ≥ 11`. SS +1 from E: `ES ≥ 9 + 1 = 10`. `ES = 11`, `EF = 15`. Shows 03-17 .. 03-20.
- **H:** SF +5 from E: `EF ≥ 9 + 5 = 14`, so `ES ≥ 12`. FS 0 from C: `ES ≥ 3`. `ES = 12`, `EF = 14`.
  Shows 03-18 .. 03-19.
- **I:** FF 0 from H: `EF ≥ 14`, so `ES ≥ 11`. FS −2 from G: `ES ≥ 15 − 2 = 13`. `ES = 13`, `EF = 16`.
  Shows 03-19 .. 03-23.
- **M:** finish-type demands I FS 0 → `16`, G FS 0 → `15`, H FS 0 → `14`; the start-type project start is `0`.
  The largest is `16`, a finish moment (ruling 3), shown as the finish day WD16 = 03-23.

Project finish = 16 (end of Mon 03-23).

### Backward pass (reverse order)

- **M:** limit = project finish 16, kind finish (set by the finish moment of M itself). `LS = LF = 16`, shows
  03-23. `TF = 0`.
- **I:** FS 0 to M: `LF ≤ 16`. Project finish 16. `LF = 16`, `LS = 13`. Shows 03-19 .. 03-23. `TF = 0`.
- **H:** FF 0 to I: `LF ≤ 16`. FS 0 to M: `LF ≤ 16`. `LF = 16`, `LS = 14`. Shows 03-20 .. 03-23.
  `TF = 16 − 14 = 2`.
- **G:** FS −2 to I: `LF ≤ 13 + 2 = 15`. FS 0 to M: `LF ≤ 16`. `LF = 15`, `LS = 11`. Shows 03-17 .. 03-20.
  `TF = 0`.
- **F:** FS 0 to G: `LF ≤ 11`. `LF = 11`, `LS = 5`. Shows 03-09 .. 03-16. `TF = 0`.
- **E:** SS +1 to G: `LS ≤ 11 − 1 = 10`, so `LF ≤ 13`. SF +5 to H: `LS ≤ 16 − 5 = 11`, so `LF ≤ 14`.
  `LF = 13`, `LS = 10`. Shows 03-16 .. 03-18. `TF = 13 − 12 = 1`.
- **D:** FF +2 to E: `LF ≤ 13 − 2 = 11`. SS +3 to F: `LS ≤ 5 − 3 = 2`, so `LF ≤ 7`. `LF = 7`, `LS = 2`.
  Shows 03-04 .. 03-10. `TF = 0`.
- **C:** FS −1 to D: `LF ≤ 2 + 1 = 3`. FS 0 to H: `LF ≤ 14`. `LF = 3`, `LS = 1`. Shows 03-03 .. 03-04. `TF = 0`.
- **B:** FS 0 to E: `LF ≤ 10`. `LF = 10`, `LS = 6`. Shows 03-10 .. 03-13. `TF = 10 − 9 = 1`.
- **A:** FS +2 to B: `LF ≤ 6 − 2 = 4`. SS +1 to C: `LS ≤ 1 − 1 = 0`, so `LF ≤ 3`. `LF = 3`, `LS = 0`.
  Shows 03-02 .. 03-04. `TF = 0`.

Critical path (TF 0): A → C → D → F → G → I → M, through SS +1, FS −1, SS +3, FS 0, FS −2 and FS 0.

## `hand-progress-retained.json`

The Task 6 out-of-sequence case, once per progress mode (the file holds two fixtures). Calendar `C`, project
start Mon 03-02, data date Mon 03-09 (position 5).

- A, 5 days, not started.
- B, 5 days, actual start Tue 03-03 (position 1), remaining duration 2, not finished.
- A FS 0 B. B started before A finished: out of sequence.

### Retained logic

Forward:
- **A:** not started, so `ES ≥` data date 5. `ES = 5`, `EF = 10`. Shows 03-09 .. 03-13.
- **B:** in progress, `ES` = actual start 1 (shows 03-03). The remaining 2 days resume at the later of the data
  date 5 and the FS demand `A.EF = 10`: resume = 10, `EF = 12`. Shows 03-03 .. 03-17.

Project finish = 12.

Backward:
- **B:** started, so `LS` = actual start (03-03). `LF ≤` project finish 12. `LF = 12`, shows 03-17.
  In progress: TF is finish float, `12 − 12 = 0`.
- **A:** retained logic keeps A ahead of the remaining part of B. B's remaining part may resume no later than
  `B.LF − remaining = 12 − 2 = 10`, so FS 0 gives `LF ≤ 10`. `LF = 10`, `LS = 5`. Shows 03-09 .. 03-13.
  `TF = 0`.

  The FS limit must use where B's REMAINING work starts late, not B's late start: B's late start is pinned to
  its actual start in the past (03-03), and A cannot be required to finish before a day that has already gone.

### Progress override

Forward:
- **A:** `ES = 5`, `EF = 10`. Shows 03-09 .. 03-13.
- **B:** `ES = 1` (03-03). Logic is overridden: the remaining 2 days resume at the data date 5. `EF = 7`.
  Shows 03-03 .. 03-10.

Project finish = 10 (A).

Backward:
- **B:** `LS` = actual start (03-03). `LF ≤` project finish 10, shows 03-13. TF (finish) `= 10 − 7 = 3`.
- **A:** progress override means the link A → B no longer constrains B's remaining work, so it does not
  constrain A either. `LF ≤` project finish 10. `LF = 10`, `LS = 5`. Shows 03-09 .. 03-13. `TF = 0`.
