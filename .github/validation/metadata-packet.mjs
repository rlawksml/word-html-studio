// Fixed two-file transfer protocol. Never accept an arbitrary export pathname.
import assert from "node:assert/strict";
import { METADATA_LIMITS, sha256 } from "./metadata-policy.mjs";
import { readStableFile } from "./metadata-file-io.mjs";

export const EXPORT_PACKET_LIMIT = 3 * 1024 * 1024;
const FILES = Object.freeze({ package: "package.json", lock: "package-lock.json" });
const KEYS = ["protocol", "nonce", "kind", "bytes", "sha256", "base64"];
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
export function kindForAction(action) {
  assert.ok(["export-package", "export-lock"].includes(action));
  return action === "export-package" ? "package" : "lock";
}
export function readManifestFile(directory, kind) {
  assert.ok(["/input", "/toolchain"].includes(directory) && Object.hasOwn(FILES, kind));
  return readStableFile(`${directory}/${FILES[kind]}`, METADATA_LIMITS[kind]);
}
export function encodePacket(bytes, kind, nonce) {
  assert.ok(Object.hasOwn(FILES, kind) && typeof nonce === "string" && /^[a-f0-9]{32}$/.test(nonce) && nonce.length === 32);
  assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= METADATA_LIMITS[kind]);
  return `${JSON.stringify({ protocol: "metadata-export-v1", nonce, kind, bytes: bytes.length,
    sha256: sha256(bytes), base64: bytes.toString("base64") })}\n`;
}
export function decodePacket(payload, kind, nonce) {
  assert.ok(Buffer.isBuffer(payload) && payload.length > 0 && payload.length <= EXPORT_PACKET_LIMIT);
  assert.ok(Object.hasOwn(FILES, kind) && typeof nonce === "string" && nonce.length === 32 && /^[a-f0-9]{32}$/.test(nonce));
  const text = decoder.decode(payload), packet = JSON.parse(text);
  assert.ok(packet && typeof packet === "object" && !Array.isArray(packet));
  assert.deepEqual(Object.keys(packet), KEYS);
  assert.equal(text, `${JSON.stringify(packet)}\n`); // also rejects duplicate keys/noncanonical encodings
  assert.equal(packet.protocol, "metadata-export-v1");
  assert.equal(packet.nonce, nonce);
  assert.equal(packet.kind, kind);
  assert.ok(Number.isSafeInteger(packet.bytes) && packet.bytes > 0 && packet.bytes <= METADATA_LIMITS[kind]);
  assert.ok(typeof packet.sha256 === "string" && packet.sha256.length === 64 && /^[a-f0-9]{64}$/.test(packet.sha256));
  assert.ok(typeof packet.base64 === "string" && packet.base64.length % 4 === 0
    && /^[A-Za-z0-9+/]*={0,2}$/.test(packet.base64));
  const bytes = Buffer.from(packet.base64, "base64");
  assert.equal(bytes.toString("base64"), packet.base64);
  assert.equal(bytes.length, packet.bytes);
  assert.equal(sha256(bytes), packet.sha256);
  decoder.decode(bytes); // fatal UTF-8 before parsing as JSON elsewhere
  return bytes;
}
