import { Box, Card, Flex, Heading, Text } from "@radix-ui/themes";
import React from "react";

interface SettingsGroupProps {
  title?: React.ReactNode;
  titleClassName?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  framed?: boolean;
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  title,
  titleClassName,
  description,
  children,
  actions,
  framed = true,
}) => {
  const header = (
    <Box mb="2">
      <Flex justify="between" align="center">
        <Box>
          {title && (
            <Heading
              size="4"
              weight="bold"
              highContrast={!titleClassName}
              style={!titleClassName ? { color: "var(--gray-12)" } : undefined}
              className={titleClassName}
            >
              {title}
            </Heading>
          )}
          {description && (
            <Text size="2" color="gray" mt="1" style={{ display: "block" }}>
              {description}
            </Text>
          )}
        </Box>
        {actions && <Box>{actions}</Box>}
      </Flex>
    </Box>
  );

  const content = (
    <Flex direction="column" gap="1">
      {React.Children.map(children, (child, index) => (
        <React.Fragment key={index}>
          {/* Custom separator line if needed, currently just spacing */}
          {child}
        </React.Fragment>
      ))}
    </Flex>
  );

  if (framed) {
    return (
      <Card
        size="3"
        style={{
          backgroundColor: "var(--color-panel-solid)",
          boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
          border: "1px solid var(--gray-a3)",
        }}
      >
        {header}
        {content}
      </Card>
    );
  }

  return (
    <Box>
      {header}
      {content}
    </Box>
  );
};
