import React from "react";
import { Transition } from "@headlessui/react";

interface FadeTransitionProps {
  show: boolean;
  children: React.ReactNode;
  className?: string;
  appear?: boolean;
  duration?: "fast" | "normal" | "slow";
}

export const FadeTransition: React.FC<FadeTransitionProps> = ({
  show,
  children,
  className = "",
  appear = true,
  duration = "normal",
}) => {
  const durationClasses = {
    fast: "duration-150",
    normal: "duration-200",
    slow: "duration-300",
  };

  return (
    <Transition
      show={show}
      appear={appear}
      enter={`transition-opacity ease-out ${durationClasses[duration]}`}
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave={`transition-opacity ease-in ${durationClasses[duration]}`}
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
    >
      <div className={className}>{children}</div>
    </Transition>
  );
};

interface SlideTransitionProps {
  show: boolean;
  children: React.ReactNode;
  direction?: "up" | "down" | "left" | "right";
  className?: string;
  appear?: boolean;
  duration?: "fast" | "normal" | "slow";
}

export const SlideTransition: React.FC<SlideTransitionProps> = ({
  show,
  children,
  direction = "down",
  className = "",
  appear = true,
  duration = "normal",
}) => {
  const durationClasses = {
    fast: "duration-150",
    normal: "duration-200",
    slow: "duration-300",
  };

  const directionClasses = {
    up: {
      enterFrom: "translate-y-2 opacity-0",
      enterTo: "translate-y-0 opacity-100",
      leaveFrom: "translate-y-0 opacity-100",
      leaveTo: "translate-y-2 opacity-0",
    },
    down: {
      enterFrom: "-translate-y-2 opacity-0",
      enterTo: "translate-y-0 opacity-100",
      leaveFrom: "translate-y-0 opacity-100",
      leaveTo: "-translate-y-2 opacity-0",
    },
    left: {
      enterFrom: "translate-x-2 opacity-0",
      enterTo: "translate-x-0 opacity-100",
      leaveFrom: "translate-x-0 opacity-100",
      leaveTo: "translate-x-2 opacity-0",
    },
    right: {
      enterFrom: "-translate-x-2 opacity-0",
      enterTo: "translate-x-0 opacity-100",
      leaveFrom: "translate-x-0 opacity-100",
      leaveTo: "-translate-x-2 opacity-0",
    },
  };

  const classes = directionClasses[direction];

  return (
    <Transition
      show={show}
      appear={appear}
      enter={`transition-all ease-out ${durationClasses[duration]}`}
      enterFrom={classes.enterFrom}
      enterTo={classes.enterTo}
      leave={`transition-all ease-in ${durationClasses[duration]}`}
      leaveFrom={classes.leaveFrom}
      leaveTo={classes.leaveTo}
    >
      <div className={className}>{children}</div>
    </Transition>
  );
};

interface ScaleTransitionProps {
  show: boolean;
  children: React.ReactNode;
  origin?: "center" | "top" | "bottom" | "left" | "right";
  className?: string;
  appear?: boolean;
  duration?: "fast" | "normal" | "slow";
}

export const ScaleTransition: React.FC<ScaleTransitionProps> = ({
  show,
  children,
  origin = "center",
  className = "",
  appear = true,
  duration = "normal",
}) => {
  const durationClasses = {
    fast: "duration-150",
    normal: "duration-200",
    slow: "duration-300",
  };

  const originClasses = {
    center: "origin-center",
    top: "origin-top",
    bottom: "origin-bottom",
    left: "origin-left",
    right: "origin-right",
  };

  return (
    <Transition
      show={show}
      appear={appear}
      enter={`transition-all ease-out ${durationClasses[duration]} ${originClasses[origin]}`}
      enterFrom="scale-95 opacity-0"
      enterTo="scale-100 opacity-100"
      leave={`transition-all ease-in ${durationClasses[duration]} ${originClasses[origin]}`}
      leaveFrom="scale-100 opacity-100"
      leaveTo="scale-95 opacity-0"
    >
      <div className={className}>{children}</div>
    </Transition>
  );
};
