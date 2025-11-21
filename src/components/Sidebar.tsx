import { Flex, Text } from "@radix-ui/themes";
import {
    Cog,
    FlaskConical,
    History,
    Info,
    Layers,
    Sparkles,
} from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../hooks/useSettings";
import HandyHand from "./icons/HandyHand";
import HandyTextLogo from "./icons/HandyTextLogo";
import {
    AboutSettings,
    AdvancedSettings,
    DebugSettings,
    GeneralSettings,
    HistorySettings,
    ModelsConfiguration,
    PromptsConfiguration,
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
  labelKey: string;
  icon: React.ComponentType<IconProps>;
  component: React.ComponentType;
  enabled: (settings: any) => boolean;
}

export const SECTIONS_CONFIG = {
  general: {
    labelKey: "sidebar.general",
    icon: HandyHand,
    component: GeneralSettings,
    enabled: () => true,
  },
  advanced: {
    labelKey: "sidebar.advanced",
    icon: Cog,
    component: AdvancedSettings,
    enabled: () => true,
  },
  models: {
    labelKey: "sidebar.models",
    icon: Layers,
    component: ModelsConfiguration,
    enabled: () => true,
  },
  prompts: {
    labelKey: "sidebar.prompts",
    icon: Sparkles,
    component: PromptsConfiguration,
    enabled: () => true,
  },
  history: {
    labelKey: "sidebar.history",
    icon: History,
    component: HistorySettings,
    enabled: () => true,
  },
  debug: {
    labelKey: "sidebar.debug",
    icon: FlaskConical,
    component: DebugSettings,
    enabled: (settings) => settings?.debug_mode ?? false,
  },
  about: {
    labelKey: "sidebar.about",
    icon: Info,
    component: AboutSettings,
    enabled: () => true,
  },
} as const satisfies Record<string, SectionConfig>;

interface SidebarProps {
  activeSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
}

type SectionWithLabel = SectionConfig & {
  id: SidebarSection;
  label: string;
};

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSectionChange,
}) => {
  const { t } = useTranslation();
  const { settings } = useSettings();

  const availableSections: SectionWithLabel[] = Object.entries(SECTIONS_CONFIG)
    .filter(([_, config]) => config.enabled(settings))
    .map(([id, config]) => ({
      id: id as SidebarSection,
      ...config,
      label: t(config.labelKey),
    }));

  return (
    <Flex
      direction="column"
      className="w-40 h-full border-r border-mid-gray/20 items-center px-2"
    >
      <HandyTextLogo width={120} className="m-4 text-logo-primary/60" />
      <Flex
        direction="column"
        className="w-full items-center gap-1 pt-2 border-t border-mid-gray/20"
      >
        {availableSections.map((section) => {
          const Icon = section.icon;
          const isActive = activeSection === section.id;

          return (
            <Flex
              key={section.id}
              gap="2"
              align="center"
              p="2"
              className={`w-full cursor-pointer rounded-lg transition-colors ${
                isActive
                  ? "bg-logo-primary/60 primary text-white"
                  : "hover:bg-mid-gray/20 hover:opacity-100 opacity-85"
              }`}
              onClick={() => onSectionChange(section.id)}
            >
              <Icon width={24} height={24} />
              <Text size="2" weight="medium">
                {section.label}
              </Text>
            </Flex>
          );
        })}
      </Flex>
    </Flex>
  );
};
