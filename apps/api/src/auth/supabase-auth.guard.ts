import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "./auth.types.js";
import { SupabaseAuthService } from "./supabase-auth.service.js";

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private readonly auth: SupabaseAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    request.authUser = await this.auth.authenticate(
      Array.isArray(authorization) ? authorization[0] : authorization,
    );
    return true;
  }
}
