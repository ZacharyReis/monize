import { Test, TestingModule } from "@nestjs/testing";
import { WhatsNewController } from "./whats-new.controller";
import { WhatsNewService } from "./whats-new.service";

describe("WhatsNewController", () => {
  let controller: WhatsNewController;
  let mockService: Partial<Record<keyof WhatsNewService, jest.Mock>>;
  const mockReq = { user: { id: "user-1" } };

  beforeEach(async () => {
    mockService = {
      getWhatsNew: jest.fn(),
      markSeen: jest.fn(),
      remindNextLogin: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WhatsNewController],
      providers: [{ provide: WhatsNewService, useValue: mockService }],
    }).compile();

    controller = module.get<WhatsNewController>(WhatsNewController);
  });

  it("getWhatsNew delegates to the service with the request user id", () => {
    mockService.getWhatsNew!.mockReturnValue("status");
    const result = controller.getWhatsNew(mockReq);
    expect(result).toBe("status");
    expect(mockService.getWhatsNew).toHaveBeenCalledWith("user-1");
  });

  it("markSeen delegates to the service with the request user id", () => {
    mockService.markSeen!.mockReturnValue("seen");
    const result = controller.markSeen(mockReq);
    expect(result).toBe("seen");
    expect(mockService.markSeen).toHaveBeenCalledWith("user-1");
  });

  it("remindNextLogin delegates to the service with the request user id", () => {
    mockService.remindNextLogin!.mockReturnValue("reminded");
    const result = controller.remindNextLogin(mockReq);
    expect(result).toBe("reminded");
    expect(mockService.remindNextLogin).toHaveBeenCalledWith("user-1");
  });
});
