import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import type { Environment } from "../config/environment.js";
import type { AuthenticatedUser } from "./auth.types.js";

const supabaseUserSchema = z.object({
  id: z.uuid(),
  email: z.email().optional(),
});

@Injectable()
export class SupabaseAuthService {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  async authenticate(authorization: string | undefined): Promise<AuthenticatedUser> {
    const accessToken = this.readBearerToken(authorization);
    const supabaseUrl = this.config.get("SUPABASE_URL", { infer: true });
    const publishableKey = this.config.get("SUPABASE_PUBLISHABLE_KEY", {
      infer: true,
    });

    if (supabaseUrl === undefined || publishableKey === undefined) {
      throw new ServiceUnavailableException("Supabase authentication is not configured");
    }

    let response: Response;
    try {
      response = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: {
          apikey: publishableKey,
          authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ServiceUnavailableException("Supabase authentication is unavailable");
    }

    if (response.status === 401 || response.status === 403) {
      throw new UnauthorizedException("Invalid or expired access token");
    }
    if (!response.ok) {
      throw new ServiceUnavailableException("Supabase authentication is unavailable");
    }

    const parsed = supabaseUserSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new ServiceUnavailableException("Supabase returned an invalid user response");
    }

    return {
      id: parsed.data.id,
      ...(parsed.data.email === undefined ? {} : { email: parsed.data.email }),
    };
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
