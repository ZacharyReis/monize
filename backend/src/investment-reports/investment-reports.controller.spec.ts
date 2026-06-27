import { InvestmentReportsController } from "./investment-reports.controller";

describe("InvestmentReportsController", () => {
  let controller: InvestmentReportsController;
  let service: Record<string, jest.Mock>;
  const req = { user: { id: "u1" } } as any;

  beforeEach(() => {
    service = {
      create: jest.fn().mockResolvedValue({ id: "r1" }),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: "r1" }),
      update: jest.fn().mockResolvedValue({ id: "r1" }),
      remove: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn().mockResolvedValue({ reportId: "r1", groups: [] }),
    };
    controller = new InvestmentReportsController(service as any);
  });

  it("delegates create to the service with the user id", async () => {
    const dto = { name: "R", config: { columns: ["symbol"] } } as any;
    await controller.create(req, dto);
    expect(service.create).toHaveBeenCalledWith("u1", dto);
  });

  it("delegates findAll", async () => {
    await controller.findAll(req);
    expect(service.findAll).toHaveBeenCalledWith("u1");
  });

  it("delegates findOne", async () => {
    await controller.findOne(req, "r1");
    expect(service.findOne).toHaveBeenCalledWith("u1", "r1");
  });

  it("delegates update", async () => {
    const dto = { name: "New" } as any;
    await controller.update(req, "r1", dto);
    expect(service.update).toHaveBeenCalledWith("u1", "r1", dto);
  });

  it("delegates remove", async () => {
    await controller.remove(req, "r1");
    expect(service.remove).toHaveBeenCalledWith("u1", "r1");
  });

  it("delegates execute", async () => {
    const dto = { asOfDate: "2024-06-10" } as any;
    await controller.execute(req, "r1", dto);
    expect(service.execute).toHaveBeenCalledWith("u1", "r1", dto);
  });
});
