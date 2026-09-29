'use client'
/** Two-step inline confirm (spec §0.4 rule 1): first press arms, second commits, 3 s auto-disarm. */
import { useCallback, useEffect, useRef, useState } from 'react'

export function useArmedConfirm(ms = 3000) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])
  const disarm = useCallback(() => { clear(); setArmed(false) }, [clear])
  const arm = useCallback(() => {
    clear()
    setArmed(true)
    timer.current = setTimeout(() => { timer.current = null; setArmed(false) }, ms)
  }, [clear, ms])

  useEffect(() => clear, [clear])
  return { armed, arm, disarm }
}
