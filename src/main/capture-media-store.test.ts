import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CaptureMediaStore,
  captureMediaFileName
} from "./capture-media-store";

const stores: CaptureMediaStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.cleanup();
});

describe("CaptureMediaStore", () => {
  it("stores screenshots behind an opaque preview URL with image metadata", () => {
    const root = mkdtempSync(path.join(tmpdir(), "android-dev-capture-"));
    const store = new CaptureMediaStore(root);
    stores.push(store);
    store.reset();

    const bytes = Buffer.from("png-bytes");
    const media = store.addScreenshot("serial:one", bytes, 1080, 2400, 1_000);
    const entry = store.get(media.id);

    expect(media).toMatchObject({
      kind: "image",
      mimeType: "image/png",
      size: bytes.length,
      width: 1080,
      height: 2400,
      deviceSerial: "serial:one"
    });
    expect(media.url).toBe(`android-dev-capture://media/${media.id}`);
    expect(readFileSync(entry.localPath)).toEqual(bytes);
  });

  it("registers a completed video and preserves its readable save name", () => {
    const root = mkdtempSync(path.join(tmpdir(), "android-dev-capture-"));
    const store = new CaptureMediaStore(root);
    stores.push(store);
    store.reset();

    const localPath = store.createVideoPath("serial-one", 2_000);
    writeFileSync(localPath, Buffer.alloc(32));
    const media = store.addVideo("serial-one", localPath, 2_000);

    expect(media.kind).toBe("video");
    expect(media.mimeType).toBe("video/mp4");
    expect(media.size).toBe(32);
    expect(media.name).toBe(captureMediaFileName("video", "serial-one", 2_000));
    expect(store.get(media.id).localPath).toBe(localPath);
  });
});
