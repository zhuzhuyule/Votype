import { Box, Button, Flex, ScrollArea, Text } from "@radix-ui/themes";
import { IconChevronDown } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModelInfo } from "../../lib/types";
import { RECOMMENDED_MODEL_IDS } from "../settings/asr-models/constants";
import ModelCard from "./ModelCard";
import WelcomeStep from "./steps/WelcomeStep";

// Onboarding steps
enum OnboardingStep {
  Welcome = 0,
  ModelDownload = 1,
}

interface OnboardingProps {
  onModelSelected: () => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ onModelSelected }) => {
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(
    OnboardingStep.Welcome,
  );
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMoreModels, setShowMoreModels] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showStep, setShowStep] = useState(true);

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

  const nextStep = () => {
    if (currentStep < OnboardingStep.ModelDownload) {
      // Start transition out
      setIsTransitioning(true);
      setShowStep(false);

      // After fade out, change step and fade in
      setTimeout(() => {
        setCurrentStep(currentStep + 1);
        setShowMoreModels(false);
        setTimeout(() => {
          setShowStep(true);
          setIsTransitioning(false);
        }, 50);
      }, 300);
    } else {
      onModelSelected();
    }
  };

  // Filter out punctuation models and separate into recommended/others
  const { recommendedModels, otherModels } = useMemo(() => {
    const asrModels = availableModels;

    const recommended = asrModels
      .filter((m) => RECOMMENDED_MODEL_IDS.has(m.id))
      .sort((a, b) => a.size_mb - b.size_mb);

    const others = asrModels
      .filter((m) => !RECOMMENDED_MODEL_IDS.has(m.id))
      .sort((a, b) => a.size_mb - b.size_mb);

    return { recommendedModels: recommended, otherModels: others };
  }, [availableModels]);

  // Render progress indicator
  const renderProgressIndicator = () => {
    const totalSteps = 2;
    return (
      <Flex gap="2" className="absolute top-6 left-1/2 -translate-x-1/2 z-10">
        {Array.from({ length: totalSteps }).map((_, index) => (
          <Box
            key={index}
            className={`w-2 h-2 rounded-full transition-colors ${
              index <= currentStep ? "bg-accent" : "bg-surface/50"
            }`}
          />
        ))}
      </Flex>
    );
  };

  // Render model download step - uses height transition for smooth expand
  const renderModelDownloadStep = () => (
    <Flex
      direction="column"
      align="center"
      justify="center"
      className="h-full w-full"
    >
      {/* Container that grows smoothly */}
      <Flex
        direction="column"
        className="w-full transition-all duration-500 ease-in-out"
        style={{
          maxWidth: 720,
          // When expanded: full height minus progress indicator space
          // When collapsed: auto height (content-based)
          height: showMoreModels ? "calc(100% - 60px)" : "auto",
          maxHeight: showMoreModels ? "calc(100% - 60px)" : "70vh",
          marginTop: showMoreModels ? 60 : 0,
        }}
      >
        {/* Header - Always visible */}
        <Flex direction="column" className="px-6 pb-4 shrink-0">
          {error && (
            <Box className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-4 w-full">
              <Text color="red" size="2">
                {error}
              </Text>
            </Box>
          )}

          <Flex direction="column" gap="2" className="w-full" align="center">
            <Flex justify="between" align="center" className="w-full">
              <Text size="5" weight="bold">
                {t("onboarding.models.title")}
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
        {/* Scrollable Content Area */}
        <ScrollArea type="hover" scrollbars="vertical" className="flex-1 px-6">
          <Flex direction="column" className="pb-4">
            {/* Recommended Models */}
            <Flex direction="column" gap="3" className="mb-4">
              <Text size="2" weight="medium" className="text-text/70">
                {t("onboarding.recommended")}
              </Text>
              {recommendedModels.map((model) => (
                <ModelCard
                  key={model.id}
                  model={model}
                  variant="featured"
                  disabled={downloading}
                  onSelect={handleDownloadModel}
                />
              ))}
            </Flex>

            {/* Other Models - Animated height */}
            {otherModels.length > 0 && (
              <Box
                className="overflow-hidden transition-all duration-500 ease-in-out"
                style={{
                  maxHeight: showMoreModels
                    ? `${otherModels.length * 100}px`
                    : "0px",
                  opacity: showMoreModels ? 1 : 0,
                }}
              >
                <Flex direction="column" gap="3" className="mb-4">
                  {otherModels.map((model) => (
                    <ModelCard
                      key={model.id}
                      model={model}
                      disabled={downloading}
                      onSelect={handleDownloadModel}
                    />
                  ))}
                </Flex>
              </Box>
            )}
          </Flex>
        </ScrollArea>
        {/* Toggle Button - Outside ScrollArea, always visible */}
        {otherModels.length > 0 && (
          <Flex justify="center" className="shrink-0 py-3 px-6">
            <Button
              variant="ghost"
              size="1"
              onClick={() => setShowMoreModels(!showMoreModels)}
              className="px-3 py-1 text-text/50 hover:text-text/80"
            >
              <IconChevronDown
                size={16}
                className={`transition-transform duration-300 ${showMoreModels ? "rotate-180" : ""}`}
              />
              {!showMoreModels && (
                <Text size="1" className="ml-1">
                  {t("onboarding.models.showMore")} ({otherModels.length})
                </Text>
              )}
            </Button>
          </Flex>
        )}
      </Flex>
    </Flex>
  );

  // Render current step
  const renderCurrentStep = () => {
    switch (currentStep) {
      case OnboardingStep.Welcome:
        return <WelcomeStep onNext={nextStep} />;
      case OnboardingStep.ModelDownload:
        return renderModelDownloadStep();
      default:
        return null;
    }
  };

  return (
    <Flex direction="column" className="h-screen w-screen relative">
      {renderProgressIndicator()}
      <Box
        className="flex-1 h-full transition-all duration-300 ease-in-out"
        style={{
          opacity: showStep ? 1 : 0,
          transform: showStep ? "translateX(0)" : "translateX(-30px)",
        }}
      >
        {renderCurrentStep()}
      </Box>
    </Flex>
  );
};

export default Onboarding;
