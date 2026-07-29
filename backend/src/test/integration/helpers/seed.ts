import { Types } from "mongoose";
import {
  ChargeModel,
  DishModel,
  IDish,
  IIngredient,
  IngredientModel,
  ISupplier,
  IUser,
  SaleModel,
  SupplierModel
} from "../../../models";

// Fabriques deterministes ecrivant directement en base, scopees sur un owner.

export async function seedSupplier(owner: IUser, overrides: Record<string, unknown> = {}): Promise<ISupplier> {
  return SupplierModel.create({
    name: "Fournisseur Test",
    email: "supplier@test.local",
    contactName: "Contact Test",
    productTypes: ["Epicerie seche"],
    deliveryLeadTimeDays: 2,
    deliveryFee: 10,
    minimumOrderAmount: 0,
    active: true,
    owner: owner._id,
    ...overrides
  });
}

export async function seedIngredient(owner: IUser, overrides: Record<string, unknown> = {}): Promise<IIngredient> {
  return IngredientModel.create({
    name: "Farine",
    category: "Epicerie seche",
    unit: "kg",
    orderUnit: "kg",
    purchasePrice: 2,
    stockQuantity: 10,
    minimumStock: 2,
    averageDailyUsage: 1,
    minimumOrderQuantity: 1,
    active: true,
    owner: owner._id,
    ...overrides
  });
}

export async function seedDish(owner: IUser, ingredient: IIngredient, overrides: Record<string, unknown> = {}): Promise<IDish> {
  return DishModel.create({
    name: "Plat Test",
    category: "Plat",
    ingredients: [{ ingredient: ingredient._id as Types.ObjectId, quantity: 0.5, unit: "kg" }],
    targetMarginRate: 0.5,
    actualPriceIncludingTax: 0,
    estimatedDailyServings: 10,
    active: true,
    owner: owner._id,
    ...overrides
  });
}

export async function seedCharge(owner: IUser, overrides: Record<string, unknown> = {}) {
  return ChargeModel.create({
    name: "Loyer",
    category: "rent",
    amount: 900,
    period: "monthly",
    active: true,
    owner: owner._id,
    ...overrides
  });
}

export async function seedSale(
  owner: IUser,
  dish: IDish,
  options: { serviceDate?: Date; quantity?: number; unitPrice?: number } = {}
) {
  const quantity = options.quantity ?? 1;
  const unitPrice = options.unitPrice ?? 10;
  return SaleModel.create({
    serviceDate: options.serviceDate ?? new Date(),
    items: [{ dish: dish._id as Types.ObjectId, quantity, unitPrice }],
    totalAmount: Math.round(quantity * unitPrice * 100) / 100,
    owner: owner._id
  });
}
