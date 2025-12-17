import { Box, Flex, Text } from "@radix-ui/themes";
import { IconThumbUp } from "@tabler/icons-react";
import React from "react";

interface ModelListItemProps {
    name: string;
    meta: React.ReactNode;
    size?: string;
    isRecommended?: boolean;
    isActive?: boolean;
    rightElement?: React.ReactNode;
    onClick?: (e: React.MouseEvent) => void;
    onKeyDown?: (e: React.KeyboardEvent) => void;
    className?: string;
    children?: React.ReactNode;
    ["data-asr-row"]?: boolean;
}

export const ModelListItem: React.FC<ModelListItemProps> = ({
    name,
    meta,
    size,
    isRecommended,
    isActive,
    rightElement,
    onClick,
    onKeyDown,
    className,
    children,
    "data-asr-row": dataAsrRow,
}) => {
    return (
        <Box
            onClick={onClick}
            onKeyDown={onKeyDown}
            tabIndex={0}
            role="button"
            data-asr-row={dataAsrRow}
            className={`w-full px-3 py-2.5 text-left transition-all cursor-pointer focus:outline-none border-2 group ${isActive
                ? "bg-logo-primary/5 border-logo-primary"
                : "border-transparent hover:bg-mid-gray/5"
                } ${className || ""}`}
        >
            <Flex justify="between" align="center">
                <Box className="min-w-0 flex-1">
                    <Flex align="center" gap="2" mb="1" className="min-w-0">
                        <Text
                            size="2"
                            weight="medium"
                            className={`truncate ${isActive ? "text-logo-primary" : "text-text"
                                }`}
                        >
                            {name}
                        </Text>

                        {size && (
                            <Text
                                style={{ borderRadius: "var(--radius-3)" }}
                                className="text-[10px] px-1.5 py-0.5 bg-mid-gray/10 text-text/60 font-medium flex-shrink-0"
                                size="1"
                            >
                                {size}
                            </Text>
                        )}{isRecommended && (
                            <IconThumbUp
                                className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400/90 flex-shrink-0"
                                stroke={2}
                            />
                        )}
                        {children}
                    </Flex>
                    {meta && (
                        <Text className="text-xs text-text/50 block leading-tight" size="1">
                            {meta}
                        </Text>
                    )}
                </Box>
                {rightElement && (
                    <Box className="flex-shrink-0 ml-3">{rightElement}</Box>
                )}
            </Flex>
        </Box>
    );
};
