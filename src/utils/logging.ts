import { invoke } from "@tauri-apps/api/core";

type LogLevel = "info" | "error" | "warn" | "debug" | "trace";

export const log = async (...args: any[]) => {
    try {
        const lastArg = args[args.length - 1];
        let level = 'info'
        if (typeof lastArg === "string" && ['info', 'error', 'warn', 'debug', 'trace'].includes(lastArg)) {
            level = args.shift() as LogLevel;
        }
        const message = args.map(item => typeof item === "object" ? JSON.stringify(item) : item).join(" ");
        await invoke("log_to_console", { msg: message, level });
    } catch (error) {
        // Fallback to frontend console if backend logging fails
        console.error("Failed to log to backend:", error);
    }
};
