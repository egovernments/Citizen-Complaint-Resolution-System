import { Undo2, X } from 'lucide-react';

interface UndoItem {
  id: string;
  action: string;
  description: string;
  timestamp: Date;
}

interface UndoToastProps {
  items: UndoItem[];
  onUndo: () => void;
  onDismiss: (id: string) => void;
}

export default function UndoToast({ items, onUndo, onDismiss }: UndoToastProps) {
  if (items.length === 0) return null;

  const latestItem = items[0];
  const secondsRemaining = Math.max(0, 30 - Math.floor((Date.now() - latestItem.timestamp.getTime()) / 1000));

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {items.slice(0, 1).map((item) => (
        <div
          key={item.id}
          className="bg-gray-900 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 animate-slide-up"
          role="alert"
          aria-live="polite"
        >
          <div className="flex-1">
            <p className="text-sm font-medium">{item.description}</p>
            <p className="text-xs text-gray-400">
              Undo available for {secondsRemaining}s
            </p>
          </div>
          <button
            onClick={onUndo}
            className="flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium transition-colors"
          >
            <Undo2 className="w-4 h-4" />
            Undo
          </button>
          <button
            onClick={() => onDismiss(item.id)}
            className="p-1 hover:bg-white/10 rounded transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
