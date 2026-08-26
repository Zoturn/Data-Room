import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { ApiErrorBody, ApiErrorCode, FieldError } from "@data-room/shared";
import type { Response } from "express";
import type { RequestWithId } from "../http-types";
import { DomainError } from "./domain-error";

/**
 * The single place that turns a failure into an HTTP response. Every non-2xx body in the
 * API has this shape, so the client can branch on `code` rather than parse a message.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();
    const requestId = request.requestId ?? "unknown";

    const { status, code, message, details } = this.classify(error);

    if (status >= 500) {
      // The client gets the id; the log gets everything else. Never leak a stack trace,
      // a driver message or SQL to the caller.
      this.logger.error(
        `${request.method} ${request.originalUrl} [${requestId}]`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    const body: ApiErrorBody = { code, message, requestId };
    if (details && details.length > 0) body.details = details;

    response.status(status).json(body);
  }

  private classify(error: unknown): {
    status: number;
    code: ApiErrorCode;
    message: string;
    details?: FieldError[];
  } {
    if (error instanceof DomainError) {
      const result = { status: error.status, code: error.code, message: error.message };
      return error.details ? { ...result, details: error.details } : result;
    }

    if (error instanceof HttpException) {
      const status = error.getStatus();
      return {
        status,
        code: this.codeForStatus(status),
        message: this.messageFor(status, error.message),
      };
    }

    return {
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Something went wrong on our side. Please try again.",
    };
  }

  private codeForStatus(status: number): ApiErrorCode {
    switch (status) {
      case 400:
        return "VALIDATION_FAILED";
      case 401:
        return "UNAUTHENTICATED";
      case 404:
        return "NOT_FOUND";
      case 409:
        return "NAME_CONFLICT";
      case 413:
        return "FILE_TOO_LARGE";
      case 429:
        return "RATE_LIMITED";
      default:
        return "INTERNAL_ERROR";
    }
  }

  private messageFor(status: number, fallback: string): string {
    // Anything 5xx is sanitised; below that the framework's message is safe to show.
    return status >= 500 ? "Something went wrong on our side. Please try again." : fallback;
  }
}
