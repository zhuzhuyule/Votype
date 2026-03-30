import { Flex, ScrollArea, Spinner } from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Toaster } from "sonner";
import "./App.css";
import { ErrorBoundary } from "./components/ErrorBoundary";
import Onboarding from "./components/onboarding";
import {
  SECTION_ORDER,
  SECTIONS_CONFIG,
  Sidebar,
  SidebarSection,
} from "./components/Sidebar";
import { CompactModeProvider } from "./components/theme/CompactModeProvider";
import { RadixThemeProvider } from "./components/theme/RadixThemeProvider";
import { useSettings } from "./hooks/useSettings";
import { VOTYPE_LOCAL_INSERT, VOTYPE_REFOCUS_ACTIVE_INPUT } from "./lib/events";

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

// Direction: 'down' = navigating to higher index, 'up' = navigating to lower index
type NavDirection = "down" | "up" | null;

const renderSettingsContent = (
  section: SidebarSection,
  direction: NavDirection = "down",
) => {
  const ActiveComponent =
    SECTIONS_CONFIG[section]?.component || SECTIONS_CONFIG.general.component;

  // Choose animation based on navigation direction
  const animationClass =
    direction === "down" ? "animate-fade-in-up" : "animate-fade-in-down";

  return (
    <Suspense fallback={<SettingsLoadingFallback />}>
      <div key={section} className={`w-full ${animationClass}`}>
        <ActiveComponent />
      </div>
    </Suspense>
  );
};

function App() {
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [currentSection, setCurrentSection] =
    useState<SidebarSection>("dashboard");
  const [navDirection, setNavDirection] = useState<NavDirection>(null);
  const prevSectionRef = useRef<SidebarSection>("dashboard");
  const { settings, updateSetting } = useSettings();

  // 延迟加载非关键组件
  const [showNonCritical, setShowNonCritical] = useState(false);
  const { t } = useTranslation();

  // Sidebar collapsed state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const lastEditableRef = useRef<HTMLElement | null>(null);

  const getEditableElement = (
    target: EventTarget | null,
  ): HTMLElement | null => {
    if (!(target instanceof HTMLElement)) return null;

    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable
    ) {
      return target;
    }

    return target.closest(
      'input, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]',
    );
  };

  useEffect(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved) {
      setSidebarCollapsed(JSON.parse(saved));
    }
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const newState = !prev;
      localStorage.setItem("sidebar-collapsed", JSON.stringify(newState));
      return newState;
    });
  };

  useEffect(() => {
    // 延迟 500ms 加载非关键组件，让主界面先渲染
    const timer = setTimeout(() => setShowNonCritical(true), 500);
    return () => clearTimeout(timer);
  }, []);

  // Initialize shortcuts after the app is ready.
  // On macOS, shortcuts require accessibility permissions and are deferred
  // from Rust startup. This call is idempotent (safe to call multiple times).
  useEffect(() => {
    if (showOnboarding === false) {
      invoke("initialize_shortcuts").catch((e: unknown) => {
        console.warn("Failed to initialize shortcuts:", e);
      });
    }
  }, [showOnboarding]);

  useEffect(() => {
    checkOnboardingStatus();
  }, []);

  // Track navigation direction when section changes
  useEffect(() => {
    const prevIndex = SECTION_ORDER.indexOf(prevSectionRef.current);
    const currIndex = SECTION_ORDER.indexOf(currentSection);

    if (currIndex > prevIndex) {
      setNavDirection("down");
    } else if (currIndex < prevIndex) {
      setNavDirection("up");
    }

    prevSectionRef.current = currentSection;
  }, [currentSection]);

  // Listen for navigate-to-settings event from Rust

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen(
        "navigate-to-settings",
        (event: { payload: string }) => {
          // Navigate to the specified settings section
          // If the payload is 'dashboard' (default open), avoid resetting if we're already on a view
          if (event.payload === "dashboard") return;
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

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    const setupListener = async () => {
      const detach = await listen<string>(VOTYPE_LOCAL_INSERT, (event) => {
        if (!insertIntoActiveElement(event.payload)) {
          console.warn(
            "[VotypeLocalInsert] No active editable element accepted the text",
          );
        }
      });

      if (disposed) {
        detach();
        return;
      }

      unlisten = detach;
    };

    void setupListener();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const handleFocusIn = (event: FocusEvent) => {
      const editable = getEditableElement(event.target);
      if (editable) {
        lastEditableRef.current = editable;
      }
    };

    document.addEventListener("focusin", handleFocusIn, true);
    return () => {
      document.removeEventListener("focusin", handleFocusIn, true);
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    const setupListener = async () => {
      const detach = await listen(VOTYPE_REFOCUS_ACTIVE_INPUT, () => {
        const editable =
          getEditableElement(document.activeElement) ?? lastEditableRef.current;
        editable?.focus();
      });

      if (disposed) {
        detach();
        return;
      }

      unlisten = detach;
    };

    void setupListener();

    return () => {
      disposed = true;
      unlisten?.();
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

        if (sectionIndex < SECTION_ORDER.length) {
          const targetSection = SECTION_ORDER[sectionIndex];
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

  const insertIntoActiveElement = (text: string) => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return false;

    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement
    ) {
      const start = active.selectionStart ?? active.value.length;
      const end = active.selectionEnd ?? start;
      active.focus();
      active.setRangeText(text, start, end, "end");
      active.dispatchEvent(new Event("input", { bubbles: true }));
      active.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    if (active.isContentEditable) {
      active.focus();
      const selection = window.getSelection();
      if (!selection) return false;

      let range: Range;
      if (
        selection.rangeCount > 0 &&
        active.contains(selection.getRangeAt(0).commonAncestorContainer)
      ) {
        range = selection.getRangeAt(0);
      } else {
        range = document.createRange();
        range.selectNodeContents(active);
        range.collapse(false);
      }

      range.deleteContents();
      const textNode = document.createTextNode(text);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      active.dispatchEvent(
        new InputEvent("input", { bubbles: true, data: text }),
      );
      return true;
    }

    return false;
  };

  const handleModelSelected = () => {
    // Transition to main app - user has started a download
    setShowOnboarding(false);
    updateSetting("onboarding_completed", true);
  };

  return (
    <ErrorBoundary>
      <CompactModeProvider>
        <RadixThemeProvider>
          {showOnboarding ? (
            <Onboarding onModelSelected={handleModelSelected} />
          ) : (
            <Flex className="h-screen flex flex-col">
              <Toaster />
              {/* Main content area that takes remaining space */}
              <Flex className="flex-1 flex overflow-hidden relative">
                <Sidebar
                  activeSection={currentSection}
                  onSectionChange={setCurrentSection}
                  collapsed={sidebarCollapsed}
                />

                {/* Scrollable content area with ScrollArea */}
                <Flex flexGrow="1" direction="column" overflow="hidden">
                  <ScrollArea
                    scrollbars="vertical"
                    type="hover"
                    className="flex-1"
                  >
                    <Flex
                      direction="column"
                      align="center"
                      py="6"
                      px="4"
                      gap="6"
                      className="min-w-[600px] max-w-[1200px] mx-auto w-full pb-3"
                    >
                      {showNonCritical && (
                        <Suspense fallback={null}>
                          <AccessibilityPermissions />
                        </Suspense>
                      )}
                      {renderSettingsContent(currentSection, navDirection)}
                    </Flex>
                  </ScrollArea>
                </Flex>
              </Flex>
              {/* Fixed footer at bottom */}
              {showNonCritical && (
                <Suspense fallback={null}>
                  <Footer
                    sidebarCollapsed={sidebarCollapsed}
                    onToggleSidebar={toggleSidebar}
                  />
                </Suspense>
              )}
            </Flex>
          )}
        </RadixThemeProvider>
      </CompactModeProvider>
    </ErrorBoundary>
  );
}

export default App;
