#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Allow,
    Ask,
    Deny,
}

impl Verdict {
    pub fn as_str(&self) -> &'static str {
        match self {
            Verdict::Allow => "allow",
            Verdict::Ask => "ask",
            Verdict::Deny => "deny",
        }
    }

    pub fn from_str(s: &str) -> Option<Verdict> {
        match s {
            "allow" => Some(Verdict::Allow),
            "ask" => Some(Verdict::Ask),
            "deny" => Some(Verdict::Deny),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rule {
    pub tool: String,
    pub pattern: String,
    pub verdict: Verdict,
}

pub fn wildcard_match(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    let mut pi = 0;
    let mut ti = 0;
    let mut star: Option<usize> = None;
    let mut mark = 0;
    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            mark = ti;
            pi += 1;
        } else if let Some(s) = star {
            pi = s + 1;
            mark += 1;
            ti = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

pub fn expand_home(pattern: &str, home: &str) -> String {
    if pattern == "~" {
        return home.to_string();
    }
    if let Some(rest) = pattern.strip_prefix("~/") {
        return format!("{}/{}", home.trim_end_matches('/'), rest);
    }
    if let Some(rest) = pattern.strip_prefix("$HOME/") {
        return format!("{}/{}", home.trim_end_matches('/'), rest);
    }
    pattern.to_string()
}

pub fn default_rules() -> Vec<Rule> {
    vec![
        Rule { tool: "read".to_string(), pattern: "*".to_string(), verdict: Verdict::Allow },
        Rule { tool: "read".to_string(), pattern: "*.env".to_string(), verdict: Verdict::Deny },
        Rule { tool: "read".to_string(), pattern: "*.env.*".to_string(), verdict: Verdict::Deny },
        Rule { tool: "read".to_string(), pattern: "*.env.example".to_string(), verdict: Verdict::Allow },
        Rule { tool: "write".to_string(), pattern: "*".to_string(), verdict: Verdict::Ask },
        Rule { tool: "bash".to_string(), pattern: "*".to_string(), verdict: Verdict::Ask },
        Rule { tool: "external".to_string(), pattern: "*".to_string(), verdict: Verdict::Ask },
    ]
}

pub fn secret_guard() -> Vec<Rule> {
    vec![
        Rule { tool: "read".to_string(), pattern: "*.env".to_string(), verdict: Verdict::Deny },
        Rule { tool: "read".to_string(), pattern: "*.env.*".to_string(), verdict: Verdict::Deny },
        Rule { tool: "read".to_string(), pattern: "*.env.example".to_string(), verdict: Verdict::Allow },
    ]
}

pub fn full_chain(root: &str, always: &[(String, String)]) -> Vec<Rule> {
    let mut rules = default_rules();
    rules.extend(trusted_root_rules(root));
    for (tool, pattern) in always {
        rules.push(Rule { tool: tool.clone(), pattern: pattern.clone(), verdict: Verdict::Allow });
    }
    rules.extend(secret_guard());
    rules
}

pub fn trusted_root_rules(root: &str) -> Vec<Rule> {
    let clean = root.trim_end_matches('/');
    vec![
        Rule { tool: "read".to_string(), pattern: format!("{}/*", clean), verdict: Verdict::Allow },
        Rule { tool: "bash".to_string(), pattern: "git status*".to_string(), verdict: Verdict::Allow },
        Rule { tool: "bash".to_string(), pattern: "git diff*".to_string(), verdict: Verdict::Allow },
        Rule { tool: "bash".to_string(), pattern: "git log*".to_string(), verdict: Verdict::Allow },
        Rule { tool: "bash".to_string(), pattern: "ls*".to_string(), verdict: Verdict::Allow },
        Rule { tool: "bash".to_string(), pattern: "cat *".to_string(), verdict: Verdict::Allow },
        Rule { tool: "bash".to_string(), pattern: "grep *".to_string(), verdict: Verdict::Allow },
        Rule { tool: "bash".to_string(), pattern: "rm *".to_string(), verdict: Verdict::Deny },
    ]
}

pub fn evaluate(rules: &[Rule], tool: &str, input: &str, home: &str) -> Verdict {
    let mut verdict: Option<Verdict> = None;
    for rule in rules {
        if rule.tool != "*" && rule.tool != tool {
            continue;
        }
        let pattern = expand_home(&rule.pattern, home);
        if wildcard_match(&pattern, input) {
            verdict = Some(rule.verdict);
        }
    }
    verdict.unwrap_or(Verdict::Ask)
}

pub fn suggest_pattern(tool: &str, input: &str) -> String {
    let first = input.split_whitespace().next().unwrap_or("");
    if tool == "bash" && !first.is_empty() {
        return format!("{} *", first);
    }
    input.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wildcard_basics() {
        assert!(wildcard_match("*", "anything"));
        assert!(wildcard_match("git *", "git status"));
        assert!(!wildcard_match("git *", "git"));
        assert!(!wildcard_match("git *", "agit"));
        assert!(wildcard_match("*.env", ".env"));
        assert!(!wildcard_match("*.env", ".env.example"));
        assert!(wildcard_match("*.env.*", ".env.local"));
        assert!(wildcard_match("a?c", "abc"));
        assert!(!wildcard_match("a?c", "ac"));
        assert!(wildcard_match("packages/*/docs/*.mdx", "packages/web/src/content/docs/a.mdx"));
    }

    #[test]
    fn last_match_wins() {
        let rules = vec![
            Rule { tool: "bash".to_string(), pattern: "*".to_string(), verdict: Verdict::Ask },
            Rule { tool: "bash".to_string(), pattern: "git *".to_string(), verdict: Verdict::Allow },
            Rule { tool: "bash".to_string(), pattern: "git push *".to_string(), verdict: Verdict::Deny },
        ];
        assert_eq!(evaluate(&rules, "bash", "git status", ""), Verdict::Allow);
        assert_eq!(evaluate(&rules, "bash", "git push origin", ""), Verdict::Deny);
        assert_eq!(evaluate(&rules, "bash", "rm -rf x", ""), Verdict::Ask);
        assert_eq!(evaluate(&rules, "read", "a.txt", ""), Verdict::Ask);
    }

    #[test]
    fn secrets_denied_by_default() {
        let rules = default_rules();
        assert_eq!(evaluate(&rules, "read", ".env", ""), Verdict::Deny);
        assert_eq!(evaluate(&rules, "read", "a.env.local", ""), Verdict::Deny);
        assert_eq!(evaluate(&rules, "read", ".env.example", ""), Verdict::Allow);
        assert_eq!(evaluate(&rules, "read", "notes.txt", ""), Verdict::Allow);
    }

    #[test]
    fn trusted_root_allows_routine() {
        let rules = trusted_root_rules("/repo");
        assert_eq!(evaluate(&rules, "bash", "git status", ""), Verdict::Allow);
        assert_eq!(evaluate(&rules, "bash", "ls -la", ""), Verdict::Allow);
        assert_eq!(evaluate(&rules, "bash", "rm -rf /tmp/x", ""), Verdict::Deny);
        assert_eq!(evaluate(&rules, "bash", "cargo test", ""), Verdict::Ask);
    }

    #[test]
    fn home_expands() {
        assert_eq!(expand_home("~/p/*", "/home/u"), "/home/u/p/*");
        assert_eq!(expand_home("$HOME/p/*", "/home/u"), "/home/u/p/*");
        assert_eq!(expand_home("/abs/*", "/home/u"), "/abs/*");
    }

    #[test]
    fn chain_orders_secrets_last() {
        let chain = full_chain("/repo", &[("bash".to_string(), "git *".to_string())]);
        assert_eq!(evaluate(&chain, "read", ".env", ""), Verdict::Deny);
        assert_eq!(evaluate(&chain, "read", ".env.example", ""), Verdict::Allow);
        assert_eq!(evaluate(&chain, "bash", "git status", ""), Verdict::Allow);
        assert_eq!(evaluate(&chain, "bash", "cargo test", ""), Verdict::Ask);
    }

    #[test]
    fn suggest_prefix() {
        assert_eq!(suggest_pattern("bash", "git status --porcelain"), "git *");
        assert_eq!(suggest_pattern("read", "notes/a.txt"), "notes/a.txt");
    }
}
