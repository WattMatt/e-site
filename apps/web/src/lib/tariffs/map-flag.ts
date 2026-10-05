/**
 * The area-of-supply map ships OFF. The MDB boundary licence allows use "in
 * value-added products such as applications" with credit, but also forbids
 * appropriating the data "for commercial use"; whether a paid product's map
 * is that is the owner's call (docs/tariffs/mdb-boundaries-source.json).
 * Set TARIFF_MAP_ENABLED=1 in Vercel to turn it on.
 */
export function tariffMapEnabled(): boolean {
  return process.env.TARIFF_MAP_ENABLED === '1'
}
