// Route de test pour valider la remontee d'erreurs vers GlitchTip (projet
// frontend, cote serveur Nuxt/Nitro via SENTRY_SERVER_DSN). Bloquee hors dev.
export default defineEventHandler(() => {
  // Actif en dev, ou en prod si ENABLE_DEBUG_ROUTES=true (démo capture d'erreurs).
  const enabled = import.meta.dev || process.env.ENABLE_DEBUG_ROUTES === 'true'
  if (!enabled) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  throw new Error('Sentry test — serveur Nuxt/Nitro (Eat Planner /api/debug/error)')
})
