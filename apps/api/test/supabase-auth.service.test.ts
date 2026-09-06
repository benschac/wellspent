import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { SupabaseAuthService } from "../src/auth/supabase-auth.service.js";
import type { Environment } from "../src/config/environment.js";

const supabaseUrl = "https://project.supabase.co";
const issuer = `${supabaseUrl}/auth/v1`;
const userId = "11111111-1111-4111-8111-111111111111";
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function createSubject(
  values: Partial<Environment> = {
    SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    SUPABASE_URL: supabaseUrl,
  },
): SupabaseAuthService {
  const config = {
    get: (key: keyof Environment) => values[key],
  } as ConfigService<Environment, true>;

  return new SupabaseAuthService(config);
}

async function createAsymmetricToken(options?: {
  algorithm?: "ES256" | "RS256";
  issuer?: string;
}): Promise<{ jwks: JsonWebKeySet; token: string }> {
  const algorithm = options?.algorithm ?? "ES256";
  const { privateKey, publicKey } = await generateKeyPair(algorithm);
  const jwk = await exportJWK(publicKey);
  const token = await new SignJWT({ email: "person@example.com" })
    .setProtectedHeader({ alg: algorithm, kid: "test-key" })
    .setIssuer(options?.issuer ?? issuer)
    .setAudience("authenticated")
    .setSubject(userId)
    .setExpirationTime("5m")
    .sign(privateKey);

  return {
    jwks: {
      keys: [{ ...jwk, alg: algorithm, kid: "test-key", use: "sig" }],
    },
    token,
  };
}

interface JsonWebKeySet {
  keys: Record<string, unknown>[];
}

describe("SupabaseAuthService", () => {
  for (const algorithm of ["ES256", "RS256"] as const) {
    it(`verifies ${algorithm} access tokens through a cached JWKS`, async () => {
      const { jwks, token } = await createAsymmetricToken({ algorithm });
      const fetchMock = mock(async () => Response.json(jwks));
      globalThis.fetch = fetchMock as typeof fetch;
      const subject = createSubject({ SUPABASE_URL: supabaseUrl });

      await expect(subject.authenticate(`Bearer ${token}`)).resolves.toEqual({
        email: "person@example.com",
        id: userId,
      });
      await expect(subject.authenticate(`Bearer ${token}`)).resolves.toEqual({
        email: "person@example.com",
        id: userId,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
        `${issuer}/.well-known/jwks.json`,
      );
    });
  }

  it("rejects an asymmetric token from another issuer", async () => {
    const { jwks, token } = await createAsymmetricToken({
      issuer: "https://attacker.example/auth/v1",
    });
    globalThis.fetch = mock(async () => Response.json(jwks)) as typeof fetch;

    await expect(
      createSubject().authenticate(`Bearer ${token}`),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("falls back to the Auth user endpoint for legacy HS256 tokens", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .sign(new TextEncoder().encode("a-secure-test-signing-secret"));
    const fetchMock = mock(async () =>
      Response.json({ email: "person@example.com", id: userId }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      createSubject().authenticate(`Bearer ${token}`),
    ).resolves.toEqual({
      email: "person@example.com",
      id: userId,
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(`${issuer}/user`);
    const headers = new Headers(init?.headers);
    expect(headers.get("apikey")).toBe("publishable-key");
    expect(headers.get("authorization")).toBe(`Bearer ${token}`);
  });

  it("reports JWKS availability failures separately from invalid tokens", async () => {
    const { token } = await createAsymmetricToken();
    globalThis.fetch = mock(async () => {
      throw new TypeError("network unavailable");
    }) as typeof fetch;

    await expect(
      createSubject().authenticate(`Bearer ${token}`),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("requires a well-formed bearer token", async () => {
    const subject = createSubject();

    await expect(subject.authenticate(undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      subject.authenticate("Basic credentials"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
