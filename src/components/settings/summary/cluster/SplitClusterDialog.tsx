import {
  Dialog,
  Button,
  Checkbox,
  Flex,
  Text,
  TextField,
  ScrollArea,
} from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import type { TaskCluster } from "../summaryTypes";

interface HistoryEntryLite {
  id: number;
  timestamp: number;
  app_name: string | null;
  transcription_text: string;
  post_processed_text: string | null;
  duration_ms: number | null;
}

interface SplitClusterDialogProps {
  open: boolean;
  cluster: TaskCluster | null;
  onCancel: () => void;
  onConfirm: (
    extractIds: number[],
    newTitle: string,
    extractedDurationMs: number,
  ) => Promise<void>;
}

export function SplitClusterDialog({
  open,
  cluster,
  onCancel,
  onConfirm,
}: SplitClusterDialogProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<HistoryEntryLite[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [newTitle, setNewTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !cluster) return;
    setSelected(new Set());
    setNewTitle("");
    (async () => {
      try {
        const all = await invoke<HistoryEntryLite[]>(
          "get_history_entries_by_ids",
          {
            ids: cluster.source_history_ids,
          },
        );
        all.sort((a, b) => a.timestamp - b.timestamp);
        setEntries(all);
      } catch (e) {
        console.warn(e);
      }
    })();
  }, [open, cluster]);

  if (!cluster) return null;

  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const validSelection =
    selected.size > 0 &&
    selected.size < cluster.source_history_ids.length &&
    newTitle.trim().length > 0;

  const submit = async () => {
    if (!validSelection) return;
    setSubmitting(true);
    try {
      const ids = Array.from(selected);
      const duration = entries
        .filter((e) => selected.has(e.id))
        .reduce((sum, e) => sum + (e.duration_ms ?? 0), 0);
      await onConfirm(ids, newTitle.trim(), duration);
      onCancel();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onCancel()}>
      <Dialog.Content style={{ maxWidth: 560 }}>
        <Dialog.Title>
          {t("settings.summary.split.title", { title: cluster.title })}
        </Dialog.Title>
        <Dialog.Description size="2" mb="3">
          {t("settings.summary.split.hint")}
        </Dialog.Description>
        <Flex direction="column" gap="3">
          <TextField.Root
            placeholder={t("settings.summary.split.titlePlaceholder")}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <ScrollArea type="auto" style={{ maxHeight: 320 }}>
            <Flex direction="column" gap="2">
              {entries.map((e) => (
                <Flex key={e.id} align="start" gap="2" asChild>
                  <label>
                    <Checkbox
                      checked={selected.has(e.id)}
                      onCheckedChange={() => toggle(e.id)}
                    />
                    <Flex direction="column" className="flex-1">
                      <Text size="1" color="gray">
                        {new Date(e.timestamp).toLocaleTimeString()} ·{" "}
                        {e.app_name ?? "?"}
                      </Text>
                      <Text size="2" className="line-clamp-2">
                        {e.post_processed_text || e.transcription_text}
                      </Text>
                    </Flex>
                  </label>
                </Flex>
              ))}
            </Flex>
          </ScrollArea>
          <Text size="1" color="gray">
            {t("settings.summary.split.selected", {
              selected: selected.size,
              total: entries.length,
            })}
            {selected.size === 0 && t("settings.summary.split.atLeastOne")}
            {selected.size === entries.length &&
              entries.length > 0 &&
              t("settings.summary.split.cannotAll")}
          </Text>
        </Flex>
        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              {t("common.cancel")}
            </Button>
          </Dialog.Close>
          <Button disabled={!validSelection || submitting} onClick={submit}>
            {t("settings.summary.split.confirm")}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
