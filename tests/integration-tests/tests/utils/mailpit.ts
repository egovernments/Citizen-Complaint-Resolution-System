/**
 * Mailpit, for specs that follow an emailed link in a browser. The address is
 * the API base (for example `http://127.0.0.1:18025/mailpit/api/v1`); a spec
 * skips when it is unset, so the capability is the mail sink, not a host.
 */
export const mailpitUrl = () => process.env.IDENTITY_TEST_MAILPIT_URL?.replace(/\/$/, '');

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const decode = (v: string) => v.replace(/&amp;/g, '&').replace(/&#x3D;/gi, '=').replace(/&#61;/g, '=');

/** The first Keycloak or BFF link in the newest mail to `to`. */
export async function emailedLink(to: string, timeout = 90_000): Promise<string> {
  const base = mailpitUrl();
  if (!base) throw new Error('Set IDENTITY_TEST_MAILPIT_URL');
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const search = await fetch(`${base}/search?${new URLSearchParams({ query: `to:${to}`, limit: '1' })}`);
    if (!search.ok) throw new Error(`Mailpit search failed: HTTP ${search.status}`);
    const newest = ((await search.json()).messages ?? [])[0] as { ID: string } | undefined;
    if (newest) {
      const message = await (await fetch(`${base}/message/${newest.ID}`)).json();
      const urls = `${message.HTML ?? ''}\n${message.Text ?? ''}`.match(/https?:\/\/[^\s"<>]+/g) ?? [];
      const link = urls.map(decode).find(url => url.includes('/auth/') || url.includes('/identity/'));
      if (link) return link;
    }
    await sleep(1_500);
  }
  throw new Error(`No mail with a link reached ${to}`);
}
