/**
 * Whether an inspection on this template must be verified by someone who did not fill it in.
 *
 * Mirrors inspections.template_requires_separate_verifier() (00250), which the database enforces:
 * the template's own `requires_separate_verifier` flag when it is a boolean, otherwise true for a
 * CoC or factory-test deliverable. The screens use it to explain the rule before anyone hits it.
 */
export function requiresSeparateVerifier(
  deliverableType: string | null | undefined,
  requiresSeparateVerifierFlag?: unknown,
): boolean {
  if (typeof requiresSeparateVerifierFlag === 'boolean') return requiresSeparateVerifierFlag
  return deliverableType === 'coc' || deliverableType === 'factory_test'
}
