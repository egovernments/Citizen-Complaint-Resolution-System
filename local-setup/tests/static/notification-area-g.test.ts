/**
 * Area G of the notification e2e suite skips its OTP case when D26 closed
 * /user-otp/v1/_send at Kong. Low (Dhruv, #2271 review 3): it skipped on ANY
 * 404, so a broken route on a box with identity_legacy_user_endpoints: true
 * was skipped instead of failing. Only Kong's deny body may skip.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const H = require('../e2e/notifications/notif-harness');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const areaG = require('../e2e/notifications/cases/area-g-otp');

const g1 = async (response: { status: number; text: string }) => {
  let json: unknown = null;
  try { json = JSON.parse(response.text); } catch { /* not JSON */ }
  const post = jest.spyOn(H, 'post').mockResolvedValue({ ...response, json });
  try {
    const [first] = await areaG.run({});
    expect(post).toHaveBeenCalledWith('/user-otp/v1/_send', expect.anything(), expect.anything());
    return first;
  } finally {
    post.mockRestore();
  }
};

describe('notification Area G: closed legacy OTP endpoint', () => {
  // The exact body Kong's deny route returns.
  const kong = fs.readFileSync(path.join(REPO_ROOT, 'local-setup/kong/kong.yml'), 'utf8');
  const denyBody = /body: '(\{"code":"IDENTITY_LEGACY_ENDPOINT_REMOVED"[^']*\})'/.exec(kong);

  test('skips when Kong answers with the D26 deny body', async () => {
    expect(denyBody).not.toBeNull();
    const result = await g1({ status: 404, text: denyBody![1] });
    expect(result).toMatchObject({ id: 'G1', status: 'SKIP' });
  });

  test.each([
    ['Kong has no route', '{"message":"no Route matched with those values"}'],
    ['an upstream 404', '<html>Not Found</html>'],
  ])('fails on any other 404 (%s)', async (_label, text) => {
    const result = await g1({ status: 404, text });
    expect(result).toMatchObject({ id: 'G1', status: 'FAIL' });
    expect(result.detail).toContain('returned 404');
  });
});
