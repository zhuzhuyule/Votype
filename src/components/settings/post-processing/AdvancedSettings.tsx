import { Box, Flex, Select, Text, TextField } from "@radix-ui/themes";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

// Built-in presets for models endpoint
const WORKER_BASE = "https://gitee-worker.zhuzhuyule-779.workers.dev/api/models";

const ENDPOINT_PRESETS: {
  id: string;
  label: string;
  value: string;
  providers?: string[];
}[] = [
  { id: "default", label: "Default", value: "/models" },
  {
    id: "gitee_free",
    label: "Gitee AI (Free)",
    value: `${WORKER_BASE}/free?provider=gitee`,
    providers: ["gitee"],
  },
  {
    id: "xingchen_free",
    label: "讯飞星辰 (Free)",
    value: `${WORKER_BASE}/free?provider=xunfei`,
    providers: ["xingchen"],
  },
  {
    id: "all_free",
    label: "All Free Models",
    value: `${WORKER_BASE}/free`,
  },
];

export interface AdvancedSettingsProps {
  modelsEndpoint: string;
  onModelsEndpointChange: (value: string) => void;
  providerId?: string;
}

export const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({
  modelsEndpoint,
  onModelsEndpointChange,
  providerId,
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [localEndpoint, setLocalEndpoint] = useState(modelsEndpoint);

  useEffect(() => {
    setLocalEndpoint(modelsEndpoint);
  }, [modelsEndpoint]);

  // Filter presets: show "Default" always + provider-specific ones + ones without provider restriction
  const availablePresets = useMemo(() => {
    return ENDPOINT_PRESETS.filter(
      (p) => !p.providers || !providerId || p.providers.includes(providerId),
    );
  }, [providerId]);

  // Find which preset matches current value (if any)
  const activePresetId = useMemo(() => {
    const match = ENDPOINT_PRESETS.find((p) => p.value === localEndpoint);
    return match?.id ?? "custom";
  }, [localEndpoint]);

  const handlePresetChange = (presetId: string) => {
    if (presetId === "custom") return;
    const preset = ENDPOINT_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      setLocalEndpoint(preset.value);
      onModelsEndpointChange(preset.value);
    }
  };

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
          <Flex gap="2" align="center">
            <Box className="flex-1">
              <TextField.Root
                value={localEndpoint}
                onChange={(e) => setLocalEndpoint(e.target.value)}
                onBlur={(e) => onModelsEndpointChange(e.target.value)}
                placeholder={t(
                  "settings.postProcessing.api.providers.fields.modelsEndpointPlaceholder",
                )}
                variant="surface"
              />
            </Box>
            {availablePresets.length > 1 && (
              <Select.Root
                value={activePresetId}
                onValueChange={handlePresetChange}
              >
                <Select.Trigger variant="soft" />
                <Select.Content>
                  {availablePresets.map((preset) => (
                    <Select.Item key={preset.id} value={preset.id}>
                      {preset.label}
                    </Select.Item>
                  ))}
                  {activePresetId === "custom" && (
                    <Select.Item value="custom" disabled>
                      Custom
                    </Select.Item>
                  )}
                </Select.Content>
              </Select.Root>
            )}
          </Flex>
        </Flex>
      )}
    </Box>
  );
};
