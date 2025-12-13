import { Flex, Text } from "@radix-ui/themes";
import {
  IconAdjustments,
  IconBrain,
  IconBug,
  IconInfoSquare,
  IconKeyboard,
  IconLayoutDashboard,
  IconSettings,
  IconSparkles,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../hooks/useSettings";
import VotypeHand from "./icons/VotypeHand";
import {
  AboutSettings,
  AdvancedSettings,
  Dashboard,
  DebugSettings,
  GeneralSettings,
  ModelsConfiguration,
  PromptsConfiguration,
  ShortcutsSettings,
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
  dashboard: {
    labelKey: "sidebar.dashboard",
    icon: IconLayoutDashboard,
    component: Dashboard,
    enabled: () => true,
  },
  general: {
    labelKey: "sidebar.general",
    icon: IconSettings,
    component: GeneralSettings,
    enabled: () => true,
  },
  shortcuts: {
    labelKey: "sidebar.shortcuts",
    icon: IconKeyboard,
    component: ShortcutsSettings,
    enabled: () => true,
  },
  advanced: {
    labelKey: "sidebar.advanced",
    icon: IconAdjustments,
    component: AdvancedSettings,
    enabled: () => true,
  },
  models: {
    labelKey: "sidebar.models",
    icon: IconBrain,
    component: ModelsConfiguration,
    enabled: () => true,
  },
  prompts: {
    labelKey: "sidebar.prompts",
    icon: IconSparkles,
    component: PromptsConfiguration,
    enabled: () => true,
  },
  debug: {
    labelKey: "sidebar.debug",
    icon: IconBug,
    component: DebugSettings,
    enabled: (settings) => settings?.debug_mode ?? false,
  },
  about: {
    labelKey: "sidebar.about",
    icon: IconInfoSquare,
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
      <VotypeHand size={24} />
      <Flex
        direction="column"
        className="w-full items-center gap-1 pt-2"
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
              className={`w-full cursor-pointer rounded-lg transition-colors ${isActive
                ? ""
                : "hover:bg-mid-gray/20 hover:opacity-100 opacity-85"
                }`}
              style={
                isActive
                  ? {
                    backgroundColor: "var(--accent-9)",
                    color: "white",
                  }
                  : undefined
              }
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
