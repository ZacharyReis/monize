import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AttachmentsController } from "./attachments.controller";
import { AttachmentsService } from "./attachments.service";
import { AttachmentToolPrepService } from "./attachment-tool-prep.service";
import { DatabaseStorageProvider } from "./storage/database-storage.provider";
import { LocalStorageProvider } from "./storage/local-storage.provider";
import { S3StorageProvider } from "./storage/s3-storage.provider";
import { ATTACHMENT_STORAGE_PROVIDER } from "./storage/attachment-storage.interface";

/**
 * Transaction attachments. Bytes are stored via the injected storage provider,
 * selected by ATTACHMENT_STORAGE_PROVIDER: "database" (default) keeps bytes in
 * Postgres BYTEA; "local" writes them to a filesystem directory; "s3" stores
 * them in S3-compatible object storage. Entities are auto-registered via the
 * datasource glob, so no forFeature is needed -- the service reads repositories
 * from the tenantTx EntityManager.
 */
@Module({
  imports: [ConfigModule],
  controllers: [AttachmentsController],
  providers: [
    AttachmentsService,
    AttachmentToolPrepService,
    DatabaseStorageProvider,
    LocalStorageProvider,
    S3StorageProvider,
    {
      provide: ATTACHMENT_STORAGE_PROVIDER,
      useFactory: (
        config: ConfigService,
        database: DatabaseStorageProvider,
        local: LocalStorageProvider,
        s3: S3StorageProvider,
      ) => {
        const kind = (
          config.get<string>("ATTACHMENT_STORAGE_PROVIDER") ?? "database"
        ).toLowerCase();
        if (kind === "s3") return s3;
        if (kind === "local") return local;
        return database;
      },
      inject: [
        ConfigService,
        DatabaseStorageProvider,
        LocalStorageProvider,
        S3StorageProvider,
      ],
    },
  ],
  exports: [AttachmentsService, AttachmentToolPrepService],
})
export class AttachmentsModule {}
