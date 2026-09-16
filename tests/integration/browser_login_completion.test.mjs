import test from "node:test";
import assert from "node:assert/strict";

import { completionSatisfied, storageFingerprint } from "../../scripts/opencode-browser-login.mjs";

const changed = {
  baselineFingerprint: "anonymous-state",
  currentFingerprint: "authenticated-state",
};

test("a completion URL alone cannot finish login without a state change", () => {
  assert.equal(completionSatisfied({
    ...changed,
    currentFingerprint: changed.baselineFingerprint,
    currentUrl: "https://example.com/home",
    completeUrl: "https://example.com/",
    cookie: null,
    cookies: [],
  }), false);

  assert.equal(completionSatisfied({
    ...changed,
    currentUrl: "https://example.com/home",
    completeUrl: "https://example.com/",
    cookie: null,
    cookies: [],
  }), true);
});

test("all supplied login predicates must be satisfied", () => {
  const options = {
    ...changed,
    currentUrl: "https://example.com/home",
    completeUrl: "https://example.com/home",
    cookie: "session",
  };
  assert.equal(completionSatisfied({ ...options, cookies: [] }), false, "URL alone is insufficient when a cookie was requested");
  assert.equal(completionSatisfied({
    ...options,
    cookies: [{ name: "session", value: "approved" }],
  }), true);
});

test("state fingerprints ignore unapproved origins and input ordering", () => {
  const approved = ["https://example.com"];
  const first = storageFingerprint({
    cookies: [
      { name: "b", value: "2", domain: "example.com", path: "/" },
      { name: "foreign", value: "ignored", domain: "other.example", path: "/" },
      { name: "a", value: "1", domain: ".example.com", path: "/" },
    ],
    origins: [
      { origin: "https://other.example", localStorage: [{ name: "foreign", value: "ignored" }] },
      { origin: "https://example.com", localStorage: [{ name: "z", value: "2" }, { name: "a", value: "1" }] },
    ],
  }, approved);
  const reordered = storageFingerprint({
    cookies: [
      { name: "a", value: "1", domain: ".example.com", path: "/" },
      { name: "b", value: "2", domain: "example.com", path: "/" },
    ],
    origins: [
      { origin: "https://example.com", localStorage: [{ name: "a", value: "1" }, { name: "z", value: "2" }] },
    ],
  }, approved);
  assert.equal(first, reordered);
});
