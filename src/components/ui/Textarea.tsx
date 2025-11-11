import React from "react";

interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: "default" | "compact";
}

export const Textarea: React.FC<TextareaProps> = ({
  className = "",
  variant = "default",
  ...props
}) => {
  const baseClasses =
    "px-3 py-2 text-sm font-normal bg-white border border-mid-gray/15 rounded-md text-left transition-all duration-200 placeholder:text-mid-gray/40 hover:border-mid-gray/25 focus:outline-none focus:border-logo-primary focus:ring-2 focus:ring-logo-primary/20 resize-y";

  const variantClasses = {
    default: "px-3 py-2.5 min-h-[110px]",
    compact: "px-2.5 py-1.5 min-h-[90px]",
  };

  return (
    <textarea
      className={`${baseClasses} ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
};
