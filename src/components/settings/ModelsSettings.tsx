import { Box, Flex, SegmentedControl } from "@radix-ui/themes";
import { IconCloud, IconDeviceDesktop } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { AsrModelsSettings } from "./asr-models/AsrModelsSettings";
import { ModelsConfiguration } from "./post-processing/ModelsConfiguration";

export const ModelsSettings: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("api");

  return (
    <Box className="w-full max-w-5xl mx-auto space-y-4">
      <Flex justify="center">
        <SegmentedControl.Root
          value={activeTab}
          onValueChange={setActiveTab}
          size="2"
        >
          <SegmentedControl.Item value="api">
            <Flex gap="2" align="center" px="8">
              <IconCloud size={16} />
              {t("settings.postProcessing.models.tabs.remote") ||
                "Online Models"}
            </Flex>
          </SegmentedControl.Item>
          <SegmentedControl.Item value="local">
            <Flex gap="2" align="center" px="8">
              <IconDeviceDesktop size={16} />
              {t("settings.postProcessing.models.tabs.local") || "Local Models"}
            </Flex>
          </SegmentedControl.Item>
        </SegmentedControl.Root>
      </Flex>

      {activeTab === "api" ? (
        <Box pt="2" key="api" className="animate-fade-in-up">
          <ModelsConfiguration />
        </Box>
      ) : (
        <Box pt="2" key="local" className="animate-fade-in-up">
          <AsrModelsSettings className="max-w-5xl" hideHeader={true} />
        </Box>
      )}
    </Box>
  );
};
