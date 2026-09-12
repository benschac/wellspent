import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  focusChangedEvent,
  focusChangedSchema,
  focusNotificationTopic,
} from "@repo/api-contract";
import type { Environment } from "../config/environment.js";

@Injectable()
export class FocusNotificationsService {
  private readonly logger = new Logger(FocusNotificationsService.name);

  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async afterCommit<T>(
    userId: string,
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    // Repository methods resolve only after their Postgres transaction commits.
    // A rejected command must never emit a hint about a successful mutation.
    const result = await operation();
    await this.publish(userId, sessionId);
    return result;
  }

  private async publish(userId: string, sessionId: string): Promise<void> {
    if (!this.config.get("FOCUS_REALTIME_ENABLED", { infer: true })) return;
    try {
      const origin = this.config.get("SUPABASE_URL", { infer: true });
      const key = this.config.get("SUPABASE_SECRET_KEY", { infer: true });
      if (!origin || !key)
        throw new Error("Realtime publisher is not configured");
      const response = await fetch(
        new URL("/realtime/v1/api/broadcast", origin),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            apikey: key,
            // The local stack also supports its legacy service-role JWT. New
            // secret keys belong only in apikey; they are not JWT bearer tokens.
            ...(key.startsWith("sb_secret_")
              ? {}
              : { authorization: `Bearer ${key}` }),
          },
          body: JSON.stringify({
            messages: [
              {
                topic: focusNotificationTopic(userId),
                event: focusChangedEvent,
                private: true,
                payload: focusChangedSchema.parse({ version: 1, sessionId }),
              },
            ],
          }),
          signal: AbortSignal.timeout(1000),
          redirect: "error",
        },
      );
      await response.body?.cancel();
      if (!response.ok) throw new Error("Realtime delivery failed");
    } catch {
      // Notification failure cannot roll back or fail an already saved action.
      // Periodic HTTP refresh and reconnect refresh repair missed hints.
      this.logger.warn(
        "Focus notification unavailable; HTTP recovery remains active",
      );
    }
  }
}
