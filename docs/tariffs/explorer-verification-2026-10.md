# Tariff explorer — source verification (2026-10-05)

Three published 2026/27 tariffs, every energy rate compared between the **live database** and its **cited source**. The source files were read from the private `tariff-sources` bucket and their SHA-256 re-computed before reading.

## Eskom Megaflex > 1 MVA (Me01N) — `Eskom-tariffs-1-April-2026-Public.xlsm`, sheet *Megaflex NLA*, row 8

SHA-256 `aeebe852…79737ad` (matches `tariffs.source_document`).

| Season | Period | Database (c/kWh excl. VAT) | Cell | Cell value | Incl. VAT cell |
|---|---|---|---|---|---|
| High | Peak | 739.28 | J8 | 739.28 | K8 850.17 |
| High | Standard | 184.82 | L8 | 184.82 | M8 212.54 |
| High | Off-peak | 123.20 | N8 | 123.2 | O8 141.68 |
| Low | Peak | 306.82 | P8 | 306.82 | Q8 352.84 |
| Low | Standard | 172.50 | R8 | 172.5 | S8 198.38 |
| Low | Off-peak | 123.20 | T8 | 123.2 | U8 141.68 |

## Eskom Homeflex 1 (HF101N) — same workbook, sheet *Homeflex NLA*, row 11

| Season | Period | Database | Cell | Cell value | Incl. VAT cell |
|---|---|---|---|---|---|
| High | Peak | 736.61 | E11 | 736.61 | F11 847.10 |
| High | Standard | 225.38 | G11 | 225.38 | H11 259.19 |
| High | Off-peak | 165.94 | I11 | 165.94 | J11 190.83 |
| Low | Peak | 343.09 | K11 | 343.09 | L11 394.55 |
| Low | Standard | 213.49 | M11 | 213.49 | N11 245.51 |
| Low | Off-peak | 165.94 | O11 | 165.94 | P11 190.83 |

## Inkosi Langalibalele — Time-of-Use Consumer: Low Voltage Customers — NERSA RfD 2026/27, page 22, *Recommended Tariff* column

SHA-256 `aa33406b…114eb305`.

| Charge | Database | Page 22 (Recommended) |
|---|---|---|
| Basic charge | R2,941.7115/month | 2941,7115 |
| Demand charge | R297.6660/kVA | 297,6660 |
| Summer peak | R2.9483/kWh | 2,9483 |
| Summer standard | R2.1327/kWh | 2,1327 |
| Summer off-peak | R1.1866/kWh | 1,1866 |
| Winter peak | R6.2693/kWh | 6,2693 |
| Winter standard | R3.2527/kWh | 3,2527 |
| Winter off-peak | R1.8502/kWh | 1,8502 |

**Result: 20 of 20 values match their source exactly.** The same values, copied from the sources, are pinned through the explorer's view model in `packages/shared/src/tariffs/explorer/known-tariffs.test.ts`.

## TOU hours

Eskom's 2026/27 hours (Schedule of standard prices, Figure 2, p56) are not printed as text: the figure is a set of coloured 24-hour wheels. They were read by sampling the colour of every hour on all four wheels (2025/26 and 2026/27, schedule and booklet) at 300 dpi; all four agree. Holidays: schedule p12. Raw extraction: `docs/tariffs/eskom-tou-2026-27.json`.

## Noted while verifying

- **Midvaal 2026/27 has a published tariff named "Based on the available information and the analysis performed, the REC decided:"** — a sentence of NERSA prose taken for a tariff name. It needs a look in the review queue (rename or delete in a new draft year).
- The explorer shows R/month and R/kVA charges to the cent (R2,941.71) while some RfDs publish four decimals; the stored value keeps all four.
