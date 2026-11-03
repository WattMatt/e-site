import { expect, it } from 'vitest'
import { decodeAccessTokenClaims } from './jwt'

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')

it('decodes aal and client_id from the payload', () => {
  const tok = `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', aal: 'aal1', client_id: 'c9' })}.sig`
  expect(decodeAccessTokenClaims(tok)).toMatchObject({ sub: 'u1', aal: 'aal1', client_id: 'c9' })
})

it('returns null for a malformed token', () => {
  expect(decodeAccessTokenClaims('not.a.jwt.at.all')).toBeNull()
  expect(decodeAccessTokenClaims('')).toBeNull()
})
