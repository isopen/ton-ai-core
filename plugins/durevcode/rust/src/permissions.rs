use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    AllowOnce,
    Deny,
}

impl Decision {
    pub fn from_str(s: &str) -> Option<Decision> {
        match s {
            "once" | "allow" | "allow-once" => Some(Decision::AllowOnce),
            "deny" | "reject" => Some(Decision::Deny),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Decision::AllowOnce => "once",
            Decision::Deny => "deny",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PermissionRequest {
    pub id: String,
    pub session: String,
    pub action: String,
    pub resource: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PermissionRecord {
    pub id: String,
    pub decision: Decision,
}

fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' => o.push_str("\\\\"),
            '\t' => o.push_str("\\t"),
            '\n' => o.push_str("\\n"),
            _ => o.push(c),
        }
    }
    o
}

fn unesc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    let mut it = s.chars();
    while let Some(c) = it.next() {
        if c == '\\' {
            match it.next() {
                Some('t') => o.push('\t'),
                Some('n') => o.push('\n'),
                Some('\\') => o.push('\\'),
                Some(x) => {
                    o.push('\\');
                    o.push(x);
                }
                None => o.push('\\'),
            }
        } else {
            o.push(c);
        }
    }
    o
}

fn split_parts(line: &str, n: usize) -> Option<Vec<String>> {
    let mut parts: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut it = line.chars().peekable();
    while let Some(c) = it.next() {
        if c == '\\' {
            cur.push('\\');
            if let Some(nx) = it.next() {
                cur.push(nx);
            }
        } else if c == '\t' {
            parts.push(cur);
            cur = String::new();
        } else {
            cur.push(c);
        }
    }
    parts.push(cur);
    if parts.len() != n {
        return None;
    }
    Some(parts)
}

pub fn encode_line(r: &PermissionRequest) -> String {
    format!("{}\t{}\t{}\t{}", esc(&r.id), esc(&r.session), esc(&r.action), esc(&r.resource))
}

pub fn decode_line(line: &str) -> Option<PermissionRequest> {
    let p = split_parts(line, 4)?;
    Some(PermissionRequest {
        id: unesc(&p[0]),
        session: unesc(&p[1]),
        action: unesc(&p[2]),
        resource: unesc(&p[3]),
    })
}

pub struct PermissionStore {
    pending: HashMap<String, Vec<PermissionRequest>>,
    resolved: Vec<PermissionRecord>,
    next: u32,
}

impl PermissionStore {
    pub fn new() -> Self {
        PermissionStore { pending: HashMap::new(), resolved: Vec::new(), next: 1 }
    }

    pub fn request(&mut self, session: &str, action: &str, resource: &str) -> PermissionRequest {
        let id = format!("per_{:04}", self.next);
        self.next += 1;
        let r = PermissionRequest {
            id: id.clone(),
            session: session.to_string(),
            action: action.to_string(),
            resource: resource.to_string(),
        };
        self.pending.entry(session.to_string()).or_default().push(r.clone());
        r
    }

    pub fn list(&self, session: &str) -> Vec<PermissionRequest> {
        self.pending.get(session).cloned().unwrap_or_default()
    }

    pub fn reply(&mut self, session: &str, id: &str, decision: Decision) -> bool {
        match self.pending.get_mut(session) {
            Some(v) => match v.iter().position(|r| r.id == id) {
                Some(i) => {
                    v.remove(i);
                    self.resolved.push(PermissionRecord { id: id.to_string(), decision });
                    true
                }
                None => false,
            },
            None => false,
        }
    }

    pub fn consume(&mut self, id: &str) -> Option<Decision> {
        self.resolved.iter().position(|r| r.id == id).map(|i| self.resolved.remove(i).decision)
    }

    pub fn load_text(&mut self, text: &str) {
        for line in text.lines() {
            if line.is_empty() {
                continue;
            }
            if let Some(r) = decode_line(line) {
                if let Some(n) = r.id.strip_prefix("per_").and_then(|v| v.parse::<u32>().ok()) {
                    if n >= self.next {
                        self.next = n + 1;
                    }
                }
                let arr = self.pending.entry(r.session.clone()).or_default();
                if !arr.iter().any(|x| x.id == r.id) {
                    arr.push(r);
                }
            }
        }
    }
}

impl Default for PermissionStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_list_reply_once() {
        let mut st = PermissionStore::new();
        let r = st.request("ses_0001", "bash", "rm -rf /tmp/x");
        assert_eq!(r.id, "per_0001");
        assert_eq!(st.list("ses_0001").len(), 1);
        assert!(st.reply("ses_0001", "per_0001", Decision::AllowOnce));
        assert!(st.list("ses_0001").is_empty());
        assert!(!st.reply("ses_0001", "per_0001", Decision::Deny));
    }

    #[test]
    fn unknown_session_or_id_is_false() {
        let mut st = PermissionStore::new();
        assert!(!st.reply("ses_9999", "per_0001", Decision::Deny));
        st.request("ses_0001", "read", "f");
        assert!(!st.reply("ses_0001", "per_9999", Decision::Deny));
        assert!(!st.reply("ses_0002", "per_0001", Decision::Deny));
    }

    #[test]
    fn codec_roundtrip() {
        let r = PermissionRequest {
            id: "per_0002".to_string(),
            session: "ses_0001".to_string(),
            action: "write".to_string(),
            resource: "a\tb".to_string(),
        };
        assert_eq!(decode_line(&encode_line(&r)).unwrap(), r);
    }
}
