/** Temporary provider seam; replace with sync/mirror.ts when that leaf merges. */
export const credentialPorts: {
  mirrorPerson(subject: string, hint: { credential: { tenantId: string; keyVersion: number; setAt: number } }): Promise<void>;
} = {
  async mirrorPerson() { throw new Error("Credential mirror provider is not integrated"); },
};
