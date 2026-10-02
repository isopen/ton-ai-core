import { strict as assert } from 'assert';
import { TelegramBotComponents } from '../src/components';
import { TelegramBotSkills } from '../src/skills';

function stubContext() {
    return {
        events: { on: () => undefined, once: () => undefined, off: () => undefined, emit: () => false, removeAllListeners: () => undefined },
        logger: { info: () => undefined, error: () => undefined, warn: () => undefined, debug: () => undefined },
        config: {},
    };
}

function fileApiFetch(fileResponse: Record<string, unknown>) {
    return (async (url: unknown) => {
        if (String(url).includes('/file/bot')) {
            return fileResponse as unknown as Response;
        }
        return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, result: { file_id: 'f1', file_path: 'docs/a.txt' } }),
        } as unknown as Response;
    }) as typeof fetch;
}

describe('telegram file download', () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    test('downloadFile rejects on HTTP error instead of returning the error body', async () => {
        globalThis.fetch = fileApiFetch({ ok: false, status: 404 });
        const context = stubContext();
        const components = new TelegramBotComponents(context, {});
        const skills = new TelegramBotSkills(context, components, { token: 'x' });
        await assert.rejects(skills.downloadFile('f1'), /HTTP 404/);
    });

    test('downloadFile returns the body on success', async () => {
        const bytes = new TextEncoder().encode('hello');
        globalThis.fetch = fileApiFetch({
            ok: true,
            status: 200,
            arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        });
        const context = stubContext();
        const components = new TelegramBotComponents(context, {});
        const skills = new TelegramBotSkills(context, components, { token: 'x' });
        const buffer = (await skills.downloadFile('f1')) as Buffer;
        assert.equal(buffer.toString('utf8'), 'hello');
    });
});
