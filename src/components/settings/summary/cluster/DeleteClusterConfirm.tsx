import { useTranslation } from "react-i18next";
import { AlertDialog, Button, Flex } from "@radix-ui/themes";

interface DeleteClusterConfirmProps {
  open: boolean;
  clusterTitle: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteClusterConfirm({
  open,
  clusterTitle,
  onCancel,
  onConfirm,
}: DeleteClusterConfirmProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog.Root open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialog.Content style={{ maxWidth: 400 }}>
        <AlertDialog.Title>
          {t("settings.summary.delete.title")}
        </AlertDialog.Title>
        <AlertDialog.Description size="2">
          {t("settings.summary.delete.body", { title: clusterTitle })}
        </AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              {t("common.cancel")}
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button color="red" onClick={onConfirm}>
              {t("common.delete")}
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
