import React, { Fragment } from "react";
import {
  Tab as HeadlessTab,
  TabGroup,
  TabList,
  TabPanel,
  TabPanels,
} from "@headlessui/react";

export interface TabConfig {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  badge?: React.ReactNode;
  disabled?: boolean;
  content: React.ReactNode;
}

interface TabsProps {
  tabs: TabConfig[];
  onTabChange?: (tabId: string) => void;
  defaultTabIndex?: number;
  vertical?: boolean;
  className?: string;
}

export const Tabs: React.FC<TabsProps> = ({
  tabs,
  onTabChange,
  defaultTabIndex = 0,
  vertical = false,
  className = "",
}) => {
  return (
    <TabGroup
      onChange={(index) => onTabChange?.(tabs[index].id)}
      defaultIndex={Math.min(defaultTabIndex, tabs.length - 1)}
      as="div"
      className={className}
    >
      <TabList
        className={`flex gap-2 border-b border-mid-gray/20 ${
          vertical ? "flex-col border-b-0 border-r pr-4" : "flex-row"
        }`}
      >
        {tabs.map((tab) => (
          <HeadlessTab key={tab.id} disabled={tab.disabled} as={Fragment}>
            {({ selected, disabled }) => (
              <button
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors duration-150 relative group ${
                  selected
                    ? "text-logo-primary"
                    : disabled
                      ? "opacity-50 cursor-not-allowed"
                      : "text-text hover:text-logo-primary"
                } focus:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary`}
              >
                {tab.icon && <tab.icon className="w-5 h-5" />}
                <span>{tab.label}</span>
                {tab.badge && <span>{tab.badge}</span>}

                {selected && (
                  <div
                    className={`absolute h-1 bg-logo-primary ${
                      vertical
                        ? "right-0 top-0 bottom-0 w-1 rounded-l"
                        : "bottom-0 left-0 right-0 rounded-t"
                    }`}
                  />
                )}
              </button>
            )}
          </HeadlessTab>
        ))}
      </TabList>

      <TabPanels className="mt-4">
        {tabs.map((tab) => (
          <TabPanel key={tab.id} className="focus:outline-none">
            {tab.content}
          </TabPanel>
        ))}
      </TabPanels>
    </TabGroup>
  );
};
