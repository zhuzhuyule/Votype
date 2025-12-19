type StyleObject = Record<string, any>;

let sheet: CSSStyleSheet | null = null;
const cache = new Map<string, string>();
let idCounter = 0;

const unitlessProps = new Set([
  "zIndex",
  "opacity",
  "flex",
  "flexGrow",
  "flexShrink",
  "order",
  "lineHeight",
  "fontWeight",
  "zoom",
  "scale",
]);

function ensureSheet() {
  if (sheet) return sheet;
  const styleEl = document.createElement("style");
  styleEl.setAttribute("data-mini-sx", "true");
  document.head.appendChild(styleEl);
  sheet = styleEl.sheet as CSSStyleSheet;
  return sheet;
}

function genClassName() {
  idCounter += 1;
  return `sx-${idCounter}`;
}

function hyphenate(key: string) {
  return key.replace(/([A-Z])/g, "-$1").toLowerCase();
}

function valueToCss(prop: string, value: any) {
  if (value == null) return "";
  if (typeof value === "number") {
    if (unitlessProps.has(prop)) return String(value);
    return `${value}px`;
  }
  return String(value);
}

function objectToCss(obj: StyleObject) {
  return Object.entries(obj)
    .map(([k, v]) => `${hyphenate(k)}: ${valueToCss(k, v)};`)
    .join(" ");
}

/**
 * sx - 将 style object 转为 className，并将对应 CSS 插入到页面
 * @param styleObj - 支持基础属性和以 & 开头的嵌套选择器（例如 "&:hover", "& > :first-child"）
 * @returns 返回生成或复用的 className 字符串
 */
export function sx(styleObj: StyleObject): string {
  if (!styleObj || typeof styleObj !== "object") return "";

  // 用 JSON 字符串做 key（保证对象相同时复用）
  const key = JSON.stringify(styleObj);
  if (cache.has(key)) return cache.get(key)!;

  const className = genClassName();
  const sheetLocal = ensureSheet();

  const base: StyleObject = {};
  const nested: StyleObject = {};

  for (const k of Object.keys(styleObj)) {
    if (k.startsWith("&")) nested[k] = styleObj[k];
    else base[k] = styleObj[k];
  }

  // 插入基础样式
  const baseCss = objectToCss(base) || "";
  try {
    if (baseCss) {
      sheetLocal.insertRule(
        `.${className} { ${baseCss} }`,
        sheetLocal.cssRules.length,
      );
    } else {
      // 为了保证 class 存在（即便无基础样式），插入空规则
      sheetLocal.insertRule(`.${className} {}`, sheetLocal.cssRules.length);
    }
  } catch (e) {
    // 某些浏览器对 insertRule 的语法更敏感，降级到 appendText
    const styleEl = sheetLocal.ownerNode as HTMLStyleElement;
    styleEl.appendChild(
      document.createTextNode(`.${className} { ${baseCss} }`),
    );
  }

  // 插入嵌套选择器
  for (const sel of Object.keys(nested)) {
    const cssObj = nested[sel];
    // 支持传入字符串或对象
    const cssText = typeof cssObj === "string" ? cssObj : objectToCss(cssObj);
    const realSel = sel.replace(/&/g, `.${className}`);
    try {
      sheetLocal.insertRule(
        `${realSel} { ${cssText} }`,
        sheetLocal.cssRules.length,
      );
    } catch (e) {
      const styleEl = sheetLocal.ownerNode as HTMLStyleElement;
      styleEl.appendChild(document.createTextNode(`${realSel} { ${cssText} }`));
    }
  }

  cache.set(key, className);
  return className;
}

// utils/mergeClasses.ts
export function mergeClasses(
  ...parts: Array<string | undefined | null | false>
) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    const tokens = String(part).trim().split(/\s+/);
    for (const t of tokens) {
      if (!seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
  }
  return out.join(" ");
}
