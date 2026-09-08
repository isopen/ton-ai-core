let devWarnings = false;
const tracedComponents = new Set<string>();

export function setDevWarnings(v: boolean): void {
  devWarnings = v;
}

export function isDevWarnings(): boolean {
  return devWarnings;
}

export function traceComponent(name: string): void {
  tracedComponents.add(name);
}

export function untraceComponent(name: string): void {
  tracedComponents.delete(name);
}

export function isTraced(name: string): boolean {
  return devWarnings && tracedComponents.has(name);
}

export function diffProps(oldProps: Record<string, any>, newProps: Record<string, any>): string {
  const changed: string[] = [];
  const allKeys = new Set([...Object.keys(oldProps), ...Object.keys(newProps)]);
  for (const key of allKeys) {
    if (key === 'children' || key === 'key') continue;
    if (!Object.is(oldProps[key], newProps[key])) changed.push(key);
  }
  return changed.join(',');
}

export function formatValue(v: any): string {
  try {
    if (typeof v === 'string') return v.length > 60 ? v.slice(0, 60) + '...' : v;
    if (typeof v === 'function') return 'fn:' + (v.name || 'anonymous');
    const s = JSON.stringify(v);
    return s.length > 80 ? s.slice(0, 80) + '...' : s;
  } catch {
    return String(typeof v);
  }
}
