import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { streamToAsyncIteratorObject } from "@orpc/server";
import {
  convertToModelMessages,
  createGateway,
  safeValidateUIMessages,
  streamText,
  type UIMessage,
} from "ai";
import type { Environment } from "../config/environment.js";

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(private readonly config: ConfigService<Environment, true>) {}

  isConfigured(): boolean {
    return this.config.get("AI_GATEWAY_API_KEY", { infer: true }) !== undefined;
  }

  async stream(messages: UIMessage[], signal?: AbortSignal) {
    const validated = await safeValidateUIMessages({ messages });

    if (!validated.success) {
      return undefined;
    }

    const apiKey = this.config.get("AI_GATEWAY_API_KEY", { infer: true });
    if (apiKey === undefined) {
      return undefined;
    }

    const model = this.config.get("AI_MODEL", { infer: true });
    const gateway = createGateway({ apiKey });
    const result = streamText({
      ...(signal === undefined ? {} : { abortSignal: signal }),
      messages: await convertToModelMessages(validated.data),
      model: gateway(model),
      system:
        "You are a concise focus coach inside a timer app. Help the user choose a realistic next task, define a short focus interval, and remove distractions. Never claim to start, pause, or reset the timer.",
    });

    return streamToAsyncIteratorObject(
      result.toUIMessageStream({
        originalMessages: validated.data,
        sendReasoning: false,
        onError: (error) => {
          this.logger.error("Focus assistant stream failed", error);
          return "The focus assistant could not complete that response.";
        },
      }),
    );
  }
}
