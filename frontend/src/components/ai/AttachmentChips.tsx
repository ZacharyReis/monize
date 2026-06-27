'use client';

import { useTranslations } from 'next-intl';
import type { AttachmentKind, ChatAttachment, ChatAttachmentMeta } from '@/types/ai';

function KindIcon({ kind }: { kind: AttachmentKind }) {
  if (kind === 'pdf') {
    return (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
      </svg>
    );
  }
  // Generic file/text icon.
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  );
}

/**
 * Editable attachment chips shown in the composer above the textarea. Images
 * render as thumbnails (transient object URL); other files render as a pill
 * with a type icon and filename. Each chip has a remove button.
 */
export function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: ChatAttachment[];
  onRemove: (id: string) => void;
}) {
  const t = useTranslations('ai');
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {attachments.map((a) => (
        <div
          key={a.id}
          className="group relative flex items-center gap-2 max-w-[12rem] rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 pl-2 pr-1 py-1 text-xs text-gray-700 dark:text-gray-200"
        >
          {a.kind === 'image' && a.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={a.previewUrl}
              alt={t('chat.attachmentImageAlt')}
              className="h-8 w-8 rounded object-cover flex-shrink-0"
            />
          ) : (
            <KindIcon kind={a.kind} />
          )}
          <span className="truncate">{a.filename}</span>
          <button
            type="button"
            onClick={() => onRemove(a.id)}
            aria-label={t('chat.removeAttachmentAriaLabel')}
            className="flex-shrink-0 rounded p-0.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Read-only attachment chips rendered on a sent user message. Driven by
 * lightweight metadata (no base64 / preview), so files and images both show as
 * a small labelled pill.
 */
export function MessageAttachmentChips({
  attachments,
}: {
  attachments: ChatAttachmentMeta[];
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((a, i) => (
        <span
          key={`${a.filename}-${i}`}
          className="inline-flex items-center gap-1 max-w-[12rem] rounded-md bg-blue-500/30 px-1.5 py-0.5 text-xs text-blue-50"
        >
          <KindIcon kind={a.kind} />
          <span className="truncate">{a.filename}</span>
        </span>
      ))}
    </div>
  );
}
