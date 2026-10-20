type ConsoleMethod = (...args: unknown[]) => void;

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

export function consoleStamp(): string {
    const d = new Date();
    return `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}.${pad(d.getMilliseconds(), 3)}`;
}

export function installConsoleStamps(): void {
    const stamped = (write: ConsoleMethod): ConsoleMethod => {
        return (...args: unknown[]) => {
            write(`[${consoleStamp()}]`, ...args);
        };
    };
    console.log = stamped(console.log.bind(console));
    console.info = stamped(console.info.bind(console));
    console.warn = stamped(console.warn.bind(console));
    console.error = stamped(console.error.bind(console));
    console.debug = stamped(console.debug.bind(console));
}

installConsoleStamps();
