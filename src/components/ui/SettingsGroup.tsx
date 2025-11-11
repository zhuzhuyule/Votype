import React from "react";
import * as Accordion from "@radix-ui/react-accordion";

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
  if (collapsible) {
    return (
      <Accordion.Root
        type="single"
        collapsible
        defaultValue={defaultOpen ? "settings" : undefined}
        className="space-y-2"
      >
        <Accordion.Item value="settings" className="border-0">
          <Accordion.Header>
            <Accordion.Trigger className="flex items-center justify-between w-full group">
              <div className="flex items-center justify-between flex-1">
                {title && (
                  <div className="px-4">
                    <h2 className="text-xs font-medium text-mid-gray uppercase tracking-wide group-hover:text-text transition-colors">
                      {title}
                    </h2>
                    {description && (
                      <p className="text-xs text-mid-gray mt-1 group-hover:text-text/80 transition-colors">
                        {description}
                      </p>
                    )}
                  </div>
                )}
                {actions && <div className="px-4">{actions}</div>}
              </div>
              <div className="px-4 text-mid-gray group-hover:text-text transition-colors">
                <svg className="w-4 h-4 transition-transform duration-200 group-data-[state=open]:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Content className="bg-background border border-mid-gray/20 rounded-lg overflow-visible">
            <div className="divide-y divide-mid-gray/20">
              {children}
            </div>
          </Accordion.Content>
        </Accordion.Item>
      </Accordion.Root>
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
