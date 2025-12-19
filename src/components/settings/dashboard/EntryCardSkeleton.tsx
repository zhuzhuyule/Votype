import { Box, Flex } from "@radix-ui/themes";
import React from "react";

interface EntryCardSkeletonProps {
  className?: string;
}

/**
 * Skeleton placeholder for DashboardEntryCard when scrolled out of view
 */
export const EntryCardSkeleton: React.FC<EntryCardSkeletonProps> = ({
  className = "",
}) => {
  return (
    <Box
      className={`bg-background/40 backdrop-blur-md border border-white/10 rounded-xl shadow-sm overflow-hidden animate-pulse ${className}`}
    >
      <Flex direction="column" className="p-4">
        {/* Header skeleton */}
        <Flex justify="between" align="center" className="pb-3">
          <Flex gap="2" align="center">
            <Box className="h-4 w-16 bg-mid-gray/20 rounded" />
            <Box className="h-4 w-20 bg-mid-gray/15 rounded" />
          </Flex>
          <Flex gap="2">
            <Box className="h-6 w-6 bg-mid-gray/10 rounded" />
            <Box className="h-6 w-6 bg-mid-gray/10 rounded" />
            <Box className="h-6 w-6 bg-mid-gray/10 rounded" />
          </Flex>
        </Flex>

        {/* Content skeleton */}
        <Box className="mb-3 bg-mid-gray/5 rounded-lg p-3 border border-mid-gray/10">
          <Box className="h-4 w-full bg-mid-gray/20 rounded mb-2" />
          <Box className="h-4 w-3/4 bg-mid-gray/15 rounded mb-2" />
          <Box className="h-4 w-1/2 bg-mid-gray/10 rounded" />
        </Box>

        {/* Audio player skeleton */}
        <Box className="pt-3 border-t border-white/5">
          <Flex align="center" gap="3">
            <Box className="h-6 w-6 bg-mid-gray/20 rounded-full" />
            <Box className="h-2 flex-1 bg-mid-gray/15 rounded" />
            <Box className="h-4 w-10 bg-mid-gray/10 rounded" />
          </Flex>
        </Box>
      </Flex>
    </Box>
  );
};
