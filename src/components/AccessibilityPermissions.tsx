import { useEffect, useState } from "react";
import {
  checkAccessibilityPermission,
  requestAccessibilityPermission,
} from "tauri-plugin-macos-permissions-api";

// Define permission state type
type PermissionState = "request" | "verify" | "granted";

// Define button configuration type
interface ButtonConfig {
  text: string;
  className: string;
}

const AccessibilityPermissions: React.FC = () => {
  const [hasAccessibility, setHasAccessibility] = useState<boolean>(false);
  const [permissionState, setPermissionState] =
    useState<PermissionState>("request");

  // Check permissions without requesting
  const checkPermissions = async (): Promise<boolean> => {
    const hasPermissions: boolean = await checkAccessibilityPermission();
    setHasAccessibility(hasPermissions);
    setPermissionState(hasPermissions ? "granted" : "verify");
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
        console.error("Error requesting permissions:", error);
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
    };

    initialSetup();
  }, []);

  if (hasAccessibility) {
    return null;
  }

  // Configure button text and style based on state
  const buttonConfig: Record<PermissionState, ButtonConfig | null> = {
    request: {
      text: "Grant",
      className:
        "px-3 py-2 text-sm font-normal bg-white border border-mid-gray/15 hover:border-mid-gray/25 rounded-md cursor-pointer transition-all duration-200 focus:outline-none focus:border-logo-primary focus:ring-2 focus:ring-logo-primary/20",
    },
    verify: {
      text: "Verify",
      className:
        "px-3 py-2 text-sm font-normal bg-white border border-mid-gray/15 hover:border-mid-gray/25 rounded-md cursor-pointer transition-all duration-200 focus:outline-none focus:border-logo-primary focus:ring-2 focus:ring-logo-primary/20",
    },
    granted: null,
  };

  const config = buttonConfig[permissionState] as ButtonConfig;

  return (
    <div className="p-4 w-full rounded-lg border border-mid-gray/10 bg-white/50">
      <div className="flex justify-between items-center gap-2">
        <div className="">
          <p className="text-sm font-medium">
            Please grant accessibility permissions for Handy
          </p>
        </div>
        <button
          onClick={handleButtonClick}
          className={`min-h-10 ${config.className}`}
        >
          {config.text}
        </button>
      </div>
    </div>
  );
};

export default AccessibilityPermissions;
