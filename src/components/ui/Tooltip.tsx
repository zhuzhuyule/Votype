import React from "react";
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from "@headlessui/react";
import { Fragment } from "react";

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  position?: "top" | "bottom" | "left" | "right";
  className?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  position = "top",
  className = "",
}) => {
  const positionClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  return (
    <Popover className="relative inline-block">
      {({ open }) => (
        <>
          <PopoverButton
            as="div"
            className="cursor-help focus:outline-none"
            onMouseEnter={(e: React.MouseEvent) => {
              const button = e.currentTarget;
              setTimeout(() => {
                if (button.matches(":hover")) {
                  button.click();
                }
              }, 500);
            }}
            onMouseLeave={(e: React.MouseEvent) => {
              if (open) {
                e.currentTarget.click();
              }
            }}
          >
            {children}
          </PopoverButton>
          <Transition
            as={Fragment}
            show={open}
            enter="transition duration-200 ease-out"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="transition duration-150 ease-in"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <PopoverPanel
              className={`absolute z-50 ${positionClasses[position]} ${className}`}
            >
              <div className="bg-background border border-mid-gray/30 rounded-md shadow-lg px-3 py-2 text-sm text-text max-w-xs">
                {content}
              </div>
            </PopoverPanel>
          </Transition>
        </>
      )}
    </Popover>
  );
};
