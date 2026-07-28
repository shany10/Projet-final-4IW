import express from "express";
import {
  chargeRouter,
  debugRouter,
  dishRouter,
  forecastRouter,
  ingredientRouter,
  paymentCardRouter,
  purchaseOrderRouter,
  saleRouter,
  supplierRouter,
  userRouter
} from "../../../routes";

// Reconstruit l'app aux memes chemins que index.ts, sans listen(), sans
// connexion DB, sans Sentry/helmet. Pas de handler d'erreur custom : les 500
// (CastError...) s'assertent sur le status seul (corps HTML par defaut).
export function createTestApp() {
  const app = express();
  app.use(express.json());

  app.use("/user", userRouter);
  app.use("/suppliers", supplierRouter);
  app.use("/ingredients", ingredientRouter);
  app.use("/dishes", dishRouter);
  app.use("/charges", chargeRouter);
  app.use("/sales", saleRouter);
  app.use("/forecasts", forecastRouter);
  app.use("/purchase-orders", purchaseOrderRouter);
  app.use("/payment-cards", paymentCardRouter);
  app.use("/debug", debugRouter);

  return app;
}
