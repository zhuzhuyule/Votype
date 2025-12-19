import { Box, Button, Flex, ScrollArea, Text } from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModelInfo } from "../../lib/types";
import { VotypeHand } from "../icons/VotypeHand";
import { RECOMMENDED_MODEL_IDS } from "../settings/asr-models/constants";
import ModelCard from "./ModelCard";

interface OnboardingProps {
  onModelSelected: () => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ onModelSelected }) => {
  const { t } = useTranslation();
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    try {
      const models: ModelInfo[] = await invoke("get_available_models");
      setAvailableModels(models);
    } catch (err) {
      console.error("Failed to load models:", err);
      setError(t("onboarding.errors.loadModels"));
    }
  };

  const handleDownloadModel = async (modelId: string) => {
    setDownloading(true);
    setError(null);
    onModelSelected();

    try {
      await invoke("download_model", { modelId });
    } catch (err) {
      console.error("Download failed:", err);
      setError(
        t("onboarding.errors.downloadModel", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      setDownloading(false);
    }
  };

  // Filter out punctuation models and separate into recommended/others
  const { recommendedModels, otherModels } = useMemo(() => {
    // Exclude punctuation models - they are plugins, not ASR models
    const asrModels = availableModels.filter(
      (m) => m.engine_type !== "SherpaOnnxPunctuation",
    );

    const recommended = asrModels
      .filter((m) => RECOMMENDED_MODEL_IDS.has(m.id))
      .sort((a, b) => a.size_mb - b.size_mb);

    const others = asrModels
      .filter((m) => !RECOMMENDED_MODEL_IDS.has(m.id))
      .sort((a, b) => a.size_mb - b.size_mb);

    return { recommendedModels: recommended, otherModels: others };
  }, [availableModels]);

  return (
    <Flex
      direction="column"
      className="h-screen w-screen p-6 gap-4 inset-0 max-w-650"
    >
      <Flex
        direction="column"
        align="center"
        gap="2"
        className="shrink-0 my-12"
      >
        <VotypeHand />
      </Flex>
      <Flex
        direction="column"
        maxWidth="650px"
        width="100%"
        mx="auto"
        align="center"
      >
        {error && (
          <Box className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-4 shrink-0">
            <Text color="red" size="2">
              {error}
            </Text>
          </Box>
        )}

        <Flex direction="column" gap="4" className="w-full">
          <Flex justify="between" align="center" className="w-full shrink-0">
            <Text className="text-text/70 font-medium" size="3">
              {t("onboarding.subtitle")}
            </Text>
            <Button
              variant="ghost"
              onClick={onModelSelected}
              className="text-muted-foreground hover:text-foreground"
            >
              {t("common.skip")}
            </Button>
          </Flex>
        </Flex>
      </Flex>
      <ScrollArea type="hover" scrollbars="vertical" className="flex-1">
        <Flex
          direction="column"
          gap="3"
          className="overflow-hidden max-w-[650px] mx-auto"
        >
          {recommendedModels.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              variant="featured"
              disabled={downloading}
              onSelect={handleDownloadModel}
            />
          ))}

          {otherModels.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              disabled={downloading}
              onSelect={handleDownloadModel}
            />
          ))}
        </Flex>
      </ScrollArea>
    </Flex>
  );
};

export default Onboarding;
