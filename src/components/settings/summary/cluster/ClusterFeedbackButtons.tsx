import {
  Button,
  Flex,
  IconButton,
  Popover,
  Text,
  TextArea,
} from "@radix-ui/themes";
import { IconThumbDown, IconThumbUp } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useClusterFeedback } from "../hooks/useClusterFeedback";

interface ClusterFeedbackButtonsProps {
  clusterId: string;
}

export function ClusterFeedbackButtons({
  clusterId,
}: ClusterFeedbackButtonsProps) {
  const { t } = useTranslation();
  const { add } = useClusterFeedback(clusterId);
  const [openThumb, setOpenThumb] = useState<"up" | "down" | null>(null);
  const [note, setNote] = useState("");

  const submit = async () => {
    if (!openThumb) return;
    await add(openThumb, note.trim() ? note.trim() : undefined);
    setNote("");
    setOpenThumb(null);
  };

  const cancel = () => {
    setNote("");
    setOpenThumb(null);
  };

  return (
    <Popover.Root
      open={openThumb !== null}
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <Flex gap="1">
        <Popover.Trigger>
          <IconButton
            variant="ghost"
            size="1"
            onClick={() => setOpenThumb("up")}
            aria-label={t("settings.summary.feedbackButtons.upAria")}
          >
            <IconThumbUp size={14} />
          </IconButton>
        </Popover.Trigger>
        <Popover.Trigger>
          <IconButton
            variant="ghost"
            size="1"
            onClick={() => setOpenThumb("down")}
            aria-label={t("settings.summary.feedbackButtons.downAria")}
          >
            <IconThumbDown size={14} />
          </IconButton>
        </Popover.Trigger>
      </Flex>
      <Popover.Content>
        <Flex direction="column" gap="2" style={{ minWidth: 240 }}>
          <Text size="2">
            {t(
              openThumb === "down"
                ? "settings.summary.feedbackButtons.notePromptDown"
                : "settings.summary.feedbackButtons.notePromptOptional",
            )}
          </Text>
          <TextArea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t(
              openThumb === "down"
                ? "settings.summary.feedbackButtons.placeholderDown"
                : "settings.summary.feedbackButtons.notePromptOptional",
            )}
            rows={3}
          />
          <Flex gap="2" justify="end">
            <Button variant="soft" onClick={cancel} size="1">
              {t("common.cancel")}
            </Button>
            <Button onClick={submit} size="1">
              {t("settings.summary.feedbackButtons.submit")}
              {!note.trim() &&
                t("settings.summary.feedbackButtons.submitNoNote")}
            </Button>
          </Flex>
        </Flex>
      </Popover.Content>
    </Popover.Root>
  );
}
