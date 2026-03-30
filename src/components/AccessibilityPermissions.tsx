import { Box, Button, Flex, Text, type ButtonProps } from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  checkAccessibilityPermission,
  requestAccessibilityPermission,
} from "tauri-plugin-macos-permissions-api";

// Define permission state type
type PermissionState = "request" | "verify" | "granted";

// Define button configuration type
interface ButtonConfig {
  text: string;
  variant: ButtonProps["variant"];
}

const AccessibilityPermissions: React.FC = () => {
  const { t } = useTranslation();
  const [hasAccessibility, setHasAccessibility] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [permissionState, setPermissionState] =
    useState<PermissionState>("request");

  // Check permissions without requesting
  const checkPermissions = async (): Promise<boolean> => {
    const hasPermissions: boolean = await checkAccessibilityPermission();
    setHasAccessibility(hasPermissions);
    setPermissionState(hasPermissions ? "granted" : "verify");
    if (hasPermissions) {
      // Initialize shortcuts now that accessibility is granted
      invoke("initialize_shortcuts").catch((e: unknown) => {
        console.warn(
          "Failed to initialize shortcuts after permission grant:",
          e,
        );
      });
    }
    return hasPermissions;
  };

  // Handle the unified button action based on current state
  const handleButtonClick = async (): Promise<void> => {
    if (permissionState === "request") {
      try {
        await requestAccessibilityPermission();
        // After system prompt, transition to verification state
        setPermissionState("verify");
      } catch (error) {
        console.error("Error requesting permissions", error);
        setPermissionState("verify");
      }
    } else if (permissionState === "verify") {
      // State is "verify" - check if permission was granted
      await checkPermissions();
    }
  };

  // On app boot - check permissions
  useEffect(() => {
    const initialSetup = async (): Promise<void> => {
      const hasPermissions: boolean = await checkAccessibilityPermission();
      setHasAccessibility(hasPermissions);
      setPermissionState(hasPermissions ? "granted" : "request");
      setIsLoading(false);
    };

    initialSetup();
  }, []);

  if (isLoading || hasAccessibility) {
    return null;
  }

  // Configure button text and style based on state
  const buttonConfig: Record<PermissionState, ButtonConfig | null> = {
    request: {
      text: t("accessibility.openSettings"),
      variant: "solid",
    },
    verify: {
      text: t("accessibility.verify"),
      variant: "outline",
    },
    granted: null,
  };

  const config = buttonConfig[permissionState];
  if (!config) {
    return null;
  }

  return (
    <Flex
      p="4"
      className="w-full rounded-lg border border-(--gray-4) bg-(--gray-2)"
    >
      <Flex justify="between" align="center" gap="4" className="w-full">
        <Box>
          <Text size="2" weight="medium" as="div">
            {t("accessibility.permissionsRequired")}
          </Text>
          <Text size="1" color="gray" as="div">
            {t("accessibility.permissionsDescription")}
          </Text>
        </Box>
        <Button
          onClick={handleButtonClick}
          variant={config.variant}
          size="1"
          className="cursor-pointer shrink-0"
        >
          {config.text}
        </Button>
      </Flex>
    </Flex>
  );
};

export default AccessibilityPermissions;
