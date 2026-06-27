import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Delete,
  Param,
  Query,
  Request,
  UseGuards,
  ParseUUIDPipe,
  ParseIntPipe,
  ParseBoolPipe,
  DefaultValuePipe,
  Logger,
} from "@nestjs/common";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from "@nestjs/swagger";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { ParseSymbolPipe } from "../common/pipes/parse-symbol.pipe";
import { assertStringParam } from "../common/query-param-utils";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { SecuritiesService } from "./securities.service";
import {
  SecurityPriceService,
  PriceRefreshSummary,
  HistoricalBackfillSummary,
  HistoricalBackfillResult,
  SecurityLookupResult,
} from "./security-price.service";
import { MsnFinanceService } from "./msn-finance.service";
import { NetWorthService } from "../net-worth/net-worth.service";
import { SectorWeightingService } from "./sector-weighting.service";
import { CreateSecurityDto } from "./dto/create-security.dto";
import { UpdateSecurityDto } from "./dto/update-security.dto";
import { RefreshSecurityPricesDto } from "./dto/refresh-security-prices.dto";
import { CreateSecurityPriceDto } from "./dto/create-security-price.dto";
import { UpdateSecurityPriceDto } from "./dto/update-security-price.dto";
import { Security } from "./entities/security.entity";

@ApiTags("Securities")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("securities")
export class SecuritiesController {
  private readonly logger = new Logger(SecuritiesController.name);

  constructor(
    private readonly securitiesService: SecuritiesService,
    private readonly securityPriceService: SecurityPriceService,
    private readonly netWorthService: NetWorthService,
    private readonly sectorWeightingService: SectorWeightingService,
    private readonly msnFinanceService: MsnFinanceService,
  ) {}

  @Get("providers/status")
  @ApiOperation({
    summary: "Quote provider configuration status",
    description: "Reports whether each provider is fully configured.",
  })
  providerStatus(): { yahoo: { ready: boolean }; msn: { ready: boolean } } {
    return {
      yahoo: { ready: true },
      msn: { ready: this.msnFinanceService.isApiKeyConfigured() },
    };
  }

  @Post()
  @ApiOperation({ summary: "Create a new security" })
  @ApiResponse({
    status: 201,
    description: "Security created successfully",
    type: Security,
  })
  @ApiResponse({
    status: 409,
    description: "Security with symbol already exists",
  })
  create(
    @Request() req,
    @Body() createSecurityDto: CreateSecurityDto,
  ): Promise<Security> {
    return this.securitiesService.create(req.user.id, createSecurityDto);
  }

  @Get()
  @ApiOperation({ summary: "Get all securities" })
  @ApiQuery({ name: "includeInactive", required: false, type: Boolean })
  @ApiResponse({
    status: 200,
    description: "List of securities",
    type: [Security],
  })
  findAll(
    @Request() req,
    @Query("includeInactive", new DefaultValuePipe(false), ParseBoolPipe)
    includeInactive: boolean,
  ): Promise<Security[]> {
    return this.securitiesService.findAll(req.user.id, includeInactive);
  }

  @Get("used")
  @ApiOperation({
    summary: "Get security IDs that have investment transactions",
  })
  @ApiResponse({
    status: 200,
    description: "List of security IDs with transactions",
    schema: { type: "array", items: { type: "string" } },
  })
  getUsedSecurityIds(@Request() req): Promise<string[]> {
    return this.securitiesService.getSecurityIdsWithTransactions(req.user.id);
  }

  @Get("favourites")
  @ApiOperation({
    summary: "Get favourite securities with latest price and daily change",
  })
  @ApiResponse({
    status: 200,
    description: "Favourite securities with price movement",
  })
  getFavourites(@Request() req) {
    return this.securitiesService.getFavouriteSecurities(req.user.id);
  }

  @Get("search")
  @ApiOperation({ summary: "Search securities by symbol or name" })
  @ApiQuery({ name: "q", required: true, description: "Search query" })
  @ApiResponse({ status: 200, description: "Search results", type: [Security] })
  search(@Request() req, @Query("q") query: string): Promise<Security[]> {
    const q = assertStringParam(query, "q");
    const safeQuery = q ? q.slice(0, 200) : "";
    return this.securitiesService.search(req.user.id, safeQuery);
  }

  @Get("lookup")
  @Throttle({ default: { ttl: 60000, limit: 60 } }) // L2: 60 lookups per minute
  @ApiOperation({ summary: "Lookup security info from Yahoo Finance or MSN" })
  @ApiQuery({
    name: "q",
    required: true,
    description: "Symbol or name to lookup",
  })
  @ApiQuery({
    name: "exchanges",
    required: false,
    description:
      "Preferred exchanges in priority order, comma-separated (e.g., LSE,TSX,NYSE)",
  })
  @ApiQuery({
    name: "provider",
    required: false,
    description:
      "Quote provider: 'yahoo', 'msn', or 'auto' (default: user preference with fallback)",
  })
  @ApiResponse({
    status: 200,
    description: "Security lookup result",
    schema: {
      type: "object",
      nullable: true,
      properties: {
        symbol: { type: "string" },
        name: { type: "string" },
        exchange: { type: "string", nullable: true },
        securityType: { type: "string", nullable: true },
        currencyCode: { type: "string", nullable: true },
      },
    },
  })
  lookup(
    @Request() req,
    @Query("q") query: string,
    @Query("exchanges") exchanges?: string,
    @Query("provider") provider?: string,
  ): Promise<SecurityLookupResult | null> {
    const q = assertStringParam(query, "q");
    const exch = assertStringParam(exchanges, "exchanges");
    const prov = assertStringParam(provider, "provider");
    const safeQuery = q ? q.slice(0, 200) : "";
    const preferredExchanges = exch
      ? exch
          .split(",")
          .map((e) => e.trim().slice(0, 20))
          .filter(Boolean)
          .slice(0, 3)
      : undefined;
    const providerChoice =
      prov === "yahoo" || prov === "msn" || prov === "auto" ? prov : undefined;
    return this.securityPriceService.lookupSecurity(
      req.user.id,
      safeQuery,
      preferredExchanges,
      providerChoice,
    );
  }

  @Get("lookup/candidates")
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @ApiOperation({
    summary: "Lookup multiple candidate securities from Yahoo Finance or MSN",
  })
  @ApiQuery({ name: "q", required: true })
  @ApiQuery({ name: "exchanges", required: false })
  @ApiQuery({ name: "provider", required: false })
  @ApiResponse({
    status: 200,
    description:
      "Array of candidate securities ordered by preferred-exchange match, best first.",
  })
  lookupCandidates(
    @Request() req,
    @Query("q") query: string,
    @Query("exchanges") exchanges?: string,
    @Query("provider") provider?: string,
  ): Promise<SecurityLookupResult[]> {
    const q = assertStringParam(query, "q");
    const exch = assertStringParam(exchanges, "exchanges");
    const prov = assertStringParam(provider, "provider");
    const safeQuery = q ? q.slice(0, 200) : "";
    const preferredExchanges = exch
      ? exch
          .split(",")
          .map((e) => e.trim().slice(0, 20))
          .filter(Boolean)
          .slice(0, 3)
      : undefined;
    const providerChoice =
      prov === "yahoo" || prov === "msn" || prov === "auto" ? prov : undefined;
    return this.securityPriceService.lookupSecurityCandidates(
      req.user.id,
      safeQuery,
      preferredExchanges,
      providerChoice,
    );
  }

  @Get("profile-description")
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({
    summary: "Suggest a description for a security from Yahoo Finance",
    description:
      "Best-effort pre-fill: stock prose or a synthesized fund one-liner. Advisory only; persists nothing.",
  })
  @ApiQuery({ name: "symbol", required: true })
  @ApiQuery({ name: "exchange", required: false })
  @ApiResponse({
    status: 200,
    description: "Suggested description (null when unavailable)",
    schema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        description: { type: "string", nullable: true },
      },
    },
  })
  suggestDescription(
    @Query("symbol") symbol: string,
    @Query("exchange") exchange?: string,
  ): Promise<{ symbol: string; description: string | null }> {
    const sym = assertStringParam(symbol, "symbol");
    const exch = assertStringParam(exchange, "exchange");
    const safeSymbol = (sym ?? "").slice(0, 20);
    const safeExchange = exch ? exch.slice(0, 50) : undefined;
    return this.securitiesService.getSuggestedDescription(
      safeSymbol,
      safeExchange,
    );
  }

  @Get("country-options")
  @ApiOperation({
    summary: "Country names for the manual ETF/fund allocation picker",
    description:
      "Canonical countries plus any custom countries the user has saved on a security, sorted alphabetically with the base-currency country first.",
  })
  @ApiResponse({
    status: 200,
    description: "Ordered list of country names",
    schema: { type: "array", items: { type: "string" } },
  })
  getCountryOptions(@Request() req): Promise<string[]> {
    return this.securitiesService.getCountryOptions(req.user.id);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a security by ID" })
  @ApiResponse({ status: 200, description: "Security details", type: Security })
  @ApiResponse({ status: 404, description: "Security not found" })
  findOne(
    @Request() req,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<Security> {
    return this.securitiesService.findOne(req.user.id, id);
  }

  @Get("symbol/:symbol")
  @ApiOperation({ summary: "Get a security by symbol" })
  @ApiResponse({ status: 200, description: "Security details", type: Security })
  @ApiResponse({ status: 404, description: "Security not found" })
  findBySymbol(
    @Request() req,
    @Param("symbol", ParseSymbolPipe) symbol: string,
  ): Promise<Security> {
    return this.securitiesService.findBySymbol(req.user.id, symbol);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a security" })
  @ApiResponse({
    status: 200,
    description: "Security updated successfully",
    type: Security,
  })
  @ApiResponse({ status: 404, description: "Security not found" })
  update(
    @Request() req,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() updateSecurityDto: UpdateSecurityDto,
  ): Promise<Security> {
    return this.securitiesService.update(req.user.id, id, updateSecurityDto);
  }

  @Post(":id/deactivate")
  @ApiOperation({ summary: "Deactivate a security" })
  @ApiResponse({
    status: 200,
    description: "Security deactivated",
    type: Security,
  })
  deactivate(
    @Request() req,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<Security> {
    return this.securitiesService.deactivate(req.user.id, id);
  }

  @Post(":id/activate")
  @ApiOperation({ summary: "Activate a security" })
  @ApiResponse({
    status: 200,
    description: "Security activated",
    type: Security,
  })
  activate(
    @Request() req,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<Security> {
    return this.securitiesService.activate(req.user.id, id);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a security" })
  @ApiResponse({
    status: 200,
    description: "Security deleted",
  })
  @ApiResponse({
    status: 403,
    description: "Security has holdings or transactions",
  })
  @ApiResponse({ status: 404, description: "Security not found" })
  async remove(
    @Request() req,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.securitiesService.remove(req.user.id, id);
  }

  @Post("prices/refresh")
  @UseGuards(RolesGuard)
  @Roles("admin")
  @ApiOperation({
    summary: "Refresh prices for all active securities (admin only)",
    description:
      "Fetches latest prices from Yahoo Finance for all active securities",
  })
  @ApiResponse({
    status: 200,
    description: "Price refresh completed",
    schema: {
      type: "object",
      properties: {
        totalSecurities: { type: "number" },
        updated: { type: "number" },
        failed: { type: "number" },
        skipped: { type: "number" },
        lastUpdated: { type: "string", format: "date-time" },
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              symbol: { type: "string" },
              success: { type: "boolean" },
              price: { type: "number" },
              error: { type: "string" },
            },
          },
        },
      },
    },
  })
  async refreshAllPrices(): Promise<PriceRefreshSummary> {
    const result = await this.securityPriceService.refreshAllPrices();
    if (result.updated > 0) {
      // Fire-and-forget: recalculate investment snapshots so charts reflect new prices
      this.netWorthService
        .recalculateAllInvestmentSnapshots()
        .catch((err) =>
          this.logger.warn(
            `Background investment snapshot recalculation failed: ${err.message}`,
          ),
        );
    }
    return result;
  }

  @Post("prices/refresh/selected")
  @ApiOperation({
    summary: "Refresh prices for selected securities",
    description:
      "Fetches latest prices from Yahoo Finance for specific securities",
  })
  @ApiResponse({ status: 200, description: "Price refresh completed" })
  async refreshSelectedPrices(
    @Request() req,
    @Body() dto: RefreshSecurityPricesDto,
  ): Promise<PriceRefreshSummary> {
    // Verify all security IDs belong to the requesting user
    for (const id of dto.securityIds) {
      await this.securitiesService.findOne(req.user.id, id);
    }
    const result = await this.securityPriceService.refreshPricesForSecurities(
      dto.securityIds,
    );
    if (result.updated > 0) {
      // Fire-and-forget: recalculate this user's investment snapshots
      this.netWorthService
        .recalculateAllAccounts(req.user.id)
        .catch((err) =>
          this.logger.warn(
            `Background account recalculation failed: ${err.message}`,
          ),
        );
    }
    // Fire-and-forget: populate sector data for securities missing it
    this.sectorWeightingService
      .ensureSectorDataByIds(dto.securityIds)
      .catch((err) =>
        this.logger.warn(
          `Background sector data update failed: ${err.message}`,
        ),
      );
    return result;
  }

  @Post("prices/backfill")
  @UseGuards(RolesGuard)
  @Roles("admin")
  @ApiOperation({
    summary:
      "Backfill historical prices for all active securities (admin only)",
    description:
      "Fetches full price history from Yahoo Finance for all active securities",
  })
  @ApiResponse({ status: 200, description: "Historical backfill completed" })
  backfillHistoricalPrices(): Promise<HistoricalBackfillSummary> {
    return this.securityPriceService.backfillHistoricalPrices();
  }

  @Get("prices/status")
  @ApiOperation({ summary: "Get price update status" })
  @ApiResponse({
    status: 200,
    description: "Price update status",
    schema: {
      type: "object",
      properties: {
        lastUpdated: { type: "string", format: "date-time", nullable: true },
      },
    },
  })
  async getPriceStatus() {
    const lastUpdated = await this.securityPriceService.getLastUpdateTime();
    return { lastUpdated };
  }

  @Post("prices/backfill-transactions")
  @UseGuards(RolesGuard)
  @Roles("admin")
  @ApiOperation({
    summary:
      "Backfill prices from investment transactions for all securities (admin only)",
  })
  @ApiResponse({
    status: 200,
    description: "Transaction price backfill completed",
  })
  backfillTransactionPrices() {
    return this.securityPriceService.backfillTransactionPrices();
  }

  @Get(":id/prices")
  @ApiOperation({ summary: "Get price history for a security" })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "Number of records (default: 365)",
  })
  @ApiResponse({ status: 200, description: "Price history" })
  async getPriceHistory(
    @Request() req,
    @Param("id", ParseUUIDPipe) id: string,
    @Query("limit", new DefaultValuePipe(365)) limit: number,
  ) {
    // Verify security belongs to the requesting user
    await this.securitiesService.findOne(req.user.id, id);
    return this.securityPriceService.getPriceHistory(
      id,
      undefined,
      undefined,
      limit,
    );
  }

  @Post(":id/prices/backfill")
  @ApiOperation({
    summary: "Force-update historical prices for a single security",
    description:
      "Re-fetches historical prices across the full period the user has held this security and overwrites existing rows. Useful after correcting an imported security's symbol.",
  })
  @ApiResponse({ status: 200, description: "Historical backfill completed" })
  @ApiResponse({ status: 404, description: "Security not found" })
  async backfillSecurityPrices(
    @Request() req,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<HistoricalBackfillResult> {
    const result =
      await this.securityPriceService.backfillSecurityHoldingPeriod(
        req.user.id,
        id,
      );
    if (result.success && (result.pricesLoaded ?? 0) > 0) {
      // Fire-and-forget: recalculate this user's accounts so holdings and
      // charts reflect the refreshed history.
      this.netWorthService
        .recalculateAllAccounts(req.user.id)
        .catch((err) =>
          this.logger.warn(
            `Background account recalculation failed: ${err.message}`,
          ),
        );
    }
    return result;
  }

  @Post(":id/prices")
  @ApiOperation({ summary: "Create a manual price entry for a security" })
  @ApiResponse({ status: 201, description: "Price created" })
  async createPrice(
    @Request() req,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateSecurityPriceDto,
  ) {
    await this.securitiesService.findOne(req.user.id, id);
    return this.securityPriceService.createManualPrice(id, dto);
  }

  @Patch(":id/prices/:priceId")
  @ApiOperation({ summary: "Update a price entry" })
  @ApiResponse({ status: 200, description: "Price updated" })
  async updatePrice(
    @Request() req,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("priceId", ParseIntPipe) priceId: number,
    @Body() dto: UpdateSecurityPriceDto,
  ) {
    await this.securitiesService.findOne(req.user.id, id);
    return this.securityPriceService.updatePrice(id, priceId, dto);
  }

  @Delete(":id/prices/:priceId")
  @ApiOperation({ summary: "Delete a price entry" })
  @ApiResponse({ status: 200, description: "Price deleted" })
  async deletePrice(
    @Request() req,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("priceId", ParseIntPipe) priceId: number,
  ) {
    await this.securitiesService.findOne(req.user.id, id);
    await this.securityPriceService.deletePrice(id, priceId);
  }
}
