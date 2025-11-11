import React, { Fragment } from "react";
import {
  Popover as HeadlessPopover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from "@headlessui/react";

interface PopoverProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  panelClassName?: string;
}

export const Popover: React.FC<PopoverProps> = ({
  trigger,
  children,
  className = "",
  panelClassName = "",
}) => {
  return (
    <HeadlessPopover className={`relative ${className}`}>
      <PopoverButton className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md bg-mid-gray/10 border border-mid-gray/80 hover:bg-mid-gray/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary transition-colors duration-150">
        {trigger}
      </PopoverButton>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-200"
        enterFrom="opacity-0 translate-y-1"
        enterTo="opacity-100 translate-y-0"
        leave="transition ease-in duration-150"
        leaveFrom="opacity-100 translate-y-0"
        leaveTo="opacity-0 translate-y-1"
      >
        <PopoverPanel
          className={`absolute z-50 mt-2 w-screen max-w-sm px-4 sm:px-0 lg:max-w-md rounded-lg shadow-lg bg-background border border-mid-gray/80 p-4 ${panelClassName}`}
        >
          {children}
        </PopoverPanel>
      </Transition>
    </HeadlessPopover>
  );
};
