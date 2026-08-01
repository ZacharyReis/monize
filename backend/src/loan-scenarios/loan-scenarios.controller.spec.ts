import { Test, TestingModule } from "@nestjs/testing";
import { LoanScenariosController } from "./loan-scenarios.controller";
import { LoanScenariosService } from "./loan-scenarios.service";

describe("LoanScenariosController", () => {
  let controller: LoanScenariosController;
  let mockService: Record<string, jest.Mock>;
  const mockReq = { user: { id: "user-1" } };
  const accountId = "account-1";

  beforeEach(async () => {
    mockService = {
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LoanScenariosController],
      providers: [
        {
          provide: LoanScenariosService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<LoanScenariosController>(LoanScenariosController);
  });

  describe("findAll()", () => {
    it("delegates with the JWT userId and account id", async () => {
      const expected = [{ id: "scenario-1", name: "Extra 200" }];
      mockService.findAll.mockResolvedValue(expected);

      const result = await controller.findAll(mockReq, accountId);

      expect(result).toEqual(expected);
      expect(mockService.findAll).toHaveBeenCalledWith("user-1", accountId);
    });
  });

  describe("create()", () => {
    it("delegates with the JWT userId, account id, and dto", async () => {
      const dto = { name: "Aggressive", recurringExtraAmount: 300 };
      const expected = { id: "scenario-new", ...dto };
      mockService.create.mockResolvedValue(expected);

      const result = await controller.create(mockReq, accountId, dto);

      expect(result).toEqual(expected);
      expect(mockService.create).toHaveBeenCalledWith("user-1", accountId, dto);
    });
  });

  describe("update()", () => {
    it("delegates with all identifiers and the dto", async () => {
      const dto = { name: "Renamed" };
      const expected = { id: "scenario-1", name: "Renamed" };
      mockService.update.mockResolvedValue(expected);

      const result = await controller.update(
        mockReq,
        accountId,
        "scenario-1",
        dto,
      );

      expect(result).toEqual(expected);
      expect(mockService.update).toHaveBeenCalledWith(
        "user-1",
        accountId,
        "scenario-1",
        dto,
      );
    });
  });

  describe("remove()", () => {
    it("delegates with all identifiers", async () => {
      mockService.remove.mockResolvedValue(undefined);

      await controller.remove(mockReq, accountId, "scenario-1");

      expect(mockService.remove).toHaveBeenCalledWith(
        "user-1",
        accountId,
        "scenario-1",
      );
    });
  });
});
