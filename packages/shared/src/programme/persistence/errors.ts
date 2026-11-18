/** A refusal with the SQLSTATE `programme.save_changes` would raise (42501 refused, 40001 stale, 22023 bad input, P0002 gone, 23505 duplicate). */
export class ProgrammeOpError extends Error {
  readonly code: '42501' | '40001' | '22023' | 'P0002' | '23505'
  constructor(message: string, code: ProgrammeOpError['code']) {
    super(message)
    this.name = 'ProgrammeOpError'
    this.code = code
  }
}
