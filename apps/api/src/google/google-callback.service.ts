import { Inject, Injectable } from "@nestjs/common";
import { GoogleConfig, type GoogleIntegration } from "./google.config.js";

// Only the response operations needed by the callback; no Express type dependency.
export interface GoogleCallbackResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}

@Injectable()
export class GoogleCallbackService {
  constructor(@Inject(GoogleConfig) private readonly config: GoogleConfig) {}

  async complete<T>(
    integration: GoogleIntegration,
    authorize: () => Promise<T>,
    response: GoogleCallbackResponse,
  ): Promise<T | undefined> {
    const returnUrl = this.config.returnUrl;
    // API consumers retain the existing JSON response and exception behavior.
    if (!returnUrl) return authorize();

    const destination = new URL(returnUrl);
    destination.search = "";
    destination.hash = "";
    destination.searchParams.set("google", integration);
    try {
      await authorize();
      destination.searchParams.set("result", "connected");
    } catch {
      // Provider errors, OAuth codes, and state must never enter the return URL.
      destination.searchParams.set("result", "error");
    }
    response.status(302);
    response.setHeader("Location", destination.toString());
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    // Nest sends the empty response after applying the passthrough headers.
    return undefined;
  }
}
