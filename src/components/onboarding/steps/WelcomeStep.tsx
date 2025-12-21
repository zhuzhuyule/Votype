import { Box, Button, Flex, Text } from "@radix-ui/themes";
import {
  IconArrowRight,
  IconCheck,
  IconKeyboard,
  IconMicrophone,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { VotypeHand } from "../../icons/VotypeHand";

interface WelcomeStepProps {
  onNext: () => void;
}

interface PermissionStatus {
  microphone: boolean | null;
  accessibility: boolean | null;
}

const WelcomeStep: React.FC<WelcomeStepProps> = ({ onNext }) => {
  const { t } = useTranslation();
  const [permissions, setPermissions] = useState<PermissionStatus>({
    microphone: null,
    accessibility: null,
  });
  const [requesting, setRequesting] = useState<string | null>(null);
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    checkPermissions();
    // Delay showing content after logo appears centered
    const timer = setTimeout(() => {
      setShowContent(true);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  const checkPermissions = async () => {
    try {
      const [mic, acc] = await Promise.all([
        invoke<boolean>("plugin:macos-permissions|check_permission", {
          permission: "Microphone",
        }),
        invoke<boolean>("plugin:macos-permissions|check_permission", {
          permission: "Accessibility",
        }),
      ]);
      setPermissions({ microphone: mic, accessibility: acc });
    } catch (err) {
      console.error("Failed to check permissions:", err);
    }
  };

  const requestMicrophone = async () => {
    setRequesting("microphone");
    try {
      const granted: boolean = await invoke(
        "plugin:macos-permissions|request_permission",
        {
          permission: "Microphone",
        },
      );
      setPermissions((prev) => ({ ...prev, microphone: granted }));
    } catch (err) {
      console.error("Failed to request microphone permission:", err);
    } finally {
      setRequesting(null);
    }
  };

  const requestAccessibility = async () => {
    setRequesting("accessibility");
    try {
      const granted: boolean = await invoke(
        "plugin:macos-permissions|request_permission",
        {
          permission: "Accessibility",
        },
      );
      setPermissions((prev) => ({ ...prev, accessibility: granted }));
    } catch (err) {
      console.error("Failed to request accessibility permission:", err);
    } finally {
      setRequesting(null);
    }
  };

  // Microphone permission is required (but allow in dev mode when check fails)
  const microphoneGranted = permissions.microphone === true;
  const isDevMode = permissions.microphone === null; // Failed to check = dev mode

  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      className="h-full w-full relative"
    >
      {/* Logo Container - Centered, moves up when content appears */}
      <Flex
        direction="column"
        align="center"
        justify="center"
        className="w-full px-8 transition-all duration-700 ease-out"
        style={{
          maxWidth: 720,
          flex: showContent ? "0 0 auto" : "1",
          paddingBottom: showContent ? 0 : 80,
        }}
      >
        <VotypeHand />
      </Flex>

      {/* Content - Fades in after delay */}
      <Flex
        direction="column"
        align="center"
        className="w-full px-8 transition-all duration-700 ease-out overflow-hidden"
        style={{
          maxWidth: 720,
          maxHeight: showContent ? "1000px" : "0px",
          opacity: showContent ? 1 : 0,
          marginTop: showContent ? 24 : 0,
        }}
      >
        {/* Permissions Section */}
        <Flex direction="column" gap="4" className="w-full">
          <Text size="3" weight="medium" className="text-text/80">
            {t("onboarding.welcome.permissionsTitle")}
          </Text>
          {/* Microphone Permission */}
          <Box className="p-4 rounded-xl border border-gray-200 bg-[var(--color-background)]">
            <Flex justify="between" align="start" gap="4">
              <Flex gap="3" align="start" className="flex-1">
                <Box
                  className={`p-2 rounded-lg ${permissions.microphone ? "bg-green-500/10" : "bg-accent/10"}`}
                >
                  {permissions.microphone ? (
                    <IconCheck size={24} className="text-green-500" />
                  ) : (
                    <IconMicrophone size={24} className="text-accent" />
                  )}
                </Box>
                <Flex direction="column" gap="1">
                  <Flex align="center" gap="2">
                    <Text size="3" weight="medium">
                      {t("onboarding.microphone.title")}
                    </Text>
                  </Flex>
                  <Text size="2" className="text-text/60">
                    {t("onboarding.microphone.shortDesc")}
                  </Text>
                </Flex>
              </Flex>
              {permissions.microphone ? (
                <Text size="2" className="text-green-500 shrink-0">
                  {t("common.granted")}
                </Text>
              ) : (
                <Button
                  size="2"
                  variant="soft"
                  onClick={requestMicrophone}
                  disabled={requesting === "microphone"}
                  className="shrink-0"
                >
                  {requesting === "microphone"
                    ? t("common.requesting")
                    : t("common.authorize")}
                </Button>
              )}
            </Flex>
          </Box>
          {/* Accessibility Permission */}
          <Box className="p-4 rounded-xl border border-gray-200 bg-[var(--color-background)]">
            <Flex justify="between" align="start" gap="4">
              <Flex gap="3" align="start" className="flex-1">
                <Box
                  className={`p-2 rounded-lg ${permissions.accessibility ? "bg-green-500/10" : "bg-blue-500/10"}`}
                >
                  {permissions.accessibility ? (
                    <IconCheck size={24} className="text-green-500" />
                  ) : (
                    <IconKeyboard size={24} className="text-blue-500" />
                  )}
                </Box>
                <Flex direction="column" gap="1">
                  <Flex align="center" gap="2">
                    <Text size="3" weight="medium">
                      {t("onboarding.accessibility.title")}
                    </Text>
                  </Flex>
                  <Flex direction="column" gap="0.5" className="mt-1">
                    <Text size="1" className="text-text/50">
                      • {t("onboarding.accessibility.feature1")}
                    </Text>
                    <Text size="1" className="text-text/50">
                      • {t("onboarding.accessibility.feature2")}
                    </Text>
                    <Text size="1" className="text-text/50">
                      • {t("onboarding.accessibility.feature3")}
                    </Text>
                  </Flex>
                  {/* Impact note inside the box */}
                  {!permissions.accessibility && (
                    <Text size="1" className="text-amber-500 mt-2">
                      {t("onboarding.accessibility.noteImpact")}
                    </Text>
                  )}
                </Flex>
              </Flex>
              {permissions.accessibility ? (
                <Text size="2" className="text-green-500 shrink-0">
                  {t("common.granted")}
                </Text>
              ) : (
                <Button
                  size="2"
                  variant="soft"
                  onClick={requestAccessibility}
                  disabled={requesting === "accessibility"}
                  className="shrink-0"
                >
                  {requesting === "accessibility"
                    ? t("common.requesting")
                    : t("common.authorize")}
                </Button>
              )}
            </Flex>
          </Box>
          {/* Authorization steps outside the box, left-aligned */}
          {!permissions.accessibility && (
            <Flex direction="column" gap="1" className="text-left">
              <Text size="1" weight="medium" className="text-text/60">
                {t("onboarding.accessibility.stepsTitle")}
              </Text>
              <Text size="1" className="text-text/50">
                1. {t("onboarding.accessibility.step1")}
              </Text>
              <Text size="1" className="text-text/50">
                2. {t("onboarding.accessibility.step2")}
              </Text>
              <Text size="1" className="text-text/50">
                3. {t("onboarding.accessibility.step3")}
              </Text>
            </Flex>
          )}
        </Flex>
      </Flex>

      {/* Bottom Button - Fixed at bottom, fade in with content */}
      <Flex
        direction="column"
        gap="2"
        align="center"
        className="absolute bottom-12 left-0 right-0 px-8 transition-all duration-700"
        style={{
          maxWidth: 720,
          margin: "0 auto",
          opacity: showContent ? 1 : 0,
          transform: showContent ? "translateY(0)" : "translateY(20px)",
          pointerEvents: showContent ? "auto" : "none",
        }}
      >
        {microphoneGranted ? (
          <Button size="3" onClick={onNext} className="w-full">
            {t("onboarding.welcome.continue")}
            <IconArrowRight size={18} />
          </Button>
        ) : isDevMode ? (
          <>
            <Text size="2" className="text-amber-500 text-center">
              {t("onboarding.microphone.devModeHint")}
            </Text>
            <Button size="3" variant="soft" onClick={onNext} className="w-full">
              {t("onboarding.welcome.skipDev")}
            </Button>
          </>
        ) : (
          <Text size="2" className="text-text/50 text-center">
            {t("onboarding.microphone.grantFirst")}
          </Text>
        )}
      </Flex>
    </Flex>
  );
};

export default WelcomeStep;
