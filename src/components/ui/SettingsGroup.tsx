import { Box, Card, Flex, Heading, Text } from "@radix-ui/themes";
import React from "react";

interface SettingsGroupProps {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  title,
  description,
  children,
  actions,
}) => {
  const headerContent = (
    <>
      {title && (
        <Box px="3">
          <Heading
            as="h2"
            size="3"
            weight="medium"
            color="gray"
            className="capitalize tracking-wide"
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

  return (
    <Box className="space-y-2 min-w-200">
      <Flex justify="between" align="center">
        {headerContent}
      </Flex>
      <Card>{children}</Card>
    </Box>
  );
};
