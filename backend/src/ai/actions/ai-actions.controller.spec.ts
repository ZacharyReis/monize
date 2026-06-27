import { AiActionsController } from "./ai-actions.controller";
import { ConfirmAiActionDto } from "./dto/confirm-ai-action.dto";

describe("AiActionsController", () => {
  let controller: AiActionsController;
  let service: { confirm: jest.Mock };

  beforeEach(() => {
    service = {
      confirm: jest.fn().mockResolvedValue({ type: "create_payee", id: "p1" }),
    };
    controller = new AiActionsController(service as never);
  });

  it("delegates to the service with the authenticated user id", async () => {
    const dto: ConfirmAiActionDto = {
      actionId: "a1",
      signature: "sig",
      descriptor: { type: "create_payee" },
    };
    const result = await controller.confirm({ user: { id: "user-1" } }, dto);

    expect(service.confirm).toHaveBeenCalledWith("user-1", dto);
    expect(result).toEqual({ type: "create_payee", id: "p1" });
  });
});
