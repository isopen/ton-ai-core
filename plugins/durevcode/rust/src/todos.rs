use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TodoItem {
    pub content: String,
    pub status: String,
    pub priority: String,
    pub position: u32,
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

pub fn encode_parts(session: &str, item: &TodoItem) -> String {
    format!(
        "{}\t{}\t{}\t{}\t{}",
        esc(session),
        item.position,
        esc(&item.content),
        esc(&item.status),
        esc(&item.priority)
    )
}

pub fn decode_line(line: &str) -> Option<(String, TodoItem)> {
    let p = split_parts5(line)?;
    Some((
        unesc(&p[0]),
        TodoItem {
            position: p[1].parse().ok()?,
            content: unesc(&p[2]),
            status: unesc(&p[3]),
            priority: unesc(&p[4]),
        },
    ))
}

fn split_parts5(line: &str) -> Option<Vec<String>> {
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
    if parts.len() != 5 {
        return None;
    }
    Some(parts)
}

pub struct TodoStore {
    map: HashMap<String, Vec<TodoItem>>,
}

impl TodoStore {
    pub fn new() -> Self {
        TodoStore { map: HashMap::new() }
    }

    pub fn put(&mut self, session: &str, items: Vec<TodoItem>) {
        let mut positioned: Vec<TodoItem> = items
            .into_iter()
            .enumerate()
            .map(|(i, mut t)| {
                t.position = i as u32;
                t
            })
            .collect();
        positioned.sort_by_key(|t| t.position);
        self.map.insert(session.to_string(), positioned);
    }

    pub fn list(&self, session: &str) -> Vec<TodoItem> {
        self.map.get(session).cloned().unwrap_or_default()
    }

    pub fn set_status(&mut self, session: &str, position: u32, status: &str) -> bool {
        match self.map.get_mut(session) {
            Some(v) => match v.iter_mut().find(|t| t.position == position) {
                Some(t) => {
                    t.status = status.to_string();
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
            if let Some((session, item)) = decode_line(line) {
                self.map.entry(session).or_default().push(item);
            }
        }
        for v in self.map.values_mut() {
            v.sort_by_key(|t| t.position);
        }
    }
}

impl Default for TodoStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(content: &str) -> TodoItem {
        TodoItem {
            content: content.to_string(),
            status: "pending".to_string(),
            priority: "medium".to_string(),
            position: 0,
        }
    }

    #[test]
    fn put_list_positions() {
        let mut st = TodoStore::new();
        st.put("ses_0001", vec![item("a"), item("b")]);
        let list = st.list("ses_0001");
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].position, 0);
        assert_eq!(list[1].position, 1);
        assert!(st.list("ses_9999").is_empty());
    }

    #[test]
    fn set_status_flow() {
        let mut st = TodoStore::new();
        st.put("ses_0001", vec![item("a")]);
        assert!(st.set_status("ses_0001", 0, "done"));
        assert_eq!(st.list("ses_0001")[0].status, "done");
        assert!(!st.set_status("ses_0001", 5, "done"));
        assert!(!st.set_status("ses_9999", 0, "done"));
    }

    #[test]
    fn codec_roundtrip() {
        let item = TodoItem {
            content: "a\tb".to_string(),
            status: "done".to_string(),
            priority: "high".to_string(),
            position: 3,
        };
        let line = encode_parts("ses_0001", &item);
        assert_eq!(decode_line(&line).unwrap(), ("ses_0001".to_string(), item));
    }
}
