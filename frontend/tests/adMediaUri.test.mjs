import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAdMediaUri } from "../src/utils/adMediaUri.ts";

test("web picker blob URLs are retained when a browser File is available", () => {
  const uri = "blob:http://localhost:8081/2e45502d";
  assert.equal(normalizeAdMediaUri(uri, true, true), uri);
});

test("web uploads reject assets without a browser File", () => {
  assert.throws(
    () => normalizeAdMediaUri("blob:http://localhost:8081/2e45502d", true, false),
    /browser did not provide the selected file/,
  );
});

test("native file and content URIs remain supported", () => {
  assert.equal(normalizeAdMediaUri("file:///cache/ad.jpg", false, false), "file:///cache/ad.jpg");
  assert.equal(normalizeAdMediaUri("content://media/ad.mp4", false, false), "content://media/ad.mp4");
});

test("native absolute file paths are normalized and remote URIs are rejected", () => {
  assert.equal(normalizeAdMediaUri("/cache/ad.jpg", false, false), "file:///cache/ad.jpg");
  assert.throws(
    () => normalizeAdMediaUri("https://example.com/ad.jpg", false, false),
    /file location is not supported/,
  );
});
