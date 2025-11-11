import React from "react";
import {
  Cog,
  FlaskConical,
  History,
  Info,
  Sparkles,
  Layers,
} from "lucide-react";
import HandyTextLogo from "./icons/HandyTextLogo";
import HandyHand from "./icons/HandyHand";
import { useSettings } from "../hooks/useSettings";
import {
  GeneralSettings,
  AdvancedSettings,
  HistorySettings,
  DebugSettings,
  AboutSettings,
  AiSettings,
  ModelsSettings,
} from "./settings";

export type SidebarSection = keyof typeof SECTIONS_CONFIG;

interface IconProps {
  width?: number | string;
  height?: number | string;
  size?: number | string;
  className?: string;
  [key: string]: any;
}

interface SectionConfig {
  label: string;
  icon: React.ComponentType<IconProps>;
  component: React.ComponentType;
  enabled: (settings: any) => boolean;
}

export const SECTIONS_CONFIG = {
  general: {
    label: "General",
    icon: HandyHand,
    component: GeneralSettings,
    enabled: () => true,
  },
  advanced: {
    label: "Advanced",
    icon: Cog,
    component: AdvancedSettings,
    enabled: () => true,
  },
  ai: {
    label: "AI",
    icon: Sparkles,
    component: AiSettings,
    enabled: () => true,
  },
  models: {
    label: "Models",
    icon: Layers,
    component: ModelsSettings,
    enabled: () => true,
  },
  history: {
    label: "History",
    icon: History,
    component: HistorySettings,
    enabled: () => true,
  },
  debug: {
    label: "Debug",
    icon: FlaskConical,
    component: DebugSettings,
    enabled: (settings) => settings?.debug_mode ?? false,
  },
  about: {
    label: "About",
    icon: Info,
    component: AboutSettings,
    enabled: () => true,
  },
} as const satisfies Record<string, SectionConfig>;

interface SidebarProps {
  activeSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSectionChange,
}) => {
  const { settings } = useSettings();

  const availableSections = Object.entries(SECTIONS_CONFIG)
    .filter(([_, config]) => config.enabled(settings))
    .map(([id, config]) => ({ id: id as SidebarSection, ...config }));

  return (
    <nav className="flex flex-col w-48 h-full border-r border-mid-gray/20 bg-background/50 backdrop-blur-sm">
      {/* Logo Section */}
      <div className="flex items-center justify-center px-4 py-4 border-b border-mid-gray/20">
        <HandyTextLogo width={120} />
      </div>

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto px-2 py-4">
        <div
          className="flex flex-col gap-1"
          role="navigation"
          aria-label="Main navigation"
        >
          {availableSections.map((section) => {
            const Icon = section.icon;
            const isActive = activeSection === section.id;

            return (
              <button
                key={section.id}
                onClick={() => onSectionChange(section.id)}
                className={`flex gap-3 items-center px-3 py-2 w-full rounded-lg font-medium text-sm transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary focus-visible:ring-inset ${
                  isActive
                    ? "bg-logo-primary/20 text-logo-primary shadow-sm"
                    : "text-text hover:bg-mid-gray/10 opacity-85 hover:opacity-100"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon width={20} height={20} className="flex-shrink-0" />
                <span className="flex-1 text-left">{section.label}</span>
                {isActive && (
                  <div className="w-1.5 h-1.5 rounded-full bg-logo-primary flex-shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
};
