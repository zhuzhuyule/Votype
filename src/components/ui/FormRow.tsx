import React from "react";

interface FormRowProps {
  label: string;
  children: React.ReactNode;
  error?: string;
  helper?: string;
  tooltip?: string;
  required?: boolean;
  className?: string;
}

export const FormRow: React.FC<FormRowProps> = ({
  label,
  children,
  error,
  helper,
  tooltip,
  required,
  className = "",
}) => {
  const [showTooltip, setShowTooltip] = React.useState(false);

  return (
    <div className={`space-y-md ${className}`}>
      <div className="flex items-center gap-sm">
        <label className="text-sm font-medium text-text">
          {label}
          {required && <span className="text-error ml-1">*</span>}
        </label>

        {tooltip && (
          <div className="relative">
            <button
              type="button"
              className="text-text-tertiary hover:text-text-secondary"
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </button>

            {showTooltip && (
              <div className="absolute bottom-full left-0 mb-md px-md py-sm bg-surface border border-border rounded-sm shadow-md z-10 whitespace-nowrap text-xs text-text-secondary">
                {tooltip}
              </div>
            )}
          </div>
        )}
      </div>

      <div>{children}</div>

      {error && <p className="text-xs text-error font-medium">{error}</p>}

      {helper && !error && (
        <p className="text-xs text-text-tertiary">{helper}</p>
      )}
    </div>
  );
};
