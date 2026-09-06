import { BadGatewayException, Inject, Injectable } from "@nestjs/common";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import { GoogleConfig, type GoogleIntegration } from "./google.config.js";

@Injectable()
export class GoogleOAuthClient {
  constructor(@Inject(GoogleConfig) private readonly config: GoogleConfig) {}
  private client(integration?: GoogleIntegration) {
    return new OAuth2Client({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      ...(integration
        ? { redirectUri: this.config.redirectUri(integration) }
        : {}),
      transporterOptions: { timeout: 15_000, retry: false },
    });
  }
  authorizationUrl(input: {
    integration: GoogleIntegration;
    state: string;
    codeChallenge: string;
    scopes: string[];
    subject?: string;
  }) {
    return this.client(input.integration).generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: true,
      scope: input.scopes,
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      ...(input.subject ? { login_hint: input.subject } : {}),
    });
  }
  async exchange(
    integration: GoogleIntegration,
    code: string,
    codeVerifier: string,
  ) {
    const client = this.client(integration);
    const { tokens } = await client.getToken({ code, codeVerifier });
    if (!tokens.access_token || !tokens.id_token)
      throw new BadGatewayException("Google returned incomplete credentials");
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: this.config.clientId,
    });
    const subject = ticket.getPayload()?.sub;
    if (!subject)
      throw new BadGatewayException("Google account identity was missing");
    const info = await client.getTokenInfo(tokens.access_token);
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? undefined,
      scopes: info.scopes,
      subject,
    };
  }
  async refresh(refreshToken: string) {
    const client = this.client();
    client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await client.refreshAccessToken();
    if (!credentials.access_token)
      throw new BadGatewayException("Google returned no access token");
    return credentials.access_token;
  }
  async subject(refreshToken: string) {
    const accessToken = await this.refresh(refreshToken);
    const info = await this.client().getTokenInfo(accessToken);
    return info.sub ?? info.user_id;
  }
  async revoke(refreshToken: string) {
    await this.client().revokeToken(refreshToken);
  }
  async inspectRefreshToken(refreshToken: string) {
    const accessToken = await this.refresh(refreshToken);
    return this.client().getTokenInfo(accessToken);
  }
}
