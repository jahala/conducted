/**
 * @feature SET-10 OpenCode providers and their keys
 * Owns: the catalogue of providers OpenCode can use and the environment variables that hold each
 * provider's key.
 * Behaviour: inventory label #45-136 (about 90 providers, from 302.AI to Z.AI) and ui-map.md 6
 * (OpenCode and Pi list per-provider keys). The provider ids, names and variables are OpenCode's
 * own catalogue, so the keys a user enters reach the provider OpenCode picks for the model.
 * Must handle: every provider has an id, a label and at least one variable; ids are unique; each
 * call returns a copy, so a caller cannot change the catalogue.
 * Our design choice: OpenCode and Pi share this list, because both read provider keys from the
 * environment the same way (SIDE-21).
 * Test first: the catalogue has about 90 providers, includes 302.AI and Z.AI, and every entry
 * names the variable its key goes in.
 */
import type { AgentProvider } from "@conducted/protocol";

const PROVIDERS: readonly AgentProvider[] = [
	{ id: "302ai", label: "302.AI", keyEnvVars: ["302AI_API_KEY"] },
	{ id: "abacus", label: "Abacus", keyEnvVars: ["ABACUS_API_KEY"] },
	{ id: "ai21", label: "AI21 Labs", keyEnvVars: ["AI21_API_KEY"] },
	{ id: "aihubmix", label: "AIHubMix", keyEnvVars: ["AIHUBMIX_API_KEY"] },
	{ id: "aimlapi", label: "AI/ML API", keyEnvVars: ["AIMLAPI_API_KEY"] },
	{ id: "alibaba", label: "Alibaba", keyEnvVars: ["DASHSCOPE_API_KEY"] },
	{
		id: "amazon-bedrock",
		label: "Amazon Bedrock",
		keyEnvVars: [
			"AWS_ACCESS_KEY_ID",
			"AWS_SECRET_ACCESS_KEY",
			"AWS_REGION",
			"AWS_BEARER_TOKEN_BEDROCK",
		],
	},
	{ id: "anthropic", label: "Anthropic", keyEnvVars: ["ANTHROPIC_API_KEY"] },
	{ id: "arcee", label: "Arcee", keyEnvVars: ["ARCEE_API_KEY"] },
	{ id: "azure", label: "Azure", keyEnvVars: ["AZURE_RESOURCE_NAME", "AZURE_API_KEY"] },
	{
		id: "azure-cognitive-services",
		label: "Azure Cognitive Services",
		keyEnvVars: ["AZURE_COGNITIVE_SERVICES_RESOURCE_NAME", "AZURE_COGNITIVE_SERVICES_API_KEY"],
	},
	{ id: "baseten", label: "Baseten", keyEnvVars: ["BASETEN_API_KEY"] },
	{ id: "cerebras", label: "Cerebras", keyEnvVars: ["CEREBRAS_API_KEY"] },
	{ id: "chutes", label: "Chutes", keyEnvVars: ["CHUTES_API_KEY"] },
	{ id: "clarifai", label: "Clarifai", keyEnvVars: ["CLARIFAI_PAT"] },
	{
		id: "cloudflare-ai-gateway",
		label: "Cloudflare AI Gateway",
		keyEnvVars: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_GATEWAY_ID"],
	},
	{
		id: "cloudflare-workers-ai",
		label: "Cloudflare Workers AI",
		keyEnvVars: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_KEY"],
	},
	{
		id: "cloudferro-sherlock",
		label: "CloudFerro Sherlock",
		keyEnvVars: ["CLOUDFERRO_SHERLOCK_API_KEY"],
	},
	{ id: "cohere", label: "Cohere", keyEnvVars: ["COHERE_API_KEY"] },
	{ id: "cortecs", label: "Cortecs", keyEnvVars: ["CORTECS_API_KEY"] },
	{ id: "crusoe", label: "Crusoe", keyEnvVars: ["CRUSOE_API_KEY"] },
	{ id: "databricks", label: "Databricks", keyEnvVars: ["DATABRICKS_HOST", "DATABRICKS_TOKEN"] },
	{ id: "deepinfra", label: "Deep Infra", keyEnvVars: ["DEEPINFRA_API_KEY"] },
	{ id: "deepseek", label: "DeepSeek", keyEnvVars: ["DEEPSEEK_API_KEY"] },
	{
		id: "digitalocean",
		label: "DigitalOcean",
		keyEnvVars: ["DIGITALOCEAN_ACCESS_TOKEN"],
	},
	{ id: "edenai", label: "Eden AI", keyEnvVars: ["EDENAI_API_KEY"] },
	{ id: "fastrouter", label: "FastRouter", keyEnvVars: ["FASTROUTER_API_KEY"] },
	{ id: "fireworks-ai", label: "Fireworks AI", keyEnvVars: ["FIREWORKS_API_KEY"] },
	{ id: "friendli", label: "Friendli", keyEnvVars: ["FRIENDLI_TOKEN"] },
	{ id: "github-copilot", label: "GitHub Copilot", keyEnvVars: ["GITHUB_TOKEN"] },
	{ id: "gitlab", label: "GitLab Duo", keyEnvVars: ["GITLAB_TOKEN"] },
	{ id: "gmicloud", label: "GMI Cloud", keyEnvVars: ["GMICLOUD_API_KEY"] },
	{
		id: "google",
		label: "Google",
		keyEnvVars: ["GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
	},
	{
		id: "google-vertex",
		label: "Vertex",
		keyEnvVars: [
			"GOOGLE_VERTEX_PROJECT",
			"GOOGLE_VERTEX_LOCATION",
			"GOOGLE_APPLICATION_CREDENTIALS",
		],
	},
	{ id: "groq", label: "Groq", keyEnvVars: ["GROQ_API_KEY"] },
	{ id: "helicone", label: "Helicone", keyEnvVars: ["HELICONE_API_KEY"] },
	{ id: "hetzner", label: "Hetzner", keyEnvVars: ["HETZNER_API_KEY"] },
	{ id: "hpc-ai", label: "HPC-AI", keyEnvVars: ["HPC_AI_API_KEY"] },
	{ id: "huggingface", label: "Hugging Face", keyEnvVars: ["HF_TOKEN"] },
	{ id: "hyper", label: "Charm Hyper", keyEnvVars: ["HYPER_API_KEY"] },
	{ id: "inception", label: "Inception", keyEnvVars: ["INCEPTION_API_KEY"] },
	{ id: "inference", label: "Inference", keyEnvVars: ["INFERENCE_API_KEY"] },
	{
		id: "infomaniak",
		label: "Infomaniak",
		keyEnvVars: ["INFOMANIAK_API_KEY", "INFOMANIAK_PRODUCT_ID"],
	},
	{ id: "io-net", label: "IO.NET", keyEnvVars: ["IOINTELLIGENCE_API_KEY"] },
	{ id: "jiekou", label: "Jiekou.AI", keyEnvVars: ["JIEKOU_API_KEY"] },
	{ id: "kilo", label: "Kilo Gateway", keyEnvVars: ["KILO_API_KEY"] },
	{ id: "liquid", label: "Liquid Inference", keyEnvVars: ["LIQUID_API_KEY"] },
	{ id: "lmstudio", label: "LMStudio", keyEnvVars: ["LMSTUDIO_API_KEY"] },
	{ id: "llmgateway", label: "DevPass (LLM Gateway)", keyEnvVars: ["LLMGATEWAY_API_KEY"] },
	{ id: "longcat", label: "LongCat", keyEnvVars: ["LONGCAT_API_KEY"] },
	{ id: "meta", label: "Meta", keyEnvVars: ["META_MODEL_API_KEY"] },
	{ id: "minimax", label: "MiniMax (minimax.io)", keyEnvVars: ["MINIMAX_API_KEY"] },
	{ id: "mistral", label: "Mistral", keyEnvVars: ["MISTRAL_API_KEY"] },
	{ id: "moark", label: "Moark", keyEnvVars: ["MOARK_API_KEY"] },
	{ id: "modelscope", label: "ModelScope", keyEnvVars: ["MODELSCOPE_API_KEY"] },
	{ id: "moonshotai", label: "Moonshot AI", keyEnvVars: ["MOONSHOT_API_KEY"] },
	{ id: "morph", label: "Morph", keyEnvVars: ["MORPH_API_KEY"] },
	{ id: "nano-gpt", label: "NanoGPT", keyEnvVars: ["NANO_GPT_API_KEY"] },
	{ id: "nebius", label: "Nebius Token Factory", keyEnvVars: ["NEBIUS_API_KEY"] },
	{ id: "novita-ai", label: "Novita AI", keyEnvVars: ["NOVITA_API_KEY"] },
	{ id: "nvidia", label: "Nvidia", keyEnvVars: ["NVIDIA_API_KEY"] },
	{ id: "ollama-cloud", label: "Ollama Cloud", keyEnvVars: ["OLLAMA_API_KEY"] },
	{ id: "openai", label: "OpenAI", keyEnvVars: ["OPENAI_API_KEY"] },
	{ id: "opencode", label: "OpenCode", keyEnvVars: ["OPENCODE_API_KEY"] },
	{ id: "openrouter", label: "OpenRouter", keyEnvVars: ["OPENROUTER_API_KEY"] },
	{ id: "ovhcloud", label: "OVHcloud AI Endpoints", keyEnvVars: ["OVHCLOUD_API_KEY"] },
	{ id: "pareto", label: "Pareto Inference", keyEnvVars: ["PARETO_API_KEY"] },
	{ id: "perplexity", label: "Perplexity", keyEnvVars: ["PERPLEXITY_API_KEY"] },
	{ id: "poe", label: "Poe", keyEnvVars: ["POE_API_KEY"] },
	{ id: "prime", label: "Prime Inference", keyEnvVars: ["PRIME_API_KEY"] },
	{ id: "qiniu-ai", label: "Qiniu", keyEnvVars: ["QINIU_API_KEY"] },
	{ id: "regolo-ai", label: "Regolo AI", keyEnvVars: ["REGOLO_API_KEY"] },
	{ id: "requesty", label: "Requesty", keyEnvVars: ["REQUESTY_API_KEY"] },
	{ id: "salad-cloud", label: "SaladCloud AI Gateway", keyEnvVars: ["SALAD_CLOUD_API_KEY"] },
	{ id: "sambanova", label: "SambaNova", keyEnvVars: ["SAMBANOVA_API_KEY"] },
	{ id: "sarvam", label: "Sarvam AI", keyEnvVars: ["SARVAM_API_KEY"] },
	{ id: "scaleway", label: "Scaleway", keyEnvVars: ["SCALEWAY_API_KEY"] },
	{ id: "siliconflow", label: "SiliconFlow", keyEnvVars: ["SILICONFLOW_API_KEY"] },
	{ id: "stackit", label: "STACKIT", keyEnvVars: ["STACKIT_API_KEY"] },
	{ id: "synthetic", label: "Synthetic", keyEnvVars: ["SYNTHETIC_API_KEY"] },
	{ id: "togetherai", label: "Together AI", keyEnvVars: ["TOGETHER_API_KEY"] },
	{ id: "upstage", label: "Upstage", keyEnvVars: ["UPSTAGE_API_KEY"] },
	{ id: "venice", label: "Venice AI", keyEnvVars: ["VENICE_API_KEY"] },
	{ id: "vercel", label: "Vercel AI Gateway", keyEnvVars: ["AI_GATEWAY_API_KEY"] },
	{ id: "volcengine", label: "Volcengine Ark", keyEnvVars: ["ARK_API_KEY"] },
	{ id: "vultr", label: "Vultr", keyEnvVars: ["VULTR_API_KEY"] },
	{ id: "wandb", label: "CoreWeave", keyEnvVars: ["WANDB_API_KEY"] },
	{
		id: "watsonx",
		label: "watsonx.ai",
		keyEnvVars: ["WATSONX_AI_APIKEY", "WATSONX_AI_PROJECT_ID"],
	},
	{ id: "xai", label: "xAI", keyEnvVars: ["XAI_API_KEY"] },
	{ id: "xiaomi", label: "Xiaomi", keyEnvVars: ["XIAOMI_API_KEY"] },
	{ id: "zai", label: "Z.AI", keyEnvVars: ["ZHIPU_API_KEY"] },
	{ id: "zhipuai", label: "Zhipu AI", keyEnvVars: ["ZHIPU_API_KEY"] },
];

/** The providers OpenCode can use, as a fresh list so a caller cannot change the catalogue. */
export function opencodeProviders(): AgentProvider[] {
	return PROVIDERS.map((provider) => ({ ...provider, keyEnvVars: [...provider.keyEnvVars] }));
}
