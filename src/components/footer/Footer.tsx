import { Flex, Text, Tooltip } from "@radix-ui/themes";
import {
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarRightCollapse,
} from "@tabler/icons-react";
import { getVersion } from "@tauri-apps/api/app";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import ModelSelector from "../model-selector";
import UpdateChecker from "../update-checker";
import { PostProcessBar } from "./PostProcessBar";
import { ThemeSelector } from "./ThemeSelector";

interface FooterProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

const Footer: React.FC<FooterProps> = ({
  sidebarCollapsed,
  onToggleSidebar,
}) => {
  const { t } = useTranslation();
  const [version, setVersion] = useState("");

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const appVersion = await getVersion();
        setVersion(appVersion);
      } catch (error) {
        console.error("Failed to get version", error);
        setVersion("0.1.2");
      }
    };

    fetchVersion();
  }, []);

  return (
    <Flex
      direction="column"
      className="w-full border-t border-mid-gray/20 pt-3"
    >
      <Flex
        justify="between"
        align="center"
        className="text-xs px-4 pb-3 text-text/60"
      >
        <Flex align="center" gap="4">
          <Tooltip
            content={
              sidebarCollapsed ? t("common.expand") : t("common.collapse")
            }
          >
            <button
              onClick={onToggleSidebar}
              className="cursor-pointer text-(--gray-11) hover:text-(--gray-12) transition-colors p-1"
            >
              {sidebarCollapsed ? (
                <IconLayoutSidebarRightCollapse size={16} />
              ) : (
                <IconLayoutSidebarLeftCollapse size={16} />
              )}
            </button>
          </Tooltip>
          <ModelSelector />
          <PostProcessBar />
        </Flex>

        {/* Update Status */}
        <Flex align="center" gap="3">
          <Flex align="center" gap="1">
            <UpdateChecker />
            <Text>•</Text>
            <Text>v{version}</Text>
          </Flex>
          <ThemeSelector />
        </Flex>
      </Flex>
    </Flex>
  );
};

export default Footer;
