import { describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { CryptoService } from "../src/crypto/crypto.service.js";

function createSubject(): { crypto: CryptoService; key: Buffer } {
  return {
    crypto: new CryptoService(),
    key: randomBytes(32),
  };
}

describe("CryptoService", () => {
  it("encrypts and decrypts values", () => {
    const { crypto, key } = createSubject();
    const encrypted = crypto.encryptAes256Gcm("secret-value", key);

    expect(encrypted).not.toContain("secret-value");
    expect(crypto.decryptAes256Gcm(encrypted, key)).toBe("secret-value");
  });

  it("rejects tampered ciphertext", () => {
    const { crypto, key } = createSubject();
    const encrypted = crypto.encryptAes256Gcm("secret-value", key);
    const tampered = `${encrypted.slice(0, -1)}A`;

    expect(() => crypto.decryptAes256Gcm(tampered, key)).toThrow();
  });

  it("compares SHA-256 hashes", () => {
    const { crypto } = createSubject();
    const hash = crypto.sha256("channel-token");

    expect(crypto.matchesSha256("channel-token", hash)).toBe(true);
    expect(crypto.matchesSha256("wrong-token", hash)).toBe(false);
  });
});
