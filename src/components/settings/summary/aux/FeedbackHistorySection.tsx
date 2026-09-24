import { Badge, Box, Button, Flex, Text } from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ClusterFeedback } from "../summaryTypes";

export function FeedbackHistorySection() {
  const { t } = useTranslation();
  const [items, setItems] = useState<ClusterFeedback[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await invoke<ClusterFeedback[]>(
        "list_recent_negative_cluster_feedback",
        { days: 30, limit: 50 },
      );
      setItems(list);
    } catch (e) {
      toast.error(
        t("settings.summary.feedbackHistoryLoadFailed", { error: String(e) }),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const remove = async (id: number) => {
    try {
      await invoke("delete_cluster_feedback", { id });
      await refresh();
    } catch (e) {
      toast.error(t("settings.summary.deleteFailed", { error: String(e) }));
    }
  };

  if (loading)
    return (
      <Text size="2" color="gray">
        {t("common.loading")}
      </Text>
    );
  if (items.length === 0)
    return (
      <Text size="2" color="gray">
        {t("settings.summary.feedbackHistory.empty")}
      </Text>
    );

  return (
    <Flex direction="column" gap="2">
      <Text size="1" color="gray">
        {t("settings.summary.feedbackHistory.desc")}
      </Text>
      {items.map((f) => (
        <Box
          key={f.id}
          className="rounded-md border border-gray-200 dark:border-gray-800 p-2"
        >
          <Flex justify="between" align="start" gap="2">
            <Box className="flex-1">
              <Flex gap="1" align="center" mb="1">
                <Badge color="red" size="1">
                  👎
                </Badge>
                <Text size="1" color="gray">
                  {new Date(f.created_at).toLocaleString()}
                </Text>
              </Flex>
              <Text size="2">
                {f.note ?? t("settings.summary.feedbackHistory.emptyNote")}
              </Text>
            </Box>
            <Button
              size="1"
              variant="ghost"
              color="gray"
              onClick={() => remove(f.id)}
            >
              {t("common.delete")}
            </Button>
          </Flex>
        </Box>
      ))}
    </Flex>
  );
}
