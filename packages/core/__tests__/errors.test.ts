import { describe, expect, it } from "vitest";
import { BeezpingAuthError, BeezpingError, BeezpingNetworkError, BeezpingValidationError } from "../src/errors.js";
import { StoreLimitError, StoreNotFoundError } from "../src/types.js";
import { errorFromResponse, isCommentGone, isThreadFull } from "../src/wire.js";

describe("BeezpingError (base)", () => {
  it("constructs with explicit code and retryable flag", () => {
    const err = new BeezpingError("boom", "CUSTOM", true);
    expect(err.message).toBe("boom");
    expect(err.code).toBe("CUSTOM");
    expect(err.retryable).toBe(true);
    expect(err.name).toBe("BeezpingError");
  });

  it("is an Error subclass — instanceof Error", () => {
    const err = new BeezpingError("x", "X", false);
    expect(err).toBeInstanceOf(Error);
  });

  it("retryable can be explicitly false", () => {
    const err = new BeezpingError("nope", "NOPE", false);
    expect(err.retryable).toBe(false);
  });
});

describe("BeezpingNetworkError", () => {
  it("has code NETWORK and is retryable", () => {
    const err = new BeezpingNetworkError("connection refused");
    expect(err.code).toBe("NETWORK");
    expect(err.retryable).toBe(true);
    expect(err.name).toBe("BeezpingNetworkError");
  });

  it("is instanceof BeezpingError", () => {
    const err = new BeezpingNetworkError("x");
    expect(err).toBeInstanceOf(BeezpingError);
  });

  it("preserves the message", () => {
    const err = new BeezpingNetworkError("timed out after 10s");
    expect(err.message).toBe("timed out after 10s");
  });
});

describe("BeezpingValidationError", () => {
  it("has code VALIDATION and is not retryable", () => {
    const err = new BeezpingValidationError("bad shape");
    expect(err.code).toBe("VALIDATION");
    expect(err.retryable).toBe(false);
    expect(err.name).toBe("BeezpingValidationError");
  });

  it("is instanceof BeezpingError", () => {
    const err = new BeezpingValidationError("x");
    expect(err).toBeInstanceOf(BeezpingError);
  });

  it("carries the HTTP status a response gave it", async () => {
    const err = await errorFromResponse(new Response("{}", { status: 409 }), "Failed");
    expect(err).toBeInstanceOf(BeezpingValidationError);
    expect((err as BeezpingValidationError).status).toBe(409);
    expect(new BeezpingValidationError("x").status).toBeUndefined();
  });
});

describe("thread failures", () => {
  it("tells a full thread from another failure, whether a store or an endpoint refused", async () => {
    expect(isThreadFull(new StoreLimitError())).toBe(true);
    expect(isThreadFull(await errorFromResponse(new Response("", { status: 409 }), "Failed"))).toBe(true);
    expect(isThreadFull(await errorFromResponse(new Response("", { status: 400 }), "Failed"))).toBe(false);
    expect(isThreadFull(new Error("offline"))).toBe(false);
  });

  it("tells a reply already gone from another failure, whether a store or an endpoint answered", async () => {
    expect(isCommentGone(new StoreNotFoundError())).toBe(true);
    expect(isCommentGone(await errorFromResponse(new Response("", { status: 404 }), "Failed"))).toBe(true);
    expect(isCommentGone(await errorFromResponse(new Response("", { status: 403 }), "Failed"))).toBe(false);
    expect(isCommentGone(new Error("offline"))).toBe(false);
  });

  it("reads the status of a custom source's own errors", () => {
    expect(isCommentGone(Object.assign(new Error("gone"), { status: 404 }))).toBe(true);
    expect(isThreadFull(Object.assign(new Error("full"), { status: 409 }))).toBe(true);
    expect(isThreadFull(Object.assign(new Error("teapot"), { status: 418 }))).toBe(false);
  });

  it("reads a store error's code, as another bundle's copy of core throws it", () => {
    expect(isThreadFull(Object.assign(new Error("full"), { code: "STORE_LIMIT" }))).toBe(true);
    expect(isCommentGone(Object.assign(new Error("gone"), { code: "STORE_NOT_FOUND" }))).toBe(true);
    expect(isCommentGone(Object.assign(new Error("full"), { code: "STORE_LIMIT" }))).toBe(false);
    expect(isThreadFull(Object.assign(new Error("gone"), { code: "STORE_NOT_FOUND" }))).toBe(false);
  });

  it("reads anything thrown, a primitive, null or undefined included", () => {
    for (const thrown of [null, undefined, 404, "409", Symbol("x")]) {
      expect(isThreadFull(thrown)).toBe(false);
      expect(isCommentGone(thrown)).toBe(false);
    }
  });
});

describe("BeezpingAuthError", () => {
  it("has code AUTH and is not retryable", () => {
    const err = new BeezpingAuthError("401", 401);
    expect(err.code).toBe("AUTH");
    expect(err.retryable).toBe(false);
    expect(err.name).toBe("BeezpingAuthError");
  });

  it("is instanceof BeezpingError", () => {
    const err = new BeezpingAuthError("x", 403);
    expect(err).toBeInstanceOf(BeezpingError);
  });

  it("is distinguishable from BeezpingValidationError despite both not retryable", () => {
    const auth = new BeezpingAuthError("401", 401);
    const validation = new BeezpingValidationError("400");
    expect(auth).toBeInstanceOf(BeezpingAuthError);
    expect(auth).not.toBeInstanceOf(BeezpingValidationError);
    expect(validation).toBeInstanceOf(BeezpingValidationError);
    expect(validation).not.toBeInstanceOf(BeezpingAuthError);
  });
});
