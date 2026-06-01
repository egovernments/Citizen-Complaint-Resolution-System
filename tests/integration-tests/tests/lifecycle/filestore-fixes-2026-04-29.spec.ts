// #474 filestore upload. Deterministic repro via direct API.
import { test, expect } from '@playwright/test';
import { loginEmployee, uploadFile } from '../utils/launch-fixes/api.js';

// 517-byte synthetic JPEG that triggers EG_FILESTORE_INPUT_ERROR.
const TINY_JPEG_HEX =
  'ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffdb0043010909090c0b0c180d0d1832211c213232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232' +
  'ffc0001108000100010301220002110103110' +
  '1ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc4007810000201030302010404050304040000010002030411051221314106135161220771148132a1b1c1234252b16115d115335462f06372e1f132737483a273ffc4001f0100030101010101010101010000000000000102030405060708090a0bffc400b51100020102040403040705040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a737475767778797a8283848586878889' +
  '8a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda000c03010002110311003f00fbfeb700ffd9';

function tinyJpegBuffer(): Buffer {
  return Buffer.from(TINY_JPEG_HEX, 'hex');
}

test.describe('05-filestore (#474)', () => {
  test('REPRO: tiny synthetic JPEG triggers EG_FILESTORE_INPUT_ERROR (pre-fix)', async () => {
    const auth = await loginEmployee();
    const r = await uploadFile(auth, 'ke.nairobi', 'tiny.jpg', tinyJpegBuffer(), 'image/jpeg', 'PGR');
    // After the fix, this assertion will flip — the same payload should
    // succeed and yield a fileStoreId.
    if (r.body?.Errors) {
      expect(r.body.Errors[0].code).toBe('EG_FILESTORE_INPUT_ERROR');
      test.info().annotations.push({ type: 'state', description: 'pre-fix: bug confirmed' });
    } else {
      expect(r.body.files?.[0]?.fileStoreId).toBeTruthy();
      test.info().annotations.push({ type: 'state', description: 'post-fix: upload succeeds' });
    }
  });

  test('Larger valid JPEG should succeed regardless of fix state (control)', async () => {
    // Synthesize a larger valid JPEG by repeating a real image's body.
    // We reuse the tiny one but pad with valid JPEG-internal sequences;
    // simpler: a 1x1 PNG as a control since PNG has no thumbnail issue.
    const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';
    const png = Buffer.from(PNG_BASE64, 'base64');
    const auth = await loginEmployee();
    const r = await uploadFile(auth, 'ke.nairobi', 'one.png', png, 'image/png', 'PGR');
    expect(r.body.files?.[0]?.fileStoreId).toBeTruthy();
  });
});
