// Suivi d'événements Umami côté navigateur.
//
// Umami injecte `window.umami` quand le script de tracking est chargé
// (NUXT_PUBLIC_UMAMI_SRC + NUXT_PUBLIC_UMAMI_WEBSITE_ID configurés). Il est
// absent en SSR, en dev sans analytics, ou si un bloqueur coupe le script :
// on no-op silencieusement pour ne jamais casser un flux applicatif.

type UmamiTracker = {
  track: (eventName: string, eventData?: Record<string, unknown>) => void
}

declare global {
  interface Window {
    umami?: UmamiTracker
  }
}

// --- Origine du trafic (attribution des campagnes) -------------------------
// On memorise l'origine du premier chargement de la session (first-touch) pour
// l'attacher a tous les evenements du tunnel : Umami rattache ainsi une
// conversion (checkout_success) a la campagne pub qui l'a amenee.
const TRAFFIC_SOURCE_KEY = 'ep:traffic-source'
const TRAFFIC_SOURCE_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'ref'] as const

type TrafficSource = Partial<Record<(typeof TRAFFIC_SOURCE_PARAMS)[number], string>>

export function captureTrafficSource(search = typeof window !== 'undefined' ? window.location.search : '') {
  if (typeof window === 'undefined') {
    return
  }

  const params = new URLSearchParams(search)
  const source: TrafficSource = {}
  for (const key of TRAFFIC_SOURCE_PARAMS) {
    const value = params.get(key)?.trim()
    if (value) {
      source[key] = value
    }
  }

  // Rien a memoriser (trafic direct), ou origine deja captee : on ne l'ecrase
  // pas avec une navigation interne qui aurait perdu les parametres.
  if (Object.keys(source).length === 0) {
    return
  }

  try {
    if (!window.sessionStorage.getItem(TRAFFIC_SOURCE_KEY)) {
      window.sessionStorage.setItem(TRAFFIC_SOURCE_KEY, JSON.stringify(source))
    }
  } catch {
    // sessionStorage indisponible (navigation privee stricte) : on ignore.
  }
}

function getTrafficSource(): TrafficSource {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const raw = window.sessionStorage.getItem(TRAFFIC_SOURCE_KEY)
    return raw ? (JSON.parse(raw) as TrafficSource) : {}
  } catch {
    return {}
  }
}

export function trackEvent(name: string, data?: Record<string, unknown>) {
  if (typeof window === 'undefined' || !window.umami) {
    return
  }

  // Les proprietes explicites de l'appelant priment sur l'origine du trafic.
  const payload = { ...getTrafficSource(), ...data }

  try {
    window.umami.track(name, Object.keys(payload).length > 0 ? payload : undefined)
  } catch {
    // Analytics best-effort : une erreur de tracking ne doit rien interrompre.
  }
}
