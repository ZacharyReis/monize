import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "crypto";
import { AiActionDescriptor } from "./ai-action.types";

/**
 * How long a proposed action remains confirmable. Short by design: the user is
 * expected to approve or dismiss the card promptly, and a stale descriptor
 * (e.g. restored from a reloaded conversation) should not be executable.
 */
export const AI_ACTION_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Deterministically serialize a value with object keys sorted so the HMAC is
 * stable regardless of property insertion order. Arrays preserve order.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalize(
          (value as Record<string, unknown>)[key],
        )}`,
    );
  return `{${entries.join(",")}}`;
}

/**
 * Signs and verifies AI action descriptors with an HMAC so the confirm endpoint
 * can detect tampering. The key is derived from the existing JWT secret (with a
 * dedicated label) so no new environment variable is required; the signature is
 * a tamper-seal only -- the confirm endpoint still re-validates every field and
 * re-checks ownership.
 */
@Injectable()
export class AiActionSigningService {
  private readonly key: string;

  constructor(private readonly configService: ConfigService) {
    const base = this.configService.get<string>("JWT_SECRET") ?? "";
    // Label-separate so this key can never collide with another HMAC use of
    // the same secret (e.g. CSRF tokens).
    this.key = `${base}:ai-action-v1`;
  }

  /** Compute the hex HMAC-SHA256 over the canonical descriptor. */
  sign(descriptor: AiActionDescriptor): string {
    return createHmac("sha256", this.key)
      .update(canonicalize(descriptor))
      .digest("hex");
  }

  /**
   * Verify a descriptor against its signature with a timing-safe comparison.
   * Returns false on any mismatch (including malformed signatures).
   */
  verify(descriptor: AiActionDescriptor, signature: string): boolean {
    const expected = this.sign(descriptor);
    let expectedBuf: Buffer;
    let actualBuf: Buffer;
    try {
      expectedBuf = Buffer.from(expected, "hex");
      actualBuf = Buffer.from(signature, "hex");
    } catch {
      return false;
    }
    if (actualBuf.length === 0 || expectedBuf.length !== actualBuf.length) {
      return false;
    }
    return timingSafeEqual(expectedBuf, actualBuf);
  }
}
