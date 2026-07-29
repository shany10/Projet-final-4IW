import { Types } from "mongoose";
import { buildAccountScope, getOwnerPatch } from "../../../services/accountScopeService";
import { makeUser } from "../helpers/fixtures";

describe("buildAccountScope", () => {
  it("scopes an empty filter to the owner", () => {
    const user = makeUser();

    expect(buildAccountScope(user)).toEqual({
      $and: [{}, { owner: user._id }]
    });
  });

  it("preserves a simple filter alongside the owner scope", () => {
    const user = makeUser();

    expect(buildAccountScope(user, { active: true })).toEqual({
      $and: [{ active: true }, { owner: user._id }]
    });
  });

  it("keeps an $or filter confined so the owner scope always applies", () => {
    const user = makeUser();
    const filter = { $or: [{ name: "a" }, { name: "b" }] };

    expect(buildAccountScope(user, filter)).toEqual({
      $and: [{ $or: [{ name: "a" }, { name: "b" }] }, { owner: user._id }]
    });
  });

  it("still enforces the real owner when the filter tries to inject another owner", () => {
    const user = makeUser();
    const attackerId = new Types.ObjectId();

    const scope = buildAccountScope(user, { owner: attackerId });

    // Les deux conditions se cumulent dans le $and : un client ne peut pas
    // elargir le scope en fournissant son propre filtre owner.
    expect(scope).toEqual({
      $and: [{ owner: attackerId }, { owner: user._id }]
    });
  });
});

describe("getOwnerPatch", () => {
  it("returns a patch pointing to the user id", () => {
    const user = makeUser();

    const patch = getOwnerPatch(user);

    expect(patch).toEqual({ owner: user._id });
    expect(patch.owner).toBe(user._id);
  });
});
