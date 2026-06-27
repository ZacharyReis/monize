import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { REQUIRE_SCOPE_KEY } from "../decorators/require-scope.decorator";
import { tr } from "../../i18n/translate";

/**
 * Guard that enforces PAT scope requirements on endpoints.
 * If the request is authenticated via PAT (indicated by req.user.patScopes),
 * it checks that the token has all required scopes. JWT-authenticated
 * requests (no patScopes) are allowed through unconditionally.
 */
@Injectable()
export class PatScopeGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredScopes = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredScopes || requiredScopes.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // JWT-authenticated requests have no patScopes -- allow through
    if (!user?.patScopes) {
      return true;
    }

    const tokenScopes = user.patScopes.split(",").map((s: string) => s.trim());

    const hasAllScopes = requiredScopes.every((scope) =>
      tokenScopes.includes(scope),
    );

    if (!hasAllScopes) {
      const requiredScopesStr = requiredScopes.join(", ");
      throw new ForbiddenException(
        tr(
          "errors.auth.insufficientTokenScope",
          `Insufficient token scope. Required: ${requiredScopesStr}`,
          { requiredScopes: requiredScopesStr },
        ),
      );
    }

    return true;
  }
}
