// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createMeterImportRepo, MAX_METER_FILE_BYTES } from './repo'

function client(overrides: Record<string, unknown> = {}) {
  const rpc = vi.fn(async () => ({ data: 3, error: null }))
  const head = { count: 17520, error: null }
  const from = vi.fn(() => ({
    select: () => ({ eq: () => Promise.resolve(head) }),
  }))
  const download = vi.fn(async () => ({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null }))
  return {
    schema: vi.fn(() => ({ rpc, from })),
    storage: { from: vi.fn(() => ({ download })) },
    rpc, from, download,
    ...overrides,
  }
}

describe('createMeterImportRepo', () => {
  it('writeReadings calls solar.write_readings with parallel arrays', async () => {
    const c = client()
    const repo = createMeterImportRepo(c as never)
    const n = await repo.writeReadings('ch1', { ts: ['2025-03-09T22:30:00.000Z'], value: [1.5], quality: [0] })
    expect(n).toBe(3)
    expect(c.schema).toHaveBeenCalledWith('solar')
    expect(c.rpc).toHaveBeenCalledWith('write_readings', { p_channel_id: 'ch1', p_ts_end: ['2025-03-09T22:30:00.000Z'], p_value: [1.5], p_quality: [0] })
  })
  it('countReadings uses an exact head count', async () => {
    expect(await createMeterImportRepo(client() as never).countReadings('ch1')).toBe(17520)
  })
  it('downloadRaw returns bytes and refuses anything over 50 MB', async () => {
    const c = client()
    expect([...(await createMeterImportRepo(c as never).downloadRaw('o/p/x.csv'))!]).toEqual([1, 2, 3])
    const big = client()
    big.download.mockResolvedValue({ data: { size: MAX_METER_FILE_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Blob, error: null })
    await expect(createMeterImportRepo(big as never).downloadRaw('o/p/x.csv')).rejects.toThrow(/50 MB/)
  })
  it('downloadRaw returns null when the object is missing', async () => {
    const c = client()
    c.download.mockResolvedValue({ data: null, error: { message: 'Object not found' } } as never)
    expect(await createMeterImportRepo(c as never).downloadRaw('o/p/x.csv')).toBeNull()
  })
})
