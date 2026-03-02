import {
  Flex,
  IconButton,
  Popover,
  ScrollArea,
  Switch,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import {
  IconCheck,
  IconChevronRight,
  IconLanguage,
  IconSparkles,
  IconTextGrammar,
  IconWand,
} from "@tabler/icons-react";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";

export const PostProcessBar: React.FC = () => {
  const { t } = useTranslation();
  const { settings, getSetting, updateSetting, isUpdating, selectPromptModel } =
    useSettings();
  const [showModelList, setShowModelList] = useState(false);

  const punctEnabled = getSetting("punctuation_enabled") || false;
  const punctUpdating = isUpdating("punctuation_enabled");

  const translateEnabled = getSetting("translate_to_english") || false;
  const translateUpdating = isUpdating("translate_to_english");

  const llmEnabled = getSetting("post_process_enabled") || false;
  const llmUpdating = isUpdating("post_process_enabled");

  const hasActiveProcess = punctEnabled || translateEnabled || llmEnabled;

  const textModels = useMemo(
    () =>
      (settings?.cached_models || []).filter(
        (model) => model.model_type === "text",
      ),
    [settings?.cached_models],
  );

  const selectedModelId = settings?.selected_prompt_model_id ?? "";
  const selectedModel = textModels.find((m) => m.id === selectedModelId);
  const selectedModelLabel = selectedModel
    ? selectedModel.custom_label || selectedModel.model_id
    : "";

  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (!open) setShowModelList(false);
      }}
    >
      <Tooltip content={t("footer.postProcess.title")}>
        <Popover.Trigger>
          <IconButton
            variant="ghost"
            color={hasActiveProcess ? undefined : "gray"}
            size="1"
          >
            <IconSparkles
              size={16}
              style={{ opacity: hasActiveProcess ? 1 : 0.5 }}
            />
          </IconButton>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Content
        size="1"
        style={{ minWidth: 240, padding: 12, overflow: "visible" }}
      >
        <div style={{ position: "relative" }}>
          <Flex direction="column" gap="3">
            <Text size="1" weight="bold" color="gray">
              {t("footer.postProcess.title")}
            </Text>

            <Flex justify="between" align="center" gap="4">
              <Flex align="center" gap="2">
                <IconTextGrammar size={14} />
                <Text size="2">{t("footer.postProcess.punctuation")}</Text>
              </Flex>
              <Switch
                size="1"
                checked={punctEnabled}
                disabled={punctUpdating}
                onCheckedChange={(checked) =>
                  updateSetting("punctuation_enabled", checked)
                }
              />
            </Flex>

            <Flex justify="between" align="center" gap="4">
              <Flex align="center" gap="2">
                <IconLanguage size={14} />
                <Text size="2">{t("footer.postProcess.translate")}</Text>
              </Flex>
              <Switch
                size="1"
                checked={translateEnabled}
                disabled={translateUpdating}
                onCheckedChange={(checked) =>
                  updateSetting("translate_to_english", checked)
                }
              />
            </Flex>

            <Flex justify="between" align="center" gap="4">
              <Flex align="center" gap="2">
                <IconWand size={14} />
                <Text size="2">{t("footer.postProcess.llm")}</Text>
              </Flex>
              <Switch
                size="1"
                checked={llmEnabled}
                disabled={llmUpdating}
                onCheckedChange={(checked) =>
                  updateSetting("post_process_enabled", checked)
                }
              />
            </Flex>

            {/* Selected model row - shown when LLM is enabled */}
            {llmEnabled && textModels.length > 0 && (
              <button
                onClick={() => setShowModelList(!showModelList)}
                className="flex items-center justify-between w-full rounded-md px-2 py-1.5 cursor-pointer transition-colors bg-(--gray-a3) hover:bg-(--gray-a4)"
              >
                <Text size="1" color="gray" truncate>
                  {selectedModelLabel || t("footer.postProcess.selectModel")}
                </Text>
                <IconChevronRight
                  size={12}
                  className="text-(--gray-9) flex-shrink-0"
                />
              </button>
            )}
          </Flex>

          {/* Model list side panel - bottom aligned */}
          {showModelList && (
            <div
              className="absolute left-full bottom-0 ml-3 bg-(--color-panel-solid) border border-(--gray-a6) shadow-lg z-50"
              style={{
                borderRadius: "var(--radius-3)",
                minWidth: 200,
                maxWidth: 280,
              }}
            >
              <ScrollArea
                type="hover"
                scrollbars="vertical"
                style={{ maxHeight: 240 }}
              >
                <Flex direction="column" py="1">
                  {textModels.map((model) => {
                    const isActive = model.id === selectedModelId;
                    const label = model.custom_label || model.model_id;
                    return (
                      <button
                        key={model.id}
                        onClick={() => {
                          selectPromptModel(model.id);
                          setShowModelList(false);
                        }}
                        className={`flex items-center justify-between gap-2 px-3 py-1.5 cursor-pointer transition-colors text-left ${
                          isActive
                            ? "bg-(--accent-a3) text-(--accent-11)"
                            : "hover:bg-(--gray-a3)"
                        }`}
                      >
                        <Text size="1" truncate>
                          {label}
                        </Text>
                        {isActive && (
                          <IconCheck size={14} className="flex-shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </Flex>
              </ScrollArea>
            </div>
          )}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
};
