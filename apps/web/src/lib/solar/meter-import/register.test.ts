// apps/web/src/lib/solar/meter-import/register.test.ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { createFakeRepo } from './fake-repo'
import { registerStoredRawFile } from './register'

const ORG = '0f8fad5b-d9cb-469f-a165-70867728950e'
const P = '9c1a98b5-6ef3-4388-865f-417d3f5d7465'
const P2 = '11111111-1111-4111-8111-111111111111'
const bytes = new TextEncoder().encode('sep=,\r\n\r\ndate,p14\r\n10/03/2025 00:00:00,1\r\n')
const sha = createHash('sha256').update(bytes).digest('hex')

describe('registerStoredRawFile', () => {
  it('registers once (201), then reports the duplicate (200)', async () => {
    const f = createFakeRepo({ orgByProject: { [P]: ORG } })
    const path = `${ORG}/${P}/${sha}.csv`
    const a = await registerStoredRawFile(f.repo, { projectId: P, orgId: ORG, storagePath: path, originalName: 'a.csv', bytes, sha })
    expect(a.status).toBe(201)
    const b = await registerStoredRawFile(f.repo, { projectId: P, orgId: ORG, storagePath: path, originalName: 'a.csv', bytes, sha })
    expect(b).toMatchObject({ status: 200, body: { duplicate: true } })
  })
  it('409 with the meters when the same bytes came through another project', async () => {
    const f = createFakeRepo({ orgByProject: { [P]: ORG, [P2]: ORG } })
    await registerStoredRawFile(f.repo, { projectId: P2, orgId: ORG, storagePath: `${ORG}/${P2}/${sha}.csv`, originalName: 'a.csv', bytes, sha })
    const r = await registerStoredRawFile(f.repo, { projectId: P, orgId: ORG, storagePath: `${ORG}/${P}/${sha}.csv`, originalName: 'a.csv', bytes, sha })
    expect(r).toMatchObject({ status: 409, body: { error: 'duplicate_in_other_project' } })
  })
})
