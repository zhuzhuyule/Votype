import React from "react";

interface SettingsGroupProps {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  title,
  description,
  children,
  actions,
  collapsible = false,
  defaultOpen = true,
}) => {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  if (collapsible && title) {
    return (
      <div className="rounded-lg border border-mid-gray/20 overflow-hidden">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-mid-gray/5 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary focus-visible:ring-inset"
        >
          <div className="flex-1 text-left">
            <h2 className="text-sm font-semibold text-text">{title}</h2>
            {description && (
              <p className="text-xs text-mid-gray mt-1">{description}</p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2 ml-4">{actions}</div>
          )}
          <svg
            className={`w-5 h-5 ml-2 transition-transform duration-200 ${
              isOpen ? "rotate-180" : ""
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
        {isOpen && (
          <div className="bg-mid-gray/5 border-t border-mid-gray/20">
            <div className="divide-y divide-mid-gray/20">{children}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        {title && (
          <div className="px-4">
            <h2 className="text-xs font-medium text-mid-gray uppercase tracking-wide">
              {title}
            </h2>
            {description && (
              <p className="text-xs text-mid-gray mt-1">{description}</p>
            )}
          </div>
        )}
        {actions && <div className="px-4">{actions}</div>}
      </div>
      <div className="bg-background border border-mid-gray/20 rounded-lg overflow-visible">
        <div className="divide-y divide-mid-gray/20">{children}</div>
      </div>
    </div>
  );
};
