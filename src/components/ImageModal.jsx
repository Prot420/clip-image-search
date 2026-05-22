import { useEffect, useState } from 'react';
import { X, Folder, Copy, Check } from 'lucide-react';
import { useStore } from '../store/useStore';
import { electron } from '../hooks/useElectronAPI';

export default function ImageModal() {
  // Read directly from the store — App renders <ImageModal /> with no props.
  const image = useStore(s => s.selectedImage);
  const onClose = useStore(s => s.clearSelectedImage);

  const [revealMsg, setRevealMsg] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Reset transient UI state whenever a different image opens.
  useEffect(() => {
    setRevealMsg(null);
    setCopied(false);
  }, [image && image.id]);

  if (!image) return null;

  const folderPath = image.path
    ? image.path.substring(0, image.path.lastIndexOf(image.filename) - 1)
    : '';

  async function handleReveal() {
    setRevealMsg(null);
    try {
      await electron.revealImage(image.id);
    } catch (e) {
      setRevealMsg('Could not open folder: ' + e.message);
    }
  }

  async function handleCopyPath() {
    try {
      await navigator.clipboard.writeText(image.path || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setRevealMsg('Could not copy path');
    }
  }

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
            src={`img://image/${image.id}`}
            alt={image.filename}
            className="max-w-full max-h-[80vh] object-contain"
          />
        </div>

        {/* Info sidebar */}
        <div className="md:w-96 p-6 overflow-y-auto bg-zinc-900 text-zinc-200">
          <h3 className="text-lg font-semibold mb-4 break-all">{image.filename}</h3>

          {/* Actions */}
          <div className="space-y-2 mb-5">
            <button
              onClick={handleReveal}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-md transition"
            >
              <Folder size={15} /> Reveal in Folder
            </button>
            <button
              onClick={handleCopyPath}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm rounded-md transition"
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? 'Path copied' : 'Copy file path'}
            </button>
            {revealMsg && (
              <p className="text-xs text-red-400">{revealMsg}</p>
            )}
          </div>

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
