import React from "react";

interface SettingsGroupProps {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  title,
  description,
  children,
  actions,
}) => {
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
      <div className="bg-white border border-mid-gray/10 rounded-lg overflow-visible">
        <div className="divide-y divide-mid-gray/10">{children}</div>
      </div>
    </div>
  );
};
