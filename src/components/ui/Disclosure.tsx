import React, { Fragment } from "react";
import {
  Disclosure as HeadlessDisclosure,
  Transition,
} from "@headlessui/react";
import { ChevronDownIcon } from "lucide-react";

interface DisclosureProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  badge?: React.ReactNode;
}

export const Disclosure: React.FC<DisclosureProps> = ({
  title,
  description,
  children,
  defaultOpen = false,
  icon: Icon,
  badge,
}) => {
  return (
    <HeadlessDisclosure defaultOpen={defaultOpen}>
      {({ open }) => (
        <div className="rounded-lg border border-mid-gray/20 overflow-hidden transition-colors hover:border-mid-gray/40">
          <HeadlessDisclosure.Button className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-mid-gray/5 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary focus-visible:ring-inset">
            <div className="flex items-center gap-3 flex-1">
              {Icon && (
                <Icon className="w-5 h-5 text-logo-primary flex-shrink-0" />
              )}
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-text">{title}</h3>
                {description && (
                  <p className="text-xs text-mid-gray mt-1">{description}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 ml-4 flex-shrink-0">
              {badge && <div>{badge}</div>}
              <ChevronDownIcon
                className={`w-5 h-5 transition-transform duration-200 ${
                  open ? "rotate-180" : ""
                }`}
              />
            </div>
          </HeadlessDisclosure.Button>

          <Transition
            as={Fragment}
            enter="transition ease-out duration-200"
            enterFrom="opacity-0 -translate-y-1"
            enterTo="opacity-100 translate-y-0"
            leave="transition ease-in duration-150"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 -translate-y-1"
          >
            <HeadlessDisclosure.Panel className="px-4 py-3 border-t border-mid-gray/20 bg-mid-gray/5">
              {children}
            </HeadlessDisclosure.Panel>
          </Transition>
        </div>
      )}
    </HeadlessDisclosure>
  );
};
