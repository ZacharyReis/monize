import apiClient from './api';

/** A section (H2) or subsection (H3) of the release-notes digest. */
export interface ReleaseNoteSection {
  heading: string;
  body: string;
  children: ReleaseNoteSection[];
}

/** The parsed release-notes digest for one version. */
export interface ReleaseNotes {
  version: string;
  intro: string;
  sections: ReleaseNoteSection[];
  releaseUrl: string;
}

/** Response of the public `GET /updates/release-notes`. */
export interface ReleaseNotesResponse {
  version: string;
  notes: ReleaseNotes | null;
}

/** Response of the authenticated `GET /updates/whats-new`. */
export interface WhatsNewStatus {
  currentVersion: string;
  autoShow: boolean;
  notes: ReleaseNotes | null;
}

export interface MarkSeenResult {
  seen: boolean;
  version: string;
}

export interface RemindResult {
  reminded: boolean;
}

export const whatsNewApi = {
  /**
   * Public endpoint: the current version's notes with no per-user state. Works
   * unauthenticated, so the login screen can open the modal.
   */
  getReleaseNotes: async (): Promise<ReleaseNotesResponse> => {
    const response = await apiClient.get<ReleaseNotesResponse>(
      '/updates/release-notes',
    );
    return response.data;
  },

  /** Authenticated: notes plus whether the digest should auto-show for this user. */
  getWhatsNew: async (): Promise<WhatsNewStatus> => {
    const response = await apiClient.get<WhatsNewStatus>('/updates/whats-new');
    return response.data;
  },

  /** Authenticated: acknowledge the current version ("Don't show this again"). */
  markSeen: async (): Promise<MarkSeenResult> => {
    const response = await apiClient.post<MarkSeenResult>(
      '/updates/whats-new/seen',
    );
    return response.data;
  },

  /**
   * Authenticated: clear the acknowledgement so the digest shows again next
   * login ("Show at next login") -- the active opposite of markSeen.
   */
  remindNextLogin: async (): Promise<RemindResult> => {
    const response = await apiClient.post<RemindResult>(
      '/updates/whats-new/remind',
    );
    return response.data;
  },
};
