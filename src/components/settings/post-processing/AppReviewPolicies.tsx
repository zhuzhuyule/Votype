import {
  Box,
  Button,
  DropdownMenu,
  Flex,
  IconButton,
  Select,
  Text,
} from "@radix-ui/themes";
import { IconGripVertical, IconPlus, IconTrash } from "@tabler/icons-react"; // Added IconGripVertical import
import { invoke } from "@tauri-apps/api/core";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { AppProfile, AppReviewPolicy } from "../../../lib/types";
import { IconPicker } from "../../shared/IconPicker";
import { Card } from "../../ui/Card";

// dnd-kit imports
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface SortableRuleItemProps {
  appName: string;
  profile: AppProfile;
  prompts: any[];
  onUpdateRule: (profileId: string, updates: Partial<AppProfile>) => void;
  onRemoveRule: (appName: string, profileId: string) => void;
  t: any;
}

const SortableRuleItem: React.FC<SortableRuleItemProps> = ({
  appName,
  profile,
  prompts,
  onUpdateRule,
  onRemoveRule,
  t,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: profile.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Card className="p-3 shadow-sm hover:shadow-md transition-shadow">
        <Flex align="center" justify="between" gap="4">
          {/* Draggable Handle & App Info */}
          <Flex align="center" gap="3" style={{ flex: 1, minWidth: 0 }}>
            <Box
              {...attributes}
              {...listeners}
              className="cursor-grab active:cursor-grabbing p-1 text-[var(--gray-8)] hover:text-[var(--gray-11)] transition-colors"
            >
              <IconGripVertical size={20} />
            </Box>
            <IconPicker
              value={profile.icon}
              onChange={(icon) => onUpdateRule(profile.id, { icon })}
            />
            <Text weight="bold" size="3" className="truncate">
              {appName}
            </Text>
          </Flex>

          {/* Settings Actions */}
          <Flex align="center" gap="4">
            <Flex direction="column" gap="1">
              <Select.Root
                size="1"
                value={profile.policy}
                onValueChange={(val) =>
                  onUpdateRule(profile.id, {
                    policy: val as AppReviewPolicy,
                  })
                }
              >
                <Select.Trigger variant="surface" style={{ width: 110 }} />
                <Select.Content position="popper">
                  <Select.Item value="auto">
                    {t("settings.postProcessing.appRules.policy.auto")}
                  </Select.Item>
                  <Select.Item value="always">
                    {t("settings.postProcessing.appRules.policy.always")}
                  </Select.Item>
                  <Select.Item value="never">
                    {t("settings.postProcessing.appRules.policy.never")}
                  </Select.Item>
                </Select.Content>
              </Select.Root>
            </Flex>

            <Flex direction="column" gap="1">
              <Select.Root
                size="1"
                value={profile.prompt_id || "default"}
                onValueChange={(val) =>
                  onUpdateRule(profile.id, {
                    prompt_id: val === "default" ? null : val,
                  })
                }
              >
                <Select.Trigger variant="surface" style={{ width: 140 }} />
                <Select.Content position="popper">
                  <Select.Item value="default">
                    {t("common.default")}
                  </Select.Item>
                  {prompts.map((p) => (
                    <Select.Item key={p.id} value={p.id}>
                      {p.name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>

            <IconButton
              variant="soft"
              color="red"
              size="1"
              onClick={() => onRemoveRule(appName, profile.id)}
            >
              <IconTrash size={14} />
            </IconButton>
          </Flex>
        </Flex>
      </Card>
    </div>
  );
};

export const AppProfilesManager: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const [isCapturing, setIsCapturing] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [suggestedApps, setSuggestedApps] = useState<string[]>([]);

  const profiles = settings?.app_profiles || [];
  const appToProfile = settings?.app_to_profile || {};
  const prompts = settings?.post_process_prompts || [];

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const fetchSuggestions = useCallback(async () => {
    try {
      const entries: any[] = await invoke("get_history_entries");
      const counts = new Map<string, number>();
      entries.forEach((e) => {
        const name = e.app_name?.trim();
        if (name && name !== "Votype" && name !== "Handy") {
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      });
      const assignedApps = new Set(Object.keys(appToProfile));
      const top = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .filter(([name]) => !assignedApps.has(name))
        .slice(0, 10)
        .map(([name]) => name);
      setSuggestedApps(top);
    } catch (e) {
      console.error("Failed to fetch app suggestions", e);
    }
  }, [appToProfile]);

  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

  const handleUpdateRule = useCallback(
    async (profileId: string, updates: Partial<AppProfile>) => {
      const newProfiles = profiles.map((p) =>
        p.id === profileId ? { ...p, ...updates } : p,
      );
      await updateSetting("app_profiles", newProfiles);
    },
    [profiles, updateSetting],
  );

  const handleAssignApp = useCallback(
    async (appName: string) => {
      if (!appName.trim()) return;
      if (appToProfile[appName]) return; // Already has a rule

      const profileId = `rule_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const newProfile: AppProfile = {
        id: profileId,
        name: appName,
        policy: "auto",
      };

      const newProfiles = [...profiles, newProfile];
      const newAppToProfile = { ...appToProfile, [appName]: profileId };

      await updateSetting("app_profiles", newProfiles);
      await updateSetting("app_to_profile", newAppToProfile);

      setCountdown(0);
      setIsCapturing(false);
    },
    [profiles, appToProfile, updateSetting],
  );

  const handleRemoveRule = useCallback(
    async (appName: string, profileId: string) => {
      const newAppToProfile = { ...appToProfile };
      delete newAppToProfile[appName];

      // If no other apps use this profile, remove it
      const otherAppsUsingProfile = Object.entries(newAppToProfile).filter(
        ([name, pid]) => pid === profileId && name !== appName,
      );

      let newProfiles = profiles;
      if (otherAppsUsingProfile.length === 0) {
        newProfiles = profiles.filter((p) => p.id !== profileId);
      }

      await updateSetting("app_profiles", newProfiles);
      await updateSetting("app_to_profile", newAppToProfile);
    },
    [profiles, appToProfile, updateSetting],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = profiles.findIndex((p) => p.id === active.id);
        const newIndex = profiles.findIndex((p) => p.id === over.id);
        const newProfiles = arrayMove(profiles, oldIndex, newIndex);
        await updateSetting("app_profiles", newProfiles);
      }
    },
    [profiles, updateSetting],
  );

  const captureAndAssign = useCallback(async () => {
    setIsCapturing(true);
    setCountdown(3);

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    setTimeout(async () => {
      try {
        const info: any = await invoke("get_active_window_info");
        if (info && info.app_name) {
          if (info.app_name !== "Votype" && info.app_name !== "Handy") {
            await handleAssignApp(info.app_name);
          }
        }
      } catch (e) {
        console.error("Failed to capture active window", e);
      } finally {
        setIsCapturing(false);
      }
    }, 3000);
  }, [handleAssignApp]);

  // We display applications based on the order of profiles array.
  // Each profile corresponds to an app in our new flat model.
  const rules = profiles
    .map((profile) => {
      const appName = Object.entries(appToProfile).find(
        ([_, pid]) => pid === profile.id,
      )?.[0];
      if (!appName) return null;
      return { appName, profile };
    })
    .filter((r): r is { appName: string; profile: AppProfile } => r !== null);

  return (
    <Flex direction="column" gap="4">
      {/* Header Actions */}
      <Flex justify="between" align="center" px="1">
        <Text size="1" color="gray" weight="medium">
          {rules.length > 0
            ? t("settings.postProcessing.appRules.activeProfiles", {
                count: rules.length,
              })
            : t("settings.postProcessing.appRules.noProfiles")}
        </Text>
        <Flex gap="2">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <Button variant="soft" size="2">
                <IconPlus size={16} />
                {t("settings.postProcessing.appRules.addApp")}
                <DropdownMenu.TriggerIcon />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              {suggestedApps.map((app) => (
                <DropdownMenu.Item
                  key={app}
                  onClick={() => handleAssignApp(app)}
                >
                  {app}
                </DropdownMenu.Item>
              ))}
              {suggestedApps.length === 0 && (
                <DropdownMenu.Item disabled>
                  {t("common.noOptionsFound")}
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
          <Button
            variant="solid"
            size="2"
            onClick={captureAndAssign}
            disabled={isCapturing}
          >
            {isCapturing
              ? `${countdown}s`
              : t("settings.postProcessing.appRules.capture")}
          </Button>
        </Flex>
      </Flex>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={rules.map((r) => r.profile.id)}
          strategy={verticalListSortingStrategy}
        >
          <Flex direction="column" gap="2">
            {rules.map(({ appName, profile }) => (
              <SortableRuleItem
                key={profile.id}
                appName={appName}
                profile={profile}
                prompts={prompts}
                onUpdateRule={handleUpdateRule}
                onRemoveRule={handleRemoveRule}
                t={t}
              />
            ))}

            {rules.length === 0 && (
              <Flex
                direction="column"
                align="center"
                justify="center"
                py="8"
                className="border-2 border-dashed border-[var(--gray-4)] rounded-xl bg-[var(--gray-2)]/50"
                gap="2"
              >
                <Text size="2" color="gray">
                  {t("settings.postProcessing.appRules.noAppsAssigned")}
                </Text>
                <Text size="1" color="gray" className="opacity-60">
                  {t("settings.postProcessing.appRules.createPromptHint")}
                </Text>
              </Flex>
            )}
          </Flex>
        </SortableContext>
      </DndContext>
    </Flex>
  );
};
