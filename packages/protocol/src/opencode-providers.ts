/**
 * @feature SET-10 OpenCode providers and their keys
 * Owns: the catalogue of providers OpenCode can use and the environment variable that holds each
 * provider's key.
 * Behaviour: Conductor's own table (the `opencode_provider_api_keys` list `_T` in the app bundle
 * main-BE1h_1MP.js at offset 335172, inventory label #45-136): 97 entries, one per key variable,
 * each with a label and the OpenCode provider ids that read it. ui-map.md 6 (OpenCode and Pi list
 * per-provider keys).
 * Must handle: one variable read by several providers is one entry (its id is Conductor's first
 * provider id, its label names them all), so a key is stored once; ids are unique; each call
 * returns a copy, so a caller cannot change the catalogue.
 * Our design choice: OpenCode and Pi share this list, because both read provider keys from the
 * environment the same way (SIDE-21).
 * The agent-provider table (agent-providers.ts) lists it as the ACP agents' config providers.
 * Test first: the catalogue holds Conductor's 97 entries, from 302.AI to Z.AI, in its order.
 */
import type { AgentProvider } from "./rpc.ts";

const PROVIDERS: readonly AgentProvider[] = [
	{ id: "302ai", label: "302.AI", keyEnvVars: ["302AI_API_KEY"] },
	{ id: "abacus", label: "Abacus", keyEnvVars: ["ABACUS_API_KEY"] },
	{ id: "abliteration-ai", label: "abliteration.ai", keyEnvVars: ["ABLIT_KEY"] },
	{ id: "vercel", label: "Vercel AI Gateway", keyEnvVars: ["AI_GATEWAY_API_KEY"] },
	{ id: "sap-ai-core", label: "SAP AI Core", keyEnvVars: ["AICORE_SERVICE_KEY"] },
	{ id: "aihubmix", label: "AIHubMix", keyEnvVars: ["AIHUBMIX_API_KEY"] },
	{
		id: "alibaba-coding-plan",
		label: "Alibaba Coding Plan / Alibaba Coding Plan (China)",
		keyEnvVars: ["ALIBABA_CODING_PLAN_API_KEY"],
	},
	{ id: "anthropic", label: "Anthropic", keyEnvVars: ["ANTHROPIC_API_KEY"] },
	{ id: "amazon-bedrock", label: "Amazon Bedrock", keyEnvVars: ["AWS_BEARER_TOKEN_BEDROCK"] },
	{ id: "bailing", label: "Bailing", keyEnvVars: ["BAILING_API_TOKEN"] },
	{ id: "baseten", label: "Baseten", keyEnvVars: ["BASETEN_API_KEY"] },
	{ id: "berget", label: "Berget.AI", keyEnvVars: ["BERGET_API_KEY"] },
	{ id: "cerebras", label: "Cerebras", keyEnvVars: ["CEREBRAS_API_KEY"] },
	{ id: "chutes", label: "Chutes", keyEnvVars: ["CHUTES_API_KEY"] },
	{ id: "clarifai", label: "Clarifai", keyEnvVars: ["CLARIFAI_PAT"] },
	{
		id: "cloudferro-sherlock",
		label: "CloudFerro Sherlock",
		keyEnvVars: ["CLOUDFERRO_SHERLOCK_API_KEY"],
	},
	{ id: "cohere", label: "Cohere", keyEnvVars: ["COHERE_API_KEY"] },
	{ id: "cortecs", label: "Cortecs", keyEnvVars: ["CORTECS_API_KEY"] },
	{ id: "alibaba", label: "Alibaba / Alibaba (China)", keyEnvVars: ["DASHSCOPE_API_KEY"] },
	{ id: "deepinfra", label: "Deep Infra", keyEnvVars: ["DEEPINFRA_API_KEY"] },
	{ id: "deepseek", label: "DeepSeek", keyEnvVars: ["DEEPSEEK_API_KEY"] },
	{ id: "digitalocean", label: "DigitalOcean", keyEnvVars: ["DIGITALOCEAN_ACCESS_TOKEN"] },
	{ id: "dinference", label: "DInference", keyEnvVars: ["DINFERENCE_API_KEY"] },
	{ id: "drun", label: "D.Run (China)", keyEnvVars: ["DRUN_API_KEY"] },
	{ id: "evroc", label: "evroc", keyEnvVars: ["EVROC_API_KEY"] },
	{ id: "fastrouter", label: "FastRouter", keyEnvVars: ["FASTROUTER_API_KEY"] },
	{ id: "firepass", label: "Fireworks (Firepass)", keyEnvVars: ["FIREPASS_API_KEY"] },
	{ id: "fireworks-ai", label: "Fireworks AI", keyEnvVars: ["FIREWORKS_API_KEY"] },
	{ id: "friendli", label: "Friendli", keyEnvVars: ["FRIENDLI_TOKEN"] },
	{ id: "frogbot", label: "FrogBot", keyEnvVars: ["FROGBOT_API_KEY"] },
	{ id: "github-copilot", label: "GitHub Copilot / GitHub Models", keyEnvVars: ["GITHUB_TOKEN"] },
	{ id: "gitlab", label: "GitLab Duo", keyEnvVars: ["GITLAB_TOKEN"] },
	{ id: "google", label: "Google", keyEnvVars: ["GOOGLE_API_KEY"] },
	{ id: "groq", label: "Groq", keyEnvVars: ["GROQ_API_KEY"] },
	{ id: "helicone", label: "Helicone", keyEnvVars: ["HELICONE_API_KEY"] },
	{ id: "huggingface", label: "Hugging Face", keyEnvVars: ["HF_TOKEN"] },
	{ id: "hpc-ai", label: "HPC-AI", keyEnvVars: ["HPC_AI_API_KEY"] },
	{ id: "iflowcn", label: "iFlow", keyEnvVars: ["IFLOW_API_KEY"] },
	{ id: "inception", label: "Inception", keyEnvVars: ["INCEPTION_API_KEY"] },
	{ id: "inference", label: "Inference", keyEnvVars: ["INFERENCE_API_KEY"] },
	{ id: "io-net", label: "IO.NET", keyEnvVars: ["IOINTELLIGENCE_API_KEY"] },
	{ id: "jiekou", label: "Jiekou.AI", keyEnvVars: ["JIEKOU_API_KEY"] },
	{ id: "kilo", label: "Kilo Gateway", keyEnvVars: ["KILO_API_KEY"] },
	{ id: "kimi-for-coding", label: "Kimi For Coding", keyEnvVars: ["KIMI_API_KEY"] },
	{ id: "kuae-cloud-coding-plan", label: "KUAE Cloud Coding Plan", keyEnvVars: ["KUAE_API_KEY"] },
	{ id: "llama", label: "Llama", keyEnvVars: ["LLAMA_API_KEY"] },
	{ id: "llmgateway", label: "LLM Gateway", keyEnvVars: ["LLMGATEWAY_API_KEY"] },
	{ id: "lmstudio", label: "LMStudio", keyEnvVars: ["LMSTUDIO_API_KEY"] },
	{ id: "lucidquery", label: "LucidQuery AI", keyEnvVars: ["LUCIDQUERY_API_KEY"] },
	{ id: "meganova", label: "Meganova", keyEnvVars: ["MEGANOVA_API_KEY"] },
	{
		id: "minimax-coding-plan",
		label:
			"MiniMax Coding Plan (minimax.io) / MiniMax Coding Plan (minimaxi.com) / MiniMax (minimax.io) / MiniMax (minimaxi.com)",
		keyEnvVars: ["MINIMAX_API_KEY"],
	},
	{ id: "mistral", label: "Mistral", keyEnvVars: ["MISTRAL_API_KEY"] },
	{ id: "mixlayer", label: "Mixlayer", keyEnvVars: ["MIXLAYER_API_KEY"] },
	{ id: "moark", label: "Moark", keyEnvVars: ["MOARK_API_KEY"] },
	{ id: "modelscope", label: "ModelScope", keyEnvVars: ["MODELSCOPE_API_KEY"] },
	{
		id: "moonshotai-cn",
		label: "Moonshot AI (China) / Moonshot AI",
		keyEnvVars: ["MOONSHOT_API_KEY"],
	},
	{ id: "morph", label: "Morph", keyEnvVars: ["MORPH_API_KEY"] },
	{ id: "nano-gpt", label: "NanoGPT", keyEnvVars: ["NANO_GPT_API_KEY"] },
	{ id: "nebius", label: "Nebius Token Factory", keyEnvVars: ["NEBIUS_API_KEY"] },
	{ id: "neuralwatt", label: "Neuralwatt", keyEnvVars: ["NEURALWATT_API_KEY"] },
	{ id: "nova", label: "Nova", keyEnvVars: ["NOVA_API_KEY"] },
	{ id: "novita-ai", label: "NovitaAI", keyEnvVars: ["NOVITA_API_KEY"] },
	{ id: "nvidia", label: "Nvidia", keyEnvVars: ["NVIDIA_API_KEY"] },
	{ id: "ollama-cloud", label: "Ollama Cloud", keyEnvVars: ["OLLAMA_API_KEY"] },
	{ id: "openai", label: "OpenAI", keyEnvVars: ["OPENAI_API_KEY"] },
	{ id: "opencode-go", label: "OpenCode Go / OpenCode Zen", keyEnvVars: ["OPENCODE_API_KEY"] },
	{ id: "openrouter", label: "OpenRouter", keyEnvVars: ["OPENROUTER_API_KEY"] },
	{ id: "ovhcloud", label: "OVHcloud AI Endpoints", keyEnvVars: ["OVHCLOUD_API_KEY"] },
	{
		id: "perplexity-agent",
		label: "Perplexity Agent / Perplexity",
		keyEnvVars: ["PERPLEXITY_API_KEY"],
	},
	{ id: "poe", label: "Poe", keyEnvVars: ["POE_API_KEY"] },
	{ id: "qihang-ai", label: "QiHang", keyEnvVars: ["QIHANG_API_KEY"] },
	{ id: "qiniu-ai", label: "Qiniu", keyEnvVars: ["QINIU_API_KEY"] },
	{ id: "regolo-ai", label: "Regolo AI", keyEnvVars: ["REGOLO_API_KEY"] },
	{ id: "requesty", label: "Requesty", keyEnvVars: ["REQUESTY_API_KEY"] },
	{ id: "sarvam", label: "Sarvam AI", keyEnvVars: ["SARVAM_API_KEY"] },
	{ id: "scaleway", label: "Scaleway", keyEnvVars: ["SCALEWAY_API_KEY"] },
	{ id: "siliconflow", label: "SiliconFlow", keyEnvVars: ["SILICONFLOW_API_KEY"] },
	{ id: "siliconflow-cn", label: "SiliconFlow (China)", keyEnvVars: ["SILICONFLOW_CN_API_KEY"] },
	{ id: "stackit", label: "STACKIT", keyEnvVars: ["STACKIT_API_KEY"] },
	{ id: "stepfun", label: "StepFun", keyEnvVars: ["STEPFUN_API_KEY"] },
	{ id: "submodel", label: "submodel", keyEnvVars: ["SUBMODEL_INSTAGEN_ACCESS_KEY"] },
	{ id: "synthetic", label: "Synthetic", keyEnvVars: ["SYNTHETIC_API_KEY"] },
	{
		id: "tencent-coding-plan",
		label: "Tencent Coding Plan (China)",
		keyEnvVars: ["TENCENT_CODING_PLAN_API_KEY"],
	},
	{ id: "tencent-tokenhub", label: "Tencent TokenHub", keyEnvVars: ["TENCENT_TOKENHUB_API_KEY"] },
	{ id: "the-grid-ai", label: "The Grid AI", keyEnvVars: ["THEGRIDAI_API_KEY"] },
	{ id: "togetherai", label: "Together AI", keyEnvVars: ["TOGETHER_API_KEY"] },
	{ id: "upstage", label: "Upstage", keyEnvVars: ["UPSTAGE_API_KEY"] },
	{ id: "v0", label: "v0", keyEnvVars: ["V0_API_KEY"] },
	{ id: "venice", label: "Venice AI", keyEnvVars: ["VENICE_API_KEY"] },
	{ id: "vivgrid", label: "Vivgrid", keyEnvVars: ["VIVGRID_API_KEY"] },
	{ id: "vultr", label: "Vultr", keyEnvVars: ["VULTR_API_KEY"] },
	{ id: "wafer.ai", label: "Wafer", keyEnvVars: ["WAFER_API_KEY"] },
	{ id: "wandb", label: "Weights & Biases", keyEnvVars: ["WANDB_API_KEY"] },
	{ id: "xai", label: "xAI", keyEnvVars: ["XAI_API_KEY"] },
	{
		id: "xiaomi-token-plan-cn",
		label:
			"Xiaomi Token Plan (China) / Xiaomi Token Plan (Singapore) / Xiaomi / Xiaomi Token Plan (Europe)",
		keyEnvVars: ["XIAOMI_API_KEY"],
	},
	{ id: "zenmux", label: "ZenMux", keyEnvVars: ["ZENMUX_API_KEY"] },
	{
		id: "zai",
		label: "Z.AI / Z.AI Coding Plan / Zhipu AI Coding Plan / Zhipu AI",
		keyEnvVars: ["ZHIPU_API_KEY"],
	},
];

/** The providers OpenCode can use, as a fresh list so a caller cannot change the catalogue. */
export function opencodeProviders(): AgentProvider[] {
	return PROVIDERS.map((provider) => ({ ...provider, keyEnvVars: [...provider.keyEnvVars] }));
}
