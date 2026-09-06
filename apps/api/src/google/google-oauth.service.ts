import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { TokenInfo } from "google-auth-library";
import { z } from "zod";
import { CryptoService } from "../crypto/crypto.service.js";
import {
  GOOGLE_SCOPES,
  GoogleConfig,
  type GoogleIntegration,
} from "./google.config.js";
import { GoogleRepository } from "./google.repository.js";
import { GoogleOAuthClient } from "./google-oauth.client.js";

const providerError = z.object({
  response: z
    .object({
      status: z.number().optional(),
      data: z.object({ error: z.string() }).optional(),
    })
    .optional(),
});
export function isInvalidGoogleGrant(error: unknown): boolean {
  const parsed = providerError.safeParse(error);
  return (
    parsed.success &&
    (parsed.data.response?.data?.error === "invalid_grant" ||
      parsed.data.response?.status === 401)
  );
}

@Injectable()
export class GoogleOAuthService {
  constructor(
    @Inject(GoogleOAuthClient) private readonly client: GoogleOAuthClient,
    @Inject(GoogleConfig) private readonly config: GoogleConfig,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(GoogleRepository) private readonly repository: GoogleRepository,
  ) {}

  async beginAuthorization(userId: string, integration: GoogleIntegration) {
    this.config.assertEnabled(integration);
    const existing = await this.repository.find(userId);
    const state = this.crypto.randomToken();
    const verifier = this.crypto.randomToken(48);
    await this.repository.createState({
      stateHash: this.crypto.sha256(state),
      userId,
      integration,
      encryptedCodeVerifier: this.crypto.encryptAes256Gcm(
        verifier,
        this.config.encryptionKey,
      ),
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    return {
      authorizationUrl: this.client.authorizationUrl({
        integration,
        state,
        codeChallenge: this.crypto.sha256(verifier),
        scopes: [
          ...new Set([
            "openid",
            GOOGLE_SCOPES[integration],
            ...(existing?.grantedScopes ?? []),
          ]),
        ],
        ...(existing?.googleSubject ? { subject: existing.googleSubject } : {}),
      }),
    };
  }

  async completeAuthorization(
    integration: GoogleIntegration,
    input: { code?: string; state?: string; error?: string },
  ) {
    this.config.assertEnabled(integration);
    if (!input.state)
      throw new BadRequestException("Google OAuth state is required");
    const state = await this.repository.consumeState(
      this.crypto.sha256(input.state),
      integration,
    );
    if (!state)
      throw new UnauthorizedException(
        "Google OAuth state is invalid or expired",
      );
    if (input.error || !input.code)
      throw new BadRequestException("Google authorization was not completed");
    const existing = await this.repository.find(state.userId);
    const tokens = await this.exchange(
      integration,
      input.code,
      this.crypto.decryptAes256Gcm(
        state.encryptedCodeVerifier,
        this.config.encryptionKey,
      ),
    );
    if (!tokens.scopes.includes(GOOGLE_SCOPES[integration]))
      throw new BadRequestException(
        "Google did not grant the requested permission",
      );
    if (existing) {
      // Legacy Calendar credentials did not record an account ID. Verify their
      // identity before adopting a shared grant; never mix two Google accounts.
      let subject = existing.googleSubject;
      if (!subject) {
        try {
          subject =
            (await this.client.subject(
              this.crypto.decryptAes256Gcm(
                existing.encryptedRefreshToken,
                this.config.encryptionKey,
              ),
            )) ?? null;
        } catch {
          throw new ConflictException(
            "Disconnect all Google integrations and reconnect to verify your Google account",
          );
        }
      }
      if (!subject || subject !== tokens.subject)
        throw new ConflictException(
          "Connect the same Google account, or disconnect all Google integrations first",
        );
    }
    const refreshToken =
      tokens.refreshToken ??
      (existing
        ? this.crypto.decryptAes256Gcm(
            existing.encryptedRefreshToken,
            this.config.encryptionKey,
          )
        : undefined);
    if (!refreshToken)
      throw new BadRequestException(
        "Google did not grant offline access; reconnect with consent",
      );
    // An existing refresh token must carry the upgraded grant, not just the
    // short-lived access token returned by the new authorization.
    let refreshInfo: TokenInfo;
    try {
      refreshInfo = await this.client.inspectRefreshToken(refreshToken);
    } catch {
      throw new BadRequestException(
        "Google offline access could not be verified; reconnect with consent",
      );
    }
    if (
      (refreshInfo.sub ?? refreshInfo.user_id) !== tokens.subject ||
      tokens.scopes.some((scope) => !refreshInfo.scopes.includes(scope))
    ) {
      throw new BadRequestException(
        "Google offline access does not include the granted permissions; reconnect with consent",
      );
    }
    await this.repository.save({
      userId: state.userId,
      googleSubject: tokens.subject,
      grantedScopes: tokens.scopes,
      encryptedRefreshToken: this.crypto.encryptAes256Gcm(
        refreshToken,
        this.config.encryptionKey,
      ),
    });
    return { userId: state.userId, accessToken: tokens.accessToken };
  }

  async getAccessToken(
    userId: string,
    integration: GoogleIntegration,
  ): Promise<string> {
    this.config.assertEnabled(integration);
    const connection = await this.repository.find(userId);
    if (
      !connection ||
      connection.reconnectRequired ||
      !connection.grantedScopes.includes(GOOGLE_SCOPES[integration])
    ) {
      throw new UnauthorizedException(
        `Connect Google ${integration} to continue`,
      );
    }
    try {
      return await this.client.refresh(
        this.crypto.decryptAes256Gcm(
          connection.encryptedRefreshToken,
          this.config.encryptionKey,
        ),
      );
    } catch (error) {
      if (isInvalidGoogleGrant(error)) {
        await this.repository.markReconnectRequired(
          userId,
          connection.encryptedRefreshToken,
        );
        throw new UnauthorizedException(
          "Google access expired; reconnect your Google account",
        );
      }
      // SDK errors can contain request headers and refresh tokens. Never log or
      // propagate the raw provider error into Nest's default exception handler.
      throw new BadGatewayException(
        "Google authorization is temporarily unavailable",
      );
    }
  }

  async status(userId: string, integration: GoogleIntegration) {
    const connection = await this.repository.find(userId);
    return {
      authorized:
        !!connection &&
        !connection.reconnectRequired &&
        connection.grantedScopes.includes(GOOGLE_SCOPES[integration]),
      reconnectRequired: connection?.reconnectRequired ?? false,
    };
  }

  // Only this explicit all-Google action revokes the combined grant.
  async disconnectAll(userId: string) {
    const connection = await this.repository.find(userId);
    if (connection) {
      try {
        await this.client.revoke(
          this.crypto.decryptAes256Gcm(
            connection.encryptedRefreshToken,
            this.config.encryptionKey,
          ),
        );
      } catch (error) {
        const parsed = providerError.safeParse(error);
        const alreadyRevoked =
          parsed.success &&
          parsed.data.response?.data?.error === "invalid_token";
        if (!isInvalidGoogleGrant(error) && !alreadyRevoked)
          throw new BadGatewayException(
            "Google revocation failed; retry disconnect",
          );
      }
    }
    await this.repository.deleteAll(userId);
  }

  private async exchange(
    integration: GoogleIntegration,
    code: string,
    verifier: string,
  ) {
    try {
      return await this.client.exchange(integration, code, verifier);
    } catch {
      throw new BadRequestException(
        "Google authorization could not be verified; reconnect and try again",
      );
    }
  }
}
