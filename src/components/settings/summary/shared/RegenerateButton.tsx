import { useTranslation } from "react-i18next";
import { Button } from "@radix-ui/themes";
import { IconRotateClockwise } from "@tabler/icons-react";

interface RegenerateButtonProps {
  onRegenerate: () => Promise<void>;
  loading: boolean;
}

export function RegenerateButton({
  onRegenerate,
  loading,
}: RegenerateButtonProps) {
  const { t } = useTranslation();
  return (
    <Button variant="soft" size="1" onClick={onRegenerate} disabled={loading}>
      <IconRotateClockwise
        size={14}
        className={loading ? "animate-spin" : ""}
      />
      {loading
        ? t("settings.summary.regenerate.loading")
        : t("settings.summary.regenerate.label")}
    </Button>
  );
}
