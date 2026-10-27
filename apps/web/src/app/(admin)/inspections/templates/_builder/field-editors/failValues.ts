// Keeps a dropdown / multi-select field's `fail_values` in step with its options: the schema
// refuses a fail value that is not an option, so a rename or removal must carry it along.

export function renameOption(failValues: string[] | undefined, from: string, to: string): string[] | undefined {
  if (!failValues?.includes(from)) return failValues;
  const next = failValues.map((v) => (v === from ? to : v)).filter((v) => v.trim() !== '');
  return next.length > 0 ? next : undefined;
}

export function dropOption(failValues: string[] | undefined, option: string): string[] | undefined {
  const next = (failValues ?? []).filter((v) => v !== option);
  return next.length > 0 ? next : undefined;
}

export function toggleFailValue(failValues: string[] | undefined, option: string, fails: boolean): string[] | undefined {
  const rest = (failValues ?? []).filter((v) => v !== option);
  const next = fails ? [...rest, option] : rest;
  return next.length > 0 ? next : undefined;
}
