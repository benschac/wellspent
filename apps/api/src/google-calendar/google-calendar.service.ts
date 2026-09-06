import * as nodeCrypto from "node:crypto";
import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";

import { CryptoService } from "../crypto/crypto.service.js";
import { GoogleCalendarConfig } from "./google-calendar.config.js";
import { GoogleCalendarRepository } from "./google-calendar.repository.js";
import {
  GoogleCalendarApiError,
  GoogleCalendarClient,
} from "./google-calendar.types.js";

@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);

  constructor(
    @Inject(GoogleCalendarClient)
    private readonly client: GoogleCalendarClient,
    private readonly config: GoogleCalendarConfig,
    private readonly crypto: CryptoService,
    private readonly repository: GoogleCalendarRepository,
  ) {}

  async beginAuthorization(
    userId: string,
  ): Promise<{ authorizationUrl: string }> {
    this.config.assertEnabled();
    const state = this.crypto.randomToken();
    const codeVerifier = this.crypto.randomToken(48);
    await this.repository.createOauthState({
      encryptedCodeVerifier: this.crypto.encryptAes256Gcm(
        codeVerifier,
        this.config.encryptionKey,
      ),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      stateHash: this.crypto.sha256(state),
      userId,
    });

    return {
      authorizationUrl: this.client.buildAuthorizationUrl({
        codeChallenge: this.crypto.sha256(codeVerifier),
        state,
      }),
    };
  }

  async completeAuthorization(input: {
    code?: string;
    error?: string;
    state?: string;
  }): Promise<{ calendarId: string; connected: true }> {
    this.config.assertEnabled();
    if (input.error !== undefined) {
      throw new BadRequestException(
        `Google authorization failed: ${input.error}`,
      );
    }
    if (input.code === undefined || input.state === undefined) {
      throw new BadRequestException(
        "Google authorization code and state are required",
      );
    }

    const oauthState = await this.repository.consumeOauthState(
      this.crypto.sha256(input.state),
    );
    if (oauthState === undefined) {
      throw new UnauthorizedException(
        "Google OAuth state is invalid or expired",
      );
    }

    const existing = await this.repository.findConnectionByUserId(
      oauthState.userId,
    );
    const tokens = await this.client.exchangeAuthorizationCode({
      code: input.code,
      codeVerifier: this.crypto.decryptAes256Gcm(
        oauthState.encryptedCodeVerifier,
        this.config.encryptionKey,
      ),
    });
    const refreshToken =
      tokens.refreshToken ??
      (existing === undefined
        ? undefined
        : this.crypto.decryptAes256Gcm(
            existing.encryptedRefreshToken,
            this.config.encryptionKey,
          ));
    if (refreshToken === undefined) {
      throw new BadGatewayException(
        "Google did not return a refresh token; reconnect with consent",
      );
    }

    const calendarId =
      existing?.calendarId ??
      (await this.client.createCalendar(tokens.accessToken));
    const syncToken = await this.fetchFullSyncToken(
      tokens.accessToken,
      calendarId,
    );
    const channelId = nodeCrypto.randomUUID();
    const channelToken = this.crypto.randomToken();
    const channel = await this.client.createWatch({
      accessToken: tokens.accessToken,
      address: this.config.webhookUrl,
      calendarId,
      channelId,
      channelToken,
    });

    const connection = await this.repository.upsertConnection({
      calendarId,
      encryptedRefreshToken: this.crypto.encryptAes256Gcm(
        refreshToken,
        this.config.encryptionKey,
      ),
      grantedScopes: tokens.scopes,
      userId: oauthState.userId,
    });
    await this.repository.saveSubscription({
      calendarId,
      channelId: channel.channelId,
      channelTokenHash: this.crypto.sha256(channelToken),
      connectionId: connection.id,
      expiresAt: channel.expiration,
      resourceId: channel.resourceId,
      syncToken,
    });

    return { calendarId, connected: true };
  }

  async getStatus(userId: string): Promise<{
    calendarId?: string;
    connected: boolean;
    reconnectRequired: boolean;
    watchExpiresAt?: string;
  }> {
    this.config.assertEnabled();
    const connection = await this.repository.findConnectionByUserId(userId);
    if (connection === undefined) {
      return { connected: false, reconnectRequired: false };
    }
    const subscription = await this.repository.findSubscriptionByConnectionId(
      connection.id,
    );
    return {
      connected: connection.status === "connected",
      reconnectRequired: connection.status === "reconnect_required",
      ...(connection.calendarId === null
        ? {}
        : { calendarId: connection.calendarId }),
      ...(subscription === undefined
        ? {}
        : { watchExpiresAt: subscription.expiresAt.toISOString() }),
    };
  }

  async disconnect(userId: string): Promise<void> {
    this.config.assertEnabled();
    const connection = await this.repository.findConnectionByUserId(userId);
    if (connection === undefined) {
      return;
    }
    const refreshToken = this.crypto.decryptAes256Gcm(
      connection.encryptedRefreshToken,
      this.config.encryptionKey,
    );
    const subscription = await this.repository.findSubscriptionByConnectionId(
      connection.id,
    );

    try {
      if (subscription !== undefined) {
        const accessToken = await this.client.refreshAccessToken(refreshToken);
        await this.client.stopWatch({
          accessToken,
          channelId: subscription.channelId,
          resourceId: subscription.resourceId,
        });
      }
      await this.client.revokeToken(refreshToken);
    } catch (error) {
      this.logger.warn(
        `Google cleanup failed during disconnect: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }

    await this.repository.deleteConnection(connection.id);
  }

  async receiveNotification(input: {
    channelId?: string;
    channelToken?: string;
    messageNumber?: string;
    resourceId?: string;
    resourceState?: string;
  }): Promise<void> {
    this.config.assertEnabled();
    if (
      input.channelId === undefined ||
      input.channelToken === undefined ||
      input.messageNumber === undefined ||
      input.resourceId === undefined ||
      input.resourceState === undefined
    ) {
      throw new BadRequestException(
        "Google notification headers are incomplete",
      );
    }
    if (
      input.channelId.length > 64 ||
      input.channelToken.length > 256 ||
      input.messageNumber.length > 32 ||
      input.resourceId.length > 512 ||
      input.resourceState.length > 32
    ) {
      throw new BadRequestException("Google notification headers are invalid");
    }

    const subscription = await this.repository.findSubscriptionByChannelId(
      input.channelId,
    );
    if (subscription === undefined) {
      throw new NotFoundException("Google notification channel is unknown");
    }
    if (
      subscription.resourceId !== input.resourceId ||
      !this.crypto.matchesSha256(
        input.channelToken,
        subscription.channelTokenHash,
      )
    ) {
      throw new UnauthorizedException("Google notification channel is invalid");
    }

    if (input.resourceState !== "sync") {
      await this.repository.enqueuePullChanges({
        channelId: input.channelId,
        connectionId: subscription.connectionId,
        messageNumber: input.messageNumber,
        resourceState: input.resourceState,
      });
    }
  }

  async pullChanges(connectionId: string): Promise<void> {
    const connection = await this.repository.findConnectionById(connectionId);
    if (connection === undefined || connection.calendarId === null) {
      return;
    }
    const subscription = await this.repository.findSubscriptionByConnectionId(
      connection.id,
    );
    if (subscription === undefined) {
      return;
    }

    let accessToken: string;
    try {
      accessToken = await this.client.refreshAccessToken(
        this.crypto.decryptAes256Gcm(
          connection.encryptedRefreshToken,
          this.config.encryptionKey,
        ),
      );
    } catch (error) {
      if (
        error instanceof GoogleCalendarApiError &&
        (error.status === 400 || error.status === 401)
      ) {
        await this.repository.markReconnectRequired(connection.id);
      }
      throw error;
    }

    try {
      await this.pullEventPages({
        accessToken,
        connectionId: connection.id,
        calendarId: connection.calendarId,
        subscriptionId: subscription.id,
        ...(subscription.syncToken === null
          ? {}
          : { syncToken: subscription.syncToken }),
      });
    } catch (error) {
      if (!(error instanceof GoogleCalendarApiError) || error.status !== 410) {
        throw error;
      }
      await this.pullEventPages({
        accessToken,
        connectionId: connection.id,
        calendarId: connection.calendarId,
        subscriptionId: subscription.id,
      });
    }
  }

  async renewWatch(connectionId: string): Promise<void> {
    const connection = await this.repository.findConnectionById(connectionId);
    if (connection === undefined || connection.calendarId === null) {
      return;
    }
    const subscription = await this.repository.findSubscriptionByConnectionId(
      connection.id,
    );
    if (
      subscription === undefined ||
      subscription.syncToken === null ||
      subscription.expiresAt.getTime() > Date.now() + 24 * 60 * 60 * 1000
    ) {
      return;
    }

    const accessToken = await this.client.refreshAccessToken(
      this.crypto.decryptAes256Gcm(
        connection.encryptedRefreshToken,
        this.config.encryptionKey,
      ),
    );
    const channelToken = this.crypto.randomToken();
    const channel = await this.client.createWatch({
      accessToken,
      address: this.config.webhookUrl,
      calendarId: subscription.calendarId,
      channelId: nodeCrypto.randomUUID(),
      channelToken,
    });

    await this.repository.saveSubscription({
      calendarId: subscription.calendarId,
      channelId: channel.channelId,
      channelTokenHash: this.crypto.sha256(channelToken),
      connectionId: connection.id,
      expiresAt: channel.expiration,
      resourceId: channel.resourceId,
      syncToken: subscription.syncToken,
    });

    try {
      await this.client.stopWatch({
        accessToken,
        channelId: subscription.channelId,
        resourceId: subscription.resourceId,
      });
    } catch (error) {
      this.logger.warn(
        `Old Google Calendar watch cleanup failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  private async fetchFullSyncToken(
    accessToken: string,
    calendarId: string,
  ): Promise<string> {
    let pageToken: string | undefined;
    do {
      const page = await this.client.listEvents({
        accessToken,
        calendarId,
        ...(pageToken === undefined ? {} : { pageToken }),
      });
      pageToken = page.nextPageToken;
      if (pageToken === undefined) {
        if (page.nextSyncToken === undefined) {
          throw new GoogleCalendarApiError(
            "Google Calendar did not return a sync token",
            502,
          );
        }
        return page.nextSyncToken;
      }
    } while (pageToken !== undefined);

    throw new GoogleCalendarApiError("Google Calendar sync failed", 502);
  }

  private async pullEventPages(input: {
    accessToken: string;
    calendarId: string;
    connectionId: string;
    subscriptionId: string;
    syncToken?: string;
  }): Promise<void> {
    let pageToken: string | undefined;
    do {
      const page = await this.client.listEvents({
        accessToken: input.accessToken,
        calendarId: input.calendarId,
        ...(pageToken === undefined ? {} : { pageToken }),
        ...(input.syncToken === undefined
          ? {}
          : { syncToken: input.syncToken }),
      });
      await this.repository.recordInboundChanges({
        calendarId: input.calendarId,
        connectionId: input.connectionId,
        subscriptionId: input.subscriptionId,
        changes: page.events.map((event) => ({
          changeType:
            event.status === "cancelled" ? "deleted" : "created_or_updated",
          dedupeKey: this.crypto.sha256(
            [
              input.connectionId,
              event.id,
              event.etag ?? "",
              event.status ?? "",
              event.updated ?? "",
            ].join(":"),
          ),
          googleEventId: event.id,
          payload: event as unknown as Record<string, unknown>,
          ...(event.etag === undefined ? {} : { googleEtag: event.etag }),
        })),
        ...(page.nextSyncToken === undefined
          ? {}
          : { nextSyncToken: page.nextSyncToken }),
      });
      pageToken = page.nextPageToken;
    } while (pageToken !== undefined);
  }
}
