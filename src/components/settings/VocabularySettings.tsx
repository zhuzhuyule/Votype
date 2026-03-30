// VocabularySettings - Root-level vocabulary management page
// Unified hotword system (includes auto-learned corrections)

import React from "react";
import { Card } from "../ui/Card";
import { HotwordSettings } from "./hotword/HotwordSettings";

export const VocabularySettings: React.FC = () => {
  return (
    <Card className="max-w-5xl w-full mx-auto p-0 flex flex-col">
      <div className="animate-fade-in-up">
        <HotwordSettings />
      </div>
    </Card>
  );
};
