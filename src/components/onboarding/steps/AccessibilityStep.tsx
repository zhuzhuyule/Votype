import { Box, Button, Flex, Text } from "@radix-ui/themes";
import { IconArrowRight, IconCheck, IconKeyboard } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface AccessibilityStepProps {
  onNext: () => void;
  onSkip: () => void;
}

const AccessibilityStep: React.FC<AccessibilityStepProps> = ({
  onNext,
  onSkip,
}) => {
  const { t } = useTranslation();
  const [requesting, setRequesting] = useState(false);
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
          permission: "Accessibility",
        },
      );
      setPermissionGranted(granted);
    } catch (err) {
      console.error("Failed to check accessibility permission:", err);
      setPermissionGranted(null);
    }
  };

  const requestPermission = async () => {
    setRequesting(true);

    try {
      const granted: boolean = await invoke(
        "plugin:macos-permissions|request_permission",
        {
          permission: "Accessibility",
        },
      );

      setPermissionGranted(granted);
      // Always proceed to next step, even if denied (it's optional)
      onNext();

      if (!granted) {
        console.log(
          "Accessibility permission not granted, user can still use app with limited features",
        );
      }
    } catch (err) {
      console.error("Failed to request accessibility permission:", err);
      // Still proceed since this is optional
      onNext();
    } finally {
      setRequesting(false);
    }
  };

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
          className={`p-6 rounded-full ${isGranted ? "bg-green-500/10" : "bg-blue-500/10"}`}
        >
          {isGranted ? (
            <IconCheck size={48} className="text-green-500" />
          ) : (
            <IconKeyboard size={48} className="text-blue-500" />
          )}
        </Box>
        <Flex align="center" gap="2">
          <Text size="6" weight="bold">
            {t("onboarding.accessibility.title")}
          </Text>
          <Text
            size="2"
            className="px-2 py-0.5 rounded-full bg-surface/50 text-text/60"
          >
            {t("common.optional")}
          </Text>
        </Flex>
        <Text size="3" className="text-center text-text/70 max-w-md">
          {isGranted
            ? t("onboarding.accessibility.granted")
            : t("onboarding.accessibility.description")}
        </Text>
      </Flex>

      {!isGranted && (
        <Flex direction="column" gap="4" className="w-full max-w-md mt-4">
          <Box className="p-4 rounded-lg bg-surface/50">
            <Text size="2" weight="medium" className="text-text/80 mb-2">
              {t("onboarding.accessibility.whyTitle")}
            </Text>
            <Flex direction="column" gap="1">
              <Text size="2" className="text-text/60">
                • {t("onboarding.accessibility.reason1")}
              </Text>
              <Text size="2" className="text-text/60">
                • {t("onboarding.accessibility.reason2")}
              </Text>
              <Text size="2" className="text-text/60">
                • {t("onboarding.accessibility.reason3")}
              </Text>
            </Flex>
          </Box>

          <Box className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <Text
              size="2"
              weight="medium"
              className="text-amber-600 dark:text-amber-400 mb-2"
            >
              {t("onboarding.accessibility.withoutTitle")}
            </Text>
            <Flex direction="column" gap="1">
              <Text size="2" className="text-text/60">
                • {t("onboarding.accessibility.without1")}
              </Text>
              <Text size="2" className="text-text/60">
                • {t("onboarding.accessibility.without2")}
              </Text>
              <Text size="2" className="text-text/60">
                • {t("onboarding.accessibility.without3")}
              </Text>
            </Flex>
          </Box>
        </Flex>
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
                : t("onboarding.accessibility.grant")}
            </Button>
            <Button
              size="3"
              variant="ghost"
              onClick={onSkip}
              disabled={requesting}
              className="w-full"
            >
              {t("onboarding.accessibility.skip")}
            </Button>
          </>
        )}
      </Flex>
    </Flex>
  );
};

export default AccessibilityStep;
