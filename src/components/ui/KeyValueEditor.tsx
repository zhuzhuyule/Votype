import {
  Button,
  Flex,
  IconButton,
  Select,
  Switch,
  TextArea,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import { IconPlus, IconX } from "@tabler/icons-react";
import React, { useCallback, useImperativeHandle } from "react";

type ValueType = "text" | "number" | "bool" | "json";

interface KVEntry {
  key: string;
  value: string;
  type: ValueType;
}

export interface QuickAction {
  label: string;
  icon?: React.ReactNode;
  getEntries: () => Record<string, unknown>;
  color?: "gray" | "blue" | "green" | "red" | "orange";
}

export interface KeyValueEditorHandle {
  addEntry: () => void;
}

interface KeyValueEditorProps {
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  /** Label for the empty-state add button, e.g. "添加 Body 参数" */
  addLabel?: string;
  /** Tooltip for the add button */
  addTooltip?: string;
  quickActions?: QuickAction[];
  addRef?: React.Ref<KeyValueEditorHandle>;
  /** Called when entry count changes (so parent can show/hide inline [+]) */
  onEntryCountChange?: (count: number) => void;
}

function tryFixJson(input: string): string {
  let s = input.trim();
  s = s.replace(/'/g, '"');
  s = s.replace(/,\s*([}\]])/g, "$1");
  return s;
}

function detectType(value: unknown): ValueType {
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return "number";
  if (typeof value === "object" && value !== null) return "json";
  return "text";
}

function parseValue(raw: string, type: ValueType): unknown {
  switch (type) {
    case "bool":
      return raw === "true" || raw === "1";
    case "number": {
      const n = Number(raw);
      return isNaN(n) ? 0 : n;
    }
    case "json": {
      try {
        return JSON.parse(raw);
      } catch {
        try {
          return JSON.parse(tryFixJson(raw));
        } catch {
          return raw;
        }
      }
    }
    default:
      return raw;
  }
}

function serializeValue(value: unknown, type: ValueType): string {
  if (type === "json" && typeof value === "object" && value !== null) {
    return JSON.stringify(value, null, 2);
  }
  return String(value ?? "");
}

function objectToEntries(obj: Record<string, unknown>): KVEntry[] {
  return Object.entries(obj).map(([key, value]) => ({
    key,
    value: serializeValue(value, detectType(value)),
    type: detectType(value),
  }));
}

function entriesToObject(entries: KVEntry[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const entry of entries) {
    if (!entry.key.trim()) continue;
    result[entry.key.trim()] = parseValue(entry.value, entry.type);
  }
  return result;
}

const TYPE_LABELS: Record<ValueType, string> = {
  text: "Text",
  number: "Num",
  bool: "Bool",
  json: "JSON",
};

export const KeyValueEditor: React.FC<KeyValueEditorProps> = ({
  value,
  onChange,
  addLabel,
  addTooltip,
  quickActions,
  addRef,
  onEntryCountChange,
}) => {
  const [entries, setEntries] = React.useState<KVEntry[]>(() =>
    Object.keys(value).length > 0 ? objectToEntries(value) : [],
  );

  const setEntriesAndNotify = useCallback(
    (newEntries: KVEntry[]) => {
      setEntries(newEntries);
      onEntryCountChange?.(newEntries.length);
    },
    [onEntryCountChange],
  );

  const commit = useCallback(
    (newEntries: KVEntry[]) => {
      setEntriesAndNotify(newEntries);
      onChange(entriesToObject(newEntries));
    },
    [onChange, setEntriesAndNotify],
  );

  const addEntry = useCallback(() => {
    const newEntries = [
      ...entries,
      { key: "", value: "", type: "text" as ValueType },
    ];
    // Only setEntries (don't commit) — empty key would be filtered out
    setEntriesAndNotify(newEntries);
  }, [entries, setEntriesAndNotify]);

  useImperativeHandle(addRef, () => ({ addEntry }), [addEntry]);

  const removeEntry = useCallback(
    (index: number) => {
      const newEntries = entries.filter((_, i) => i !== index);
      commit(newEntries);
    },
    [entries, commit],
  );

  const updateEntry = useCallback(
    (index: number, field: Partial<KVEntry>) => {
      const updated = entries.map((e, i) => {
        if (i !== index) return e;
        const newEntry = { ...e, ...field };
        if (field.value !== undefined && !field.type) {
          const v = field.value.trim();
          if (v === "true" || v === "false") newEntry.type = "bool";
          else if (/^-?\d+(\.\d+)?$/.test(v)) newEntry.type = "number";
          else if (v.startsWith("{") || v.startsWith("["))
            newEntry.type = "json";
        }
        return newEntry;
      });
      commit(updated);
    },
    [entries, commit],
  );

  const mergeEntries = useCallback(
    (newObj: Record<string, unknown>) => {
      const newKVs = objectToEntries(newObj);
      const result = [...entries];
      for (const ne of newKVs) {
        const idx = result.findIndex((e) => e.key.trim() === ne.key.trim());
        if (idx >= 0) {
          result[idx] = ne;
        } else {
          result.push(ne);
        }
      }
      commit(result);
    },
    [entries, commit],
  );

  // Empty state: dashed box with all actions inside
  if (entries.length === 0) {
    return (
      <Flex
        align="center"
        justify="center"
        gap="2"
        py="3px"
        style={{
          border: "1px dashed var(--gray-7)",
          borderRadius: "var(--radius-2)",
          fontSize: "var(--font-size-1)",
        }}
      >
        <Flex
          align="center"
          gap="1"
          onClick={addEntry}
          style={{ cursor: "pointer", color: "var(--gray-9)" }}
        >
          <IconPlus size={12} />
          {addLabel || "添加参数"}
        </Flex>
        {quickActions?.map((action, i) => (
          <Button
            key={i}
            size="1"
            variant="soft"
            color={action.color || "blue"}
            onClick={() => mergeEntries(action.getEntries())}
          >
            {action.icon}
            {action.label}
          </Button>
        ))}
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="2">
      {entries.map((entry, i) => (
        <Flex
          key={i}
          gap="2"
          align={entry.type === "json" ? "start" : "center"}
        >
          <TextField.Root
            size="1"
            value={entry.key}
            onChange={(e) => updateEntry(i, { key: e.target.value })}
            placeholder="Key"
            className="font-mono text-xs flex-shrink-0"
            style={{ width: 130 }}
          />
          <Select.Root
            size="1"
            value={entry.type}
            onValueChange={(v) => {
              const newType = v as ValueType;
              let newValue = entry.value;
              if (newType === "bool") newValue = "false";
              else if (newType === "number" && isNaN(Number(entry.value)))
                newValue = "0";
              updateEntry(i, { type: newType, value: newValue });
            }}
          >
            <Select.Trigger style={{ width: 68, flexShrink: 0 }} />
            <Select.Content>
              {(Object.keys(TYPE_LABELS) as ValueType[]).map((t) => (
                <Select.Item key={t} value={t}>
                  {TYPE_LABELS[t]}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          {entry.type === "bool" ? (
            <Flex align="center" className="flex-1">
              <Switch
                size="1"
                checked={entry.value === "true"}
                onCheckedChange={(checked) =>
                  updateEntry(i, { value: checked ? "true" : "false" })
                }
              />
            </Flex>
          ) : entry.type === "json" ? (
            <TextArea
              size="1"
              value={entry.value}
              onChange={(e) => updateEntry(i, { value: e.target.value })}
              placeholder="Value"
              className="font-mono text-xs flex-1"
              rows={2}
              style={{ resize: "vertical", minHeight: 48 }}
            />
          ) : (
            <TextField.Root
              size="1"
              value={entry.value}
              onChange={(e) => updateEntry(i, { value: e.target.value })}
              placeholder="Value"
              className="font-mono text-xs flex-1"
              type={entry.type === "number" ? "number" : "text"}
            />
          )}
          <Tooltip content="删除">
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              onClick={() => removeEntry(i)}
              style={{ flexShrink: 0 }}
            >
              <IconX size={14} />
            </IconButton>
          </Tooltip>
        </Flex>
      ))}
      {quickActions && quickActions.length > 0 && (
        <Flex gap="2" wrap="wrap" align="center">
          {quickActions.map((action, i) => (
            <Button
              key={i}
              size="1"
              variant="soft"
              color={action.color || "blue"}
              onClick={() => mergeEntries(action.getEntries())}
            >
              {action.icon}
              {action.label}
            </Button>
          ))}
        </Flex>
      )}
    </Flex>
  );
};
