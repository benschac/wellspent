import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { apiContract } from "@repo/api-contract";
import { AssistantService } from "./assistant.service.js";

@Controller()
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Implement(apiContract.assistant.chat)
  chat() {
    return implement(apiContract.assistant.chat).handler(
      async ({ errors, input, signal }) => {
        if (!this.assistantService.isConfigured()) {
          throw errors.SERVICE_UNAVAILABLE();
        }

        const stream = await this.assistantService.stream(input.messages, signal);

        if (stream === undefined) {
          throw errors.BAD_REQUEST();
        }

        return stream;
      },
    );
  }
}
