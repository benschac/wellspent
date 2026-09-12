import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CryptoModule } from "../crypto/crypto.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { GoogleConfig } from "./google.config.js";
import { GoogleController } from "./google.controller.js";
import { GoogleRepository } from "./google.repository.js";
import { GoogleCallbackService } from "./google-callback.service.js";
import { GoogleOAuthClient } from "./google-oauth.client.js";
import { GoogleOAuthService } from "./google-oauth.service.js";

@Module({
  imports: [AuthModule, CryptoModule, DatabaseModule],
  controllers: [GoogleController],
  providers: [
    GoogleConfig,
    GoogleCallbackService,
    GoogleRepository,
    GoogleOAuthClient,
    GoogleOAuthService,
  ],
  exports: [
    GoogleConfig,
    GoogleCallbackService,
    GoogleRepository,
    GoogleOAuthService,
  ],
})
export class GoogleModule {}
