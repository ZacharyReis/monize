import { Injectable } from "@nestjs/common";
import {
  PayeesService,
  CreatePayeePreview,
  UpdatePayeePreview,
  DeletePayeePreview,
} from "./payees.service";
import {
  AiActionPreviewRow,
  BatchCreatePayeeRow,
  BatchUpdatePayeeRow,
  BatchDeletePayeeRow,
} from "../ai/actions/ai-action.types";
import { payeePreviewRow } from "../ai/actions/ai-action-builder.service";
import { BulkCreateSkip, bulkSkipReason } from "../common/bulk-create.types";

/** Create-row input for manage_payees (names; resolved internally). */
export interface ManageCreatePayeeRow {
  name: string;
  categoryName?: string;
}

/** Update-row input for manage_payees (identified by current name). */
export interface ManageUpdatePayeeRow {
  name: string;
  newName?: string;
  categoryName?: string;
}

/** Delete-row input for manage_payees (identified by name). */
export interface ManageDeletePayeeRow {
  name: string;
}

export interface PrepareCreatePayeesResult {
  okPreviews: CreatePayeePreview[];
  okRows: BatchCreatePayeeRow[];
  previewRows: AiActionPreviewRow[];
  okIndex: number[];
  skipped: BulkCreateSkip[];
}

export interface PrepareUpdatePayeesResult {
  okPreviews: UpdatePayeePreview[];
  okRows: BatchUpdatePayeeRow[];
  previewRows: AiActionPreviewRow[];
  okIndex: number[];
  skipped: BulkCreateSkip[];
}

export interface PrepareDeletePayeesResult {
  okPreviews: DeletePayeePreview[];
  okRows: BatchDeletePayeeRow[];
  previewRows: AiActionPreviewRow[];
  okIndex: number[];
  skipped: BulkCreateSkip[];
}

/**
 * Shared name-resolution + preview-building for the unified `manage_payees`
 * tool. Both tool surfaces (AI Assistant tool executor and MCP server) delegate
 * here so they stay thin adapters with identical behaviour (CLAUDE.md repo rule).
 *
 * Single-item resolution failures throw (the surfaces map the 4xx to a
 * user-facing message); bulk variants are best-effort, collecting per-row skips
 * instead of aborting the batch.
 */
@Injectable()
export class PayeeToolPrepService {
  constructor(private readonly payeesService: PayeesService) {}

  static createToBatchRow(preview: CreatePayeePreview): BatchCreatePayeeRow {
    return { name: preview.name, defaultCategoryId: preview.defaultCategoryId };
  }

  static updateToBatchRow(preview: UpdatePayeePreview): BatchUpdatePayeeRow {
    return {
      payeeId: preview.payeeId,
      name: preview.name,
      defaultCategoryId: preview.defaultCategoryId,
    };
  }

  async prepareCreatePayeeSingle(
    userId: string,
    row: ManageCreatePayeeRow,
  ): Promise<CreatePayeePreview> {
    return this.payeesService.previewCreatePayee(userId, {
      name: row.name,
      categoryName: row.categoryName,
    });
  }

  async prepareUpdatePayeeSingle(
    userId: string,
    row: ManageUpdatePayeeRow,
  ): Promise<UpdatePayeePreview> {
    return this.payeesService.previewUpdatePayee(userId, {
      name: row.name,
      newName: row.newName,
      categoryName: row.categoryName,
    });
  }

  async prepareDeletePayeeSingle(
    userId: string,
    row: ManageDeletePayeeRow,
  ): Promise<DeletePayeePreview> {
    return this.payeesService.previewDeletePayee(userId, { name: row.name });
  }

  async prepareCreatePayees(
    userId: string,
    rows: ManageCreatePayeeRow[],
  ): Promise<PrepareCreatePayeesResult> {
    const okPreviews: CreatePayeePreview[] = [];
    const okRows: BatchCreatePayeeRow[] = [];
    const previewRows: AiActionPreviewRow[] = [];
    const okIndex: number[] = [];
    const skipped: BulkCreateSkip[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const preview = await this.prepareCreatePayeeSingle(userId, row);
        okPreviews.push(preview);
        okRows.push(PayeeToolPrepService.createToBatchRow(preview));
        okIndex.push(i);
        previewRows.push(payeePreviewRow(preview));
      } catch (err) {
        const reason = bulkSkipReason(err);
        skipped.push({ index: i, reason });
        previewRows.push({
          status: "error",
          name: row.name ?? null,
          error: reason,
        });
      }
    }

    return { okPreviews, okRows, previewRows, okIndex, skipped };
  }

  async prepareUpdatePayees(
    userId: string,
    rows: ManageUpdatePayeeRow[],
  ): Promise<PrepareUpdatePayeesResult> {
    const okPreviews: UpdatePayeePreview[] = [];
    const okRows: BatchUpdatePayeeRow[] = [];
    const previewRows: AiActionPreviewRow[] = [];
    const okIndex: number[] = [];
    const skipped: BulkCreateSkip[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const preview = await this.prepareUpdatePayeeSingle(userId, row);
        okPreviews.push(preview);
        okRows.push(PayeeToolPrepService.updateToBatchRow(preview));
        okIndex.push(i);
        previewRows.push(payeePreviewRow(preview));
      } catch (err) {
        const reason = bulkSkipReason(err);
        skipped.push({ index: i, reason });
        previewRows.push({
          status: "error",
          name: row.name ?? null,
          error: reason,
        });
      }
    }

    return { okPreviews, okRows, previewRows, okIndex, skipped };
  }

  async prepareDeletePayees(
    userId: string,
    rows: ManageDeletePayeeRow[],
  ): Promise<PrepareDeletePayeesResult> {
    const okPreviews: DeletePayeePreview[] = [];
    const okRows: BatchDeletePayeeRow[] = [];
    const previewRows: AiActionPreviewRow[] = [];
    const okIndex: number[] = [];
    const skipped: BulkCreateSkip[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const preview = await this.prepareDeletePayeeSingle(userId, row);
        okPreviews.push(preview);
        okRows.push({ payeeId: preview.payeeId });
        okIndex.push(i);
        previewRows.push({ status: "ok", name: preview.name });
      } catch (err) {
        const reason = bulkSkipReason(err);
        skipped.push({ index: i, reason });
        previewRows.push({
          status: "error",
          name: row.name ?? null,
          error: reason,
        });
      }
    }

    return { okPreviews, okRows, previewRows, okIndex, skipped };
  }
}
