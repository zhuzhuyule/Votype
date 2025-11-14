import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IconButton, Flex, Text } from "@radix-ui/themes";
import { CopyIcon, CheckIcon } from "@radix-ui/react-icons";
import { SettingContainer } from "../ui/SettingContainer";

export const AppDataDirectory: React.FC = () => {
  const [appDirPath, setAppDirPath] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    invoke<string>("get_app_dir_path").then(setAppDirPath);
  }, []);

  const handleCopy = async () => {
    if (!appDirPath) return;
    try {
      await navigator.clipboard.writeText(appDirPath);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <SettingContainer
      title="App Data Directory"
      description="Main directory where application data, settings, and models are stored"
      layout="stacked"
    >
      <Flex align="center" gap="3" >
        <Text className="bg-gray-50 border border-gray-200 rounded px-3 py-2 font-mono text-sm break-all flex-1 min-w-0">
          {appDirPath || "Loading..."}
        </Text>
        {appDirPath && (
          <IconButton
            size="2"
            variant="ghost"
            color={copied ? "green" : "gray"}
            onClick={handleCopy}
            title={copied ? "Copied!" : "Copy path"}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </IconButton>
        )}
      </Flex>
    </SettingContainer>
  );
};
