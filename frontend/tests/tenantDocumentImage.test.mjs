import assert from "node:assert/strict";
import test from "node:test";
import { tenantDocumentImageUri } from "../src/utils/tenantDocumentImage.ts";

test("web document blobs become revocable browser image URLs", async () => {
  const blob = new Blob(["image-bytes"], { type: "image/png" });
  const uri = await tenantDocumentImageUri(blob, true);
  assert.match(uri, /^blob:/);
  assert.equal(await (await fetch(uri)).text(), "image-bytes");
  URL.revokeObjectURL(uri);
});

test("native document blobs become data URIs for React Native Image", async () => {
  const originalFileReader = globalThis.FileReader;
  globalThis.FileReader = class {
    onload = null;
    onerror = null;
    result = null;

    readAsDataURL(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
        this.onload?.();
      }, () => this.onerror?.());
    }
  };

  try {
    const blob = new Blob(["image-bytes"], { type: "image/png" });
    const uri = await tenantDocumentImageUri(blob, false);
    assert.equal(uri, `data:image/png;base64,${Buffer.from("image-bytes").toString("base64")}`);
  } finally {
    globalThis.FileReader = originalFileReader;
  }
});

test("native document decode errors are surfaced to the UI", async () => {
  const originalFileReader = globalThis.FileReader;
  globalThis.FileReader = class {
    onload = null;
    onerror = null;
    readAsDataURL() {
      this.onerror?.();
    }
  };

  try {
    await assert.rejects(
      tenantDocumentImageUri(new Blob(["image-bytes"], { type: "image/png" }), false),
      /Could not decode the downloaded document/,
    );
  } finally {
    globalThis.FileReader = originalFileReader;
  }
});
