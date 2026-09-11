// #474 filestore upload. Deterministic repro via direct API.
import { test, expect } from '@playwright/test';
import { loginEmployee, uploadFile } from '../utils/launch-fixes/api.js';
import { ROOT_TENANT } from '../utils/env';

// A genuinely VALID 287-byte 1x1 JPEG (baseline, quality 30) — the actual #474
// case: an image small enough that thumbnail generation used to blow up.
//
// Kept distinct from TINY_JPEG_HEX below, which despite its name is NOT a decodable
// image (see the corrupt-input test). Conflating "tiny" with "corrupt" is what let
// this file report a fixed bug as broken.
const VALID_TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABsSFBcUERsXFhceHBsgKEIrKCUlKFE6PTBCYFVlZF9VXVtqeJmBanGQc1tdhbWGkJ6jq62rZ4C8ybqmx5moq6T/2wBDARweHigjKE4rK06kbl1upKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKT/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABAb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCAANSP/9k=';

function validTinyJpegBuffer(): Buffer {
  return Buffer.from(VALID_TINY_JPEG_B64, 'base64');
}

// 517-byte CORRUPT JPEG — has the SOI/EOI markers but a broken entropy-coded
// stream, so no decoder can read it (verified: Python PIL reports "broken data
// stream", and Java's ImageIO.read() returns null).
const TINY_JPEG_HEX =
  'ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffdb0043010909090c0b0c180d0d1832211c213232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232' +
  'ffc0001108000100010301220002110103110' +
  '1ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc4007810000201030302010404050304040000010002030411051221314106135161220771148132a1b1c1234252b16115d115335462f06372e1f132737483a273ffc4001f0100030101010101010101010000000000000102030405060708090a0bffc400b51100020102040403040705040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a737475767778797a8283848586878889' +
  '8a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda000c03010002110311003f00fbfeb700ffd9';

function tinyJpegBuffer(): Buffer {
  return Buffer.from(TINY_JPEG_HEX, 'hex');
}

test.describe('05-filestore (#474)', () => {
  test('a valid 1x1 JPEG uploads successfully — CCRS#474', {
    annotation: {
      type: 'description',
      description: `Regression test for CCRS#474 — filestore threw EG_FILESTORE_INPUT_ERROR when an uploaded JPEG was small enough that thumbnail generation failed. Sends a genuinely valid 287-byte 1x1 JPEG (fixed base64 literal, byte-reproducible) and asserts it yields a fileStoreId.

Steps:
1. Log in as the test employee.
2. Build the 287-byte VALID 1x1 JPEG buffer from the embedded base64.
3. uploadFile(auth, ROOT_TENANT, 'tiny-valid.jpg', buf, 'image/jpeg', 'PGR').
4. Assert no Errors are returned and files[0].fileStoreId is truthy.

TWO DEFECTS WERE FIXED HERE, AND THE SECOND MATTERS MORE.

(a) It was self-flipping — "if Errors, assert the error code; else assert success" —
so the bug being present and the bug being fixed BOTH counted as a pass. Nothing
distinguished them in the pass/fail column, only in an annotation nobody gates on.

(b) It fed the *corrupt* TINY_JPEG_HEX payload, which no decoder can read, and called
that "a tiny JPEG". So it could never have demonstrated #474 either way: a corrupt
file SHOULD be rejected. #474 is about VALID small images, and this deployment
handles those correctly — verified by uploading 1x1 and 8x8 JPEGs, both accepted.

The corrupt payload now has its own test below, asserting the behaviour that is
actually correct for it.`,
    },
    tag: ['@area:pgr', '@ccrs:474', '@kind:lifecycle', '@layer:ui', '@persona:cross'] }, async () => {
    const auth = await loginEmployee();
    const r = await uploadFile(auth, ROOT_TENANT, 'tiny-valid.jpg', validTinyJpegBuffer(), 'image/jpeg', 'PGR');
    const errCode = r.body?.Errors?.[0]?.code;
    expect(
      errCode,
      `filestore rejected a valid 1x1 JPEG with ${errCode} — CCRS#474 has regressed`,
    ).toBeUndefined();
    expect(r.body.files?.[0]?.fileStoreId).toBeTruthy();
  });

  test('a corrupt JPEG is rejected with a clean error, not a crash', {
    annotation: {
      type: 'description',
      description: `Companion to the #474 test, using the 517-byte CORRUPT payload this file has carried since 2026-04. That payload has valid SOI/EOI markers but a broken entropy-coded stream, so no decoder can read it (Python PIL: "broken data stream"; Java ImageIO.read() returns null).

Rejecting it is CORRECT behaviour — the previous version of this file treated the rejection as proof that CCRS#474 was unfixed, which conflated "tiny" with "corrupt".

What this asserts is that the rejection is a well-formed application error rather than a transport-level crash. Internally filestore does NOT null-check ImageIO's result — CloudFileMgrUtils.createVersionsOfImage:86 throws NullPointerException on largeImage.flush() (visible in egov-filestore logs) — but StorageService catches it and maps it to EG_FILESTORE_INPUT_ERROR, so the API contract holds. That null-check is worth adding upstream; until then this test pins the contract clients depend on.

Steps:
1. Log in as the test employee.
2. Build the 517-byte corrupt buffer from TINY_JPEG_HEX.
3. Upload it.
4. Assert an Errors array comes back carrying EG_FILESTORE_INPUT_ERROR, and that no fileStoreId was minted for an unreadable file.`,
    },
    tag: ['@area:pgr', '@ccrs:474', '@kind:edge-case', '@layer:api', '@persona:cross'] }, async () => {
    const auth = await loginEmployee();
    const r = await uploadFile(auth, ROOT_TENANT, 'corrupt.jpg', tinyJpegBuffer(), 'image/jpeg', 'PGR');
    expect(r.body?.Errors?.[0]?.code, 'a corrupt image should be rejected, not stored').toBe(
      'EG_FILESTORE_INPUT_ERROR',
    );
    expect(r.body?.files?.[0]?.fileStoreId).toBeFalsy();
  });

  test('Larger valid JPEG should succeed regardless of fix state (control)', {
    annotation: {
      type: 'description',
      description: `Control case for CCRS#474 — confirms the filestore service handles a "normal" upload regardless of whether the tiny-JPEG fix has landed. Uses a 1×1 PNG (PNG has no thumbnail-shape issue) so any failure here means filestore itself is broken, not the bug under investigation.

Steps:
1. Log in as the test employee.
2. Build a 1×1 PNG buffer from the embedded base64 constant.
3. uploadFile(auth, ROOT_TENANT, 'one.png', png, 'image/png', 'PGR').
4. Assert response.body.files[0].fileStoreId is truthy.

Pairs with the REPRO test to discriminate "filestore is down" from "tiny-image bug is back".`,
    },
    tag: ['@area:pgr', '@ccrs:474', '@kind:lifecycle', '@layer:ui', '@persona:cross'] }, async () => {
    // Synthesize a larger valid JPEG by repeating a real image's body.
    // We reuse the tiny one but pad with valid JPEG-internal sequences;
    // simpler: a 1x1 PNG as a control since PNG has no thumbnail issue.
    const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';
    const png = Buffer.from(PNG_BASE64, 'base64');
    const auth = await loginEmployee();
    const r = await uploadFile(auth, ROOT_TENANT, 'one.png', png, 'image/png', 'PGR');
    expect(r.body.files?.[0]?.fileStoreId).toBeTruthy();
  });
});
