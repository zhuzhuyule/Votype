import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { Flex, Box, ScrollArea } from "@radix-ui/themes";
import "./App.css";
import AccessibilityPermissions from "./components/AccessibilityPermissions";
import Footer from "./components/footer";
import Onboarding from "./components/onboarding";
import { Sidebar, SidebarSection, SECTIONS_CONFIG } from "./components/Sidebar";
import { useSettings } from "./hooks/useSettings";
import { RadixThemeProvider } from "./components/theme/RadixThemeProvider";

const renderSettingsContent = (section: SidebarSection) => {
  const ActiveComponent =
    SECTIONS_CONFIG[section]?.component || SECTIONS_CONFIG.general.component;
  return <ActiveComponent />;
};

function App() {
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [currentSection, setCurrentSection] =
    useState<SidebarSection>("general");
  const { settings, updateSetting } = useSettings();

  useEffect(() => {
    checkOnboardingStatus();
  }, []);

  // Handle keyboard shortcuts for debug mode toggle
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for Ctrl+Shift+D (Windows/Linux) or Cmd+Shift+D (macOS)
      const isDebugShortcut =
        event.shiftKey &&
        event.key.toLowerCase() === "d" &&
        (event.ctrlKey || event.metaKey);

      if (isDebugShortcut) {
        event.preventDefault();
        const currentDebugMode = settings?.debug_mode ?? false;
        updateSetting("debug_mode", !currentDebugMode);
      }
    };

    // Add event listener when component mounts
    document.addEventListener("keydown", handleKeyDown);

    // Cleanup event listener when component unmounts
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [settings?.debug_mode, updateSetting]);

  const checkOnboardingStatus = async () => {
    try {
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
                  <AccessibilityPermissions />
                  {renderSettingsContent(currentSection)}
                </Flex>
              </ScrollArea>
            </Flex>
          </Flex>
          {/* Fixed footer at bottom */}
          <Footer />
        </Flex>
      )}
    </RadixThemeProvider>
  );
}

export default App;
