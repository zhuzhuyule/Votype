import React from "react";

interface TranscriptionIconProps {
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

const TranscriptionIcon: React.FC<TranscriptionIconProps> = ({
  width = 24,
  height = 24,
  color = "#4f46e5",
  className = "",
}) => {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 256 256"
      color={color}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M224 131.2a44.9 44.9 0 0 0-25.6-40.488V83.2A38.386 38.386 0 0 0 128 62.005 38.386 38.386 0 0 0 57.6 83.2v7.512a44.802 44.802 0 0 0 0 80.957v1.131a38.386 38.386 0 0 0 70.4 21.195 38.386 38.386 0 0 0 70.4-21.195v-1.131A44.85 44.85 0 0 0 224 131.2M96 198.4a25.635 25.635 0 0 1-25.45-22.845 45 45 0 0 0 6.25.445h6.4a6.4 6.4 0 0 0 0-12.8h-6.4a32.007 32.007 0 0 1-10.668-62.18 6.4 6.4 0 0 0 4.267-6.034L70.4 83.2a25.6 25.6 0 0 1 51.2 0v61.01A38.24 38.24 0 0 0 96 134.4a6.4 6.4 0 0 0 0 12.8 25.6 25.6 0 0 1 0 51.2m83.2-35.2h-6.4a6.4 6.4 0 0 0 0 12.8h6.4a45 45 0 0 0 6.25-.445A25.6 25.6 0 1 1 160 147.2a6.4 6.4 0 0 0 0-12.8 38.24 38.24 0 0 0-25.6 9.81V83.2a25.6 25.6 0 1 1 51.2 0v11.786a6.4 6.4 0 0 0 4.268 6.033A32.007 32.007 0 0 1 179.2 163.2M73.6 128a6.4 6.4 0 0 1 0-12.8 16.02 16.02 0 0 0 16-16v-6.4a6.4 6.4 0 0 1 12.8 0v6.4A28.83 28.83 0 0 1 73.6 128m115.2-6.4a6.4 6.4 0 0 1-6.4 6.4 28.83 28.83 0 0 1-28.8-28.8v-6.4a6.4 6.4 0 0 1 12.8 0v6.4a16.02 16.02 0 0 0 16 16 6.4 6.4 0 0 1 6.4 6.4"
        fill="currentColor"
        stroke="currentColor"
        stroke-width="9.8"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    </svg>
  );
};

export default TranscriptionIcon;
