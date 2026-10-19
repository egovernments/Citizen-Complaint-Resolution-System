/** Test-only HttpOtpSender receiver. Run only on root's isolated gate network. */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

interface Receipt { phone: string; code: string; purpose: string; tenantId: string; receivedAt: number; expiresAt: number; challengeId?: string }
export function createOtpInbox(now = Date.now) {
  const receipts = new Map<string, Receipt>();
  return createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    const reply = (status: number, body: unknown) => response.writeHead(status).end(JSON.stringify(body));
    const url = new URL(request.url || '/', 'http://localhost');
    for (const [phone, receipt] of receipts) if (receipt.expiresAt <= now()) receipts.delete(phone);
    if (request.method === 'POST' && url.pathname === '/send') {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 4096) { reply(413, { code: 'BODY_TOO_LARGE' }); return; }
        chunks.push(Buffer.from(chunk));
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString()); }
      catch { reply(400, { code: 'INVALID_JSON' }); return; }
      if (!body || typeof body !== 'object' || typeof body.phone !== 'string' || typeof body.code !== 'string' || !/^\+\d{5,15}$/.test(body.phone) || !/^\d{6}$/.test(body.code) ||
          !['signin', 'stepup', 'change_phone'].includes(body.purpose) || typeof body.tenantId !== 'string' ||
          !body.tenantId || !Number.isFinite(body.expiresIn) || body.expiresIn <= 0) {
        reply(400, { code: 'INVALID_DELIVERY' }); return;
      }
      const receivedAt = now();
      receipts.set(body.phone, { phone: body.phone, code: body.code, purpose: body.purpose,
        tenantId: body.tenantId, receivedAt, expiresAt: receivedAt + body.expiresIn * 1000 });
      reply(204, undefined);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/codes') {
      const phone = url.searchParams.get('phone') || '';
      const challengeId = url.searchParams.get('challengeId') || '';
      const since = Number(url.searchParams.get('since'));
      if (!phone || !challengeId || !url.searchParams.has('since') || !Number.isFinite(since)) {
        reply(400, { code: 'INVALID_QUERY' }); return;
      }
      const receipt = receipts.get(phone);
      if (!receipt || receipt.receivedAt < since || receipt.tenantId !== url.searchParams.get('tenantId') ||
          receipt.purpose !== (url.searchParams.get('purpose') || 'signin') ||
          (receipt.challengeId !== undefined && receipt.challengeId !== challengeId)) {
        reply(404, { code: 'NO_FRESH_DELIVERY' }); return;
      }
      // Association is made by the test reader, not by the sender. Only the BFF
      // can prove the code belongs to this challenge when _verify succeeds.
      receipt.challengeId = challengeId;
      reply(200, { code: receipt.code, receivedAt: receipt.receivedAt, expiresAt: receipt.expiresAt });
      return;
    }
    reply(404, { code: 'NOT_FOUND' });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.IDENTITY_E2E_OTP_INBOX_PORT || 18291);
  createOtpInbox().listen(port, '127.0.0.1', () => {
    process.stdout.write(`Test OTP inbox listening on loopback port ${port}; delivery payloads are never logged.\n`);
  });
}
