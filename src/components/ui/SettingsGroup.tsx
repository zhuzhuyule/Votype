import React from "react";
import * as Accordion from "@radix-ui/react-accordion";
import { Flex, Heading, Text, Box } from "@radix-ui/themes";
import { ChevronDownIcon } from "@radix-ui/react-icons";

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
  if (collapsible) {
    return (
      <Accordion.Root
        type="single"
        collapsible
        defaultValue={defaultOpen ? "settings" : undefined}
        className="space-y-2"
      >
        <Accordion.Item value="settings" className="border-0">
          <Accordion.Header>
            <Accordion.Trigger className="flex items-center justify-between w-full group">
              <Flex justify="between" align="center" className="flex-1">
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
                {actions && <Box px="3">{actions}</Box>}
              </Flex>
              <Box px="3" className="text-mid-gray group-hover:text-text transition-colors">
                <ChevronDownIcon
                  width="16"
                  height="16"
                  className="transition-transform duration-200 group-data-[state=open]:rotate-180"
                />
              </Box>
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Content className="bg-background border border-mid-gray/20 rounded-lg overflow-visible">
            <Box className="divide-y divide-mid-gray/20">
              {children}
            </Box>
          </Accordion.Content>
        </Accordion.Item>
      </Accordion.Root>
    );
  }

  return (
    <Box className="space-y-2">
      <Flex justify="between" align="center">
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
      </Flex>
      <Box className="bg-background border border-mid-gray/20 rounded-lg overflow-visible">
        <Box className="divide-y divide-mid-gray/20">{children}</Box>
      </Box>
    </Box>
  );
};
