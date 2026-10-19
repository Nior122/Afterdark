import { useCallback, useEffect, useState } from 'react'

/**
 * Age verification for the 18+ catalogue.
 *
 * There is no account and no server involved: acceptance is a single flag in
 * localStorage, so a returning visitor is not asked again in the same browser.
 * Clearing site data (or `resetAgeVerification()`) asks again — which is the
 * correct behaviour, since a browser flag is an acknowledgement, not an ID check.
 */

const AGE_KEY = 'afterdark.age.v1'

export function hasAcceptedAge(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(AGE_KEY) === 'yes'
  } catch {
    return false
  }
}

export function storeAgeAcceptance(): void {
  try {
    window.localStorage.setItem(AGE_KEY, 'yes')
  } catch {
    /* storage may be unavailable — the gate still opens for this session */
  }
}

export function resetAgeVerification(): void {
  try {
    window.localStorage.removeItem(AGE_KEY)
  } catch {
    /* ignore */
  }
}

export function useAgeVerification() {
  const [accepted, setAccepted] = useState<boolean>(hasAcceptedAge)

  // If another tab accepts, stop gating this one.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === AGE_KEY) setAccepted(event.newValue === 'yes')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const accept = useCallback(() => {
    storeAgeAcceptance()
    setAccepted(true)
  }, [])

  const decline = useCallback(() => setAccepted(false), [])

  return { accepted, accept, decline }
}
