import anthropicLogo from "@lobehub/icons-static-svg/icons/anthropic.svg";
import appleLogo from "@lobehub/icons-static-svg/icons/apple.svg";
import baichuanLogo from "@lobehub/icons-static-svg/icons/baichuan-color.svg";
import bailianLogo from "@lobehub/icons-static-svg/icons/bailian-color.svg";
import deepseekLogo from "@lobehub/icons-static-svg/icons/deepseek-color.svg";
import doubaoLogo from "@lobehub/icons-static-svg/icons/doubao-color.svg";
import fireworksLogo from "@lobehub/icons-static-svg/icons/fireworks-color.svg";
import geminiLogo from "@lobehub/icons-static-svg/icons/gemini-color.svg";
import giteeLogo from "@lobehub/icons-static-svg/icons/giteeai.svg";
import groqLogo from "@lobehub/icons-static-svg/icons/groq.svg";
import lmstudioLogo from "@lobehub/icons-static-svg/icons/lmstudio.svg";
import longcatLogo from "@lobehub/icons-static-svg/icons/longcat-color.svg";
import minimaxLogo from "@lobehub/icons-static-svg/icons/minimax-color.svg";
import moonshotLogo from "@lobehub/icons-static-svg/icons/moonshot.svg";
import ollamaLogo from "@lobehub/icons-static-svg/icons/ollama.svg";
import openaiLogo from "@lobehub/icons-static-svg/icons/openai.svg";
import openrouterLogo from "@lobehub/icons-static-svg/icons/openrouter.svg";
import perplexityLogo from "@lobehub/icons-static-svg/icons/perplexity-color.svg";
import qwenLogo from "@lobehub/icons-static-svg/icons/qwen-color.svg";
import siliconflowLogo from "@lobehub/icons-static-svg/icons/siliconcloud-color.svg";
import sparkLogo from "@lobehub/icons-static-svg/icons/spark-color.svg";
import stepfunLogo from "@lobehub/icons-static-svg/icons/stepfun-color.svg";
import togetherLogo from "@lobehub/icons-static-svg/icons/together-brand-color.svg";
import vllmLogo from "@lobehub/icons-static-svg/icons/vllm-color.svg";
import xaiLogo from "@lobehub/icons-static-svg/icons/xai.svg";
import xinferenceLogo from "@lobehub/icons-static-svg/icons/xinference-color.svg";
import zaiLogo from "@lobehub/icons-static-svg/icons/zai.svg";
import zhipuLogo from "@lobehub/icons-static-svg/icons/zhipu-color.svg";

export type ProviderIconCatalogEntry = {
  key: string;
  label: string;
  asset: string;
  domains: string[];
  keywords: string[];
};

export const PROVIDER_ICON_CATALOG: ProviderIconCatalogEntry[] = [
  {
    key: "openai",
    label: "OpenAI",
    asset: openaiLogo,
    domains: ["openai.com"],
    keywords: ["openai", "chatgpt", "gpt", "sora"],
  },
  {
    key: "openrouter",
    label: "OpenRouter",
    asset: openrouterLogo,
    domains: ["openrouter.ai"],
    keywords: ["openrouter"],
  },
  {
    key: "anthropic",
    label: "Anthropic",
    asset: anthropicLogo,
    domains: ["anthropic.com"],
    keywords: ["anthropic", "claude"],
  },
  {
    key: "apple_intelligence",
    label: "Apple Intelligence",
    asset: appleLogo,
    domains: ["apple.com"],
    keywords: ["apple", "intelligence", "siri"],
  },
  {
    key: "groq",
    label: "Groq",
    asset: groqLogo,
    domains: ["groq.com"],
    keywords: ["groq"],
  },
  {
    key: "xai",
    label: "xAI",
    asset: xaiLogo,
    domains: ["x.ai"],
    keywords: ["xai", "grok"],
  },
  {
    key: "gemini",
    label: "Gemini",
    asset: geminiLogo,
    domains: ["googleapis.com", "google.com"],
    keywords: ["gemini", "google"],
  },
  {
    key: "deepseek",
    label: "DeepSeek",
    asset: deepseekLogo,
    domains: ["deepseek.com"],
    keywords: ["deepseek"],
  },
  {
    key: "together",
    label: "Together AI",
    asset: togetherLogo,
    domains: ["together.xyz"],
    keywords: ["together"],
  },
  {
    key: "fireworks",
    label: "Fireworks AI",
    asset: fireworksLogo,
    domains: ["fireworks.ai"],
    keywords: ["fireworks"],
  },
  {
    key: "siliconflow",
    label: "SiliconFlow",
    asset: siliconflowLogo,
    domains: ["siliconflow.com"],
    keywords: ["siliconflow", "siliconcloud"],
  },
  {
    key: "zai",
    label: "Z.AI",
    asset: zaiLogo,
    domains: ["z.ai"],
    keywords: ["z.ai", "zai"],
  },
  {
    key: "zhipu",
    label: "BigModel",
    asset: zhipuLogo,
    domains: ["bigmodel.cn"],
    keywords: ["bigmodel", "zhipu", "chatglm"],
  },
  {
    key: "qwen",
    label: "Qwen",
    asset: qwenLogo,
    domains: ["aliyuncs.com", "dashscope.aliyun.com"],
    keywords: ["qwen", "dashscope", "tongyi", "aliyun"],
  },
  {
    key: "moonshot",
    label: "Moonshot",
    asset: moonshotLogo,
    domains: ["moonshot.cn", "moonshot.ai"],
    keywords: ["moonshot", "kimi"],
  },
  {
    key: "perplexity",
    label: "Perplexity",
    asset: perplexityLogo,
    domains: ["perplexity.ai"],
    keywords: ["perplexity"],
  },
  {
    key: "stepfun",
    label: "StepFun",
    asset: stepfunLogo,
    domains: ["stepfun.com"],
    keywords: ["stepfun", "step"],
  },
  {
    key: "doubao",
    label: "Doubao",
    asset: doubaoLogo,
    domains: ["volces.com", "doubao.com"],
    keywords: ["doubao", "ark", "volcengine", "bytedance"],
  },
  {
    key: "baichuan",
    label: "Baichuan",
    asset: baichuanLogo,
    domains: ["baichuan-ai.com"],
    keywords: ["baichuan"],
  },
  {
    key: "bailian",
    label: "Bailian",
    asset: bailianLogo,
    domains: ["aliyun.com"],
    keywords: ["bailian"],
  },
  {
    key: "gitee",
    label: "Gitee AI",
    asset: giteeLogo,
    domains: ["gitee.com"],
    keywords: ["gitee"],
  },
  {
    key: "minimax",
    label: "MiniMax",
    asset: minimaxLogo,
    domains: ["minimax.io", "minimaxi.com"],
    keywords: ["minimax"],
  },
  {
    key: "longcat",
    label: "LongCat",
    asset: longcatLogo,
    domains: ["longcat.ai"],
    keywords: ["longcat"],
  },
  {
    key: "xingchen",
    label: "讯飞星辰",
    asset: sparkLogo,
    domains: ["xfyun.cn"],
    keywords: ["星辰", "讯飞", "spark"],
  },
  {
    key: "ollama",
    label: "Ollama",
    asset: ollamaLogo,
    domains: ["ollama.com", "localhost"],
    keywords: ["ollama"],
  },
  {
    key: "lmstudio",
    label: "LM Studio",
    asset: lmstudioLogo,
    domains: ["lmstudio.ai", "localhost"],
    keywords: ["lmstudio", "lm studio"],
  },
  {
    key: "vllm",
    label: "vLLM",
    asset: vllmLogo,
    domains: ["localhost"],
    keywords: ["vllm"],
  },
  {
    key: "xinference",
    label: "Xinference",
    asset: xinferenceLogo,
    domains: ["localhost"],
    keywords: ["xinference"],
  },
];

const PROVIDER_ICON_ASSET_MAP = Object.fromEntries(
  PROVIDER_ICON_CATALOG.map((entry) => [entry.key, entry.asset]),
);

export const PROVIDER_BRAND_ASSETS: Record<string, string> = {
  ...PROVIDER_ICON_ASSET_MAP,
  gitee_free: giteeLogo,
};

export const resolveProviderIconAsset = (
  iconKey: string | null | undefined,
) => {
  if (!iconKey) return null;
  return PROVIDER_ICON_ASSET_MAP[iconKey] ?? null;
};

export const matchRecommendedProviderIconKeys = (params: {
  providerId: string;
  label: string;
  baseUrl: string;
}) => {
  const providerText = `${params.providerId} ${params.label} ${params.baseUrl}`
    .toLowerCase()
    .trim();

  let host = "";
  try {
    host = new URL(params.baseUrl).host.toLowerCase();
  } catch {
    host = params.baseUrl.toLowerCase();
  }

  return PROVIDER_ICON_CATALOG.map((entry) => {
    let score = 0;

    if (entry.key === params.providerId) {
      score += 100;
    }

    for (const domain of entry.domains) {
      if (host.includes(domain)) {
        score += 60;
      }
    }

    for (const keyword of entry.keywords) {
      if (providerText.includes(keyword.toLowerCase())) {
        score += 24;
      }
    }

    return { key: entry.key, score };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((entry) => entry.key);
};
