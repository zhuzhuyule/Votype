// RemoveModelDialog - Confirmation dialog for removing a custom model

import { AlertDialog, Button, Flex } from "@radix-ui/themes";
import { TFunction } from "i18next";
import React from "react";

interface RemoveModelDialogProps {
    t: TFunction;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
}

export const RemoveModelDialog: React.FC<RemoveModelDialogProps> = ({
    t,
    isOpen,
    onOpenChange,
    onConfirm,
}) => {
    return (
        <AlertDialog.Root open={isOpen} onOpenChange={onOpenChange}>
            <AlertDialog.Content maxWidth="450px">
                <AlertDialog.Title>
                    {t("settings.asrModels.install.remove")}
                </AlertDialog.Title>
                <AlertDialog.Description size="2">
                    {t("settings.asrModels.install.removeConfirm")}
                </AlertDialog.Description>
                <Flex gap="3" mt="4" justify="end">
                    <AlertDialog.Cancel>
                        <Button variant="soft" color="gray">
                            {t("common.cancel")}
                        </Button>
                    </AlertDialog.Cancel>
                    <AlertDialog.Action>
                        <Button variant="solid" color="red" onClick={onConfirm}>
                            {t("common.delete")}
                        </Button>
                    </AlertDialog.Action>
                </Flex>
            </AlertDialog.Content>
        </AlertDialog.Root>
    );
};
