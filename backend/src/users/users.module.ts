import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "./entities/user.entity";
import { UserPreference } from "./entities/user-preference.entity";
import { TrustedDevice } from "./entities/trusted-device.entity";
import { RefreshToken } from "../auth/entities/refresh-token.entity";
import { PersonalAccessToken } from "../auth/entities/personal-access-token.entity";
import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";
import { PasswordBreachService } from "../auth/password-breach.service";

/**
 * `PasswordBreachService` is re-provided here (rather than imported from
 * AuthModule) on purpose: the dependency chain
 * `NotificationsModule -> UsersModule -> AuthModule -> NotificationsModule`
 * cannot be broken by a single `forwardRef`. Since `PasswordBreachService`
 * is stateless (HIBP HTTP client, no in-memory cache), the duplicate
 * instance has no correctness or memory cost.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      UserPreference,
      TrustedDevice,
      RefreshToken,
      PersonalAccessToken,
    ]),
  ],
  providers: [UsersService, PasswordBreachService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
