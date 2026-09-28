import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ parse: vi.fn() }))
vi.mock('@/lib/solar/load/import-client', async (orig) => ({ ...(await orig<object>()), parseFiles: h.parse }))
import { CloudImportDialog } from './CloudImportDialog'

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
beforeEach(() => { vi.restoreAllMocks(); h.parse.mockResolvedValue({ reviews: [{ fileId: 'f1' }], failed: [] }) })

describe('CloudImportDialog', () => {
  it('lists the mapped folder, imports the ticked files and hands their reviews over', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ rootFolderId: 'root', rootPath: '/Meters', items: [{ id: 'd', name: 'Sub', type: 'folder' }, { id: 'a', name: 'a.csv', type: 'file', size: 10 }] }))
      .mockResolvedValueOnce(json({ results: [{ name: 'a.csv', fileId: 'f1', duplicate: false }] }))
    const onReviews = vi.fn()
    render(<CloudImportDialog projectId="p1" onReviews={onReviews} onClose={vi.fn()} />)
    await userEvent.click(await screen.findByLabelText('a.csv'))
    await userEvent.click(screen.getByRole('button', { name: 'Import 1 file' }))
    expect(fetchMock.mock.calls[1][0]).toBe('/api/projects/p1/solar/cloud-files/import')
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({ items: [{ id: 'a', name: 'a.csv' }] })
    expect(h.parse).toHaveBeenCalledWith('p1', ['f1'])
    expect(onReviews).toHaveBeenCalledWith([{ fileId: 'f1' }])
  })
  it('sends the folder trail from the mapped root when browsing and importing from a sub-folder', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ rootFolderId: 'root', rootPath: '/Meters', items: [{ id: 'd', name: 'Sub', type: 'folder' }] }))
      .mockResolvedValueOnce(json({ rootFolderId: 'root', rootPath: '/Meters', items: [{ id: 's', name: 's.csv', type: 'file', size: 10 }] }))
      .mockResolvedValueOnce(json({ results: [{ name: 's.csv', fileId: 'f1', duplicate: false }] }))
    render(<CloudImportDialog projectId="p1" onReviews={vi.fn()} onClose={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: /Sub/ }))
    await userEvent.click(await screen.findByLabelText('s.csv'))
    expect(fetchMock.mock.calls[1][0]).toBe('/api/projects/p1/solar/cloud-files?trail=d')
    await userEvent.click(screen.getByRole('button', { name: 'Import 1 file' }))
    expect(JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body))).toEqual({ items: [{ id: 's', name: 's.csv', trail: ['d'] }] })
  })
  it('a folder outside the mapped root reads as a sentence', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ error: 'outside_mapped_folder', message: "That folder is outside this project's mapped cloud folder." }, 403))
    render(<CloudImportDialog projectId="p1" onReviews={vi.fn()} onClose={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toContain("outside this project's mapped cloud folder")
  })
  it('says so when the project has no mapped folder', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ error: 'no_mapping' }, 404))
    render(<CloudImportDialog projectId="p1" onReviews={vi.fn()} onClose={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toContain('no cloud folder mapped')
  })
})
