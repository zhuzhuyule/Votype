import { Box, Button, Flex, Switch, Text } from "@radix-ui/themes";
import { IconFileText, IconFolderOpen, IconRefresh } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import type { LLMPrompt } from "../../../../../lib/types";

interface ExternalSkillsListProps {
  skills: LLMPrompt[];
  isLoading: boolean;
  onRefresh: () => void;
  onOpenFolder: () => void;
}

export const ExternalSkillsList: React.FC<ExternalSkillsListProps> = ({
  skills,
  isLoading,
  onRefresh,
  onOpenFolder,
}) => {
  const { t } = useTranslation();

  return (
    <Flex direction="column" gap="4" className="p-4">
      {/* Header */}
      <Flex justify="between" align="center">
        <Flex align="center" gap="2">
          <Text size="2" color="gray">
            📂 ~/.votype/skills/
          </Text>
        </Flex>
        <Flex gap="2">
          <Button
            variant="soft"
            color="gray"
            size="1"
            onClick={onOpenFolder}
            className="cursor-pointer"
          >
            <IconFolderOpen size={14} />
            {t("settings.postProcessing.skills.openFolder")}
          </Button>
          <Button
            variant="soft"
            color="gray"
            size="1"
            onClick={onRefresh}
            disabled={isLoading}
            className="cursor-pointer"
          >
            <IconRefresh
              size={14}
              className={isLoading ? "animate-spin" : ""}
            />
            {t("settings.postProcessing.skills.refresh")}
          </Button>
        </Flex>
      </Flex>

      {/* Skills List */}
      {skills.length === 0 ? (
        <Box className="text-center py-8">
          <Text size="2" color="gray">
            {t("settings.postProcessing.skills.noExternalSkills")}
          </Text>
          <Text size="1" color="gray" className="block mt-2">
            {t("settings.postProcessing.skills.createHint")}
          </Text>
        </Box>
      ) : (
        <Flex direction="column" gap="2">
          {skills.map((skill) => (
            <Flex
              key={skill.id}
              align="center"
              justify="between"
              className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800"
            >
              <Flex align="center" gap="3">
                <IconFileText size={16} className="text-emerald-500" />
                <Flex direction="column" gap="0">
                  <Text size="2" weight="medium">
                    {skill.name}
                  </Text>
                  <Text size="1" color="gray">
                    {skill.id.replace("ext_", "") + ".md"}
                  </Text>
                </Flex>
              </Flex>
              <Flex align="center" gap="2">
                <Text
                  size="1"
                  className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300"
                >
                  {t("settings.postProcessing.skills.sourceFile")}
                </Text>
                <Switch
                  size="1"
                  checked={skill.enabled}
                  disabled
                  title={t("settings.postProcessing.skills.enabledInFile")}
                />
              </Flex>
            </Flex>
          ))}
        </Flex>
      )}

      {/* Help Text */}
      <Box className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-100 dark:border-blue-900">
        <Text size="1" color="blue">
          💡 {t("settings.postProcessing.skills.helpText")}
        </Text>
      </Box>
    </Flex>
  );
};
