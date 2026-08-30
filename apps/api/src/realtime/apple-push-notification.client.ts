import { Injectable } from "@nestjs/common";
import { connect, constants } from "node:http2";
import { importPKCS8, SignJWT } from "jose";
import { LiveActivityPushConfig } from "./live-activity-push.config.js";

export interface ApplePushResponse {
  reason?: string;
  statusCode: number;
}

export interface LiveActivityPushPayload {
  aps: {
    "content-state": {
      elapsedMs: number;
      isRunning: boolean;
      originEpochMs: number;
      realtimeUrl: string;
    };
    "dismissal-date"?: number;
    event: "end" | "update";
    timestamp: number;
  };
}

@Injectable()
export class ApplePushNotificationClient {
  private providerToken?: { issuedAt: number; value: string };
  private signingKeyPromise?: ReturnType<typeof importPKCS8>;

  constructor(private readonly config: LiveActivityPushConfig) {}

  async sendLiveActivityPush(
    pushToken: string,
    payload: LiveActivityPushPayload,
  ): Promise<ApplePushResponse> {
    const providerToken = await this.getProviderToken();
    const session = connect(this.config.apnsOrigin);

    return new Promise<ApplePushResponse>((resolve, reject) => {
      let responseBody = "";
      let statusCode = 0;
      let settled = false;
      const finish = (
        callback: () => void,
      ) => {
        if (settled) {
          return;
        }
        settled = true;
        session.close();
        callback();
      };
      const request = session.request({
        [constants.HTTP2_HEADER_METHOD]: "POST",
        [constants.HTTP2_HEADER_PATH]: `/3/device/${pushToken}`,
        authorization: `bearer ${providerToken}`,
        "apns-priority": "10",
        "apns-push-type": "liveactivity",
        "apns-topic": `${this.config.bundleId}.push-type.liveactivity`,
        "content-type": "application/json",
      });

      session.once("error", (error) => finish(() => reject(error)));
      request.on("response", (headers) => {
        statusCode = Number(headers[constants.HTTP2_HEADER_STATUS] ?? 0);
      });
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        responseBody += chunk;
      });
      request.once("error", (error) => finish(() => reject(error)));
      request.once("end", () => {
        let reason: string | undefined;

        if (responseBody) {
          try {
            const parsed = JSON.parse(responseBody) as { reason?: unknown };
            reason =
              typeof parsed.reason === "string" ? parsed.reason : undefined;
          } catch {
            reason = undefined;
          }
        }

        finish(() =>
          resolve({
            ...(reason === undefined ? {} : { reason }),
            statusCode,
          }),
        );
      });
      request.end(JSON.stringify(payload));
    });
  }

  private async getProviderToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1_000);

    if (
      this.providerToken &&
      now - this.providerToken.issuedAt < 50 * 60
    ) {
      return this.providerToken.value;
    }

    this.signingKeyPromise ??= importPKCS8(this.config.privateKey, "ES256");
    const signingKey = await this.signingKeyPromise;
    const value = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: this.config.keyId })
      .setIssuer(this.config.teamId)
      .setIssuedAt(now)
      .sign(signingKey);

    this.providerToken = { issuedAt: now, value };
    return value;
  }
}
