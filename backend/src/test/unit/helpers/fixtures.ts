import { Types } from "mongoose";
import { ICharge, IDish, IDishIngredientLine, IIngredient, IUser } from "../../../models";
import { BusinessUnit, ChargePeriod } from "../../../types/business";

// Les fonctions testees prennent des interfaces Mongoose mais ne touchent
// jamais la base : des objets minimaux castes suffisent.

type IngredientOverrides = {
  _id?: Types.ObjectId;
  name?: string;
  unit?: BusinessUnit;
  purchasePrice?: number;
};

export function makeIngredient(overrides: IngredientOverrides = {}): IIngredient {
  return {
    _id: new Types.ObjectId(),
    name: "Ingredient",
    unit: "kg",
    purchasePrice: 10,
    ...overrides
  } as unknown as IIngredient;
}

type DishOverrides = {
  _id?: Types.ObjectId;
  name?: string;
  category?: string;
  estimatedDailyServings?: number;
  targetMarginRate?: number | null;
  actualPriceIncludingTax?: number;
  ingredients?: IDishIngredientLine[];
};

export function makeDish(overrides: DishOverrides = {}): IDish {
  return {
    _id: new Types.ObjectId(),
    name: "Plat test",
    category: "Plat",
    estimatedDailyServings: 10,
    targetMarginRate: null,
    actualPriceIncludingTax: 0,
    ingredients: [],
    ...overrides
  } as unknown as IDish;
}

export function makeDishLine(
  ingredient: IIngredient,
  quantity: number,
  unit: BusinessUnit
): IDishIngredientLine {
  return { ingredient: ingredient._id as Types.ObjectId, quantity, unit };
}

export function makeCharge(period: ChargePeriod, amount: number): ICharge {
  return { period, amount } as unknown as ICharge;
}

export function makeUser(): IUser {
  return { _id: new Types.ObjectId() } as unknown as IUser;
}

export function makeIngredientMap(...ingredients: IIngredient[]): Map<string, IIngredient> {
  return new Map(ingredients.map((ingredient) => [String(ingredient._id), ingredient]));
}
