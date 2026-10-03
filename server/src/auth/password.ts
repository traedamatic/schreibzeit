// Password/PIN hashing. Uses Bun's native argon2id (per code_guidelines.md:
// argon2id, never roll your own crypto). Both functions are async.

export function hashSecret(plain: string): Promise<string> {
  return Bun.password.hash(plain, { algorithm: 'argon2id' });
}

export function verifySecret(plain: string, hash: string): Promise<boolean> {
  return Bun.password.verify(plain, hash);
}
