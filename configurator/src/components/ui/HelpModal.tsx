import { X, Keyboard, Book, MessageCircle } from 'lucide-react';

interface HelpModalProps {
  onClose: () => void;
}

export default function HelpModal({ onClose }: HelpModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        className="relative bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 id="help-title" className="text-lg font-semibold text-gray-900">Help & Shortcuts</h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
            aria-label="Close help"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-6 overflow-y-auto max-h-[60vh]">
          {/* Keyboard shortcuts */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Keyboard className="w-5 h-5 text-blue-600" />
              <h3 className="font-medium text-gray-900">Keyboard Shortcuts</h3>
            </div>
            <div className="space-y-2">
              {[
                { keys: ['Ctrl', '/'], action: 'Open this help dialog' },
                { keys: ['F1'], action: 'Open this help dialog' },
                { keys: ['Ctrl', 'Z'], action: 'Undo last action' },
                { keys: ['Escape'], action: 'Close dialogs / Cancel' },
                { keys: ['Enter'], action: 'Confirm action' },
                { keys: ['Tab'], action: 'Navigate between elements' },
              ].map(({ keys, action }) => (
                <div key={action} className="flex items-center justify-between py-1">
                  <span className="text-sm text-gray-600">{action}</span>
                  <div className="flex items-center gap-1">
                    {keys.map((key, i) => (
                      <span key={i}>
                        <kbd className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-mono">
                          {key}
                        </kbd>
                        {i < keys.length - 1 && <span className="text-gray-400 mx-1">+</span>}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Quick guide */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Book className="w-5 h-5 text-blue-600" />
              <h3 className="font-medium text-gray-900">Quick Guide</h3>
            </div>
            <div className="space-y-3 text-sm text-gray-600">
              <p>
                <strong className="text-gray-900">Phase 1:</strong> Create tenant and configure branding.
                Upload "Tenant And Branding Master.xlsx".
              </p>
              <p>
                <strong className="text-gray-900">Phase 2:</strong> Set up boundary hierarchy (State → City → Ward).
                Create or select existing hierarchy.
              </p>
              <p>
                <strong className="text-gray-900">Phase 3:</strong> Configure departments, designations, and complaint types.
                Upload "Common and Complaint Master.xlsx".
              </p>
              <p>
                <strong className="text-gray-900">Phase 4:</strong> Bulk create employees with roles and jurisdictions.
                Generate dynamic template, fill, and upload.
              </p>
            </div>
          </section>

          {/* Support */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <MessageCircle className="w-5 h-5 text-blue-600" />
              <h3 className="font-medium text-gray-900">Need Help?</h3>
            </div>
            <p className="text-sm text-gray-600 mb-3">
              If you encounter issues or have questions:
            </p>
            <div className="flex flex-col gap-2">
              <a
                href="#"
                className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
                onClick={(e) => e.preventDefault()}
              >
                View Documentation
              </a>
              <a
                href="#"
                className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
                onClick={(e) => e.preventDefault()}
              >
                Contact Support
              </a>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
