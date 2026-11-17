import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  usePathname: () => '/projects/p1/snags',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('./SolarNavItem', () => ({ SolarNavItem: () => null }))
vi.mock('@/lib/mobile/use-projects', () => ({ useProjectName: () => 'Test project' }))
import { MobileProjectBar } from './MobileProjectBar'

describe('MobileProjectBar: Programme chip (dark behind the flag)', () => {
  it('is hidden when programmeEnabled is false or absent', () => {
    const { unmount } = render(<MobileProjectBar mvVisible={false} programmeEnabled={false} />)
    expect(screen.queryByRole('link', { name: 'Programme' })).toBeNull()
    unmount()
    render(<MobileProjectBar mvVisible={false} />)
    expect(screen.queryByRole('link', { name: 'Programme' })).toBeNull()
  })
  it('shows, pointing at the project programme, when programmeEnabled', () => {
    render(<MobileProjectBar mvVisible={false} programmeEnabled />)
    expect(screen.getByRole('link', { name: 'Programme' }).getAttribute('href')).toBe('/projects/p1/programme')
  })
})
