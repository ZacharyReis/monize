import { ApiProperty } from "@nestjs/swagger";
import { IsObject, IsString, MaxLength } from "class-validator";

/**
 * Body for confirming a human-in-the-loop AI action. The `descriptor` is the
 * signed payload the assistant proposed (echoed back verbatim by the browser);
 * the server verifies `signature`, re-validates the descriptor fields, and only
 * then performs the write.
 */
export class ConfirmAiActionDto {
  @ApiProperty({ description: "Action id, must match descriptor.actionId" })
  @IsString()
  @MaxLength(64)
  actionId: string;

  @ApiProperty({ description: "HMAC signature of the descriptor" })
  @IsString()
  @MaxLength(256)
  signature: string;

  @ApiProperty({
    description: "The signed action descriptor proposed by the assistant",
  })
  @IsObject()
  descriptor: Record<string, unknown>;
}
