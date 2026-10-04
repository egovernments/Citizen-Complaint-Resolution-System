import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { HttpOtpSender } from "../../src/modules/citizen-otp/otp-sender.js";

const saved = { ...config };
afterEach(() => { Object.assign(config, saved); vi.unstubAllGlobals(); });
const message = { challengeId: "not-sent", tenantId: "ke", phoneNumber: "+254712345678", code: "123456", expiresInSeconds: 300, locale: "sw_KE", purpose: "change_phone" as const };
function configure() {
  Object.assign(config, { identityCitizenOtpSender: "http", identityOtpSenderUrl: "https://otp.test/send" });
  return new HttpOtpSender();
}
describe("HTTP OTP transport", () => {
  it("sends only the frozen transport fields and accepts 2xx", async () => {
    const sender = configure();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    await sender.send(message);
    expect(sender.configured).toBe(true);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(config.identityOtpSenderUrl);
    expect(options.method).toBe("POST");
    expect(options.redirect).toBe("error");
    expect(JSON.parse(options.body)).toEqual({ phone: message.phoneNumber, code: "123456", purpose: "change_phone", tenantId: "ke", locale: "sw_KE", expiresIn: 300 });
  });
  it.each([429, 400, 500, 302])("maps HTTP %s without exposing the response", async status => {
    const sender = configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private provider error", { status })));
    await expect(sender.send(message)).rejects.toMatchObject({ code: status === 429 ? "OTP_RATE_LIMITED" : "OTP_CHANNEL_UNAVAILABLE" });
  });
  it("maps a timeout to unavailable", async () => {
    const sender = configure();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError")));
    await expect(sender.send(message)).rejects.toMatchObject({ code: "OTP_CHANNEL_UNAVAILABLE" });
  });
  it("requires both HTTP mode and a URL", async () => {
    const sender = configure();
    config.identityOtpSenderUrl = "";
    expect(sender.configured).toBe(false);
    await expect(sender.send(message)).rejects.toMatchObject({ code: "OTP_CHANNEL_UNAVAILABLE" });
  });
});
