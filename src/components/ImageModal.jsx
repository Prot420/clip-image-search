import { useEffect } from 'react';
import { X, ExternalLink, Folder } from 'lucide-react';

export default function ImageModal({ image, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!image) return null;

  const folderPath = image.path
    ? image.path.substring(0, image.path.lastIndexOf(image.filename) - 1)
    : '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-zinc-900 rounded-lg max-w-6xl w-full max-h-[92vh] overflow-hidden flex flex-col md:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white"
          aria-label="Close"
        >
          <X size={20} />
        </button>

        {/* Image area */}
        <div className="flex-1 flex items-center justify-center bg-black p-4 min-h-[400px]">
          <img
            src={`img://${image.id}`}
            alt={image.filename}
            className="max-w-full max-h-[80vh] object-contain"
          />
        </div>

        {/* Info sidebar */}
        <div className="md:w-96 p-6 overflow-y-auto bg-zinc-900 text-zinc-200">
          <h3 className="text-lg font-semibold mb-4 break-all">{image.filename}</h3>

          <div className="space-y-4 text-sm">
            {image.caption && (
              <div>
                <div className="text-zinc-400 uppercase text-xs tracking-wide mb-1">AI Description</div>
                <div className="text-zinc-100 leading-relaxed">{image.caption}</div>
              </div>
            )}

            {(image.width && image.height) && (
              <div>
                <div className="text-zinc-400 uppercase text-xs tracking-wide mb-1">Dimensions</div>
                <div>{image.width} × {image.height} px</div>
              </div>
            )}

            {image.score !== undefined && (
              <div>
                <div className="text-zinc-400 uppercase text-xs tracking-wide mb-1">Match Score</div>
                <div className="font-mono">{(image.score * 100).toFixed(1)}%</div>
              </div>
            )}

            {folderPath && (
              <div>
                <div className="text-zinc-400 uppercase text-xs tracking-wide mb-1 flex items-center gap-1">
                  <Folder size={12} /> Folder
                </div>
                <div className="text-xs break-all text-zinc-400">{folderPath}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
