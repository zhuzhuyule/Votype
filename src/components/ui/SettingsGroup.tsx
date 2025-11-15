import React, { useState } from "react";
import { Box, Flex, Heading, Text, ChevronDownIcon } from "@radix-ui/themes";

interface SettingsGroupProps {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  title,
  description,
  children,
  actions,
  collapsible = false,
  defaultOpen = true,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const toggleOpen = () => {
    setIsOpen((prev) => !prev);
  };

  const headerContent = (
    <>
      {title && (
        <Box px="3">
          <Heading
            as="h2"
            size="1"
            weight="medium"
            color="gray"
            className="uppercase tracking-wide"
          >
            {title}
          </Heading>
          {description && (
            <Text size="1" color="gray" mt="1">
              {description}
            </Text>
          )}
        </Box>
      )}
      {actions && <Box px="3">{actions}</Box>}
    </>
  );

  if (collapsible) {
    return (
      <Box className="space-y-2">
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={isOpen}
          className="group flex w-full items-center justify-between rounded-lg border border-mid-gray/20 bg-background px-1 py-1 text-left transition hover:border-logo-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Flex justify="between" align="center" className="flex-1">
            <Box className="flex-1">
              {title && (
                <Box px="3">
                  <Heading
                    as="h2"
                    size="1"
                    weight="medium"
                    color="gray"
                    className="uppercase tracking-wide group-hover:text-text transition-colors"
                  >
                    {title}
                  </Heading>
                  {description && (
                    <Text
                      size="1"
                      color="gray"
                      mt="1"
                      className="group-hover:text-text/80 transition-colors"
                    >
                      {description}
                    </Text>
                  )}
                </Box>
              )}
            </Box>
            {actions && (
              <Box px="3" className="flex items-center">
                {actions}
              </Box>
            )}
          </Flex>
          <Box
            px="3"
            className="text-mid-gray group-hover:text-text transition-colors"
          >
            <ChevronDownIcon
              className={`h-4 w-4 transition-transform duration-200 ${
                isOpen ? "rotate-180" : ""
              }`}
            />
          </Box>
        </button>

        {isOpen && (
          <Box className="bg-background border border-mid-gray/20 overflow-visible rounded-lg">
            <Box className="divide-y divide-mid-gray/20">{children}</Box>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box className="space-y-2">
      <Flex justify="between" align="center">
        {headerContent}
      </Flex>
      <Box className="bg-background border border-mid-gray/20 overflow-visible">
        <Box className="divide-y divide-mid-gray/20">{children}</Box>
      </Box>
    </Box>
  );
};
