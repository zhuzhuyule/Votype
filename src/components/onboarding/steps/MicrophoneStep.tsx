import { Box, Button, Flex, Text } from "@radix-ui/themes";
import { IconArrowRight, IconMicrophone } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface MicrophoneStepProps {
  onNext: () => void;
}

const MicrophoneStep: React.FC<MicrophoneStepProps> = ({ onNext }) => {
  const { t } = useTranslation();
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(
    null,
  );

  // Check if permission is already granted on mount
  useEffect(() => {
    checkPermission();
  }, []);

  const checkPermission = async () => {
    try {
      const granted: boolean = await invoke(
        "plugin:macos-permissions|check_permission",
        {
          permission: "Microphone",
        },
      );
      setPermissionGranted(granted);
      // If already granted, auto-advance or show success state
      if (granted) {
        setError(null);
      }
    } catch (err) {
      console.error("Failed to check microphone permission:", err);
      // In dev mode or if check fails, allow proceeding
      setPermissionGranted(null);
    }
  };

  const requestPermission = async () => {
    setRequesting(true);
    setError(null);

    try {
      const granted: boolean = await invoke(
        "plugin:macos-permissions|request_permission",
        {
          permission: "Microphone",
        },
      );

      if (granted) {
        setPermissionGranted(true);
        onNext();
      } else {
        setError(t("onboarding.microphone.denied"));
      }
    } catch (err) {
      console.error("Failed to request microphone permission:", err);
      setError(t("onboarding.microphone.error"));
    } finally {
      setRequesting(false);
    }
  };

  // If permission is already granted, show success and allow proceeding
  const isGranted = permissionGranted === true;

  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      className="h-full w-full gap-6 p-8"
    >
      <Flex direction="column" align="center" gap="4" className="mt-8">
        <Box
          className={`p-6 rounded-full ${isGranted ? "bg-green-500/10" : "bg-accent/10"}`}
        >
          <IconMicrophone
            size={48}
            className={isGranted ? "text-green-500" : "text-accent"}
          />
        </Box>
        <Text size="6" weight="bold" className="mt-2">
          {t("onboarding.microphone.title")}
        </Text>
        <Text size="3" className="text-center text-text/70 max-w-md">
          {isGranted
            ? t("onboarding.microphone.granted")
            : t("onboarding.microphone.description")}
        </Text>
      </Flex>

      {!isGranted && (
        <Flex
          direction="column"
          gap="2"
          className="w-full max-w-md mt-4 p-4 rounded-lg bg-surface/50"
        >
          <Text size="2" weight="medium" className="text-text/80">
            {t("onboarding.microphone.whyTitle")}
          </Text>
          <Flex direction="column" gap="1">
            <Text size="2" className="text-text/60">
              • {t("onboarding.microphone.reason1")}
            </Text>
            <Text size="2" className="text-text/60">
              • {t("onboarding.microphone.reason2")}
            </Text>
            <Text size="2" className="text-text/60">
              • {t("onboarding.microphone.reason3")}
            </Text>
          </Flex>
        </Flex>
      )}

      {error && (
        <Box className="w-full max-w-md p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <Text size="2" color="red">
            {error}
          </Text>
        </Box>
      )}

      <Flex direction="column" gap="3" className="w-full max-w-sm mt-auto mb-8">
        {isGranted ? (
          <Button size="3" onClick={onNext} className="w-full">
            {t("common.next")}
            <IconArrowRight size={18} />
          </Button>
        ) : (
          <>
            <Button
              size="3"
              onClick={requestPermission}
              disabled={requesting}
              className="w-full"
            >
              {requesting
                ? t("common.requesting")
                : t("onboarding.microphone.grant")}
            </Button>
            {/* Allow skipping in dev mode or if there's an error */}
            {error && (
              <Button
                size="3"
                variant="ghost"
                onClick={onNext}
                className="w-full"
              >
                {t("onboarding.microphone.skipDev")}
              </Button>
            )}
          </>
        )}
      </Flex>
    </Flex>
  );
};

export default MicrophoneStep;
