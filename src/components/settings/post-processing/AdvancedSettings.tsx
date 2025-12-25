import { Box, Flex, Text, TextField } from "@radix-ui/themes";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export interface AdvancedSettingsProps {
  modelsEndpoint: string;
  onModelsEndpointChange: (value: string) => void;
}

export const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({
  modelsEndpoint,
  onModelsEndpointChange,
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [localEndpoint, setLocalEndpoint] = useState(modelsEndpoint);

  useEffect(() => {
    setLocalEndpoint(modelsEndpoint);
  }, [modelsEndpoint]);

  return (
    <Box>
      <Flex
        align="center"
        gap="1"
        onClick={() => setIsOpen(!isOpen)}
        className="cursor-pointer select-none text-gray-500 hover:text-gray-700 w-fit mb-2"
      >
        {isOpen ? (
          <IconChevronDown size={14} />
        ) : (
          <IconChevronRight size={14} />
        )}
        <Text size="2" weight="medium">
          {t("settings.postProcessing.api.providers.advancedSettings")}
        </Text>
      </Flex>

      {isOpen && (
        <Flex direction="column" gap="2">
          <Text size="2" weight="medium" color="gray">
            {t("settings.postProcessing.api.providers.fields.modelsEndpoint")}
          </Text>
          <TextField.Root
            value={localEndpoint}
            onChange={(e) => setLocalEndpoint(e.target.value)}
            onBlur={(e) => onModelsEndpointChange(e.target.value)}
            placeholder={t(
              "settings.postProcessing.api.providers.fields.modelsEndpointPlaceholder",
            )}
            variant="surface"
          />
        </Flex>
      )}
    </Box>
  );
};
