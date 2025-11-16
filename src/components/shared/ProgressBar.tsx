import React from "react";
import { Flex, Text } from "@radix-ui/themes";

export interface ProgressData {
  id: string;
  percentage: number;
  speed?: number;
  label?: string;
}

interface ProgressBarProps {
  progress: ProgressData[];
  className?: string;
  size?: "small" | "medium" | "large";
  showSpeed?: boolean;
  showLabel?: boolean;
}

const ProgressBar: React.FC<ProgressBarProps> = ({
  progress,
  className = "",
  size = "medium",
  showSpeed = false,
  showLabel = false,
}) => {
  const sizeClasses = {
    small: "w-16 h-1",
    medium: "w-20 h-1.5",
    large: "w-24 h-2",
  };

  const progressClasses = sizeClasses[size];

  if (progress.length === 0) {
    return null;
  }

  if (progress.length === 1) {
    // Single progress bar
    const item = progress[0];
    const percentage = Math.max(0, Math.min(100, item.percentage));

    return (
      <Flex align="center" gap="3" className={className}>
        <progress
          value={percentage}
          max={100}
          className={`${progressClasses} [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-mid-gray/20 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-logo-primary`}
        />
        {(showSpeed || showLabel) && (
          <Flex className="text-xs text-text/60 tabular-nums min-w-fit">
            {showLabel && item.label && (
              <Text className="mr-2">{item.label}</Text>
            )}
            {showSpeed && item.speed !== undefined && item.speed > 0 ? (
              <Text>{item.speed.toFixed(1)}MB/s</Text>
            ) : showSpeed ? (
              <Text>Downloading...</Text>
            ) : null}
          </Flex>
        )}
      </Flex>
    );
  }

  // Multiple progress bars
  return (
    <Flex align="center" gap="2" className={className}>
      <Flex className="flex gap-1">
        {progress.map((item) => {
          const percentage = Math.max(0, Math.min(100, item.percentage));
          return (
            <progress
              key={item.id}
              value={percentage}
              max={100}
              title={item.label || `${percentage}%`}
              className="w-3 h-1.5 [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-mid-gray/20 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-logo-primary"
            />
          );
        })}
      </Flex>
      <Text className="text-xs text-text/60 min-w-fit">
        {progress.length} downloading...
      </Text>
    </Flex>
  );
};

export default ProgressBar;
