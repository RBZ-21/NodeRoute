import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { Button } from './ui/button';

const ACCEPT = 'image/jpeg,image/png,image/webp';

export type PoScanUploaderProps = {
  /** Called with all staged pages, in order, when the user presses Scan. */
  onScan: (files: File[]) => Promise<void> | void;
  /** True while a scan request is in flight; disables the controls. */
  loading: boolean;
  /** Max pages allowed in a single scan. */
  maxPages?: number;
};

/**
 * Stages one or more photos of a single multi-page PO / dock invoice, then
 * emits them together for one combined AI scan. Each "Upload Image" (multi
 * select) or "Take Photo" (one shot) appends to a thumbnail list the user can
 * prune before scanning. Loading/error display is owned by the parent screen.
 */
export function PoScanUploader({ onScan, loading, maxPages = 5 }: PoScanUploaderProps) {
  const [pages, setPages] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Object URLs for thumbnails — recomputed whenever the page list changes,
  // and revoked on change/unmount to avoid leaks.
  const [previews, setPreviews] = useState<string[]>([]);
  useEffect(() => {
    const urls = pages.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [pages]);

  const atCap = pages.length >= maxPages;

  function addFiles(e: ChangeEvent<HTMLInputElement>, ref: RefObject<HTMLInputElement>) {
    const selected = Array.from(e.target.files || []);
    if (ref.current) ref.current.value = ''; // allow re-selecting the same file
    if (!selected.length) return;
    setPages((prev) => [...prev, ...selected].slice(0, maxPages));
  }

  function removePage(index: number) {
    setPages((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleScan() {
    if (!pages.length || loading) return;
    await onScan(pages);
    setPages([]);
  }

  const pageLabel = pages.length === 1 ? '1 page' : `${pages.length} pages`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => addFiles(e, fileInputRef)}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept={ACCEPT}
          capture="environment"
          className="hidden"
          onChange={(e) => addFiles(e, cameraInputRef)}
        />
        <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={loading || atCap}>
          📁 Upload Image
        </Button>
        <Button variant="outline" onClick={() => cameraInputRef.current?.click()} disabled={loading || atCap}>
          📷 Take Photo
        </Button>
        <Button onClick={handleScan} disabled={loading || pages.length === 0}>
          {loading ? 'Scanning…' : `Scan ${pageLabel}`}
        </Button>
      </div>

      {atCap && (
        <p className="text-xs text-muted-foreground">
          Maximum of {maxPages} pages per scan reached. Remove a page to add a different one.
        </p>
      )}

      {pages.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {pages.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className="relative h-20 w-20 overflow-hidden rounded-md border bg-muted"
              title={file.name}
            >
              {previews[index] && (
                <img src={previews[index]} alt={`Page ${index + 1}`} className="h-full w-full object-cover" />
              )}
              <span className="absolute bottom-0 left-0 bg-black/60 px-1 text-[10px] text-white">
                {index + 1}
              </span>
              <button
                type="button"
                onClick={() => removePage(index)}
                disabled={loading}
                aria-label={`Remove page ${index + 1}`}
                className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center bg-black/60 text-xs text-white hover:bg-destructive disabled:opacity-50"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
