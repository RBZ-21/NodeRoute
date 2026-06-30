import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PoScanUploader } from './PoScanUploader';

// jsdom does not implement object URLs; stub them so thumbnail previews render.
beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function uploadInputFor(container: HTMLElement): HTMLInputElement {
  // First file input is the multi-select "Upload Image" picker.
  const input = container.querySelector('input[type="file"]') as HTMLInputElement | null;
  if (!input) throw new Error('Expected a file input');
  return input;
}

describe('PoScanUploader', () => {
  it('stages multiple pages and emits them in order on scan', async () => {
    const onScan = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<PoScanUploader onScan={onScan} loading={false} />);

    const input = uploadInputFor(container);
    const page1 = new File(['a'], 'page-1.png', { type: 'image/png' });
    const page2 = new File(['b'], 'page-2.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [page1, page2] } });

    fireEvent.click(await screen.findByRole('button', { name: /Scan 2 pages/ }));

    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith([page1, page2]);
  });

  it('removes a staged page before scanning', async () => {
    const onScan = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<PoScanUploader onScan={onScan} loading={false} />);

    const input = uploadInputFor(container);
    const page1 = new File(['a'], 'page-1.png', { type: 'image/png' });
    const page2 = new File(['b'], 'page-2.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [page1, page2] } });

    fireEvent.click(await screen.findByRole('button', { name: 'Remove page 1' }));
    fireEvent.click(await screen.findByRole('button', { name: /Scan 1 page/ }));

    expect(onScan).toHaveBeenCalledWith([page2]);
  });

  it('caps staged pages at the maximum', async () => {
    const onScan = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<PoScanUploader onScan={onScan} loading={false} maxPages={2} />);

    const input = uploadInputFor(container);
    const files = [
      new File(['a'], 'p1.png', { type: 'image/png' }),
      new File(['b'], 'p2.png', { type: 'image/png' }),
      new File(['c'], 'p3.png', { type: 'image/png' }),
    ];
    fireEvent.change(input, { target: { files } });

    expect(await screen.findByText(/Maximum of 2 pages per scan reached/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Scan 2 pages/ }));
    expect(onScan).toHaveBeenCalledWith([files[0], files[1]]);
  });

  it('disables scanning until at least one page is staged', () => {
    const onScan = vi.fn();
    render(<PoScanUploader onScan={onScan} loading={false} />);
    expect(screen.getByRole('button', { name: /Scan 0 pages/ })).toBeDisabled();
  });
});
