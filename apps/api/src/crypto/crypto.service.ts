import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { Injectable } from "@nestjs/common";

@Injectable()
export class CryptoService {
  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString("base64url");
  }

  sha256(value: string): string {
    return createHash("sha256").update(value).digest("base64url");
  }

  encryptAes256Gcm(plaintext: string, key: Buffer): string {
    this.assertAes256Key(key);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return ["v1", iv, tag, ciphertext]
      .map((part) =>
        typeof part === "string" ? part : part.toString("base64url"),
      )
      .join(".");
  }

  decryptAes256Gcm(value: string, key: Buffer): string {
    this.assertAes256Key(key);
    const [version, ivValue, tagValue, ciphertextValue] = value.split(".");
    if (
      version !== "v1" ||
      ivValue === undefined ||
      tagValue === undefined ||
      ciphertextValue === undefined
    ) {
      throw new Error("Encrypted value has an invalid format");
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  matchesSha256(value: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.sha256(value));
    const expected = Buffer.from(expectedHash);
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }

  private assertAes256Key(key: Buffer): void {
    if (key.length !== 32) {
      throw new Error("AES-256-GCM requires a 32-byte key");
    }
  }
}
