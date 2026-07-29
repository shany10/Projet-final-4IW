import { addDays, startOfDay, subDays } from "../../../services/serviceUtils";

// Assertions en heure locale (getHours/getDate) pour rester robustes quel que
// soit le fuseau de la machine qui execute la suite.

describe("startOfDay", () => {
  it("resets hours, minutes, seconds and milliseconds to local midnight", () => {
    const result = startOfDay(new Date(2026, 6, 15, 13, 45, 30, 500));

    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(6);
    expect(result.getDate()).toBe(15);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });

  it("does not mutate its argument and returns a new instance", () => {
    const input = new Date(2026, 6, 15, 13, 45, 30, 500);

    const result = startOfDay(input);

    expect(result).not.toBe(input);
    expect(input.getHours()).toBe(13);
  });
});

describe("addDays", () => {
  it("adds days within the same month", () => {
    const result = addDays(new Date(2026, 6, 10), 5);

    expect(result.getMonth()).toBe(6);
    expect(result.getDate()).toBe(15);
  });

  it("rolls over to the next month", () => {
    const result = addDays(new Date(2026, 0, 31), 1);

    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(1);
  });

  it("rolls over to the next year", () => {
    const result = addDays(new Date(2026, 11, 31), 1);

    expect(result.getFullYear()).toBe(2027);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(1);
  });

  it("handles leap years", () => {
    const result = addDays(new Date(2024, 1, 28), 1);

    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(29);
  });

  it("accepts negative day counts", () => {
    const result = addDays(new Date(2026, 2, 1), -1);

    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(28);
  });

  it("preserves the local wall-clock time across a DST transition night", () => {
    // En Europe/Paris le passage a l'heure d'ete a lieu le 29 mars 2026 ;
    // setDate conserve l'heure locale, ce test le documente.
    const result = addDays(new Date(2026, 2, 28, 12, 30), 1);

    expect(result.getMonth()).toBe(2);
    expect(result.getDate()).toBe(29);
    expect(result.getHours()).toBe(12);
    expect(result.getMinutes()).toBe(30);
  });

  it("does not mutate its argument", () => {
    const input = new Date(2026, 6, 10);

    addDays(input, 5);

    expect(input.getDate()).toBe(10);
  });
});

describe("subDays", () => {
  it("subtracts days across a month boundary", () => {
    const result = subDays(new Date(2026, 2, 1), 1);

    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(28);
  });

  it("is symmetric with addDays", () => {
    const input = new Date(2026, 6, 15, 9, 0);

    const roundTrip = subDays(addDays(input, 10), 10);

    expect(roundTrip.getFullYear()).toBe(input.getFullYear());
    expect(roundTrip.getMonth()).toBe(input.getMonth());
    expect(roundTrip.getDate()).toBe(input.getDate());
    expect(roundTrip.getHours()).toBe(input.getHours());
  });

  it("does not mutate its argument", () => {
    const input = new Date(2026, 6, 15);

    subDays(input, 3);

    expect(input.getDate()).toBe(15);
  });
});
