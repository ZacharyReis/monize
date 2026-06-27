import { Body, Controller, Post, Request, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { DemoRestricted } from "../../common/decorators/demo-restricted.decorator";
import { AiActionsService } from "./ai-actions.service";
import { ConfirmAiActionDto } from "./dto/confirm-ai-action.dto";

/**
 * Confirms human-in-the-loop write actions the AI Assistant proposed. This is a
 * separate controller from the read-only query endpoints: it is owner-only (not
 * @AllowDelegate, so the global delegate guard rejects "acting as" sessions
 * fail-closed) and demo-restricted, since AI-driven writes are higher risk.
 */
@ApiTags("AI")
@Controller("ai/actions")
@UseGuards(AuthGuard("jwt"))
@ApiBearerAuth()
export class AiActionsController {
  constructor(private readonly actionsService: AiActionsService) {}

  @Post("confirm")
  @DemoRestricted()
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @ApiOperation({ summary: "Confirm a proposed AI Assistant write action" })
  async confirm(
    @Request() req: { user: { id: string } },
    @Body() dto: ConfirmAiActionDto,
  ) {
    return this.actionsService.confirm(req.user.id, dto);
  }
}
