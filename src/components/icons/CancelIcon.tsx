import React from "react";

interface CancelIconProps {
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

const CancelIcon: React.FC<CancelIconProps> = ({
  width = 24,
  height = 24,
  color = "#767676",
  className = "",
}) => {
  return (
    <svg
      width={width}
      height={height}
      color={color}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle fill="none" stroke="currentColor" stroke-width="2" stroke-miterlimit="10" cx="16" cy="16" r="12" />
      <path fill="none" stroke="currentColor" stroke-linejoin="round" stroke-linecap="round" stroke-width="2" d="m11.5 11.5 9 9m0-9-9 9" />
    </svg>


  );
};

export default CancelIcon;
