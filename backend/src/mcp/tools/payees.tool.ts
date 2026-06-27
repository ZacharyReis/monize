import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PayeesService } from "../../payees/payees.service";
import {
  PayeeToolPrepService,
  ManageCreatePayeeRow,
  ManageUpdatePayeeRow,
  ManageDeletePayeeRow,
} from "../../payees/payee-tool-prep.service";
import { AiRelayService } from "../../ai/relay/ai-relay.service";
import { AiActionBuilderService } from "../../ai/actions/ai-action-builder.service";
import {
  PendingAiAction,
  MAX_BULK_ACTION_ROWS,
} from "../../ai/actions/ai-action.types";
import { RELAY_PREVIEW_SHOWN } from "../mcp-relay-confirm";
import {
  UserContextResolver,
  requireScope,
  toolResult,
  toolError,
  safeToolError,
  confirmWrite,
} from "../mcp-context";
import { McpWriteLimiter } from "../mcp-write-limiter";
import { getPayeesOutput, managePayeesOutput } from "../tool-output-schemas";
import { READ_ONLY, WRITE } from "../mcp-annotations";

type ManagePayeeOperation = "create" | "update" | "delete";
type ApprovalMode = "bulk" | "individual";

interface ManagePayeeItem {
  // create
  name?: string;
  categoryName?: string;
  // update (name identifies the payee; newName/categoryName are the changes)
  newName?: string;
}

@Injectable()
export class McpPayeesTools {
  constructor(
    private readonly payeesService: PayeesService,
    private readonly prepService: PayeeToolPrepService,
    private readonly relayService: AiRelayService,
    private readonly actionBuilder: AiActionBuilderService,
    private readonly writeLimiter: McpWriteLimiter,
  ) {}

  register(server: McpServer, resolve: UserContextResolver) {
    server.registerTool(
      "list_payees",
      {
        title: "List payees",
        annotations: READ_ONLY,
        description: "List payees, optionally filtered by search query",
        inputSchema: {
          search: z
            .string()
            .max(200)
            .optional()
            .describe("Search query to filter payees"),
        },
        outputSchema: getPayeesOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "read");
        if (check.error) return check.result;

        try {
          if (args.search) {
            const payees = await this.payeesService.search(
              ctx.userId,
              args.search,
              50,
            );
            return toolResult(payees);
          }
          const payees = await this.payeesService.findAll(ctx.userId);
          return toolResult(payees);
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );

    server.registerTool(
      "manage_payees",
      {
        title: "Manage payees",
        annotations: WRITE,
        description:
          "Create, edit, or delete the user's payees. Accepts NAMES -- the payee and its default category are resolved internally, so you do NOT need to call list_payees/list_categories first. operation = 'create' | 'update' | 'delete' with an items array (1-25 rows). " +
          "create: { name, categoryName? } -- categoryName optionally sets the payee's default category ('Parent: Child' for a subcategory). " +
          "update: { name, newName?, categoryName? } -- name identifies the existing payee; provide newName to rename and/or categoryName to set the default category (pass an empty string to clear it). At least one of newName/categoryName is required. " +
          "delete: { name } -- removes the payee (its transactions keep their stored payee name). " +
          "approvalMode = 'bulk' (default; one confirmation for the whole batch) or 'individual' (one confirmation per item); ignored for a single item. Set dryRun=true to preview every item without saving. The user is asked to confirm before anything is saved (web chat card via relay, or an MCP confirmation dialog).",
        inputSchema: {
          operation: z
            .enum(["create", "update", "delete"])
            .describe("The operation to perform on every item."),
          items: z
            .array(
              z.object({
                name: z
                  .string()
                  .max(100)
                  .describe(
                    "create: the new payee name. update/delete: the existing payee's current name.",
                  ),
                newName: z
                  .string()
                  .max(100)
                  .optional()
                  .describe("update: the payee's new name."),
                categoryName: z
                  .string()
                  .max(100)
                  .optional()
                  .describe(
                    'create/update: default category name ("Parent: Child" for a subcategory). update: empty string clears it.',
                  ),
              }),
            )
            .min(1)
            .max(MAX_BULK_ACTION_ROWS)
            .describe("The rows to act on (1-25)."),
          approvalMode: z
            .enum(["bulk", "individual"])
            .optional()
            .describe(
              "How multi-item batches are approved: 'bulk' (default) one card for all; 'individual' one card per item. Ignored for a single item.",
            ),
          dryRun: z
            .boolean()
            .optional()
            .default(false)
            .describe(
              "If true, validate and return a per-item preview without saving anything.",
            ),
        },
        outputSchema: managePayeesOutput,
      },
      async (args, extra) => {
        const ctx = resolve(extra.sessionId);
        if (!ctx) return toolError("No user context");
        const check = requireScope(ctx.scopes, "write");
        if (check.error) return check.result;

        const operation = args.operation as ManagePayeeOperation;
        const items = args.items as ManagePayeeItem[];
        const approvalMode = (args.approvalMode ?? "bulk") as ApprovalMode;

        try {
          if (args.dryRun) {
            return this.manageDryRun(ctx.userId, operation, items);
          }
          if (operation === "create") {
            return await this.manageCreate(
              server,
              ctx.userId,
              items,
              approvalMode,
              extra.requestId,
            );
          }
          if (operation === "update") {
            return await this.manageUpdate(
              server,
              ctx.userId,
              items,
              approvalMode,
              extra.requestId,
            );
          }
          return await this.manageDelete(
            server,
            ctx.userId,
            items,
            approvalMode,
            extra.requestId,
          );
        } catch (err: unknown) {
          return safeToolError(err);
        }
      },
    );
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------

  private toCreateRow(item: ManagePayeeItem): ManageCreatePayeeRow {
    return { name: item.name as string, categoryName: item.categoryName };
  }

  private toUpdateRow(item: ManagePayeeItem): ManageUpdatePayeeRow {
    return {
      name: item.name as string,
      newName: item.newName,
      categoryName: item.categoryName,
    };
  }

  private toDeleteRow(item: ManagePayeeItem): ManageDeletePayeeRow {
    return { name: item.name as string };
  }

  private async manageDryRun(
    userId: string,
    operation: ManagePayeeOperation,
    items: ManagePayeeItem[],
  ) {
    const prep =
      operation === "create"
        ? await this.prepService.prepareCreatePayees(
            userId,
            items.map((i) => this.toCreateRow(i)),
          )
        : operation === "update"
          ? await this.prepService.prepareUpdatePayees(
              userId,
              items.map((i) => this.toUpdateRow(i)),
            )
          : await this.prepService.prepareDeletePayees(
              userId,
              items.map((i) => this.toDeleteRow(i)),
            );
    return toolResult({
      dryRun: true,
      operation,
      previews: prep.previewRows,
      skipped: prep.skipped,
      message:
        "This is a preview. Call again with dryRun=false to apply the changes.",
    });
  }

  private async emitOrConfirm(
    server: McpServer,
    userId: string,
    pendingAction: PendingAiAction,
    confirmMessage: string,
    requestId: unknown,
  ): Promise<"relay" | "accepted" | "declined"> {
    if (this.relayService.emitPendingAction(userId, pendingAction)) {
      return "relay";
    }
    const confirmation = await confirmWrite(
      server,
      confirmMessage,
      requestId as never,
    );
    return confirmation === "declined" ? "declined" : "accepted";
  }

  private async manageCreate(
    server: McpServer,
    userId: string,
    items: ManagePayeeItem[],
    approvalMode: ApprovalMode,
    requestId: unknown,
  ) {
    if (items.length === 1) {
      const preview = await this.prepService.prepareCreatePayeeSingle(
        userId,
        this.toCreateRow(items[0]),
      );
      const budget = this.writeLimiter.reserve(userId, 1);
      if (budget) return budget;
      const action = this.actionBuilder.buildCreatePayee(userId, preview);
      const outcome = await this.emitOrConfirm(
        server,
        userId,
        action,
        `Create this payee?\nName: ${preview.name}${preview.defaultCategoryName ? `\nDefault category: ${preview.defaultCategoryName}` : ""}`,
        requestId,
      );
      if (outcome === "relay") return toolResult(RELAY_PREVIEW_SHOWN);
      if (outcome === "declined")
        return toolError(
          "Cancelled: the confirmation was declined, so no payee was created.",
        );
      const payee = await this.payeesService.create(userId, {
        name: preview.name,
        defaultCategoryId: preview.defaultCategoryId ?? undefined,
      });
      this.writeLimiter.record(userId, "create_payee");
      return toolResult({ id: payee.id, name: payee.name, count: 1 });
    }

    const prep = await this.prepService.prepareCreatePayees(
      userId,
      items.map((i) => this.toCreateRow(i)),
    );
    if (prep.okPreviews.length === 0) {
      return toolError(
        "None of the payees could be prepared. Check the name and category for each row.",
      );
    }
    const budget = this.writeLimiter.reserve(userId, prep.okPreviews.length);
    if (budget) return budget;

    if (approvalMode === "individual") {
      const cards = prep.okPreviews.map((p) =>
        this.actionBuilder.buildCreatePayee(userId, p),
      );
      return this.runIndividual(server, userId, cards, requestId, prep.skipped);
    }

    const action = this.actionBuilder.buildBatchActions(
      userId,
      "create_payee",
      prep.okRows,
      prep.previewRows,
    );
    if (this.relayService.emitPendingAction(userId, action)) {
      return toolResult(RELAY_PREVIEW_SHOWN);
    }
    const confirmation = await confirmWrite(
      server,
      `Create ${prep.okPreviews.length} payee(s)?${prep.skipped.length ? ` (${prep.skipped.length} skipped)` : ""}`,
      requestId as never,
    );
    if (confirmation === "declined")
      return toolError(
        "Cancelled: the confirmation was declined, so nothing was created.",
      );
    const ids: string[] = [];
    for (const preview of prep.okPreviews) {
      const payee = await this.payeesService.create(userId, {
        name: preview.name,
        defaultCategoryId: preview.defaultCategoryId ?? undefined,
      });
      ids.push(payee.id);
      this.writeLimiter.record(userId, "create_payee");
    }
    return toolResult({ ids, count: ids.length, skipped: prep.skipped });
  }

  private async manageUpdate(
    server: McpServer,
    userId: string,
    items: ManagePayeeItem[],
    approvalMode: ApprovalMode,
    requestId: unknown,
  ) {
    if (items.length === 1) {
      const preview = await this.prepService.prepareUpdatePayeeSingle(
        userId,
        this.toUpdateRow(items[0]),
      );
      const budget = this.writeLimiter.reserve(userId, 1);
      if (budget) return budget;
      const action = this.actionBuilder.buildUpdatePayee(userId, preview);
      const outcome = await this.emitOrConfirm(
        server,
        userId,
        action,
        `Apply this payee edit?\nName: ${preview.name}\nDefault category: ${preview.defaultCategoryName ?? "(none)"}`,
        requestId,
      );
      if (outcome === "relay") return toolResult(RELAY_PREVIEW_SHOWN);
      if (outcome === "declined")
        return toolError(
          "Cancelled: the confirmation was declined, so the payee was not changed.",
        );
      const payee = await this.payeesService.update(userId, preview.payeeId, {
        name: preview.name,
        defaultCategoryId: preview.defaultCategoryId,
      });
      this.writeLimiter.record(userId, "update_payee");
      return toolResult({ id: payee.id, name: payee.name, count: 1 });
    }

    const prep = await this.prepService.prepareUpdatePayees(
      userId,
      items.map((i) => this.toUpdateRow(i)),
    );
    if (prep.okPreviews.length === 0) {
      return toolError("None of the payee edits could be prepared.");
    }
    const budget = this.writeLimiter.reserve(userId, prep.okPreviews.length);
    if (budget) return budget;

    if (approvalMode === "individual") {
      const cards = prep.okPreviews.map((p) =>
        this.actionBuilder.buildUpdatePayee(userId, p),
      );
      return this.runIndividual(server, userId, cards, requestId, prep.skipped);
    }

    const action = this.actionBuilder.buildBatchActions(
      userId,
      "update_payee",
      prep.okRows,
      prep.previewRows,
    );
    if (this.relayService.emitPendingAction(userId, action)) {
      return toolResult(RELAY_PREVIEW_SHOWN);
    }
    const confirmation = await confirmWrite(
      server,
      `Apply ${prep.okPreviews.length} payee edit(s)?${prep.skipped.length ? ` (${prep.skipped.length} skipped)` : ""}`,
      requestId as never,
    );
    if (confirmation === "declined")
      return toolError(
        "Cancelled: the confirmation was declined, so nothing was changed.",
      );
    const ids: string[] = [];
    for (const preview of prep.okPreviews) {
      const payee = await this.payeesService.update(userId, preview.payeeId, {
        name: preview.name,
        defaultCategoryId: preview.defaultCategoryId,
      });
      ids.push(payee.id);
      this.writeLimiter.record(userId, "update_payee");
    }
    return toolResult({ ids, count: ids.length, skipped: prep.skipped });
  }

  private async manageDelete(
    server: McpServer,
    userId: string,
    items: ManagePayeeItem[],
    approvalMode: ApprovalMode,
    requestId: unknown,
  ) {
    if (items.length === 1) {
      const preview = await this.prepService.prepareDeletePayeeSingle(
        userId,
        this.toDeleteRow(items[0]),
      );
      const budget = this.writeLimiter.reserve(userId, 1);
      if (budget) return budget;
      const action = this.actionBuilder.buildDeletePayee(userId, preview);
      const outcome = await this.emitOrConfirm(
        server,
        userId,
        action,
        `Delete this payee?\nName: ${preview.name}`,
        requestId,
      );
      if (outcome === "relay") return toolResult(RELAY_PREVIEW_SHOWN);
      if (outcome === "declined")
        return toolError(
          "Cancelled: the confirmation was declined, so the payee was not deleted.",
        );
      await this.payeesService.remove(userId, preview.payeeId);
      this.writeLimiter.record(userId, "delete_payee");
      return toolResult({ id: preview.payeeId, deleted: true, count: 1 });
    }

    const prep = await this.prepService.prepareDeletePayees(
      userId,
      items.map((i) => this.toDeleteRow(i)),
    );
    if (prep.okPreviews.length === 0) {
      return toolError("None of the payees could be prepared.");
    }
    const budget = this.writeLimiter.reserve(userId, prep.okPreviews.length);
    if (budget) return budget;

    if (approvalMode === "individual") {
      const cards = prep.okPreviews.map((p) =>
        this.actionBuilder.buildDeletePayee(userId, p),
      );
      return this.runIndividual(server, userId, cards, requestId, prep.skipped);
    }

    const action = this.actionBuilder.buildBatchActions(
      userId,
      "delete_payee",
      prep.okRows,
      prep.previewRows,
    );
    if (this.relayService.emitPendingAction(userId, action)) {
      return toolResult(RELAY_PREVIEW_SHOWN);
    }
    const confirmation = await confirmWrite(
      server,
      `Delete ${prep.okPreviews.length} payee(s)?${prep.skipped.length ? ` (${prep.skipped.length} skipped)` : ""}`,
      requestId as never,
    );
    if (confirmation === "declined")
      return toolError(
        "Cancelled: the confirmation was declined, so nothing was deleted.",
      );
    const ids: string[] = [];
    for (const preview of prep.okPreviews) {
      await this.payeesService.remove(userId, preview.payeeId);
      ids.push(preview.payeeId);
      this.writeLimiter.record(userId, "delete_payee");
    }
    return toolResult({ ids, count: ids.length, skipped: prep.skipped });
  }

  /**
   * Individual mode: relay path emits every card to the web chat; otherwise
   * confirm + commit each card in turn.
   */
  private async runIndividual(
    server: McpServer,
    userId: string,
    cards: PendingAiAction[],
    requestId: unknown,
    skipped: { index: number; reason: string }[],
  ) {
    if (this.relayService.emitPendingAction(userId, cards[0])) {
      for (let i = 1; i < cards.length; i++) {
        this.relayService.emitPendingAction(userId, cards[i]);
      }
      return toolResult(RELAY_PREVIEW_SHOWN);
    }
    const ids: string[] = [];
    for (const card of cards) {
      const confirmation = await confirmWrite(
        server,
        this.confirmLineFor(card),
        requestId as never,
      );
      if (confirmation === "declined") continue;
      const id = await this.commitCard(userId, card);
      if (id) ids.push(id);
    }
    return toolResult({ ids, count: ids.length, skipped });
  }

  private confirmLineFor(card: PendingAiAction): string {
    const p = card.preview;
    switch (card.type) {
      case "delete_payee":
        return `Delete this payee?\nName: ${p.name}`;
      case "update_payee":
        return `Apply this payee edit?\nName: ${p.name}\nDefault category: ${p.categoryName ?? "(none)"}`;
      default:
        return `Create this payee?\nName: ${p.name}${p.categoryName ? `\nDefault category: ${p.categoryName}` : ""}`;
    }
  }

  /** Commit one signed payee card directly (non-relay individual mode). */
  private async commitCard(
    userId: string,
    card: PendingAiAction,
  ): Promise<string | null> {
    const d = card.descriptor;
    switch (d.type) {
      case "create_payee": {
        const payee = await this.payeesService.create(userId, {
          name: d.name,
          defaultCategoryId: d.defaultCategoryId ?? undefined,
        });
        this.writeLimiter.record(userId, "create_payee");
        return payee.id;
      }
      case "update_payee": {
        const payee = await this.payeesService.update(userId, d.payeeId, {
          name: d.name,
          defaultCategoryId: d.defaultCategoryId,
        });
        this.writeLimiter.record(userId, "update_payee");
        return payee.id;
      }
      case "delete_payee": {
        await this.payeesService.remove(userId, d.payeeId);
        this.writeLimiter.record(userId, "delete_payee");
        return d.payeeId;
      }
      default:
        return null;
    }
  }
}
