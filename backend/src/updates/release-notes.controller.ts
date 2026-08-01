import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ReleaseNotesService } from "./release-notes.service";
import { ReleaseNotes } from "./release-notes.parser";

export interface ReleaseNotesResponse {
  version: string;
  notes: ReleaseNotes | null;
}

/**
 * Public, read-only endpoint serving the current version's release-notes digest.
 *
 * Intentionally unauthenticated (unlike every data controller) so the login
 * screen can open the "What's New" modal before the user signs in. It exposes
 * only the already-public notes for the exact version the login page already
 * displays, takes no user input, and is a safe GET (CSRF-exempt).
 */
@ApiTags("Updates")
@Controller("updates/release-notes")
export class ReleaseNotesController {
  constructor(private readonly releaseNotesService: ReleaseNotesService) {}

  @Get()
  @ApiOperation({
    summary:
      "Get the current version's release-notes digest (public; used by the login screen).",
  })
  getReleaseNotes(): ReleaseNotesResponse {
    return {
      version: this.releaseNotesService.currentVersion,
      notes: this.releaseNotesService.getForCurrentVersion(),
    };
  }
}
