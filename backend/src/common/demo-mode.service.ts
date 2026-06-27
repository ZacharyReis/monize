import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class DemoModeService {
  readonly isDemo: boolean;
  private readonly logger = new Logger(DemoModeService.name);

  constructor(private configService: ConfigService) {
    const setting = this.configService.get<string>("DEMO_MODE", "false");
    this.isDemo = setting.toLowerCase() === "true";

    if (this.isDemo) {
      this.logger.log(
        "Demo mode is ACTIVE - restricted operations will be blocked",
      );
    }
  }
}
