import {
  Button,
  Flex,
  Grid,
  IconButton,
  Select,
  Switch,
  Text,
  TextField,
} from "@radix-ui/themes";
import {
  IconPlug,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSettings } from "../../../hooks/useSettings";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { HistoryLimit } from "../HistoryLimit";
import { ModelUnloadTimeoutSetting } from "../ModelUnloadTimeout";
import { RecordingRetentionPeriodSelector } from "../RecordingRetentionPeriod";
import { TranslateToEnglish } from "../TranslateToEnglish";
import { DebugLogChannels } from "../debug/DebugLogChannels";
import { LogDirectory } from "../debug/LogDirectory";
import { LogLevelSelector } from "../debug/LogLevelSelector";
import { OfflineVadRealtimeInterval } from "../debug/OfflineVadRealtimeInterval";
import { OfflineVadRealtimeWindow } from "../debug/OfflineVadRealtimeWindow";
import { WordCorrectionThreshold } from "../debug/WordCorrectionThreshold";

const PROXY_PROTOCOLS = ["http", "https", "socks5", "socks5h"] as const;
type ProxyProtocol = (typeof PROXY_PROTOCOLS)[number];

interface ProxyParts {
  protocol: ProxyProtocol;
  host: string;
  port: string;
  username: string;
  password: string;
}

function parseProxyUrl(url: string): ProxyParts {
  const defaults: ProxyParts = {
    protocol: "http",
    host: "",
    port: "",
    username: "",
    password: "",
  };
  if (!url) return defaults;
  try {
    // Handle socks5:// etc by replacing with http:// for URL parsing
    const normalized = url.replace(/^(socks5h?|https?):\/\//, "http://");
    const protocolMatch = url.match(/^(socks5h?|https?):\/\//);
    const protocol = (protocolMatch?.[1] ?? "http") as ProxyProtocol;
    const parsed = new URL(normalized);
    return {
      protocol,
      host: parsed.hostname,
      port: parsed.port,
      username: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
    };
  } catch {
    return defaults;
  }
}

function buildProxyUrl(parts: ProxyParts): string {
  const { protocol, host, port, username, password } = parts;
  if (!host) return "";
  const auth =
    username && password
      ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
      : username
        ? `${encodeURIComponent(username)}@`
        : "";
  const portPart = port ? `:${port}` : "";
  return `${protocol}://${auth}${host}${portPart}`;
}

export const AdvancedSettings: React.FC = () => {
  const { t } = useTranslation();
  const { expertMode, settings, setProxySettings } = useSettings();

  const savedUrl = settings?.proxy_url ?? "";
  const initialParts = useMemo(() => parseProxyUrl(savedUrl), [savedUrl]);
  const [proxyParts, setProxyParts] = useState<ProxyParts>(initialParts);

  useEffect(() => {
    setProxyParts(parseProxyUrl(savedUrl));
  }, [savedUrl]);

  const hasProxy = !!savedUrl;
  const [showProxy, setShowProxy] = useState(hasProxy);
  const [proxyTesting, setProxyTesting] = useState(false);
  const [proxyTested, setProxyTested] = useState(false);

  const saveProxy = useCallback(() => {
    const url = buildProxyUrl(proxyParts);
    const globalEnabled = settings?.proxy_global_enabled ?? false;
    setProxySettings(url || null, globalEnabled);
  }, [proxyParts, settings?.proxy_global_enabled, setProxySettings]);

  const updatePart = <K extends keyof ProxyParts>(
    key: K,
    value: ProxyParts[K],
  ) => {
    setProxyParts((prev) => ({ ...prev, [key]: value }));
  };

  const proxyGlobalEnabled = settings?.proxy_global_enabled ?? false;

  return (
    <Flex direction="column" className="max-w-5xl w-full mx-auto space-y-8">
      {/* Transcription Optimization - Expert only */}
      {expertMode && (
        <SettingsGroup
          title={t("settings.advanced.groups.transcriptionOptimization")}
        >
          <TranslateToEnglish descriptionMode="inline" grouped={true} />
          <ModelUnloadTimeoutSetting descriptionMode="inline" grouped={true} />
        </SettingsGroup>
      )}

      {/* Data Management - Expert only */}
      {expertMode && (
        <SettingsGroup title={t("settings.advanced.groups.dataManagement")}>
          <HistoryLimit descriptionMode="inline" grouped={true} />
          <RecordingRetentionPeriodSelector
            descriptionMode="inline"
            grouped={true}
          />
        </SettingsGroup>
      )}

      {/* Network / Proxy - temporarily hidden */}
      {false && (
      <SettingsGroup
        title={t("settings.advanced.groups.network", "Network")}
        noContent={!hasProxy && !showProxy}
        actions={
          !hasProxy &&
          !showProxy && (
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              onClick={() => setShowProxy(true)}
              className="cursor-pointer"
              title={t("settings.advanced.proxy.add")}
            >
              <IconPlus  />
            </IconButton>
          )
        }
      >
        {(hasProxy || showProxy) && (
          <Flex direction="column" gap="4" p="2">
            <Grid
              columns="auto 1fr"
              gapX="4"
              gapY="2"
              align="center"
              className="max-w-lg"
            >
              {/* Protocol + Host */}
              <Text
                size="2"
                weight="medium"
                color="gray"
                className="text-right"
              >
                {t("settings.advanced.proxy.server", "Server")}:
              </Text>
              <Flex gap="2" align="center">
                <Select.Root
                  value={proxyParts.protocol}
                  onValueChange={(v) =>
                    updatePart("protocol", v as ProxyProtocol)
                  }
                >
                  <Select.Trigger
                    variant="surface"
                    className="w-[110px] shrink-0"
                  />
                  <Select.Content>
                    {PROXY_PROTOCOLS.map((p) => (
                      <Select.Item key={p} value={p}>
                        {p.toUpperCase()}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
                <TextField.Root
                  value={proxyParts.host}
                  onChange={(e) => updatePart("host", e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveProxy();
                  }}
                  placeholder="127.0.0.1"
                  className="flex-1"
                />
                <Text size="2" color="gray">
                  :
                </Text>
                <TextField.Root
                  value={proxyParts.port}
                  onChange={(e) =>
                    updatePart("port", e.target.value.replace(/\D/g, ""))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveProxy();
                  }}
                  placeholder="7890"
                  className="w-20 shrink-0"
                />
              </Flex>

              {/* Username */}
              <Text
                size="2"
                weight="medium"
                color="gray"
                className="text-right"
              >
                {t("settings.advanced.proxy.username", "Username")}:
              </Text>
              <TextField.Root
                value={proxyParts.username}
                onChange={(e) => updatePart("username", e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveProxy();
                }}
                placeholder={t(
                  "settings.advanced.proxy.usernamePlaceholder",
                  "Optional",
                )}
              />

              {/* Password */}
              <Text
                size="2"
                weight="medium"
                color="gray"
                className="text-right"
              >
                {t("settings.advanced.proxy.password", "Password")}:
              </Text>
              <TextField.Root
                type="password"
                value={proxyParts.password}
                onChange={(e) => updatePart("password", e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveProxy();
                }}
                placeholder={t(
                  "settings.advanced.proxy.passwordPlaceholder",
                  "Optional",
                )}
              />

              {/* Enable globally */}
              <Text
                size="2"
                weight="medium"
                color="gray"
                className="text-right"
              >
                {t("settings.advanced.proxy.enable", "Enable")}:
              </Text>
              <Flex align="center" gap="2" className="h-8">
                <Switch
                  size="1"
                  checked={settings?.proxy_global_enabled ?? false}
                  onCheckedChange={(checked: boolean) =>
                    setProxySettings(settings?.proxy_url ?? null, checked)
                  }
                />
                <Text size="1" color="gray" className="opacity-60">
                  {t(
                    "settings.advanced.proxy.globalHint",
                    "Apply to all providers by default",
                  )}
                </Text>
              </Flex>

              {/* Preview */}
              {proxyParts.host && (
                <>
                  <Text
                    size="2"
                    weight="medium"
                    color="gray"
                    className="text-right"
                  >
                    URL:
                  </Text>
                  <Text
                    size="1"
                    className="text-(--gray-9) truncate font-mono"
                    title={buildProxyUrl(proxyParts)}
                  >
                    {buildProxyUrl(proxyParts)}
                  </Text>
                </>
              )}
            </Grid>

            {/* Test & Save / Remove */}
            <Flex align="center" gap="3">
              <Button
                variant="soft"
                size="2"
                disabled={!proxyParts.host || proxyTesting}
                onClick={async () => {
                  setProxyTesting(true);
                  setProxyTested(false);
                  const url = buildProxyUrl(proxyParts);
                  try {
                    // Save first so backend can use it
                    await setProxySettings(
                      url || null,
                      settings?.proxy_global_enabled ?? false,
                    );
                    // Test by fetching a known URL through the proxy
                    const { invoke } = await import(
                      "@tauri-apps/api/core"
                    );
                    await invoke("test_proxy_connection", {
                      proxyUrl: url,
                    });
                    setProxyTested(true);
                    toast.success(
                      t(
                        "settings.advanced.proxy.testSuccess",
                        "Proxy connection successful",
                      ),
                    );
                  } catch (e) {
                    toast.error(
                      t(
                        "settings.advanced.proxy.testFailed",
                        "Proxy connection failed: {{error}}",
                        { error: String(e) },
                      ),
                    );
                  } finally {
                    setProxyTesting(false);
                  }
                }}
              >
                <IconPlug size={14} />
                {proxyTesting
                  ? t("common.loading", "Testing...")
                  : t(
                      "settings.advanced.proxy.testAndSave",
                      "Test & Save",
                    )}
              </Button>
              <Button
                variant="ghost"
                size="2"
                color="red"
                onClick={() => {
                  setProxyParts({
                    protocol: "http",
                    host: "",
                    port: "",
                    username: "",
                    password: "",
                  });
                  setProxySettings(null, false);
                  setShowProxy(false);
                  setProxyTested(false);
                  toast.success(
                    t(
                      "settings.advanced.proxy.removed",
                      "Proxy removed",
                    ),
                  );
                }}
              >
                <IconTrash size={14} />
                {t("settings.advanced.proxy.remove", "Remove")}
              </Button>
            </Flex>
          </Flex>
        )}
      </SettingsGroup>
      )}

      {/* Debug Options - Expert only */}
      {expertMode && (
        <SettingsGroup title={t("settings.advanced.groups.debug")}>
          <LogDirectory descriptionMode="inline" grouped={true} />
          <LogLevelSelector descriptionMode="inline" grouped={true} />
          <WordCorrectionThreshold descriptionMode="inline" grouped={true} />
          <OfflineVadRealtimeInterval descriptionMode="inline" grouped={true} />
          <OfflineVadRealtimeWindow descriptionMode="inline" grouped={true} />
          <DebugLogChannels />
        </SettingsGroup>
      )}
    </Flex>
  );
};
