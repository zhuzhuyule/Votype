import { Icon as IconifyIcon } from "@iconify/react";
import {
  Flex,
  Grid,
  IconButton,
  Popover,
  ScrollArea,
  Spinner,
  TextField,
} from "@radix-ui/themes";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
// Local imports for featured icons to ensure they are bundled and work offline
import {
  IconBell,
  IconBolt,
  IconBox,
  IconBrain,
  IconBulb,
  IconCalendar,
  IconChecklist,
  IconCloud,
  IconCode,
  IconConfetti,
  IconDatabase,
  IconDeviceSpeaker,
  IconEar,
  IconFilePlus,
  IconFileSearch,
  IconFileText,
  IconFlame,
  IconGhost,
  IconHeadphones,
  IconHeart,
  IconHistory,
  IconLanguage,
  IconLink,
  IconList,
  IconListDetails,
  IconMail,
  IconMessage,
  IconMessageChatbot,
  IconMessageReply,
  IconMicrophone,
  IconMoodSmile,
  IconNotes,
  IconPencil,
  IconPlayerPlay,
  IconRobot,
  IconRocket,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconSparkles,
  IconStar,
  IconSum,
  IconTerminal,
  IconTerminal2,
  IconTextCaption,
  IconUser,
  IconUsers,
  IconVolume,
  IconWand,
} from "@tabler/icons-react";

// Map for featured icons using local components
const FEATURED_ICONS_MAP: Record<string, React.ElementType> = {
  IconWand,
  IconLanguage,
  IconSparkles,
  IconRobot,
  IconBrain,
  IconMessageChatbot,
  IconTextCaption,
  IconSum,
  IconBulb,
  IconBolt,
  IconPencil,
  IconNotes,
  IconChecklist,
  IconList,
  IconMicrophone,
  IconPlayerPlay,
  IconVolume,
  IconEar,
  IconHeadphones,
  IconDeviceSpeaker,
  IconSearch,
  IconHistory,
  IconSettings,
  IconHeart,
  IconStar,
  IconFlame,
  IconRocket,
  IconConfetti,
  IconMoodSmile,
  IconGhost,
  IconCode,
  IconTerminal,
  IconTerminal2,
  IconDatabase,
  IconCloud,
  IconLink,
  IconMail,
  IconBell,
  IconCalendar,
  IconUser,
  IconUsers,
  IconFileText,
  IconFilePlus,
  IconFileSearch,
  IconBox,
  IconShieldCheck,
  IconListDetails,
  IconMessage,
  IconMessageReply,
};

const FEATURED_NAMES = Object.keys(FEATURED_ICONS_MAP);

/**
 * DynamicIcon handles:
 * 1. Raw SVG strings (starts with <svg)
 * 2. Base64 images (starts with data:image)
 * 3. Local Tabler component names (starts with Icon)
 * 4. Fallback IconWand
 */
export const DynamicIcon = React.forwardRef<
  HTMLElement,
  {
    name: string;
    [key: string]: any;
  }
>(({ name, ...props }, ref) => {
  if (!name) return <IconWand size={props.size || 18} {...props} />;

  // 1. Raw SVG String support
  if (name.startsWith("<svg")) {
    return (
      <div
        ref={ref as React.Ref<HTMLDivElement>}
        style={{
          width: props.size || 18,
          height: props.size || 18,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        dangerouslySetInnerHTML={{ __html: name }}
        {...props}
      />
    );
  }

  // 2. Base64/Image URL support (incl. Tauri asset:// protocol)
  if (
    name.startsWith("data:image") ||
    name.startsWith("http") ||
    name.startsWith("asset:")
  ) {
    return (
      <img
        ref={ref as React.Ref<HTMLImageElement>}
        src={name}
        alt="icon"
        style={{
          width: props.size || 18,
          height: props.size || 18,
          borderRadius: "4px",
          objectFit: "contain",
          display: "block",
        }}
        {...props}
      />
    );
  }

  // 3. Local Tabler Component support
  const LocalIcon = FEATURED_ICONS_MAP[name];
  if (LocalIcon) {
    return <LocalIcon size={props.size || 18} {...props} />;
  }

  // 4. Iconify string (fallback)
  return <IconifyIcon icon={name} fontSize={props.size || 18} {...props} />;
});

DynamicIcon.displayName = "DynamicIcon";

interface IconPickerProps {
  value?: string | null;
  onChange: (data: string) => void;
}

export const IconPicker: React.FC<IconPickerProps> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [remoteIcons, setRemoteIcons] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const currentIconData = value || "IconWand";

  // Fetch full SVG string from Iconify for selected icon
  const selectRemoteIcon = useCallback(
    async (iconName: string) => {
      try {
        const [prefix, name] = iconName.split(":");
        const response = await fetch(
          `https://api.iconify.design/${prefix}/${name}.svg`,
        );
        const svgText = await response.text();
        if (svgText.startsWith("<svg")) {
          onChange(svgText);
        } else {
          onChange(iconName);
        }
      } catch (err) {
        console.error("Failed to download SVG:", err);
        onChange(iconName);
      }
    },
    [onChange],
  );

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items;
      for (const item of items) {
        if (item.type.indexOf("image") !== -1) {
          const file = item.getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
              const base64 = event.target?.result as string;
              if (base64) onChange(base64);
            };
            reader.readAsDataURL(file);
          }
        }
      }
    },
    [onChange],
  );

  useEffect(() => {
    if (!search.trim()) {
      setRemoteIcons([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const response = await fetch(
          `https://api.iconify.design/search?query=${encodeURIComponent(search)}&limit=60&prefixes=tabler`,
        );
        const data = await response.json();
        if (data.icons) setRemoteIcons(data.icons);
      } catch (err) {
        console.error("Failed to fetch icons:", err);
      } finally {
        setIsLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  const isSearchMode = search.trim().length > 0;
  const isImageValue =
    typeof value === "string" &&
    (value.startsWith("data:image") ||
      value.startsWith("http") ||
      value.startsWith("asset:") ||
      value.startsWith("<svg"));

  return (
    <Popover.Root>
      <Popover.Trigger>
        {isImageValue ? (
          <button
            type="button"
            aria-label="Change icon"
            style={{
              cursor: "pointer",
              width: 28,
              height: 28,
              padding: 0,
              border: "none",
              borderRadius: 6,
              overflow: "hidden",
              background: "var(--gray-a2)",
              boxShadow:
                "inset 0 0 0 0.5px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.06)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <DynamicIcon name={currentIconData} size={26} />
          </button>
        ) : (
          <IconButton
            variant="soft"
            size="2"
            style={{ cursor: "pointer", width: "28px", height: "28px" }}
          >
            <DynamicIcon name={currentIconData} size={18} />
          </IconButton>
        )}
      </Popover.Trigger>
      <Popover.Content
        size="1"
        style={{ width: 240, padding: "8px", paddingRight: 0 }}
        side="bottom"
        align="start"
        onPaste={handlePaste}
      >
        <Flex direction="column" gap="2">
          <TextField.Root
            placeholder={t("common.searchOrPaste")}
            style={{ marginRight: "8px" }}
            value={search}
            onInput={(e: React.FormEvent<HTMLInputElement>) =>
              setSearch(e.currentTarget.value)
            }
            size="1"
            autoFocus
          >
            <TextField.Slot>
              <IconifyIcon icon="tabler:search" />
            </TextField.Slot>
            {isLoading && (
              <TextField.Slot>
                <Spinner size="1" />
              </TextField.Slot>
            )}
          </TextField.Root>

          <ScrollArea
            scrollbars="vertical"
            style={{ height: 175, paddingRight: "16px" }}
            type="auto"
          >
            {isSearchMode ? (
              <Grid columns="7" gap="0">
                {remoteIcons.map((name) => (
                  <IconButton
                    key={name}
                    variant="ghost"
                    size="1"
                    onClick={() => selectRemoteIcon(name)}
                    style={{ cursor: "pointer", width: "28px", height: "28px" }}
                  >
                    <IconifyIcon icon={name} fontSize={20} />
                  </IconButton>
                ))}
              </Grid>
            ) : (
              <Grid columns="7" gap="0">
                {FEATURED_NAMES.map((name) => {
                  const IconComp = FEATURED_ICONS_MAP[name];
                  const isSelected = currentIconData === name;
                  return (
                    <IconButton
                      key={name}
                      variant={isSelected ? "solid" : "ghost"}
                      size="1"
                      onClick={() => onChange(name)}
                      style={{
                        cursor: "pointer",
                        width: "28px",
                        height: "28px",
                        borderRadius: "4px",
                        backgroundColor: isSelected ? undefined : "transparent",
                      }}
                    >
                      <IconComp
                        size={20}
                        stroke={isSelected ? 2 : 1.5}
                        color={isSelected ? "white" : "var(--gray-11)"}
                      />
                    </IconButton>
                  );
                })}
              </Grid>
            )}
          </ScrollArea>
        </Flex>
      </Popover.Content>
    </Popover.Root>
  );
};
