export const LABELS: ReadonlyArray<string> = [
    'Hello, world!',
    "Let's do IT",
    'Ready to GO!',
];

export function getLabels(): string[] {
    return [...LABELS];
}

export function labelAt(index: number): string {
    const total = LABELS.length;
    const safe = Number.isInteger(index) ? index : 0;
    return LABELS[((safe % total) + total) % total];
}

export function nextLabel(current: string): string {
    const at = LABELS.indexOf(current);
    return labelAt(at === -1 ? 0 : at + 1);
}
