use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuestionOption {
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuestionItem {
    pub question: String,
    pub options: Vec<QuestionOption>,
    pub multiple: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuestionRequest {
    pub id: String,
    pub session: String,
    pub items: Vec<QuestionItem>,
}

fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' => o.push_str("\\\\"),
            '\t' => o.push_str("\\t"),
            '\n' => o.push_str("\\n"),
            '|' => o.push_str("\\p"),
            '~' => o.push_str("\\q"),
            '\x1f' => o.push_str("\\u"),
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
                Some('p') => o.push('|'),
                Some('q') => o.push('~'),
                Some('u') => o.push('\x1f'),
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

fn split_top(line: &str) -> Vec<String> {
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
    parts
}

fn split_pipe(s: &str) -> Vec<String> {
    let mut parts: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c == '\\' {
            cur.push('\\');
            if let Some(nx) = it.next() {
                cur.push(nx);
            }
        } else if c == '|' {
            parts.push(cur);
            cur = String::new();
        } else {
            cur.push(c);
        }
    }
    parts.push(cur);
    parts
}

pub fn encode_line(r: &QuestionRequest) -> String {
    let mut items: Vec<String> = Vec::new();
    for it in &r.items {
        let opts: Vec<String> = it.options.iter().map(|o| esc(&o.label)).collect();
        let m = if it.multiple { "1" } else { "0" };
        items.push(format!("{}~{}~{}", esc(&it.question), m, opts.join("|")));
    }
    format!("{}\t{}\t{}", esc(&r.id), esc(&r.session), items.join("\x1f"))
}

pub fn decode_line(line: &str) -> Option<QuestionRequest> {
    let p = split_top(line);
    if p.len() != 3 {
        return None;
    }
    let mut items: Vec<QuestionItem> = Vec::new();
    if !p[2].is_empty() {
        for chunk in p[2].split('\x1f') {
            let mut f: Vec<String> = Vec::new();
            let mut cur = String::new();
            let mut it = chunk.chars().peekable();
            let mut seen = 0;
            while let Some(c) = it.next() {
                if c == '\\' {
                    cur.push('\\');
                    if let Some(nx) = it.next() {
                        cur.push(nx);
                    }
                } else if c == '~' && seen < 2 {
                    f.push(cur);
                    cur = String::new();
                    seen += 1;
                } else {
                    cur.push(c);
                }
            }
            f.push(cur);
            if f.len() != 3 {
                return None;
            }
            let options: Vec<QuestionOption> = if f[2].is_empty() {
                Vec::new()
            } else {
                split_pipe(&f[2]).into_iter().map(|l| QuestionOption { label: unesc(&l) }).collect()
            };
            items.push(QuestionItem {
                question: unesc(&f[0]),
                options,
                multiple: f[1] == "1",
            });
        }
    }
    Some(QuestionRequest { id: unesc(&p[0]), session: unesc(&p[1]), items })
}

pub struct QuestionStore {
    pending: HashMap<String, Vec<QuestionRequest>>,
    next: u32,
}

impl QuestionStore {
    pub fn new() -> Self {
        QuestionStore { pending: HashMap::new(), next: 1 }
    }

    pub fn ask(&mut self, session: &str, items: Vec<QuestionItem>) -> QuestionRequest {
        let id = format!("que_{:04}", self.next);
        self.next += 1;
        let r = QuestionRequest { id: id.clone(), session: session.to_string(), items };
        self.pending.entry(session.to_string()).or_default().push(r.clone());
        r
    }

    pub fn list(&self, session: &str) -> Vec<QuestionRequest> {
        self.pending.get(session).cloned().unwrap_or_default()
    }

    pub fn reply(&mut self, session: &str, id: &str, answers: &[Vec<String>]) -> bool {
        match self.pending.get_mut(session) {
            Some(v) => match v.iter().position(|r| r.id == id) {
                Some(i) => {
                    let req = &v[i];
                    if answers.len() != req.items.len() {
                        return false;
                    }
                    for (a, item) in answers.iter().zip(req.items.iter()) {
                        if !item.multiple && a.len() != 1 {
                            return false;
                        }
                        for label in a {
                            if !item.options.iter().any(|o| &o.label == label) {
                                return false;
                            }
                        }
                    }
                    v.remove(i);
                    true
                }
                None => false,
            },
            None => false,
        }
    }

    pub fn load_text(&mut self, text: &str) {
        for line in text.lines() {
            if line.is_empty() {
                continue;
            }
            if let Some(r) = decode_line(line) {
                if let Some(n) = r.id.strip_prefix("que_").and_then(|v| v.parse::<u32>().ok()) {
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

impl Default for QuestionStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn items() -> Vec<QuestionItem> {
        vec![QuestionItem {
            question: "Which one?".to_string(),
            options: vec![
                QuestionOption { label: "Alpha".to_string() },
                QuestionOption { label: "Beta".to_string() },
            ],
            multiple: false,
        }]
    }

    #[test]
    fn ask_list_reply_single() {
        let mut st = QuestionStore::new();
        let r = st.ask("ses_0001", items());
        assert_eq!(r.id, "que_0001");
        assert_eq!(st.list("ses_0001").len(), 1);
        assert!(st.reply("ses_0001", "que_0001", &[vec!["Alpha".to_string()]]));
        assert!(st.list("ses_0001").is_empty());
        assert!(!st.reply("ses_0001", "que_0001", &[vec!["Alpha".to_string()]]));
    }

    #[test]
    fn rejects_bad_answers() {
        let mut st = QuestionStore::new();
        st.ask("ses_0001", items());
        assert!(!st.reply("ses_0001", "que_0001", &[vec!["Gamma".to_string()]]));
        assert!(!st.reply("ses_0001", "que_0001", &[]));
        assert!(!st.reply("ses_9999", "que_0001", &[vec!["Alpha".to_string()]]));
        assert_eq!(st.list("ses_0001").len(), 1);
    }

    #[test]
    fn codec_roundtrip() {
        let r = QuestionRequest { id: "que_0002".to_string(), session: "ses_0001".to_string(), items: items() };
        assert_eq!(decode_line(&encode_line(&r)).unwrap(), r);
    }
}
