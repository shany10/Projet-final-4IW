import { Request, Response } from "express";

// Mocks minimaux pour tester les middlewares Express sans serveur HTTP.

export type MockResponse = Response & { statusCode: number; body: unknown };

export function makeRes(): MockResponse {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    }
  };
  return res as unknown as MockResponse;
}

export function makeReq(overrides: Record<string, unknown> = {}): Request {
  return { headers: {}, params: {}, ...overrides } as unknown as Request;
}
