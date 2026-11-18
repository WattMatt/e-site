'use client'

import { useEffect, useState } from 'react'

/** Must match the 767.98px breakpoint in globals.css (the phone shell). */
export const PHONE_QUERY = 'screen and (max-width: 767.98px)'

/**
 * True on a phone-width viewport, false on the server and on wider screens.
 * The app shell's layout never depends on this — CSS shows and hides the shells;
 * here it stops the hidden phone bar doing network work (project name, Solar
 * access check) on desktop. Exception: the programme screen (P3) uses it to show
 * one pane at a time and to size the grid's phone columns, so its first paint on
 * a phone is the desktop split until this effect runs.
 */
export function usePhoneViewport(): boolean {
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(PHONE_QUERY)
    const update = () => setPhone(mq.matches)
    update()
    mq.addEventListener?.('change', update)
    return () => mq.removeEventListener?.('change', update)
  }, [])
  return phone
}
