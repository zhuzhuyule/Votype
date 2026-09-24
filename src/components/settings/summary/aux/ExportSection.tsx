import { Button, Flex, Text } from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

interface ExportSectionProps {
  summaryId: number | null;
}

export function ExportSection({ summaryId }: ExportSectionProps) {
  const { t } = useTranslation();
  if (!summaryId) {
    return (
      <Text size="2" color="gray">
        {t("settings.summary.export.pleaseSelect")}
      </Text>
    );
  }

  const exportAs = async (format: "markdown" | "json") => {
    try {
      const content = await invoke<string>("export_summary", {
        summaryId,
        format,
      });
      await writeText(content);
      toast.success(
        t("settings.summary.export.copied", { format: format.toUpperCase() }),
      );
    } catch (e) {
      toast.error(t("settings.summary.export.failed", { error: String(e) }));
    }
  };

  return (
    <Flex direction="column" gap="2">
      <Button size="2" variant="soft" onClick={() => exportAs("markdown")}>
        {t("settings.summary.export.markdown")}
      </Button>
      <Button size="2" variant="soft" onClick={() => exportAs("json")}>
        {t("settings.summary.export.json")}
      </Button>
    </Flex>
  );
}
