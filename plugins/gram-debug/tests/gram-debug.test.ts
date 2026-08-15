import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    configure,
    getConfig,
    getLogger,
    GramDebugPlugin,
    GramDebugSkills,
    isEnabled,
    loadConfig,
    resolveConfigFile,
    setScope,
    LOG_LEVELS
} from '@ton-ai/gram-debug';
import { DebugComponents } from '../src/components';

describe('gram-debug', () => {
    let consoleLog: jest.SpyInstance;
    let consoleWarn: jest.SpyInstance;
    let consoleError: jest.SpyInstance;

    beforeEach(() => {
        consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleLog.mockRestore();
        consoleWarn.mockRestore();
        consoleError.mockRestore();
        loadConfig();
    });

    describe('config loading', () => {
        it('resolves the plugin gram-debug.json from src', () => {
            const file = resolveConfigFile();
            expect(file).toBe(path.resolve(__dirname, '../gram-debug.json'));
        });

        it('loads the global config file with scope flags', () => {
            const config = loadConfig();
            expect(typeof config.enabled).toBe('boolean');
            expect(typeof config.level).toBe('string');
            expect(LOG_LEVELS[config.level as keyof typeof LOG_LEVELS]).toBeDefined();
            for (const scope of Object.values(config.scopes || {})) {
                expect(typeof scope.enabled).toBe('boolean');
                if (scope.level) {
                    expect(LOG_LEVELS[scope.level as keyof typeof LOG_LEVELS]).toBeDefined();
                }
            }
        });

        it('falls back to embedded defaults when no config file exists', () => {
            const config = loadConfig('/nonexistent/gram-debug.json');
            expect(typeof config.enabled).toBe('boolean');
            expect(LOG_LEVELS[config.level as keyof typeof LOG_LEVELS]).toBeDefined();
        });

        it('loads a custom config file', () => {
            const tmp = path.join(os.tmpdir(), `gram-debug-${Date.now()}.json`);
            fs.writeFileSync(tmp, JSON.stringify({ enabled: false, level: 'error', scopes: {} }));
            try {
                const config = loadConfig(tmp);
                expect(config.enabled).toBe(false);
                expect(config.level).toBe('error');
            } finally {
                fs.unlinkSync(tmp);
            }
        });
    });

    describe('DebugComponents', () => {
        it('creates loggers per scope', () => {
            const components = new DebugComponents({ level: 'info' });
            const a = components.getLogger('core');
            const b = components.getLogger('core');
            const c = components.getLogger('other');
            expect(a).toBe(b);
            expect(a).not.toBe(c);
            expect(a.scope).toBe('core');
        });

        it('suppresses disabled scopes', () => {
            const components = new DebugComponents({ scopes: { quiet: { enabled: false } } });
            components.getLogger('quiet').info('hidden');
            expect(consoleLog).not.toHaveBeenCalled();
        });

        it('filters by level', () => {
            const components = new DebugComponents({ level: 'info' });
            components.getLogger('x').debug('nope');
            components.getLogger('x').info('yes');
            components.getLogger('x').warn('yes2');
            expect(consoleLog).toHaveBeenCalledTimes(1);
            expect(consoleWarn).toHaveBeenCalledTimes(1);
        });

        it('respects per-scope level overrides', () => {
            const components = new DebugComponents({ level: 'error', scopes: { loud: { level: 'debug' } } });
            components.getLogger('loud').debug('shown');
            components.getLogger('other').info('hidden');
            expect(consoleLog).toHaveBeenCalledTimes(1);
            expect(consoleLog.mock.calls[0][1]).toBe('shown');
        });

        it('respects level off', () => {
            const components = new DebugComponents({ level: 'off' });
            components.getLogger('x').error('nope');
            expect(consoleError).not.toHaveBeenCalled();
        });

        it('prefixes output with scope and level', () => {
            const components = new DebugComponents({});
            components.getLogger('gram-media').warn('boom', 42);
            expect(consoleWarn.mock.calls[0][0]).toBe('[gram-media] WARN');
            expect(consoleWarn.mock.calls[0][1]).toBe('boom');
            expect(consoleWarn.mock.calls[0][2]).toBe(42);
        });

        it('applies runtime configure patches', () => {
            const components = new DebugComponents({ scopes: { s: { enabled: false } } });
            components.getLogger('s').info('hidden');
            components.configure({ scopes: { s: { enabled: true } } });
            components.getLogger('s').info('shown');
            expect(consoleLog).toHaveBeenCalledTimes(1);
        });

        it('setScope merges into existing scope config', () => {
            const components = new DebugComponents({ scopes: { s: { enabled: true, level: 'info' } } });
            components.setScope('s', { level: 'debug' });
            expect(components.resolveLevel('s')).toBe('debug');
            expect(components.isScopeEnabled('s')).toBe(true);
        });

        it('isAllowed checks scope flag and level', () => {
            const components = new DebugComponents({ level: 'info', scopes: { on: { enabled: true }, off: { enabled: false } } });
            expect(components.isAllowed('on', 'debug')).toBe(false);
            expect(components.isAllowed('on', 'warn')).toBe(true);
            expect(components.isAllowed('off', 'error')).toBe(false);
            expect(components.isAllowed('on', 'off')).toBe(false);
        });

        it('logger enabled and level getters reflect config', () => {
            const components = new DebugComponents({ level: 'warn', scopes: { q: { enabled: false, level: 'error' } } });
            const logger = components.getLogger('q');
            expect(logger.enabled).toBe(false);
            expect(logger.level).toBe('error');
        });

        it('writes to a per-scope file when configured', () => {
            const tmp = path.join(os.tmpdir(), `gram-debug-${Date.now()}.log`);
            try {
                const components = new DebugComponents({ scopes: { filey: { file: tmp } } });
                components.getLogger('filey').info('into file');
                expect(consoleLog).not.toHaveBeenCalled();
                const content = fs.readFileSync(tmp, 'utf8');
                expect(content).toContain('[filey] INFO into file');
            } finally {
                fs.unlinkSync(tmp);
            }
        });

        it('falls back to console when the file sink fails', () => {
            const components = new DebugComponents({ scopes: { bad: { file: '/nonexistent-dir/x.log' } } });
            components.getLogger('bad').error('oops');
            expect(consoleError).toHaveBeenCalledTimes(1);
        });
    });

    describe('module-level API', () => {
        it('getLogger obeys the current config flags', () => {
            const config = loadConfig();
            const scopes = Object.keys(config.scopes || {});
            expect(scopes.length).toBeGreaterThan(0);
            for (const scope of scopes) {
                expect(getLogger(scope).enabled).toBe(config.scopes![scope].enabled);
            }
        });

        it('configure and setScope update behavior at runtime', () => {
            setScope('temp-scope', { enabled: true, level: 'debug' });
            expect(isEnabled('temp-scope', 'debug')).toBe(true);
            configure({ scopes: { 'temp-scope': { enabled: false } } });
            expect(isEnabled('temp-scope', 'debug')).toBe(false);
        });

        it('getConfig returns the active config', () => {
            const config = getConfig();
            const scopes = Object.keys(config.scopes || {});
            expect(scopes.length).toBeGreaterThan(0);
        });

        it('isEnabled works with and without level', () => {
            const config = loadConfig();
            const scopes = Object.keys(config.scopes || {});
            for (const scope of scopes) {
                const expected = config.scopes![scope].enabled;
                expect(isEnabled(scope)).toBe(expected);
            }
        });
    });

    describe('GramDebugSkills', () => {
        it('isReady and getLogger', () => {
            const skills = new GramDebugSkills({}, new DebugComponents({}), {});
            expect(skills.isReady()).toBe(true);
            expect(skills.getLogger('x').scope).toBe('x');
        });

        it('enable/disable/setLevel/setScope control flags', () => {
            const skills = new GramDebugSkills({}, new DebugComponents({ scopes: { s: { enabled: false, level: 'info' } } }), {});
            skills.enable('s');
            expect(skills.isEnabled('s')).toBe(true);
            skills.setLevel('s', 'trace');
            expect(skills.isEnabled('s', 'trace')).toBe(true);
            skills.disable('s');
            expect(skills.isEnabled('s', 'trace')).toBe(false);
            skills.setScope('s', { level: 'off' });
            skills.enable('s');
            expect(skills.isEnabled('s', 'trace')).toBe(false);
        });

        it('updateConfig merges and applies', () => {
            const skills = new GramDebugSkills({}, new DebugComponents({}), {});
            skills.updateConfig({ scopes: { u: { enabled: false } } });
            expect(skills.getConfig().scopes?.['u']).toEqual({ enabled: false });
        });

        it('reloadConfig reloads from file', () => {
            const skills = new GramDebugSkills({}, new DebugComponents({}), {});
            const config = skills.reloadConfig();
            expect(Object.keys(config.scopes || {}).length).toBeGreaterThan(0);
        });

        it('dumpConfig serializes the config', () => {
            const skills = new GramDebugSkills({}, new DebugComponents(), {});
            const dumped = JSON.parse(skills.dumpConfig());
            expect(Object.keys(dumped.scopes || {}).length).toBeGreaterThan(0);
        });

        it('log routes through level methods', () => {
            const skills = new GramDebugSkills({}, new DebugComponents({ level: 'info' }), {});
            skills.log('s', 'info', 'hello');
            skills.log('s', 'debug', 'hidden');
            expect(consoleLog).toHaveBeenCalledTimes(1);
            expect(consoleLog.mock.calls[0][1]).toBe('hello');
        });
    });

    describe('GramDebugPlugin', () => {
        function mockContext(): any {
            const events = { emit: jest.fn() };
            return {
                events,
                logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
                config: {}
            };
        }

        it('has metadata and initializes with context', async () => {
            const plugin = new GramDebugPlugin();
            expect(plugin.metadata.name).toBe('gram-debug');
            expect(plugin.metadata.dependencies).toEqual([]);
            const context = mockContext();
            await plugin.initialize(context);
            expect(plugin.isReady()).toBe(true);
            expect(context.logger.info).toHaveBeenCalled();
        });

        it('emits events on activate/deactivate', async () => {
            const plugin = new GramDebugPlugin();
            const context = mockContext();
            await plugin.initialize(context);
            await plugin.onActivate();
            await plugin.onDeactivate();
            expect(context.events.emit).toHaveBeenCalledWith('gram-debug:ready');
            expect(context.events.emit).toHaveBeenCalledWith('gram-debug:deactivated');
        });

        it('reloads config on config change', async () => {
            const plugin = new GramDebugPlugin();
            const context = mockContext();
            await plugin.initialize(context);
            await plugin.onConfigChange({ scopes: { 'plugin-scope': { enabled: false } } });
            expect(plugin.getConfig().scopes?.['plugin-scope']).toEqual({ enabled: false });
        });

        it('exposes skills-backed control methods', async () => {
            const plugin = new GramDebugPlugin();
            await plugin.initialize(mockContext());
            plugin.enable('p');
            expect(plugin.getConfig().scopes?.['p']).toEqual({ enabled: true });
            plugin.disable('p');
            plugin.setLevel('p', 'trace');
            expect(plugin.getConfig().scopes?.['p']).toEqual({ enabled: false, level: 'trace' });
            plugin.setScope('p', { enabled: true });
            expect(plugin.getLogger('p').enabled).toBe(true);
            expect(typeof plugin.dumpConfig()).toBe('string');
            expect(Object.keys(plugin.reloadConfig().scopes || {}).length).toBeGreaterThan(0);
        });
    });
});
