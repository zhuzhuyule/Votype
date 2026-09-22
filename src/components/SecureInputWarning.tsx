import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  IconAlertTriangle,
  IconExternalLink,
  IconX,
} from "@tabler/icons-react";

// Detailed remediation steps live in the docs rather than in the banner
export const SECURE_INPUT_HELP_URL =
  "https://handy.computer/docs/troubleshooting#shortcuts-stopped-working-on-macos-secure-input";

interface SecureInputStatus {
  enabled: boolean;
  sustained: boolean;
  culprit_pid: number | null;
  culprit_name: string | null;
  fallback_active: boolean;
  covered_bindings: string[];
  degraded_bindings: string[];
  uncovered_bindings: string[];
  recorder_blocked: boolean;
}

/**
 * Compact warning banner shown while macOS Secure Input is stuck on.
 *
 * Secure Input blocks key events from reaching the handy-keys keyboard
 * listener, so keyed shortcuts silently stop firing. The backend monitor
 * emits `secure-input-changed` on state transitions; `sustained` filters
 * out the normal momentary activation from focusing a password field.
 */
const SecureInputWarning: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SecureInputStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await invoke<SecureInputStatus>("get_secure_input_status"));
    } catch (e) {
      console.warn("Failed to fetch secure input status:", e);
    }
  }, []);

  useEffect(() => {
    refresh();
    const unlisten = listen<SecureInputStatus>(
      "secure-input-changed",
      (event) => setStatus(event.payload),
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refresh]);

  // Only warn when the user is actually impacted: a binding is degraded
  // (side-specific matching widened) or dead (e.g. fn+key), or they ran into
  // the blocked shortcut recorder. When the Carbon fallback covers everything
  // transparently — and nothing else surfaced — stay silent.
  const impacted =
    status !== null &&
    ((status.sustained &&
      (status.degraded_bindings.length > 0 ||
        status.uncovered_bindings.length > 0)) ||
      status.recorder_blocked);

  // A dismissal lasts for the current episode only: once the condition
  // clears, the next occurrence warns again. The tray badge is the
  // persistent indicator and is not dismissible.
  useEffect(() => {
    if (!impacted) {
      setDismissed(false);
    }
  }, [impacted]);

  if (!impacted || dismissed) {
    return null;
  }

  const affectedCount = new Set([
    ...status.uncovered_bindings,
    ...status.degraded_bindings,
  ]).size;
  const countSuffix = affectedCount === 1 ? "one" : "other";
  const message =
    affectedCount > 0
      ? status.culprit_name !== null
        ? t(`secureInput.blockedWithCulprit_${countSuffix}`, {
            name: status.culprit_name,
            count: affectedCount,
          })
        : t(`secureInput.blockedNoCulprit_${countSuffix}`, {
            count: affectedCount,
          })
      : status.culprit_name !== null
        ? t("secureInput.recorderBlockedWithCulprit", {
            name: status.culprit_name,
          })
        : t("secureInput.recorderBlockedNoCulprit");

  return (
    <div className="w-full rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <IconAlertTriangle className="h-5 w-5 shrink-0 text-warning" />
        <p className="min-w-0 flex-1 text-sm font-medium leading-5">
          {message}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => openUrl(SECURE_INPUT_HELP_URL)}
            className="cursor-pointer whitespace-nowrap rounded px-2 py-1.5 text-sm font-medium text-text hover:text-warning focus:outline-none focus:ring-1 focus:ring-warning"
          >
            <span className="flex items-center gap-1 border-b border-current leading-4">
              {t("secureInput.learnMore")}
              <IconExternalLink className="h-3.5 w-3.5" />
            </span>
          </button>
          <button
            onClick={() => setDismissed(true)}
            aria-label={t("secureInput.dismiss")}
            className="cursor-pointer rounded p-1.5 text-mid-gray hover:bg-warning/15 hover:text-warning focus:outline-none focus:ring-1 focus:ring-warning"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default SecureInputWarning;
