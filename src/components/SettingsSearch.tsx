import React, { useState, useMemo } from "react";
import { SearchInput } from "./ui/SearchInput";
import { SECTIONS_CONFIG } from "./Sidebar";

interface SearchableSection {
  id: string;
  name: string;
  description: string;
}

const SEARCHABLE_ITEMS: SearchableSection[] = [
  {
    id: "general",
    name: "General",
    description: "Keyboard shortcuts, language, audio input",
  },
  {
    id: "advanced",
    name: "Advanced Settings",
    description: "Model management, audio settings, clipboard handling",
  },
  {
    id: "ai",
    name: "AI Settings",
    description: "Post-processing, translation, custom words",
  },
  {
    id: "models",
    name: "Models",
    description: "Download and manage AI models",
  },
  {
    id: "history",
    name: "History",
    description: "Transcription history management",
  },
  {
    id: "debug",
    name: "Debug",
    description: "Developer and debug tools",
  },
  {
    id: "about",
    name: "About",
    description: "Application information",
  },
];

interface SettingsSearchProps {
  onNavigate: (sectionId: string) => void;
}

export const SettingsSearch: React.FC<SettingsSearchProps> = ({
  onNavigate,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const results = useMemo(() => {
    if (!searchQuery.trim()) return [];

    const query = searchQuery.toLowerCase();
    return SEARCHABLE_ITEMS.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query),
    ).slice(0, 5);
  }, [searchQuery]);

  const handleSelectResult = (sectionId: string) => {
    setSearchQuery("");
    setIsOpen(false);
    onNavigate(sectionId);
  };

  return (
    <div className="relative">
      <div
        onFocus={() => setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 200)}
        className="w-full"
      >
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search settings..."
          onClear={() => setIsOpen(false)}
          className="w-full"
        />

        {isOpen && (searchQuery || results.length > 0) && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-background border border-mid-gray/80 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
            {results.length > 0 ? (
              results.map((result) => (
                <button
                  key={result.id}
                  onClick={() => handleSelectResult(result.id)}
                  className="w-full px-4 py-3 text-left hover:bg-mid-gray/10 transition-colors border-b border-mid-gray/20 last:border-b-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary"
                >
                  <div className="font-medium text-sm text-text">
                    {result.name}
                  </div>
                  <div className="text-xs text-mid-gray mt-1">
                    {result.description}
                  </div>
                </button>
              ))
            ) : (
              <div className="px-4 py-6 text-center text-sm text-mid-gray">
                No settings found matching "{searchQuery}"
              </div>
            )}
          </div>
        )}
      </div>

      {/* Overlay to close on click outside */}
      {isOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
      )}
    </div>
  );
};
