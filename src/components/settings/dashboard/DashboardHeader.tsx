import { Button, Flex, Heading } from "@radix-ui/themes";
import { IconFolderOpen } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import React from "react";
import { useTranslation } from "react-i18next";

interface DashboardHeaderProps {
  loading?: boolean;
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({ loading = false }) => {
  const { t } = useTranslation();

  return (
    <Flex justify="between" align="center" gap="4">
      <Heading size="7">{t("dashboard.title")}</Heading>
      <Button
        variant="soft"
        onClick={() => invoke("open_recordings_folder")}
        disabled={loading}
      >
        <IconFolderOpen width={18} height={18} />
        {t("dashboard.actions.openRecordings")}
      </Button>
    </Flex>
  );
};
