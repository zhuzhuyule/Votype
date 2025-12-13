import { Flex, Text } from "@radix-ui/themes";
import { getVersion } from "@tauri-apps/api/app";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import ModelSelector from "../model-selector";
import UpdateChecker from "../update-checker";
import { ThemeSelector } from "./ThemeSelector";

const Footer: React.FC = () => {
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
    <Flex direction="column" className="w-full border-t border-mid-gray/20 pt-3">
      <Flex justify="between" align="center" className="text-xs px-4 pb-3 text-text/60">
        <Flex align="center" gap="4">
          <ModelSelector />
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
