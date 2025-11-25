import { Box, Button, Flex, Text } from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModelInfo } from "../../lib/types";
import { VotypeHand } from "../icons/VotypeHand";
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
      // Only show downloadable models for onboarding
      setAvailableModels(models.filter((m) => !m.is_downloaded));
    } catch (err) {
      console.error("Failed to load models:", err);
      setError(t("onboarding.failedLoadModels"));
    }
  };

  const handleDownloadModel = async (modelId: string) => {
    setDownloading(true);
    setError(null);

    // Immediately transition to main app - download will continue in footer
    onModelSelected();

    try {
      await invoke("download_model", { modelId });
    } catch (err) {
      console.error("Download failed:", err);
      setError(
        t("onboarding.failedDownloadModel", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      setDownloading(false);
    }
  };

  const getRecommendedBadge = (modelId: string): boolean => {
    return modelId === "parakeet-tdt-0.6b-v3";
  };

  return (
    <Flex
      direction="column"
      className="h-screen w-screen p-6 gap-4 inset-0"
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
        maxWidth="600px"
        width="100%"
        mx="auto"
        align="center"
        className="flex-1 min-h-0"
      >
        {error && (
          <Box
            className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-4 shrink-0"
          >
            <Text color="red" size="2">
              {error}
            </Text>
          </Box>
        )}

        <Flex direction="column" gap="4" className="w-full">
          <Flex justify="between" className="w-full">
            <Text
              className="text-text/70 max-w-md font-medium mx-auto"
              size="3"
              align="center"
            >
              {t("onboarding.description")}
            </Text>
            <Button
              variant="ghost"
              onClick={onModelSelected}
              className="text-muted-foreground hover:text-foreground"
            >
              {t('common.skip')}
            </Button>
          </Flex>
          {availableModels
            .filter((model) => getRecommendedBadge(model.id))
            .map((model) => (
              <ModelCard
                key={model.id}
                model={model}
                variant="featured"
                disabled={downloading}
                onSelect={handleDownloadModel}
              />
            ))}

          {availableModels
            .filter((model) => !getRecommendedBadge(model.id))
            .sort((a, b) => a.size_mb - b.size_mb)
            .map((model) => (
              <ModelCard
                key={model.id}
                model={model}
                disabled={downloading}
                onSelect={handleDownloadModel}
              />
            ))}
        </Flex>
      </Flex>
    </Flex>
  );
};

export default Onboarding;
