export function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function truncate(s: string, n: number): string {
    if (s.length <= n) return s;
    return s.slice(0, Math.max(0, n - 1)) + '…';
}

export function wellFormed(s: string): string {
    return s.replace(/&(?!amp;|lt;|gt;|quot;)/g, '&amp;');
}

export function splitTelegramHtml(text: string, limit = 4000): string[] {
    if (text.length <= limit) return [text];
    const parts: string[] = [];
    let rest = text;
    while (rest.length > limit) {
        let cut = rest.lastIndexOf('\n', limit);
        if (cut <= 0) cut = limit;
        parts.push(rest.slice(0, cut));
        rest = rest.slice(cut);
    }
    if (rest.length > 0) parts.push(rest);
    return parts;
}
