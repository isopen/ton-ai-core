let current: Record<string, string> = {};

export function t(key: string): string {
  return current[key] ?? key;
}

export function setStrings(map: Record<string, string>) {
  current = { ...map };
}

export function tpl(key: string, params: Record<string, string | number>): string {
  let str = current[key] ?? key;
  for (const [k, v] of Object.entries(params)) {
    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return str;
}
