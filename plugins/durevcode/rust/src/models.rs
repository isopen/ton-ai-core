#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    Zen,
    OpenRouter,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Endpoint {
    ChatCompletions,
    Responses,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FreeModel {
    pub id: &'static str,
    pub provider: Provider,
    pub endpoint: Endpoint,
}

pub const ZEN_CHAT_URL: &str = "https://opencode.ai/zen/v1/chat/completions";
pub const ZEN_RESPONSES_URL: &str = "https://opencode.ai/zen/v1/responses";
pub const ZEN_MODELS_URL: &str = "https://opencode.ai/zen/v1/models";
pub const OPENROUTER_CHAT_URL: &str = "https://openrouter.ai/api/v1/chat/completions";

pub const ANON_OK: &[&str] = &["space-bunny-free"];

pub fn supports_anonymous(id: &str) -> bool {
    let short = id.rsplit('/').next().unwrap_or(id);
    ANON_OK.contains(&short)
}

pub const FREE_MODELS: &[FreeModel] = &[
    FreeModel { id: "big-pickle", provider: Provider::Zen, endpoint: Endpoint::ChatCompletions },
    FreeModel { id: "mimo-v2.5-free", provider: Provider::Zen, endpoint: Endpoint::ChatCompletions },
    FreeModel { id: "mimo-v2.6-flash-free", provider: Provider::Zen, endpoint: Endpoint::ChatCompletions },
    FreeModel { id: "ling-3.0-flash-fin-free", provider: Provider::Zen, endpoint: Endpoint::ChatCompletions },
    FreeModel { id: "nemotron-3-ultra-free", provider: Provider::Zen, endpoint: Endpoint::ChatCompletions },
    FreeModel { id: "nemotron-3.5-lightning-free", provider: Provider::Zen, endpoint: Endpoint::ChatCompletions },
    FreeModel { id: "kimi-k2.5-free", provider: Provider::Zen, endpoint: Endpoint::ChatCompletions },
    FreeModel { id: "minimax-m2.5-free", provider: Provider::Zen, endpoint: Endpoint::ChatCompletions },
    FreeModel { id: "space-bunny-free", provider: Provider::Zen, endpoint: Endpoint::ChatCompletions },
    FreeModel { id: "jev-1.13-free", provider: Provider::Zen, endpoint: Endpoint::ChatCompletions },
    FreeModel { id: "muse-spark-1.3-contributor-free", provider: Provider::Zen, endpoint: Endpoint::Responses },
];

pub fn find_model(id: &str) -> Option<FreeModel> {
    let short = id.rsplit('/').next().unwrap_or(id);
    FREE_MODELS.iter().copied().find(|m| m.id == short || m.id == id)
}

pub fn is_free_id(id: &str) -> bool {
    if find_model(id).is_some() {
        return true;
    }
    if id == "openrouter/free" || id == "free" || id == "big-pickle" {
        return true;
    }
    id.ends_with(":free") || id.ends_with("-free")
}

pub fn chat_url_for(id: &str) -> &'static str {
    match find_model(id) {
        Some(m) => match m.provider {
            Provider::Zen => match m.endpoint {
                Endpoint::ChatCompletions => ZEN_CHAT_URL,
                Endpoint::Responses => ZEN_RESPONSES_URL,
            },
            Provider::OpenRouter => OPENROUTER_CHAT_URL,
        },
        None => {
            if id.contains('/') && id.ends_with(":free") {
                OPENROUTER_CHAT_URL
            } else if id.ends_with("-free") {
                ZEN_CHAT_URL
            } else {
                ZEN_CHAT_URL
            }
        }
    }
}

pub fn needs_responses_endpoint(id: &str) -> bool {
    match find_model(id) {
        Some(m) => m.endpoint == Endpoint::Responses,
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_has_core_free_models() {
        for id in ["big-pickle", "mimo-v2.5-free", "nemotron-3-ultra-free", "muse-spark-1.3-contributor-free"] {
            assert!(find_model(id).is_some(), "missing {}", id);
        }
    }

    #[test]
    fn contributor_uses_responses_endpoint() {
        assert!(needs_responses_endpoint("muse-spark-1.3-contributor-free"));
        assert!(needs_responses_endpoint("opencode/muse-spark-1.3-contributor-free"));
        assert!(!needs_responses_endpoint("mimo-v2.5-free"));
        assert_eq!(chat_url_for("muse-spark-1.3-contributor-free"), ZEN_RESPONSES_URL);
        assert_eq!(chat_url_for("mimo-v2.5-free"), ZEN_CHAT_URL);
    }

    #[test]
    fn openrouter_free_pattern_routes_to_openrouter() {
        assert!(is_free_id("nvidia/nemotron-nano-12b-v2-vl:free"));
        assert_eq!(chat_url_for("nvidia/nemotron-nano-12b-v2-vl:free"), OPENROUTER_CHAT_URL);
    }

    #[test]
    fn prefixed_ids_resolve() {
        assert!(is_free_id("opencode/mimo-v2.5-free"));
        assert_eq!(chat_url_for("opencode/mimo-v2.5-free"), ZEN_CHAT_URL);
    }

    #[test]
    fn anonymous_allowlist() {
        assert!(supports_anonymous("space-bunny-free"));
        assert!(supports_anonymous("opencode/space-bunny-free"));
        assert!(!supports_anonymous("mimo-v2.5-free"));
        assert!(!supports_anonymous("muse-spark-1.3-contributor-free"));
    }
}
