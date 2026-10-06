/** Validate without echoing secret configuration into an error or log. */
export function parseStaffCredentialConfig(env: NodeJS.ProcessEnv) {
  const mode = env.IDENTITY_STAFF_CREDENTIAL_MODE || "rotate";
  if (mode !== "rotate" && mode !== "derived") {
    throw new Error("IDENTITY_STAFF_CREDENTIAL_MODE must be rotate or derived");
  }
  const keys = new Map<number, Buffer>();
  for (const entry of (env.IDENTITY_CREDENTIAL_KEYS || "").split(",").filter(Boolean)) {
    const match = /^([1-9]\d*):([A-Za-z0-9+/]+={0,2})$/.exec(entry.trim());
    if (!match) throw new Error("Invalid IDENTITY_CREDENTIAL_KEYS entry");
    const version = Number(match[1]);
    const key = Buffer.from(match[2], "base64");
    if (!Number.isSafeInteger(version) || keys.has(version) || key.length < 32 ||
        key.toString("base64").replace(/=+$/, "") !== match[2].replace(/=+$/, "")) {
      throw new Error("Invalid or duplicate IDENTITY_CREDENTIAL_KEYS entry (minimum 32 bytes)");
    }
    keys.set(version, key);
  }
  const current = Number(env.IDENTITY_CREDENTIAL_KEY_CURRENT || "0");
  if ((mode === "derived" || keys.size > 0 || current !== 0) &&
      (!Number.isSafeInteger(current) || current < 1 || !keys.has(current))) {
    throw new Error("IDENTITY_CREDENTIAL_KEY_CURRENT must name a configured key");
  }
  return {
    identityStaffCredentialMode: mode as "rotate" | "derived",
    identityCredentialKeys: keys,
    identityCredentialKeyCurrent: current,
  };
}
