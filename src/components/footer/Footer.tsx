import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { Flex, Text } from "@radix-ui/themes";

import ModelSelector from "../model-selector";
import UpdateChecker from "../update-checker";

const Footer: React.FC = () => {
  const { t } = useTranslation();
  const [version, setVersion] = useState("");

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const appVersion = await getVersion();
        setVersion(appVersion);
      } catch (error) {
        console.error(t("error.failedGetVersion"), error);
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
        <Flex align="center" gap="1">
          <UpdateChecker />
          <Text>•</Text>
          <Text>v{version}</Text>
        </Flex>
      </Flex>
    </Flex>
  );
};

export default Footer;
