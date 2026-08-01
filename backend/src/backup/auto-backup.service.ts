import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { Repository, LessThanOrEqual } from "typeorm";
import { Cron } from "@nestjs/schedule";
import { promises as fs, readdirSync, unlinkSync, copyFileSync } from "fs";
import { resolve } from "path";
import { AutoBackupSettings } from "./entities/auto-backup-settings.entity";
import { BackupService } from "./backup.service";
import { User } from "../users/entities/user.entity";
import { withSystemContext, withUserContext } from "../common/db/with-context";
import {
  UpdateAutoBackupSettingsDto,
  AutoBackupFrequency,
} from "./dto/update-auto-backup-settings.dto";
import { tr } from "../i18n/translate";

const BACKUP_FILE_PREFIX = "monize-backup-";

/**
 * Folder automatic backups are written to when BACKUP_CONTAINER_DIR is unset.
 * Monize runs in a container, so this is a container path: mount a host folder
 * there (see .env.example and the docker-compose files).
 */
export const DEFAULT_BACKUP_CONTAINER_DIR = "/data/backups";

// File extensions: .json.gz for unencrypted, .mzbe for encrypted Monize backups.
// Retention enforcement matches both so we can clean up legacy and encrypted
// files uniformly.
const DAILY_FILE_PATTERN =
  /^monize-backup-daily-(\d{4}-\d{2}-\d{2})\.(json\.gz|mzbe)$/;
const WEEKLY_FILE_PATTERN =
  /^monize-backup-weekly-(\d{4}-\d{2}-\d{2})\.(json\.gz|mzbe)$/;
const MONTHLY_FILE_PATTERN =
  /^monize-backup-monthly-(\d{2}-\d{2})\.(json\.gz|mzbe)$/;

const WEEKLY_DAYS = [7, 14, 21, 28];

const FREQUENCY_HOURS: Record<AutoBackupFrequency, number> = {
  every6hours: 6,
  every12hours: 12,
  daily: 24,
  weekly: 168,
};

interface BackupFile {
  name: string;
  date: Date;
  tier: "daily" | "weekly" | "monthly";
}

function parseDateString(ds: string): Date | null {
  const date = new Date(ds + "T00:00:00Z");
  return isNaN(date.getTime()) ? null : date;
}

function parseYearMonthString(ym: string): Date | null {
  const date = new Date(`20${ym}-01T00:00:00Z`);
  return isNaN(date.getTime()) ? null : date;
}

@Injectable()
export class AutoBackupService {
  private readonly logger = new Logger(AutoBackupService.name);

  /** Deployment-wide backup folder (BACKUP_CONTAINER_DIR), used whenever a user has not
   *  chosen one of their own. */
  private readonly defaultFolderPath: string;

  constructor(
    @InjectRepository(AutoBackupSettings)
    private readonly settingsRepo: Repository<AutoBackupSettings>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly backupService: BackupService,
    config: ConfigService,
  ) {
    this.defaultFolderPath = this.resolveConfiguredFolderPath(
      config.get<string>("BACKUP_CONTAINER_DIR"),
    );
  }

  /**
   * BACKUP_CONTAINER_DIR is operator-supplied, so it goes through the same CWE-22
   * validation as a user-supplied path. An unusable value falls back to the
   * built-in default with a loud log rather than taking the whole app down.
   */
  private resolveConfiguredFolderPath(configured: string | undefined): string {
    const trimmed = configured?.trim();
    if (!trimmed) return DEFAULT_BACKUP_CONTAINER_DIR;
    try {
      return this.validateFolderPath(trimmed);
    } catch (error) {
      this.logger.error(
        `Invalid BACKUP_CONTAINER_DIR "${trimmed}": ${error.message}. Falling back to ${DEFAULT_BACKUP_CONTAINER_DIR}`,
      );
      return DEFAULT_BACKUP_CONTAINER_DIR;
    }
  }

  /**
   * The folder a backup should be written to: the user's own choice when they
   * have one, otherwise the deployment-wide default.
   */
  private resolveFolderPath(folderPath: string | null | undefined): string {
    const trimmed = folderPath?.trim();
    return trimmed ? trimmed : this.defaultFolderPath;
  }

  /** Settings for a user with no persisted row yet (not saved by this method). */
  private defaultSettingsFor(userId: string): AutoBackupSettings {
    const defaults = new AutoBackupSettings();
    defaults.userId = userId;
    defaults.enabled = false;
    defaults.folderPath = this.defaultFolderPath;
    defaults.frequency = "daily";
    defaults.backupTime = "02:00";
    defaults.timezone = "UTC";
    defaults.retentionDaily = 7;
    defaults.retentionWeekly = 4;
    defaults.retentionMonthly = 6;
    defaults.lastBackupAt = null;
    defaults.lastBackupStatus = null;
    defaults.lastBackupError = null;
    defaults.nextBackupAt = null;
    return defaults;
  }

  async getSettings(userId: string): Promise<AutoBackupSettings> {
    const existing = await this.settingsRepo.findOne({
      where: { userId },
    });
    if (!existing) return this.defaultSettingsFor(userId);

    // Report the folder backups are actually written to, so a stored row that
    // never had one chosen shows the deployment default instead of a blank.
    return Object.assign(new AutoBackupSettings(), existing, {
      folderPath: this.resolveFolderPath(existing.folderPath),
    });
  }

  async updateSettings(
    userId: string,
    dto: UpdateAutoBackupSettingsDto,
  ): Promise<AutoBackupSettings> {
    let settings = await this.settingsRepo.findOne({
      where: { userId },
    });

    if (!settings) {
      // Seed the row with the same defaults getSettings reports, so an update
      // that only touches one field still lands on a complete row.
      settings = this.settingsRepo.create(this.defaultSettingsFor(userId));
    }

    if (dto.folderPath !== undefined) {
      settings.folderPath = this.validateFolderPath(dto.folderPath);
    }
    if (dto.frequency !== undefined) {
      settings.frequency = dto.frequency;
    }
    if (dto.backupTime !== undefined) {
      settings.backupTime = dto.backupTime;
    }
    if (dto.timezone !== undefined) {
      settings.timezone = dto.timezone;
    }
    if (dto.retentionDaily !== undefined) {
      settings.retentionDaily = dto.retentionDaily;
    }
    if (dto.retentionWeekly !== undefined) {
      settings.retentionWeekly = dto.retentionWeekly;
    }
    if (dto.retentionMonthly !== undefined) {
      settings.retentionMonthly = dto.retentionMonthly;
    }

    if (dto.enabled !== undefined) {
      settings.enabled = dto.enabled;
      if (dto.enabled) {
        // Persist the resolved folder so the stored row always records where
        // backups actually go, even when the user never picked one.
        settings.folderPath = this.resolveFolderPath(settings.folderPath);
        await this.assertFolderWritable(settings.folderPath);
        settings.nextBackupAt = this.calculateNextBackupAt(
          settings.frequency as AutoBackupFrequency,
          settings.backupTime,
          settings.timezone,
          new Date(),
        );
      } else {
        settings.nextBackupAt = null;
      }
    }

    return this.settingsRepo.save(settings);
  }

  async validateFolder(
    folderPath: string,
  ): Promise<{ valid: boolean; error?: string }> {
    try {
      const safePath = this.validateFolderPath(folderPath);
      await this.assertFolderWritable(safePath);
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  async browseFolders(
    folderPath: string,
  ): Promise<{ current: string; directories: string[] }> {
    const safePath = this.validateFolderPath(folderPath);

    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(safePath);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new BadRequestException(
          tr(
            "errors.backup.folderNotExist",
            `Folder does not exist: ${safePath}`,
            { safePath },
          ),
        );
      }
      throw new BadRequestException(
        tr(
          "errors.backup.folderAccessError",
          `Cannot access folder: ${safePath}`,
          { safePath },
        ),
      );
    }

    if (!stat.isDirectory()) {
      throw new BadRequestException(
        tr(
          "errors.backup.pathNotDirectory",
          `Path is not a directory: ${safePath}`,
          { safePath },
        ),
      );
    }

    const entries = await fs.readdir(safePath, { withFileTypes: true });
    const directories = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));

    return { current: safePath, directories };
  }

  async runManualBackup(
    userId: string,
  ): Promise<{ message: string; filename: string }> {
    // A user who has never opened the auto-backup settings still gets a working
    // manual run: the row is seeded with defaults here and persisted by the
    // save at the end of this method.
    const settings =
      (await this.settingsRepo.findOne({ where: { userId } })) ??
      this.settingsRepo.create(this.defaultSettingsFor(userId));
    settings.folderPath = this.resolveFolderPath(settings.folderPath);

    await this.assertFolderWritable(settings.folderPath);
    const timezone = settings.timezone || "UTC";
    const filename = await this.exportToFile(
      userId,
      settings.folderPath,
      timezone,
    );
    this.copyToWeeklyIfNeeded(settings.folderPath, filename, timezone);
    this.copyToMonthlyIfNeeded(settings.folderPath, filename, timezone);
    this.enforceRetention(settings.folderPath, settings);

    settings.lastBackupAt = new Date();
    settings.lastBackupStatus = "success";
    settings.lastBackupError = null;
    if (settings.enabled) {
      settings.nextBackupAt = this.calculateNextBackupAt(
        settings.frequency as AutoBackupFrequency,
        settings.backupTime,
        settings.timezone,
        new Date(),
      );
    }
    await this.settingsRepo.save(settings);

    return { message: "Backup completed successfully", filename };
  }

  @Cron("0 * * * *")
  async handleAutoBackupCron(): Promise<void> {
    const now = new Date();
    // RLS (task C2): cross-user fan-out over every user's due backup settings.
    const dueSettings = await withSystemContext(() =>
      this.settingsRepo.find({
        where: {
          enabled: true,
          nextBackupAt: LessThanOrEqual(now),
        },
      }),
    );

    if (dueSettings.length === 0) return;

    this.logger.log(`Auto-backup cron: ${dueSettings.length} backup(s) due`);

    for (const settings of dueSettings) {
      try {
        settings.folderPath = this.resolveFolderPath(settings.folderPath);
        await this.assertFolderWritable(settings.folderPath);
        const timezone = settings.timezone || "UTC";
        // RLS (task C2): the export reads this user's entire dataset, and the
        // settings write below is that user's row -- both under a user context.
        const filename = await withUserContext(settings.userId, () =>
          this.exportToFile(settings.userId, settings.folderPath, timezone),
        );
        this.copyToWeeklyIfNeeded(settings.folderPath, filename, timezone);
        this.copyToMonthlyIfNeeded(settings.folderPath, filename, timezone);
        this.enforceRetention(settings.folderPath, settings);

        settings.lastBackupAt = now;
        settings.lastBackupStatus = "success";
        settings.lastBackupError = null;
        settings.nextBackupAt = this.calculateNextBackupAt(
          settings.frequency as AutoBackupFrequency,
          settings.backupTime,
          settings.timezone,
          now,
        );
        await withUserContext(settings.userId, () =>
          this.settingsRepo.save(settings),
        );

        this.logger.log(
          `Auto-backup completed for user ${settings.userId}: ${filename}`,
        );
      } catch (error) {
        this.logger.error(
          `Auto-backup failed for user ${settings.userId}: ${error.message}`,
        );
        settings.lastBackupAt = now;
        settings.lastBackupStatus = "failed";
        settings.lastBackupError = String(error.message).slice(0, 1024);
        settings.nextBackupAt = this.calculateNextBackupAt(
          settings.frequency as AutoBackupFrequency,
          settings.backupTime,
          settings.timezone,
          now,
        );
        await withUserContext(settings.userId, () =>
          this.settingsRepo.save(settings),
        );
      }
    }
  }

  private async exportToFile(
    userId: string,
    folderPath: string,
    timezone: string,
  ): Promise<string> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException(
        tr("errors.backup.userNotFound", `User ${userId} not found`, {
          userId,
        }),
      );
    }

    const encryptionPassword =
      this.backupService.resolveStoredBackupPassword(user) ?? undefined;
    if (user.backupEncryptionEnabled && !encryptionPassword) {
      // User opted into encryption but we can't recover the password
      // (likely AI_ENCRYPTION_KEY rotated). Fail loud rather than silently
      // writing an unencrypted backup.
      throw new BadRequestException(
        tr(
          "errors.backup.encryptedPasswordDecryptFailed",
          "Encrypted backups are enabled but the stored password could not be decrypted. Re-enable encryption in Security settings.",
        ),
      );
    }

    const dateStr = this.getLocalDateString(new Date(), timezone);
    const ext = encryptionPassword ? "mzbe" : "json.gz";
    const filename = `${BACKUP_FILE_PREFIX}daily-${dateStr}.${ext}`;
    const filepath = this.safePath(folderPath, filename);

    const payload = await this.backupService.exportToBuffer(
      userId,
      encryptionPassword,
    );
    await fs.writeFile(filepath, payload);

    this.logger.log(
      `Backup written to ${filepath}${encryptionPassword ? " (encrypted)" : ""}`,
    );
    return filename;
  }

  private copyToWeeklyIfNeeded(
    folderPath: string,
    dailyFilename: string,
    timezone: string,
  ): void {
    const dayOfMonth = this.getLocalDayOfMonth(new Date(), timezone);
    if (!WEEKLY_DAYS.includes(dayOfMonth)) return;

    const ext = dailyFilename.endsWith(".mzbe") ? "mzbe" : "json.gz";
    const dateStr = this.getLocalDateString(new Date(), timezone);
    const weeklyFilename = `${BACKUP_FILE_PREFIX}weekly-${dateStr}.${ext}`;
    try {
      copyFileSync(
        this.safePath(folderPath, dailyFilename),
        this.safePath(folderPath, weeklyFilename),
      );
      this.logger.log(`Copied daily backup to weekly: ${weeklyFilename}`);
    } catch (err) {
      this.logger.warn(`Failed to copy daily to weekly: ${err.message}`);
    }
  }

  private copyToMonthlyIfNeeded(
    folderPath: string,
    dailyFilename: string,
    timezone: string,
  ): void {
    const dayOfMonth = this.getLocalDayOfMonth(new Date(), timezone);
    if (dayOfMonth !== 1) return;

    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "2-digit",
      month: "2-digit",
    });
    const parts = formatter.formatToParts(now);
    const year = parts.find((p) => p.type === "year")!.value;
    const month = parts.find((p) => p.type === "month")!.value;
    const ext = dailyFilename.endsWith(".mzbe") ? "mzbe" : "json.gz";
    const monthlyFilename = `${BACKUP_FILE_PREFIX}monthly-${year}-${month}.${ext}`;

    try {
      copyFileSync(
        this.safePath(folderPath, dailyFilename),
        this.safePath(folderPath, monthlyFilename),
      );
      this.logger.log(`Copied daily backup to monthly: ${monthlyFilename}`);
    } catch (err) {
      this.logger.warn(`Failed to copy daily to monthly: ${err.message}`);
    }
  }

  private enforceRetention(
    folderPath: string,
    settings: AutoBackupSettings,
  ): void {
    let entries: string[];
    try {
      entries = readdirSync(folderPath);
    } catch {
      return;
    }

    const dailyFiles: BackupFile[] = [];
    const weeklyFiles: BackupFile[] = [];
    const monthlyFiles: BackupFile[] = [];

    for (const name of entries) {
      const dailyMatch = DAILY_FILE_PATTERN.exec(name);
      if (dailyMatch) {
        const date = parseDateString(dailyMatch[1]);
        if (date) dailyFiles.push({ name, date, tier: "daily" });
        continue;
      }
      const weeklyMatch = WEEKLY_FILE_PATTERN.exec(name);
      if (weeklyMatch) {
        const date = parseDateString(weeklyMatch[1]);
        if (date) weeklyFiles.push({ name, date, tier: "weekly" });
        continue;
      }
      const monthlyMatch = MONTHLY_FILE_PATTERN.exec(name);
      if (monthlyMatch) {
        const date = parseYearMonthString(monthlyMatch[1]);
        if (date) monthlyFiles.push({ name, date, tier: "monthly" });
        continue;
      }
    }

    // Sort each tier newest first and delete beyond retention limit
    const deleteExcess = (files: BackupFile[], limit: number) => {
      const sorted = [...files].sort(
        (a, b) => b.date.getTime() - a.date.getTime(),
      );
      for (let i = limit; i < sorted.length; i++) {
        try {
          unlinkSync(this.safePath(folderPath, sorted[i].name));
          this.logger.log(`Retention: deleted old backup ${sorted[i].name}`);
        } catch (err) {
          this.logger.warn(
            `Retention: failed to delete ${sorted[i].name}: ${err.message}`,
          );
        }
      }
    };

    deleteExcess(dailyFiles, settings.retentionDaily);
    deleteExcess(weeklyFiles, settings.retentionWeekly);
    deleteExcess(monthlyFiles, settings.retentionMonthly);
  }

  private getLocalDateString(date: Date, timezone: string): string {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(date);
  }

  private getLocalDayOfMonth(date: Date, timezone: string): number {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      day: "numeric",
    });
    return Number(formatter.format(date));
  }

  private calculateNextBackupAt(
    frequency: AutoBackupFrequency,
    backupTime: string,
    timezone: string,
    fromDate: Date,
  ): Date {
    const [hours] = backupTime.split(":").map(Number);
    const intervalHours = FREQUENCY_HOURS[frequency] ?? 24;

    // Snap minutes to 0 -- the cron fires at minute 0 of each hour,
    // so non-zero minutes would cause the backup to run an hour late.
    const todayInTz = this.localTimeToUtc(fromDate, hours, 0, timezone);

    if (frequency === "daily" || frequency === "weekly") {
      const next = new Date(todayInTz);

      // If the target time is in the past for today, move forward by one interval
      if (next.getTime() <= fromDate.getTime()) {
        next.setTime(next.getTime() + intervalHours * 60 * 60 * 1000);
      }
      return next;
    }

    // Sub-daily frequencies (every6hours, every12hours):
    // Align to the configured time, then add interval increments
    let next = new Date(todayInTz);
    while (next.getTime() <= fromDate.getTime()) {
      next = new Date(next.getTime() + intervalHours * 60 * 60 * 1000);
    }
    return next;
  }

  /**
   * Convert a local time (hours:minutes) in the given timezone to a UTC Date
   * for the same calendar day as `referenceDate`.
   */
  private localTimeToUtc(
    referenceDate: Date,
    hours: number,
    minutes: number,
    timezone: string,
  ): Date {
    // Get the current date parts in the target timezone
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(referenceDate);
    const year = parts.find((p) => p.type === "year")!.value;
    const month = parts.find((p) => p.type === "month")!.value;
    const day = parts.find((p) => p.type === "day")!.value;

    // Build an ISO string representing the local time in the timezone,
    // then compute the UTC equivalent by finding the offset
    const localIso = `${year}-${month}-${day}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;

    // Use the timezone offset at that specific moment to convert to UTC
    const offsetMs = this.getTimezoneOffsetMs(localIso, timezone);
    return new Date(new Date(localIso + "Z").getTime() - offsetMs);
  }

  /**
   * Get the UTC offset in milliseconds for a given local datetime in a timezone.
   */
  private getTimezoneOffsetMs(localIso: string, timezone: string): number {
    const utcDate = new Date(localIso + "Z");
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(utcDate);
    const get = (type: string) => parts.find((p) => p.type === type)!.value;
    const localAtUtc = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`;
    return new Date(localAtUtc).getTime() - utcDate.getTime();
  }

  /**
   * Safely join a folder path with a filename, ensuring the result
   * stays within the base folder (prevents path traversal CWE-22).
   */
  private safePath(basePath: string, filename: string): string {
    const full = resolve(basePath, filename);
    if (!full.startsWith(basePath + "/") && full !== basePath) {
      throw new BadRequestException(
        tr(
          "errors.backup.pathTraversal",
          `Path traversal detected: ${filename}`,
          { filename },
        ),
      );
    }
    return full;
  }

  /**
   * Validate a user-supplied folder path and return the normalized form.
   * All filesystem operations must use the returned value (not the original
   * input) so CodeQL/SAST tools can see the explicit sanitization boundary
   * (CWE-22: Path traversal).
   */
  private validateFolderPath(folderPath: string): string {
    if (typeof folderPath !== "string") {
      throw new BadRequestException(
        tr(
          "errors.backup.folderPathMustBeString",
          "Folder path must be a string",
        ),
      );
    }
    if (folderPath.length > 4096) {
      throw new BadRequestException(
        tr("errors.backup.folderPathTooLong", "Folder path is too long"),
      );
    }
    if (!folderPath.startsWith("/")) {
      throw new BadRequestException(
        tr(
          "errors.backup.folderPathMustBeAbsolute",
          "Folder path must be an absolute path",
        ),
      );
    }
    if (folderPath.includes("..")) {
      throw new BadRequestException(
        tr(
          "errors.backup.folderPathNoDotDot",
          "Folder path must not contain '..' segments",
        ),
      );
    }
    if (folderPath.includes("\0")) {
      throw new BadRequestException(
        tr(
          "errors.backup.folderPathNoNullBytes",
          "Folder path must not contain null bytes",
        ),
      );
    }
    // Trim trailing slashes without a greedy regex (avoids ReDoS on '/' runs).
    let trimmed = folderPath;
    while (trimmed.length > 1 && trimmed.endsWith("/")) {
      trimmed = trimmed.slice(0, -1);
    }
    // Ensure the resolved path matches the input (no symlink-like tricks via //)
    const normalized = resolve(trimmed);
    if (normalized !== trimmed) {
      throw new BadRequestException(
        tr(
          "errors.backup.folderPathMustBeNormalized",
          "Folder path must be a normalized absolute path",
        ),
      );
    }
    return normalized;
  }

  /**
   * Ensure `safePath` is an existing directory. The configured default folder
   * is created on first use so a deployment only has to mount the volume;
   * user-chosen folders must already exist, since creating arbitrary paths on
   * demand would mask typos.
   */
  private async assertDirectoryExists(safePath: string): Promise<void> {
    try {
      const stat = await fs.stat(safePath);
      if (!stat.isDirectory()) {
        throw new BadRequestException(
          tr(
            "errors.backup.pathNotDirectory",
            `Path is not a directory: ${safePath}`,
            { safePath },
          ),
        );
      }
      return;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (error.code !== "ENOENT") {
        throw new BadRequestException(
          tr(
            "errors.backup.folderAccessErrorDetail",
            `Cannot access folder: ${safePath} - ${error.message}`,
            { safePath, message: error.message },
          ),
        );
      }
      if (safePath !== this.defaultFolderPath) {
        throw new BadRequestException(
          tr(
            "errors.backup.folderNotExistVolume",
            `Folder does not exist: ${safePath}. Ensure the path is mapped as a Docker volume.`,
            { safePath },
          ),
        );
      }
    }

    try {
      await fs.mkdir(safePath, { recursive: true });
      this.logger.log(`Created backup folder ${safePath}`);
    } catch (error) {
      this.logger.error(
        `Failed to create backup folder ${safePath}: ${error.message}`,
      );
      throw new BadRequestException(
        tr(
          "errors.backup.folderNotExistVolume",
          `Folder does not exist: ${safePath}. Ensure the path is mapped as a Docker volume.`,
          { safePath },
        ),
      );
    }
  }

  private async assertFolderWritable(folderPath: string): Promise<void> {
    // Re-validate defensively: this method is also invoked with folder paths
    // read back from the database (originally user-supplied), so CWE-22
    // sanitization must run every time before we touch the filesystem.
    const safePath = this.validateFolderPath(folderPath);
    await this.assertDirectoryExists(safePath);

    // Test write access by creating and removing a temporary file
    const testFile = this.safePath(
      safePath,
      `.monize-write-test-${Date.now()}`,
    );
    try {
      await fs.writeFile(testFile, "");
      await fs.unlink(testFile);
    } catch {
      throw new BadRequestException(
        tr(
          "errors.backup.folderNotWritable",
          `Folder is not writable: ${safePath}. Check container permissions.`,
          { safePath },
        ),
      );
    }
  }
}
