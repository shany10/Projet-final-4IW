import { UserModel } from "../../../models";
import { signAccessToken } from "../../../utils/jwt";

type Role = "admin" | "manager" | "employee" | "supplier";

type AccountOptions = {
  role?: Role;
  active?: boolean;
  password?: string;
  email?: string;
  firstname?: string;
};

let accountCounter = 0;

// Cree un compte directement en base (hook argon2 reel) et forge le token
// correspondant. Le role est lu depuis le JWT par les middlewares.
export async function createAccount(options: AccountOptions = {}) {
  accountCounter += 1;
  const role = options.role ?? "manager";
  const user = await UserModel.create({
    firstname: options.firstname ?? "Test",
    lastname: "User",
    email: options.email ?? `user-${accountCounter}-${Date.now()}@test.local`,
    password: options.password ?? "Password123!",
    role,
    active: options.active ?? true,
    authProvider: "local"
  });

  const token = signAccessToken({ sub: String(user._id), role });
  return { user, token };
}

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
