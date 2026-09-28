#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Session {
    pub id: String,
    pub title: String,
    pub directory: String,
    pub model: String,
    pub created: u64,
    pub updated: u64,
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

fn split6(line: &str) -> Option<[String; 6]> {
    let mut parts: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut it = line.chars().peekable();
    while let Some(c) = it.next() {
        if c == '\\' {
            cur.push('\\');
            if let Some(n) = it.next() {
                cur.push(n);
            }
        } else if c == '\t' {
            parts.push(cur);
            cur = String::new();
        } else {
            cur.push(c);
        }
    }
    parts.push(cur);
    if parts.len() != 6 {
        return None;
    }
    Some([parts[0].clone(), parts[1].clone(), parts[2].clone(), parts[3].clone(), parts[4].clone(), parts[5].clone()])
}

pub fn encode_line(s: &Session) -> String {
    format!(
        "{}\t{}\t{}\t{}\t{}\t{}",
        esc(&s.id),
        esc(&s.title),
        esc(&s.directory),
        esc(&s.model),
        s.created,
        s.updated
    )
}

pub fn decode_line(line: &str) -> Option<Session> {
    let p = split6(line)?;
    Some(Session {
        id: unesc(&p[0]),
        title: unesc(&p[1]),
        directory: unesc(&p[2]),
        model: unesc(&p[3]),
        created: p[4].parse().ok()?,
        updated: p[5].parse().ok()?,
    })
}

pub struct SessionStore {
    sessions: Vec<Session>,
    next: u32,
}

impl SessionStore {
    pub fn new() -> Self {
        SessionStore { sessions: Vec::new(), next: 1 }
    }

    pub fn create(&mut self, directory: &str, model: &str, now: u64) -> Session {
        let id = format!("ses_{:04}", self.next);
        self.next += 1;
        let s = Session {
            id,
            title: String::new(),
            directory: directory.to_string(),
            model: model.to_string(),
            created: now,
            updated: now,
        };
        self.sessions.push(s.clone());
        s
    }

    pub fn get(&self, id: &str) -> Option<&Session> {
        self.sessions.iter().find(|s| s.id == id)
    }

    pub fn list(&self) -> &[Session] {
        &self.sessions
    }

    pub fn rename(&mut self, id: &str, title: &str, now: u64) -> bool {
        match self.sessions.iter_mut().find(|s| s.id == id) {
            Some(s) => {
                s.title = title.to_string();
                s.updated = now;
                true
            }
            None => false,
        }
    }

    pub fn load_text(&mut self, text: &str) {
        for line in text.lines() {
            if line.is_empty() {
                continue;
            }
            if let Some(s) = decode_line(line) {
                if let Some(n) = s.id.strip_prefix("ses_").and_then(|v| v.parse::<u32>().ok()) {
                    if n >= self.next {
                        self.next = n + 1;
                    }
                }
                if self.get(&s.id).is_none() {
                    self.sessions.push(s);
                }
            }
        }
    }
}

impl Default for SessionStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_get_rename() {
        let mut st = SessionStore::new();
        let s = st.create("/repo", "mimo-v2.5-free", 100);
        assert_eq!(s.id, "ses_0001");
        assert!(st.get("ses_0001").is_some());
        assert!(st.rename("ses_0001", "demo", 120));
        assert_eq!(st.get("ses_0001").unwrap().title, "demo");
        assert!(!st.rename("ses_9999", "x", 130));
    }

    #[test]
    fn codec_roundtrip_with_tabs() {
        let s = Session {
            id: "ses_0007".to_string(),
            title: "a\tb".to_string(),
            directory: "/r\nepo".to_string(),
            model: "m".to_string(),
            created: 5,
            updated: 9,
        };
        let line = encode_line(&s);
        assert_eq!(decode_line(&line).unwrap(), s);
    }

    #[test]
    fn load_skips_bad_lines_and_bumps_next() {
        let mut st = SessionStore::new();
        st.load_text("bad\nses_0003\tt\td\tm\t1\t2\n");
        assert!(st.get("ses_0003").is_some());
        let s = st.create("/x", "m", 3);
        assert_eq!(s.id, "ses_0004");
    }
}
