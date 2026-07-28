import { Router } from "express";

const debugRouter = Router();

// Route de test pour valider la remontee d'erreurs vers GlitchTip (projet
// backend). Volontairement bloquee en production : lever une erreur a la
// demande serait un vecteur de bruit / DoS en prod.
debugRouter.get("/error", (req, res): void => {
  // Actif hors production, ou en production si ENABLE_DEBUG_ROUTES=true
  // (utile pour demontrer la capture d'erreurs sur l'environnement de prod).
  const enabled = process.env.NODE_ENV !== "production" || process.env.ENABLE_DEBUG_ROUTES === "true";
  if (!enabled) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  throw new Error("Sentry test — backend Express (Eat Planner /debug/error)");
});

export { debugRouter };
