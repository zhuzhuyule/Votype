import { Flex, ScrollArea, Spinner } from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { lazy, Suspense, useEffect, useState } from "react";
import { Toaster } from "sonner";
import "./App.css";
import Onboarding from "./components/onboarding";
import { SECTIONS_CONFIG, Sidebar, SidebarSection } from "./components/Sidebar";
import { RadixThemeProvider } from "./components/theme/RadixThemeProvider";
import { useSettings } from "./hooks/useSettings";

// 懒加载非关键组件以改善首屏加载性能
const AccessibilityPermissions = lazy(
  () => import("./components/AccessibilityPermissions"),
);
const Footer = lazy(() => import("./components/footer"));

// 加载状态组件
const SettingsLoadingFallback = () => (
  <Flex
    direction="column"
    align="center"
    justify="center"
    className="h-full py-20"
  >
    <Spinner size="3" />
  </Flex>
);

const renderSettingsContent = (section: SidebarSection) => {
  const ActiveComponent =
    SECTIONS_CONFIG[section]?.component || SECTIONS_CONFIG.general.component;
  return (
    // Key forces complete unmount/remount when section changes,
    // releasing audio/media resources and clearing component state
    <Suspense key={section} fallback={<SettingsLoadingFallback />}>
      <ActiveComponent />
    </Suspense>
  );
};

function App() {
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [currentSection, setCurrentSection] =
    useState<SidebarSection>("dashboard");
  const { settings, updateSetting } = useSettings();

  // 延迟加载非关键组件
  const [showNonCritical, setShowNonCritical] = useState(false);

  useEffect(() => {
    // 延迟 500ms 加载非关键组件，让主界面先渲染
    const timer = setTimeout(() => setShowNonCritical(true), 500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    checkOnboardingStatus();
  }, []);

  // Listen for navigate-to-settings event from Rust

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen(
        "navigate-to-settings",
        (event: { payload: string }) => {
          // Navigate to the specified settings section

          setCurrentSection(event.payload as SidebarSection);
        },
      );
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  // Handle keyboard shortcuts for settings navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for Cmd/Ctrl + , (Comma) for General settings (common convention)
      const isPreferencesShortcut =
        (event.ctrlKey || event.metaKey) && event.key === ",";

      if (isPreferencesShortcut) {
        event.preventDefault();
        setCurrentSection("general");
        return;
      }

      // Check for Cmd/Ctrl + Number (1-9) for settings navigation
      const isSettingsShortcut =
        (event.ctrlKey || event.metaKey) && /^[1-9]$/.test(event.key);

      if (isSettingsShortcut) {
        event.preventDefault();
        const sectionIndex = parseInt(event.key, 10) - 1;
        const sections: SidebarSection[] = [
          "dashboard",
          "general",
          "shortcuts",
          "advanced",
          "models",
          "prompts",
          "about",
        ];

        if (sectionIndex < sections.length) {
          const targetSection = sections[sectionIndex];
          setCurrentSection(targetSection);
        }
      }
    };

    // Add event listener when component mounts
    document.addEventListener("keydown", handleKeyDown);

    // Cleanup event listener when component unmounts
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Re-check onboarding status when settings are loaded
  useEffect(() => {
    if (settings) {
      checkOnboardingStatus();
    }
  }, [settings?.onboarding_completed]);

  const checkOnboardingStatus = async () => {
    try {
      // If onboarding is already completed, don't show it
      if (settings?.onboarding_completed) {
        setShowOnboarding(false);
        return;
      }

      // Always check if they have any models available
      const modelsAvailable: boolean = await invoke("has_any_models_available");
      setShowOnboarding(!modelsAvailable);
    } catch (error) {
      console.error("Failed to check onboarding status:", error);
      setShowOnboarding(true);
    }
  };

  const handleModelSelected = () => {
    // Transition to main app - user has started a download
    setShowOnboarding(false);
    updateSetting("onboarding_completed", true);
  };

  return (
    <RadixThemeProvider>
      {showOnboarding ? (
        <Onboarding onModelSelected={handleModelSelected} />
      ) : (
        <Flex className="h-screen flex flex-col">
          <Toaster />
          {/* Main content area that takes remaining space */}
          <Flex className="flex-1 flex overflow-hidden">
            <Sidebar
              activeSection={currentSection}
              onSectionChange={setCurrentSection}
            />
            {/* Scrollable content area with ScrollArea */}
            <Flex flexGrow="1" direction="column" overflow="hidden">
              <ScrollArea scrollbars="vertical" type="hover" className="flex-1">
                <Flex
                  direction="column"
                  align="center"
                  py="6"
                  px="4"
                  gap="6"
                  className="min-w-[600px] max-w-[1200px] mx-auto w-full"
                >
                  {showNonCritical && (
                    <Suspense fallback={null}>
                      <AccessibilityPermissions />
                    </Suspense>
                  )}
                  {renderSettingsContent(currentSection)}
                </Flex>
              </ScrollArea>
            </Flex>
          </Flex>
          {/* Fixed footer at bottom */}
          {showNonCritical && (
            <Suspense fallback={null}>
              <Footer />
            </Suspense>
          )}
        </Flex>
      )}
    </RadixThemeProvider>
  );
}

export default App;
