// DeletePromptDialog - Confirmation dialog for deleting a prompt

import { AlertDialog, Button, Flex } from "@radix-ui/themes";
import { IconTrash } from "@tabler/icons-react";
import { TFunction } from "i18next";
import React from "react";

interface DeletePromptDialogProps {
  t: TFunction;
  onDelete: () => void;
  disabled?: boolean;
}

export const DeletePromptDialog: React.FC<DeletePromptDialogProps> = ({
  t,
  onDelete,
  disabled = false,
}) => {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger>
        <Button variant="soft" color="red" disabled={disabled}>
          <IconTrash size={16} />
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Content maxWidth="450px">
        <AlertDialog.Title>
          {t("settings.postProcessing.prompts.deleteConfirm.title")}
        </AlertDialog.Title>
        <AlertDialog.Description size="2">
          {t("settings.postProcessing.prompts.deleteConfirm.description")}
        </AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              {t("common.cancel")}
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button variant="solid" color="red" onClick={onDelete}>
              {t("common.delete")}
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
};
