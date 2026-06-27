import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { EmergencyAccessSettings } from "./entities/emergency-access-settings.entity";
import { EmergencyAccessContact } from "./entities/emergency-access-contact.entity";
import { EmergencyAccessService } from "./emergency-access.service";
import { EmergencyAccessMonitorService } from "./emergency-access-monitor.service";
import { EmergencyAccessController } from "./emergency-access.controller";
import { EmergencyAccessClaimController } from "./emergency-access-claim.controller";
import { User } from "../users/entities/user.entity";
import { UserPreference } from "../users/entities/user-preference.entity";
import { TrustedDevice } from "../users/entities/trusted-device.entity";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { AiModule } from "../ai/ai.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EmergencyAccessSettings,
      EmergencyAccessContact,
      User,
      UserPreference,
      TrustedDevice,
    ]),
    AuthModule,
    NotificationsModule,
    AiModule,
  ],
  providers: [EmergencyAccessService, EmergencyAccessMonitorService],
  controllers: [EmergencyAccessController, EmergencyAccessClaimController],
})
export class EmergencyAccessModule {}
