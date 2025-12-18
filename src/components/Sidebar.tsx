import { Flex, Text } from "@radix-ui/themes";
import {
  IconAdjustments,
  IconBrain,
  IconInfoSquare,
  IconKeyboard,
  IconLayoutDashboard,
  IconSettings,
  IconSparkles
} from "@tabler/icons-react";
import React, { lazy } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../hooks/useSettings";
import VotypeHand from "./icons/VotypeHand";

// 使用懒加载导入所有设置组件，减少初始 bundle 大小
const Dashboard = lazy(() =>
  import("./settings/dashboard/Dashboard").then(m => ({ default: m.Dashboard }))
);
const GeneralSettings = lazy(() =>
  import("./settings/general/GeneralSettings").then(m => ({ default: m.GeneralSettings }))
);
const ShortcutsSettings = lazy(() =>
  import("./settings/shortcuts/ShortcutsSettings").then(m => ({ default: m.ShortcutsSettings }))
);
const AdvancedSettings = lazy(() =>
  import("./settings/advanced/AdvancedSettings").then(m => ({ default: m.AdvancedSettings }))
);
const ModelsConfiguration = lazy(() =>
  import("./settings/ModelsSettings").then(m => ({ default: m.ModelsSettings }))
);
const PromptsConfiguration = lazy(() =>
  import("./settings/post-processing/PromptsConfiguration").then(m => ({ default: m.PromptsConfiguration }))
);
const AboutSettings = lazy(() =>
  import("./settings/about/AboutSettings").then(m => ({ default: m.AboutSettings }))
);

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
  shortcutKey: string;
}

export const SECTIONS_CONFIG = {
  dashboard: {
    labelKey: "sidebar.dashboard",
    icon: IconLayoutDashboard,
    component: Dashboard,
    enabled: () => true,
    shortcutKey: "1",
  },
  general: {
    labelKey: "sidebar.general",
    icon: IconSettings,
    component: GeneralSettings,
    enabled: () => true,
    shortcutKey: "2",
  },
  
  advanced: {
    labelKey: "sidebar.advanced",
    icon: IconAdjustments,
    component: AdvancedSettings,
    enabled: () => true,
    shortcutKey: "4",
  },
  models: {
    labelKey: "sidebar.models",
    icon: IconBrain,
    component: ModelsConfiguration,
    enabled: () => true,
    shortcutKey: "5",
  },
  prompts: {
    labelKey: "sidebar.prompts",
    icon: IconSparkles,
    component: PromptsConfiguration,
    enabled: () => true,
    shortcutKey: "7",
  },
  shortcuts: {
    labelKey: "sidebar.shortcuts",
    icon: IconKeyboard,
    component: ShortcutsSettings,
    enabled: () => true,
    shortcutKey: "3",
  },
  about: {
    labelKey: "sidebar.about",
    icon: IconInfoSquare,
    component: AboutSettings,
    enabled: () => true,
    shortcutKey: "8",
  },
} as const satisfies Record<string, SectionConfig>;

interface SidebarProps {
  activeSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
}

type SectionWithLabel = SectionConfig & {
  id: SidebarSection;
  label: string;
  shortcutKey: string;
};

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSectionChange,
}) => {
  const { t } = useTranslation();
  const { settings } = useSettings();

  const availableSections: SectionWithLabel[] = Object.entries(SECTIONS_CONFIG)
    .filter(([_, config]) => config.enabled())
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
              align="center"
              justify="between"
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
              <Flex gap="2" align="center">
                <Icon width={24} height={24} />
                <Text size="2" weight="medium">
                  {section.label}
                </Text>
              </Flex>
              <Text size="1" className={`${isActive ? "opacity-90" : "opacity-50"}`}>
                {section.shortcutKey}
              </Text>
            </Flex>
          );
        })}
      </Flex>
    </Flex>
  );
};
