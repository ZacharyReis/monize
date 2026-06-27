import {
  IsString,
  MaxLength,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
  IsIn,
  IsBase64,
  ArrayMaxSize,
} from "class-validator";
import { Type } from "class-transformer";
import { SanitizeHtml } from "../../../common/decorators/sanitize-html.decorator";

class ConversationMessageDto {
  @IsIn(["user", "assistant"])
  role: "user" | "assistant";

  @IsString()
  @MaxLength(50000)
  content: string;
}

/**
 * Maximum number of conversation history messages the client may send.
 * Keeps context size bounded while allowing enough turns for a
 * natural back-and-forth (10 pairs of user+assistant messages).
 */
export const MAX_HISTORY_MESSAGES = 20;

/** Maximum number of attachments allowed on a single query. */
export const MAX_ATTACHMENTS = 5;

/** Maximum decoded size of a single attachment (5 MB). */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/**
 * Maximum combined decoded size of all attachments on one query (20 MB). Kept
 * comfortably under Anthropic's 32 MB decoded request ceiling; the per-field
 * base64 length cap below bounds the raw HTTP body.
 */
export const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/**
 * Upper bound on a single attachment's base64 string length. base64 inflates
 * bytes by ~4/3, so 5 MB decoded is ~6.99 MB encoded; allow slack for padding
 * and any stray whitespace (the service does the exact decoded-byte check).
 */
export const MAX_ATTACHMENT_BASE64_LENGTH = 7_200_000;

/** MIME types the assistant accepts as attachments. */
export const ALLOWED_ATTACHMENT_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/csv",
  "text/plain",
] as const;

export type AttachmentKind = "image" | "pdf" | "text";

export class AttachmentDto {
  @IsIn(["image", "pdf", "text"])
  kind: AttachmentKind;

  @IsIn(ALLOWED_ATTACHMENT_MEDIA_TYPES as unknown as string[])
  mediaType: string;

  @IsString()
  @MaxLength(255)
  filename: string;

  // base64 payload, no `data:` prefix. Not @SanitizeHtml -- that would corrupt
  // the encoding. Treated as opaque bytes and never rendered as HTML server
  // side. The service re-validates the decoded size and magic bytes.
  @IsString()
  @IsBase64()
  @MaxLength(MAX_ATTACHMENT_BASE64_LENGTH)
  data: string;
}

export class AiQueryDto {
  @IsString()
  @MaxLength(2000)
  @IsNotEmpty()
  @SanitizeHtml()
  query: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConversationMessageDto)
  conversationHistory?: ConversationMessageDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTACHMENTS)
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];
}
