import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { WhatsNewService, WhatsNewStatus } from "./whats-new.service";

@ApiTags("Updates")
@ApiBearerAuth()
@Controller("updates/whats-new")
@UseGuards(AuthGuard("jwt"))
export class WhatsNewController {
  constructor(private readonly whatsNewService: WhatsNewService) {}

  @Get()
  @ApiOperation({
    summary:
      "Get the current version's release-notes digest and whether it should auto-show for this user.",
  })
  getWhatsNew(@Request() req): Promise<WhatsNewStatus> {
    return this.whatsNewService.getWhatsNew(req.user.id);
  }

  @Post("seen")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Acknowledge the current version's release notes so the digest stops auto-showing (Don't show this again).",
  })
  markSeen(@Request() req) {
    return this.whatsNewService.markSeen(req.user.id);
  }

  @Post("remind")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Clear the current version's acknowledgement so the digest auto-shows again next login (Show at next login).",
  })
  remindNextLogin(@Request() req) {
    return this.whatsNewService.remindNextLogin(req.user.id);
  }
}
