import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Response } from "express";
import { QueryFailedError } from "typeorm";
import { tr } from "../../i18n/translate";
import { getRlsMode } from "../db/rls-config";

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);
  private readonly isProduction = process.env.NODE_ENV === "production";

  /**
   * True for the two Postgres errors RLS produces that must be mapped to a
   * generic 403 instead of surfacing raw: a WITH CHECK policy violation
   * (SQLSTATE 42501, "new row violates row-level security policy") and the
   * identity-GUC uuid cast on a non-UUID value (SQLSTATE 22P02, "invalid input
   * syntax for type uuid"). Returns false at `RLS_MODE=off`, where neither can
   * occur, so `off` behavior is unchanged and a stray non-RLS 22P02 keeps its
   * existing 500 mapping.
   */
  private isRlsViolation(driverError: {
    code?: string;
    message?: string;
  }): boolean {
    if (getRlsMode() === "off") {
      return false;
    }
    const dbMessage = (driverError?.message ?? "").toLowerCase();
    return (
      (driverError?.code === "42501" &&
        dbMessage.includes("row-level security")) ||
      (driverError?.code === "22P02" &&
        dbMessage.includes("invalid input syntax for type uuid"))
    );
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (response.headersSent) {
      return;
    }

    let status: number;
    let message: string | string[];
    // Optional machine-readable error codes forwarded from an HttpException's
    // object response, letting the client branch on the specific failure
    // without parsing the localized message.
    //
    // Two field names are carried deliberately. `errorCode` is upstream's
    // (e.g. "CURRENCY_INACTIVE"); `code` predates it in this fork (T-555
    // import match-review conflicts) and is also what the step-up guard/service
    // throw ("STEP_UP_REQUIRED", "STEP_UP_EXPIRED", "TOTP_REQUIRED", ...) and
    // what stepUpToken.ts and MatchReviewList.tsx read. Dropping either would
    // silently break a live consumer, so both are forwarded.
    let code: string | undefined;
    let errorCode: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();

      if (status === HttpStatus.TOO_MANY_REQUESTS) {
        message = tr(
          "errors.http.tooManyRequests",
          "Too many requests. Please wait a few minutes and try again.",
        );
      } else {
        const exceptionResponse = exception.getResponse();

        if (typeof exceptionResponse === "string") {
          message = exceptionResponse;
        } else if (
          typeof exceptionResponse === "object" &&
          exceptionResponse !== null
        ) {
          const resp = exceptionResponse as Record<string, unknown>;
          message = (resp.message as string | string[]) || exception.message;
          if (typeof resp.code === "string") code = resp.code;
          if (typeof resp.errorCode === "string") {
            errorCode = resp.errorCode;
          }
        } else {
          message = exception.message;
        }
      }
    } else if (exception instanceof QueryFailedError) {
      const driverError = exception.driverError as {
        code?: string;
        message?: string;
      };
      if (driverError?.code === "23505") {
        status = HttpStatus.CONFLICT;
        message = tr(
          "errors.http.duplicateRecord",
          "A record with this value already exists",
        );
      } else if (driverError?.code === "23503") {
        status = HttpStatus.BAD_REQUEST;
        message = tr(
          "errors.http.referencedRecord",
          "Referenced record does not exist or cannot be removed",
        );
      } else if (this.isRlsViolation(driverError)) {
        // Row-Level Security fail-closed paths -- a WITH CHECK policy violation
        // (42501) or the identity-GUC uuid cast on a malformed value (22P02).
        // These must never surface raw to users; app-level filtering normally
        // prevents reaching them at all. Gated on RLS_MODE so behavior at `off`
        // (no policies, no GUCs) is byte-for-byte unchanged. See design Phase 6.
        status = HttpStatus.FORBIDDEN;
        message = tr("errors.http.forbidden", "Access denied");
      } else {
        status = HttpStatus.INTERNAL_SERVER_ERROR;
        message = tr("errors.http.internal", "Internal server error");
      }
      this.logger.error("Database error", exception.stack);
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = tr("errors.http.internal", "Internal server error");

      this.logger.error(
        "Unhandled exception",
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      statusCode: status,
      message,
      ...(code ? { code } : {}),
      ...(errorCode ? { errorCode } : {}),
      ...(this.isProduction ? {} : { timestamp: new Date().toISOString() }),
    });
  }
}
