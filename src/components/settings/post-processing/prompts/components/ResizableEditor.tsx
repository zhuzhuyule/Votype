// ResizableEditor - A text editor with draggable resize handle

import { Box, Flex, Text, TextArea } from "@radix-ui/themes";
import React, { useEffect, useRef, useState } from "react";
import { Trans } from "react-i18next";

interface ResizableEditorProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    tipKey: string;
}

export const ResizableEditor: React.FC<ResizableEditorProps> = ({
    label,
    value,
    onChange,
    placeholder,
    tipKey,
}) => {
    const [height, setHeight] = useState(400);
    const isDragging = useRef(false);
    const startY = useRef(0);
    const startHeight = useRef(0);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging.current) return;
            const delta = e.clientY - startY.current;
            const newHeight = Math.max(150, startHeight.current + delta); // Min height 150px
            setHeight(newHeight);
        };

        const handleMouseUp = () => {
            isDragging.current = false;
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, []);

    const handleMouseDown = (e: React.MouseEvent) => {
        isDragging.current = true;
        startY.current = e.clientY;
        startHeight.current = height;
        document.body.style.cursor = "ns-resize";
        document.body.style.userSelect = "none"; // Prevent text selection while dragging
    };

    return (
        <Flex direction="column" gap="2">
            <Text size="2" weight="medium">
                {label}
            </Text>

            <Box className="relative group">
                <TextArea
                    variant="surface"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    className="font-mono text-sm leading-relaxed border-gray-200 p-4 transition-none"
                    style={{ height: height, resize: "none" }} // Disable native resize
                />

                {/* Custom Resize Handle */}
                <Box
                    className="absolute bottom-0 left-1/2 w-full max-w-[200px] cursor-ns-resize flex items-center justify-center hover:bg-black/5 transition-colors rounded-b"
                    onMouseDown={handleMouseDown}
                    style={{
                        touchAction: "none",
                        transform: "translate(-50%, 50%)", // combine centering X and offset Y
                        bottom: "1px",
                        opacity: 0.6,
                    }}
                >
                    {/* Grip Lines Icon or Graphic */}
                    <Box className="w-full h-1.5 bg-gray-300 rounded-full group-hover:bg-gray-500 transition-colors shadow-sm" />
                </Box>
            </Box>

            <Text size="1" color="gray">
                <Trans
                    i18nKey={tipKey}
                    components={{
                        code: (
                            <code className="px-1.5 py-0.5 bg-gray-100/80 rounded text-xs font-mono text-gray-700 mx-1" />
                        ),
                        br: <br />,
                    }}
                />
            </Text>
        </Flex>
    );
};
