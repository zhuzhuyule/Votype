import React from "react";

import { PromoteModelSelection } from "./post-processing/PromoteModelSelection";
import { OnlineAsrSettings } from "./post-processing/OnlineAsrSettings";
import { PostProcessingSettingsPrompts } from "./post-processing/PostProcessingSettings";
import { SettingsGroup } from "../ui";
import { PostProcessingToggle } from "./PostProcessingToggle";

export const ModelsSettings: React.FC = () => {
  return (
    <div className="max-w-3xl w-full mx-auto p-6 shadow-sm space-y-8">
      <SettingsGroup title="ASR Model">
        <OnlineAsrSettings />
      </SettingsGroup>
      <SettingsGroup title="Prompt Model">
        <PostProcessingToggle grouped={true} />
        <div className="space-y-4">
          <PromoteModelSelection />
          <PostProcessingSettingsPrompts />
        </div>
      </SettingsGroup>
    </div>
  );
};
