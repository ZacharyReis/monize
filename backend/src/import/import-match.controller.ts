import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { ImportMatchService } from "./import-match.service";
import { MergeMatchDto } from "./dto/import.dto";

@ApiTags("import")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("import/matches")
export class ImportMatchController {
  constructor(private readonly matchService: ImportMatchService) {}

  @Get()
  listPending(@Req() req: any) {
    return this.matchService.listPending(req.user.id);
  }

  @Post(":id/merge")
  merge(
    @Req() req: any,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: MergeMatchDto,
  ) {
    return this.matchService.merge(req.user.id, id, body.transactionId);
  }

  @Post(":id/keep-both")
  keepBoth(@Req() req: any, @Param("id", ParseUUIDPipe) id: string) {
    return this.matchService.keepBoth(req.user.id, id);
  }
}
