import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PhotoSourcePicker, addPhotos } from './PhotoSourcePicker'

const photo = (name: string, size = 10) => new File(['x'.repeat(size)], name, { type: 'image/jpeg', lastModified: 1 })

describe('PhotoSourcePicker', () => {
  it('offers the camera (one shot) and the library (multi-select) as separate controls', () => {
    render(<PhotoSourcePicker onFiles={() => {}} />)
    const take = screen.getByLabelText(/Take photo/) as HTMLInputElement
    const choose = screen.getByLabelText(/Choose photos/) as HTMLInputElement
    expect(take.getAttribute('capture')).toBe('environment')
    expect(take.multiple).toBe(false)
    expect(choose.getAttribute('capture')).toBeNull()
    expect(choose.multiple).toBe(true)
  })

  it('hands picked files to the caller and clears the input so the same photo can be picked again', () => {
    const onFiles = vi.fn()
    render(<PhotoSourcePicker onFiles={onFiles} />)
    const take = screen.getByLabelText(/Take photo/) as HTMLInputElement
    const f = photo('a.jpg')
    Object.defineProperty(take, 'files', { value: [f], configurable: true })
    fireEvent.change(take)
    expect(onFiles).toHaveBeenCalledWith([f])
  })

  it('does not call back when the picker was cancelled', () => {
    const onFiles = vi.fn()
    render(<PhotoSourcePicker onFiles={onFiles} />)
    const choose = screen.getByLabelText(/Choose photos/) as HTMLInputElement
    Object.defineProperty(choose, 'files', { value: [], configurable: true })
    fireEvent.change(choose)
    expect(onFiles).not.toHaveBeenCalled()
  })
})

describe('addPhotos', () => {
  it('adds to the list (a second camera shot must not replace the first) and skips exact repeats', () => {
    const a = photo('a.jpg'), b = photo('b.jpg')
    expect(addPhotos([a], [b]).map(f => f.name)).toEqual(['a.jpg', 'b.jpg'])
    expect(addPhotos([a, b], [photo('a.jpg')]).map(f => f.name)).toEqual(['a.jpg', 'b.jpg'])
  })
})
