import { Test, TestingModule } from "@nestjs/testing";
import { ReleaseNotesController } from "./release-notes.controller";
import { ReleaseNotesService } from "./release-notes.service";
import { ReleaseNotes } from "./release-notes.parser";

describe("ReleaseNotesController", () => {
  let controller: ReleaseNotesController;
  let mockService: { getForCurrentVersion: jest.Mock; currentVersion: string };

  const notes: ReleaseNotes = {
    version: "1.12.1",
    intro: "Intro.",
    sections: [],
    releaseUrl: "https://github.com/kenlasko/monize/releases/tag/v1.12.1",
  };

  beforeEach(async () => {
    mockService = {
      getForCurrentVersion: jest.fn().mockReturnValue(notes),
      currentVersion: "1.12.1",
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReleaseNotesController],
      providers: [{ provide: ReleaseNotesService, useValue: mockService }],
    }).compile();

    controller = module.get<ReleaseNotesController>(ReleaseNotesController);
  });

  it("returns the current version and its notes", () => {
    expect(controller.getReleaseNotes()).toEqual({
      version: "1.12.1",
      notes,
    });
  });

  it("returns null notes when none exist for the current version", () => {
    mockService.getForCurrentVersion.mockReturnValue(null);
    expect(controller.getReleaseNotes()).toEqual({
      version: "1.12.1",
      notes: null,
    });
  });
});
