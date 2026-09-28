use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Event {
    pub key: String,
    pub kind: String,
    pub text: String,
    pub time: u64,
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

pub fn encode_line(session: &str, e: &Event) -> String {
    format!("{}\t{}\t{}\t{}\t{}", esc(session), esc(&e.key), esc(&e.kind), e.time, esc(&e.text))
}

pub fn decode_line(line: &str) -> Option<(String, Event)> {
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
    Some((
        unesc(&parts[0]),
        Event {
            key: unesc(&parts[1]),
            kind: unesc(&parts[2]),
            text: unesc(&parts[4]),
            time: parts[3].parse().ok()?,
        },
    ))
}

pub struct EventLog {
    map: HashMap<String, Vec<Event>>,
    next: u32,
}

impl EventLog {
    pub fn new() -> Self {
        EventLog { map: HashMap::new(), next: 1 }
    }

    pub fn append(&mut self, session: &str, kind: &str, text: &str, time: u64) -> Event {
        let key = format!("ev_{:04}", self.next);
        self.next += 1;
        let e = Event { key: key.clone(), kind: kind.to_string(), text: text.to_string(), time };
        self.map.entry(session.to_string()).or_default().push(e.clone());
        e
    }

    pub fn read(&self, session: &str, limit: usize) -> Vec<Event> {
        match self.map.get(session) {
            Some(v) => {
                if limit == 0 || limit >= v.len() {
                    v.clone()
                } else {
                    v[v.len() - limit..].to_vec()
                }
            }
            None => Vec::new(),
        }
    }

    pub fn load_text(&mut self, text: &str) {
        for line in text.lines() {
            if line.is_empty() {
                continue;
            }
            if let Some((session, e)) = decode_line(line) {
                if let Some(n) = e.key.strip_prefix("ev_").and_then(|v| v.parse::<u32>().ok()) {
                    if n >= self.next {
                        self.next = n + 1;
                    }
                }
                self.map.entry(session).or_default().push(e);
            }
        }
    }
}

impl Default for EventLog {
    fn default() -> Self {
        Self::new()
    }
}

pub struct PromptQueue {
    queue: Vec<String>,
    interrupted: bool,
}

impl PromptQueue {
    pub fn new() -> Self {
        PromptQueue { queue: Vec::new(), interrupted: false }
    }

    pub fn enqueue(&mut self, text: &str) {
        self.queue.push(text.to_string());
    }

    pub fn dequeue(&mut self) -> Option<String> {
        if self.queue.is_empty() {
            None
        } else {
            Some(self.queue.remove(0))
        }
    }

    pub fn len(&self) -> usize {
        self.queue.len()
    }

    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }

    pub fn interrupt(&mut self) -> usize {
        let n = self.queue.len();
        self.queue.clear();
        self.interrupted = true;
        n
    }

    pub fn is_interrupted(&self) -> bool {
        self.interrupted
    }

    pub fn ack_interrupt(&mut self) {
        self.interrupted = false;
    }
}

impl Default for PromptQueue {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_read_limit() {
        let mut log = EventLog::new();
        log.append("ses_0001", "text", "a", 1);
        log.append("ses_0001", "text", "b", 2);
        log.append("ses_0002", "text", "z", 3);
        assert_eq!(log.read("ses_0001", 0).len(), 2);
        assert_eq!(log.read("ses_0001", 1)[0].text, "b");
        assert!(log.read("ses_9999", 0).is_empty());
    }

    #[test]
    fn codec_roundtrip() {
        let e = Event { key: "ev_0001".to_string(), kind: "tool".to_string(), text: "a\tb".to_string(), time: 7 };
        let line = encode_line("ses_0001", &e);
        let (s, back) = decode_line(&line).unwrap();
        assert_eq!(s, "ses_0001");
        assert_eq!(back, e);
    }

    #[test]
    fn queue_interrupt_flow() {
        let mut q = PromptQueue::new();
        q.enqueue("one");
        q.enqueue("two");
        assert_eq!(q.dequeue().as_deref(), Some("one"));
        assert_eq!(q.interrupt(), 1);
        assert!(q.is_interrupted());
        assert!(q.dequeue().is_none());
        q.ack_interrupt();
        assert!(!q.is_interrupted());
    }
}
