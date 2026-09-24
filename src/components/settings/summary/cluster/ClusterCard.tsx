import {
  Badge,
  Box,
  Flex,
  IconButton,
  Select,
  Text,
  TextField,
} from "@radix-ui/themes";
import {
  IconArrowMerge,
  IconArrowsSplit,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconPencil,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Card } from "../../../ui/Card";
import type { TaskCluster } from "../summaryTypes";
import { ClusterFeedbackButtons } from "./ClusterFeedbackButtons";

interface ClusterCardProps {
  cluster: TaskCluster;
  expanded: boolean;
  onToggleExpanded: () => void;
  onUpdateField: (
    field: "title" | "status" | "next_step",
    value: string,
  ) => Promise<void>;
  onOpenSplit: () => void;
  onOpenMerge: () => void;
  onOpenDelete: () => void;
  detailSlot?: React.ReactNode;
}

// Status values are the canonical data keys stored on the cluster; the display
// label is resolved via i18n (see STATUS_LABEL_KEYS). i18n-ignore: data values.
const STATUS_OPTIONS = ["进行中", "完成", "卡住", "已搁置"]; // i18n-ignore

const STATUS_COLORS: Record<string, "blue" | "green" | "amber" | "gray"> = {
  进行中: "blue", // i18n-ignore
  完成: "green", // i18n-ignore
  卡住: "amber", // i18n-ignore
  已搁置: "gray", // i18n-ignore
};

const STATUS_LABEL_KEYS: Record<string, string> = {
  进行中: "settings.summary.cluster.status.inProgress", // i18n-ignore (backend status enum value)
  完成: "settings.summary.cluster.status.done", // i18n-ignore (backend status enum value)
  卡住: "settings.summary.cluster.status.blocked", // i18n-ignore (backend status enum value)
  已搁置: "settings.summary.cluster.status.shelved", // i18n-ignore (backend status enum value)
};

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

export function ClusterCard({
  cluster,
  expanded,
  onToggleExpanded,
  onUpdateField,
  onOpenSplit,
  onOpenMerge,
  onOpenDelete,
  detailSlot,
}: ClusterCardProps) {
  const { t } = useTranslation();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(cluster.title);
  const [editingNextStep, setEditingNextStep] = useState(false);
  const [nextStepDraft, setNextStepDraft] = useState(cluster.next_step ?? "");

  const commitTitle = async () => {
    if (titleDraft.trim() && titleDraft !== cluster.title) {
      await onUpdateField("title", titleDraft.trim());
    }
    setEditingTitle(false);
  };
  const cancelTitle = () => {
    setTitleDraft(cluster.title);
    setEditingTitle(false);
  };
  const commitNextStep = async () => {
    if (nextStepDraft !== (cluster.next_step ?? "")) {
      await onUpdateField("next_step", nextStepDraft);
    }
    setEditingNextStep(false);
  };
  const cancelNextStep = () => {
    setNextStepDraft(cluster.next_step ?? "");
    setEditingNextStep(false);
  };

  return (
    <Card className="mb-3">
      <Flex direction="column" gap="2">
        <Flex align="center" gap="2">
          <IconButton
            size="1"
            variant="ghost"
            onClick={onToggleExpanded}
            aria-label={t("common.expand")}
          >
            {expanded ? (
              <IconChevronDown size={16} />
            ) : (
              <IconChevronRight size={16} />
            )}
          </IconButton>
          {editingTitle ? (
            <Flex align="center" gap="1" className="flex-1">
              <TextField.Root
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitTitle();
                  if (e.key === "Escape") cancelTitle();
                }}
                autoFocus
                className="flex-1"
              />
              <IconButton size="1" variant="ghost" onClick={commitTitle}>
                <IconCheck size={14} />
              </IconButton>
              <IconButton size="1" variant="ghost" onClick={cancelTitle}>
                <IconX size={14} />
              </IconButton>
            </Flex>
          ) : (
            <Flex align="center" gap="2" className="flex-1 group">
              <Text size="3" weight="bold">
                {cluster.title}
              </Text>
              <IconButton
                size="1"
                variant="ghost"
                className="opacity-0 group-hover:opacity-100"
                onClick={() => {
                  setTitleDraft(cluster.title);
                  setEditingTitle(true);
                }}
              >
                <IconPencil size={12} />
              </IconButton>
            </Flex>
          )}
          <Select.Root
            value={cluster.status}
            onValueChange={(v) => onUpdateField("status", v)}
          >
            <Select.Trigger variant="ghost">
              <Badge color={STATUS_COLORS[cluster.status] ?? "gray"} size="1">
                {t(
                  STATUS_LABEL_KEYS[cluster.status] ??
                    "settings.summary.cluster.status.unknown",
                )}
              </Badge>
            </Select.Trigger>
            <Select.Content>
              {STATUS_OPTIONS.map((s) => (
                <Select.Item key={s} value={s}>
                  {t(
                    STATUS_LABEL_KEYS[s] ??
                      "settings.summary.cluster.status.unknown",
                  )}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <Text size="1" color="gray">
            {formatDuration(cluster.total_duration_ms)} · {cluster.entry_count}{" "}
            entries
          </Text>
          {cluster.is_user_modified && (
            <Badge color="violet" size="1" variant="soft">
              {t("settings.summary.cluster.edited")}
            </Badge>
          )}
        </Flex>

        {cluster.keywords.length > 0 && (
          <Flex gap="1" wrap="wrap">
            {cluster.keywords.slice(0, 8).map((k) => (
              <Badge key={k} size="1" variant="soft" color="gray">
                {k}
              </Badge>
            ))}
          </Flex>
        )}

        {cluster.summary && (
          <Text size="2" color="gray">
            {cluster.summary}
          </Text>
        )}

        {cluster.blockers.length > 0 && (
          <Box className="rounded-md bg-amber-50 dark:bg-amber-950/30 px-2 py-1">
            <Text size="1" color="amber">
              ⚠ {cluster.blockers.join(" / ")}
            </Text>
          </Box>
        )}

        <Flex align="center" gap="2">
          <Text size="1" color="gray">
            📋 next_step:
          </Text>
          {editingNextStep ? (
            <Flex align="center" gap="1" className="flex-1">
              <TextField.Root
                value={nextStepDraft}
                onChange={(e) => setNextStepDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitNextStep();
                  if (e.key === "Escape") cancelNextStep();
                }}
                autoFocus
                className="flex-1"
              />
              <IconButton size="1" variant="ghost" onClick={commitNextStep}>
                <IconCheck size={14} />
              </IconButton>
              <IconButton size="1" variant="ghost" onClick={cancelNextStep}>
                <IconX size={14} />
              </IconButton>
            </Flex>
          ) : (
            <Flex align="center" gap="1" className="flex-1 group">
              <Text size="2">{cluster.next_step || "—"}</Text>
              <IconButton
                size="1"
                variant="ghost"
                className="opacity-0 group-hover:opacity-100"
                onClick={() => {
                  setNextStepDraft(cluster.next_step ?? "");
                  setEditingNextStep(true);
                }}
              >
                <IconPencil size={12} />
              </IconButton>
            </Flex>
          )}
        </Flex>

        {expanded && detailSlot && <Box className="mt-2">{detailSlot}</Box>}

        <Flex justify="between" align="center" className="mt-1">
          <Flex gap="2">
            <button
              type="button"
              onClick={onOpenSplit}
              className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"
            >
              <IconArrowsSplit size={12} />
              {t("settings.summary.cluster.split")}
            </button>
            <button
              type="button"
              onClick={onOpenMerge}
              className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"
            >
              <IconArrowMerge size={12} />
              {t("settings.summary.cluster.merge")}
            </button>
            <button
              type="button"
              onClick={onOpenDelete}
              className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-red-600"
            >
              <IconTrash size={12} />
              {t("common.delete")}
            </button>
          </Flex>
          <ClusterFeedbackButtons clusterId={cluster.id} />
        </Flex>
      </Flex>
    </Card>
  );
}
