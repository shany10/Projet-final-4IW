// Environnement de test pose AVANT tout import de module applicatif : de
// nombreux modules (jwt, crypto, rateLimit, userRouter, bootstrap) lisent
// process.env au chargement. Ne jamais reprendre les valeurs de .env ici.

process.env.JWT_SECRET = "test-secret";
process.env.TOTP_ENCRYPTION_KEY = "test-totp-key";

// Neutralise le rate limiter singleton (20 req/IP par defaut) pour les suites
// d'integration ; le test dedie au 429 recharge le module avec sa propre valeur.
process.env.AUTH_RATE_LIMIT_MAX = "100000";
process.env.AUTH_RATE_LIMIT_WINDOW_MS = "900000";

// Aucune config SMTP : sendAppEmail reste en mode "log" et ne leve jamais.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("SMTP_") || key.startsWith("MAIL_")) {
    delete process.env[key];
  }
}
