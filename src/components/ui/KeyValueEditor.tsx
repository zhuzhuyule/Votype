import React, { useCallback } from "react";
import {
  Button,
  Flex,
  IconButton,
  Select,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { IconPlus, IconX } from "@tabler/icons-react";

type ValueType = "text" | "number" | "bool" | "json";

interface KVEntry {
  key: string;
  value: string;
  type: ValueType;
}

interface KeyValueEditorProps {
  /** Current entries as a flat JSON object */
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  placeholder?: string;
}

/** Try to auto-fix loose JSON: single quotes → double quotes, trailing commas, unquoted keys */
function tryFixJson(input: string): string {
  let s = input.trim();
  // Single quotes → double quotes (naive but useful)
  s = s.replace(/'/g, '"');
  // Trailing commas before } or ]
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
          return raw; // fallback to string
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

export const KeyValueEditor: React.FC<KeyValueEditorProps> = ({
  value,
  onChange,
  placeholder,
}) => {
  const [entries, setEntries] = React.useState<KVEntry[]>(() =>
    Object.keys(value).length > 0 ? objectToEntries(value) : [],
  );

  // Sync entries back to parent
  const commitChanges = useCallback(
    (newEntries: KVEntry[]) => {
      setEntries(newEntries);
      onChange(entriesToObject(newEntries));
    },
    [onChange],
  );

  const addEntry = useCallback(() => {
    commitChanges([...entries, { key: "", value: "", type: "text" }]);
  }, [entries, commitChanges]);

  const removeEntry = useCallback(
    (index: number) => {
      commitChanges(entries.filter((_, i) => i !== index));
    },
    [entries, commitChanges],
  );

  const updateEntry = useCallback(
    (index: number, field: Partial<KVEntry>) => {
      const updated = entries.map((e, i) => {
        if (i !== index) return e;
        const newEntry = { ...e, ...field };
        // Auto-detect type when value changes and type wasn't explicitly set
        if (field.value !== undefined && !field.type) {
          const v = field.value.trim();
          if (v === "true" || v === "false") newEntry.type = "bool";
          else if (/^-?\d+(\.\d+)?$/.test(v)) newEntry.type = "number";
          else if (v.startsWith("{") || v.startsWith("[")) newEntry.type = "json";
        }
        return newEntry;
      });
      commitChanges(updated);
    },
    [entries, commitChanges],
  );

  return (
    <Flex direction="column" gap="2">
      {entries.map((entry, i) => (
        <Flex key={i} gap="2" align="start">
          <TextField.Root
            size="1"
            value={entry.key}
            onChange={(e) => updateEntry(i, { key: e.target.value })}
            placeholder="key"
            className="font-mono text-xs flex-shrink-0"
            style={{ width: 140 }}
          />
          {entry.type === "bool" ? (
            <Flex align="center" className="flex-1" style={{ minHeight: 28 }}>
              <Select.Root
                size="1"
                value={entry.value === "true" ? "true" : "false"}
                onValueChange={(v) => updateEntry(i, { value: v })}
              >
                <Select.Trigger className="flex-1" />
                <Select.Content>
                  <Select.Item value="true">true</Select.Item>
                  <Select.Item value="false">false</Select.Item>
                </Select.Content>
              </Select.Root>
            </Flex>
          ) : entry.type === "json" ? (
            <TextArea
              size="1"
              value={entry.value}
              onChange={(e) => updateEntry(i, { value: e.target.value })}
              placeholder='{"key": "value"}'
              className="font-mono text-xs flex-1"
              rows={2}
            />
          ) : (
            <TextField.Root
              size="1"
              value={entry.value}
              onChange={(e) => updateEntry(i, { value: e.target.value })}
              placeholder="value"
              className="font-mono text-xs flex-1"
              type={entry.type === "number" ? "number" : "text"}
            />
          )}
          <Select.Root
            size="1"
            value={entry.type}
            onValueChange={(v) => {
              const newType = v as ValueType;
              // Convert value when type changes
              let newValue = entry.value;
              if (newType === "bool") newValue = "false";
              else if (newType === "number" && isNaN(Number(entry.value)))
                newValue = "0";
              updateEntry(i, { type: newType, value: newValue });
            }}
          >
            <Select.Trigger style={{ width: 70, flexShrink: 0 }} />
            <Select.Content>
              <Select.Item value="text">text</Select.Item>
              <Select.Item value="number">num</Select.Item>
              <Select.Item value="bool">bool</Select.Item>
              <Select.Item value="json">json</Select.Item>
            </Select.Content>
          </Select.Root>
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            onClick={() => removeEntry(i)}
          >
            <IconX size={14} />
          </IconButton>
        </Flex>
      ))}
      <Button size="1" variant="soft" onClick={addEntry} className="self-start">
        <IconPlus size={12} />
        {placeholder || "Add parameter"}
      </Button>
    </Flex>
  );
};
