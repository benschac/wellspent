import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  errors,
  jwtVerify,
  type RemoteJWKSet,
} from "jose";
import { z } from "zod";
import type { Environment } from "../config/environment.js";
import type { AuthenticatedUser } from "./auth.types.js";

const supabaseUserSchema = z.object({
  id: z.uuid(),
  email: z.email().optional(),
});

const supabaseClaimsSchema = z.object({
  email: z.email().optional(),
  sub: z.uuid(),
});

const asymmetricAlgorithms = ["EdDSA", "ES256", "RS256"];
const invalidTokenErrorCodes = new Set([
  "ERR_JOSE_ALG_NOT_ALLOWED",
  "ERR_JOSE_NOT_SUPPORTED",
  "ERR_JWS_INVALID",
  "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  "ERR_JWKS_NO_MATCHING_KEY",
  "ERR_JWT_CLAIM_VALIDATION_FAILED",
  "ERR_JWT_EXPIRED",
  "ERR_JWT_INVALID",
]);

@Injectable()
export class SupabaseAuthService {
  private readonly issuer: string | undefined;
  private readonly jwks: RemoteJWKSet | undefined;

  constructor(private readonly config: ConfigService<Environment, true>) {
    const supabaseUrl = this.config.get("SUPABASE_URL", { infer: true });
    if (supabaseUrl !== undefined) {
      this.issuer = new URL("/auth/v1", supabaseUrl).href.replace(/\/$/, "");
      this.jwks = createRemoteJWKSet(
        new URL(`${this.issuer}/.well-known/jwks.json`),
        {
          cacheMaxAge: 10 * 60 * 1_000,
          cooldownDuration: 30_000,
          timeoutDuration: 10_000,
        },
      );
    }
  }

  async authenticate(
    authorization: string | undefined,
  ): Promise<AuthenticatedUser> {
    const accessToken = this.readBearerToken(authorization);
    const issuer = this.issuer;
    const jwks = this.jwks;
    if (issuer === undefined || jwks === undefined) {
      throw new ServiceUnavailableException(
        "Supabase authentication is not configured",
      );
    }

    const algorithm = this.readAlgorithm(accessToken);
    if (algorithm === "HS256") {
      return this.authenticateLegacyToken(accessToken);
    }
    if (!asymmetricAlgorithms.includes(algorithm)) {
      throw new UnauthorizedException("Invalid or expired access token");
    }

    return this.authenticateAsymmetricToken(accessToken, issuer, jwks);
  }

  private async authenticateAsymmetricToken(
    accessToken: string,
    issuer: string,
    jwks: RemoteJWKSet,
  ): Promise<AuthenticatedUser> {
    const payload = await this.verifyAsymmetricToken(accessToken, issuer, jwks);
    const parsed = supabaseClaimsSchema.safeParse(payload);
    if (!parsed.success) {
      throw new UnauthorizedException("Invalid or expired access token");
    }

    return {
      id: parsed.data.sub,
      ...(parsed.data.email === undefined ? {} : { email: parsed.data.email }),
    };
  }

  private async verifyAsymmetricToken(
    accessToken: string,
    issuer: string,
    jwks: RemoteJWKSet,
  ) {
    try {
      const { payload } = await jwtVerify(accessToken, jwks, {
        algorithms: asymmetricAlgorithms,
        audience: "authenticated",
        issuer,
      });
      return payload;
    } catch (error) {
      if (
        error instanceof errors.JOSEError &&
        invalidTokenErrorCodes.has(error.code)
      ) {
        throw new UnauthorizedException("Invalid or expired access token");
      }
      throw new ServiceUnavailableException(
        "Supabase authentication is unavailable",
      );
    }
  }

  private async authenticateLegacyToken(
    accessToken: string,
  ): Promise<AuthenticatedUser> {
    const publishableKey = this.config.get("SUPABASE_PUBLISHABLE_KEY", {
      infer: true,
    });

    if (this.issuer === undefined || publishableKey === undefined) {
      throw new ServiceUnavailableException(
        "Supabase authentication is not configured",
      );
    }

    let response: Response;
    try {
      response = await fetch(`${this.issuer}/user`, {
        headers: {
          apikey: publishableKey,
          authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ServiceUnavailableException(
        "Supabase authentication is unavailable",
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new UnauthorizedException("Invalid or expired access token");
    }
    if (!response.ok) {
      throw new ServiceUnavailableException(
        "Supabase authentication is unavailable",
      );
    }

    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      throw new ServiceUnavailableException(
        "Supabase returned an invalid user response",
      );
    }

    const parsed = supabaseUserSchema.safeParse(responseBody);
    if (!parsed.success) {
      throw new ServiceUnavailableException(
        "Supabase returned an invalid user response",
      );
    }

    return {
      id: parsed.data.id,
      ...(parsed.data.email === undefined ? {} : { email: parsed.data.email }),
    };
  }

  private readAlgorithm(accessToken: string): string {
    try {
      const { alg } = decodeProtectedHeader(accessToken);
      if (alg === undefined) {
        throw new Error("JWT algorithm is missing");
      }
      return alg;
    } catch {
      throw new UnauthorizedException("Bearer access token is malformed");
    }
  }

  private readBearerToken(authorization: string | undefined): string {
    if (authorization === undefined) {
      throw new UnauthorizedException("Bearer access token is required");
    }

    const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization);
    if (match?.[1] === undefined) {
      throw new UnauthorizedException("Bearer access token is malformed");
    }
    return match[1];
  }
}
