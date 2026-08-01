import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@/test/render';
import toast from 'react-hot-toast';
import { AttachmentsSection } from './AttachmentsSection';
import { attachmentsApi } from '@/lib/attachments';
import { Attachment, MAX_ATTACHMENT_BYTES } from '@/types/attachment';

vi.mock('@/lib/attachments', () => ({
  attachmentsApi: { list: vi.fn(), upload: vi.fn(), delete: vi.fn() },
  attachmentDownloadUrl: (id: string) => `/api/v1/attachments/${id}/download`,
}));

const mockList = attachmentsApi.list as ReturnType<typeof vi.fn>;
const mockUpload = attachmentsApi.upload as ReturnType<typeof vi.fn>;
const mockDelete = attachmentsApi.delete as ReturnType<typeof vi.fn>;

function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'a-1',
    transactionId: 't-1',
    filename: 'receipt.png',
    contentType: 'image/png',
    byteSize: 2048,
    sha256: 'abc',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

async function renderSection() {
  await act(async () => {
    render(<AttachmentsSection transactionId="t-1" />);
  });
}

function fileOfType(type: string, size = 100): File {
  const file = new File(['x'], 'f', { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('AttachmentsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue([]);
  });

  it('shows the empty state when there are no attachments', async () => {
    await renderSection();
    expect(screen.getByText('No attachments yet')).toBeInTheDocument();
  });

  it('lists attachments with a working download link', async () => {
    mockList.mockResolvedValue([makeAttachment()]);
    await renderSection();
    const link = screen.getByRole('link', { name: 'receipt.png' });
    expect(link).toHaveAttribute(
      'href',
      '/api/v1/attachments/a-1/download',
    );
  });

  it('reports failure to load', async () => {
    mockList.mockRejectedValue(new Error('boom'));
    await renderSection();
    await act(async () => {});
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it('uploads a valid file and refreshes', async () => {
    mockList.mockResolvedValue([]);
    mockUpload.mockResolvedValue(makeAttachment());
    await renderSection();

    const input = screen.getByLabelText('Add attachment') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [fileOfType('image/png')] } });
    });

    await waitFor(() =>
      expect(mockUpload).toHaveBeenCalledWith('t-1', expect.any(File)),
    );
    expect(toast.success).toHaveBeenCalledWith('Attachment added');
    // Refreshed once on mount, once after upload.
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it('rejects an unsupported file type without uploading', async () => {
    await renderSection();
    const input = screen.getByLabelText('Add attachment') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: { files: [fileOfType('text/plain')] },
      });
    });
    expect(mockUpload).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('rejects a file over the size limit', async () => {
    await renderSection();
    const input = screen.getByLabelText('Add attachment') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: {
          files: [fileOfType('image/png', MAX_ATTACHMENT_BYTES + 1)],
        },
      });
    });
    expect(mockUpload).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('deletes an attachment after confirmation', async () => {
    mockList.mockResolvedValue([makeAttachment()]);
    mockDelete.mockResolvedValue(undefined);
    await renderSection();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });

    // Confirm dialog appears; click its confirm action.
    const confirmButtons = screen.getAllByRole('button', { name: 'Delete' });
    await act(async () => {
      fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    });

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('a-1'));
    expect(toast.success).toHaveBeenCalledWith('Attachment deleted');
  });

  describe('staged mode', () => {
    function renderStaged(files: File[], onChange = vi.fn()) {
      render(
        <AttachmentsSection stagedFiles={files} onStagedFilesChange={onChange} />,
      );
      return onChange;
    }

    it('does not touch the server and shows the empty state', () => {
      renderStaged([]);
      expect(screen.getByText('No attachments yet')).toBeInTheDocument();
      expect(mockList).not.toHaveBeenCalled();
    });

    it('stages a valid file via the change handler without uploading', () => {
      const onChange = renderStaged([]);
      const input = screen.getByLabelText('Add attachment') as HTMLInputElement;
      const file = fileOfType('image/png');
      fireEvent.change(input, { target: { files: [file] } });

      expect(onChange).toHaveBeenCalledWith([file]);
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it('rejects an unsupported staged file', () => {
      const onChange = renderStaged([]);
      const input = screen.getByLabelText('Add attachment') as HTMLInputElement;
      fireEvent.change(input, {
        target: { files: [fileOfType('text/plain')] },
      });

      expect(onChange).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalled();
    });

    it('lists staged files with a remove control', () => {
      const file = fileOfType('application/pdf');
      Object.defineProperty(file, 'name', { value: 'invoice.pdf' });
      const onChange = renderStaged([file]);

      expect(screen.getByText('invoice.pdf')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
      expect(onChange).toHaveBeenCalledWith([]);
    });
  });
});
