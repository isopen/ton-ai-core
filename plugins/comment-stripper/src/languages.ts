export type StringSpec =
    | { kind: 'single' }
    | { kind: 'double' }
    | { kind: 'backtick' }
    | { kind: 'triple-single' }
    | { kind: 'triple-double' }
    | { kind: 'verbatim-double' }
    | { kind: 'rust-raw' }
    | { kind: 'cpp-raw' };

export interface BlockSpec {
    open: string;
    close: string;
    nested?: boolean;
    lineStartOnly?: boolean;
}

export interface LanguageConfig {
    id: string;
    extensions: string[];
    line: string[];
    block: BlockSpec[];
    strings: StringSpec[];
    hashNotBracket?: boolean;
    hashNotAfterDollar?: boolean;
    hashLineStartOnly?: boolean;
}

const cLike = {
    line: ['//'],
    block: [{ open: '/*', close: '*/' }],
    strings: [{ kind: 'single' }, { kind: 'double' }],
};

const hashLine = {
    line: ['#'],
    block: [],
    strings: [{ kind: 'single' }, { kind: 'double' }],
};

export const LANGUAGES: Record<string, LanguageConfig> = {
    typescript: { id: 'typescript', extensions: ['.ts', '.tsx'], line: ['//'], block: [{ open: '/*', close: '*/' }], strings: [{ kind: 'single' }, { kind: 'double' }, { kind: 'backtick' }] },
    javascript: { id: 'javascript', extensions: ['.js', '.jsx', '.mjs', '.cjs'], line: ['//'], block: [{ open: '/*', close: '*/' }], strings: [{ kind: 'single' }, { kind: 'double' }, { kind: 'backtick' }] },
    python: { id: 'python', extensions: ['.py', '.pyw'], line: ['#'], block: [], strings: [{ kind: 'single' }, { kind: 'double' }, { kind: 'triple-single' }, { kind: 'triple-double' }] },
    ruby: { id: 'ruby', extensions: ['.rb'], line: ['#'], block: [{ open: '=begin', close: '=end', lineStartOnly: true }], strings: [{ kind: 'single' }, { kind: 'double' }] },
    php: { id: 'php', extensions: ['.php', '.phtml'], line: ['//', '#'], block: [{ open: '/*', close: '*/' }], strings: [{ kind: 'single' }, { kind: 'double' }], hashNotBracket: true },
    c: { id: 'c', extensions: ['.c', '.h'], line: ['//'], block: [{ open: '/*', close: '*/' }], strings: [{ kind: 'single' }, { kind: 'double' }] },
    cpp: { id: 'cpp', extensions: ['.cpp', '.hpp', '.cc', '.cxx', '.hxx'], line: ['//'], block: [{ open: '/*', close: '*/' }], strings: [{ kind: 'single' }, { kind: 'double' }, { kind: 'cpp-raw' }] },
    java: { id: 'java', extensions: ['.java'], line: ['//'], block: [{ open: '/*', close: '*/' }], strings: [{ kind: 'single' }, { kind: 'double' }] },
    kotlin: { id: 'kotlin', extensions: ['.kt', '.kts'], line: ['//'], block: [{ open: '/*', close: '*/' }], strings: [{ kind: 'single' }, { kind: 'double' }] },
    scala: { id: 'scala', extensions: ['.scala'], line: ['//'], block: [{ open: '/*', close: '*/' }], strings: [{ kind: 'single' }, { kind: 'double' }] },
    csharp: { id: 'csharp', extensions: ['.cs'], line: ['//'], block: [{ open: '/*', close: '*/' }], strings: [{ kind: 'single' }, { kind: 'double' }, { kind: 'verbatim-double' }] },
    go: { id: 'go', extensions: ['.go'], line: ['//'], block: [{ open: '/*', close: '*/' }], strings: [{ kind: 'single' }, { kind: 'double' }, { kind: 'backtick' }] },
    rust: { id: 'rust', extensions: ['.rs'], line: ['//'], block: [{ open: '/*', close: '*/', nested: true }], strings: [{ kind: 'single' }, { kind: 'double' }, { kind: 'rust-raw' }] },
    swift: { id: 'swift', extensions: ['.swift'], line: ['//'], block: [{ open: '/*', close: '*/', nested: true }], strings: [{ kind: 'single' }, { kind: 'double' }] },
    objc: { id: 'objc', extensions: ['.m', '.mm'], line: ['//'], block: [{ open: '/*', close: '*/' }], strings: [{ kind: 'single' }, { kind: 'double' }, { kind: 'cpp-raw' }] },
    lua: { id: 'lua', extensions: ['.lua'], line: ['--'], block: [{ open: '--[[', close: ']]', nested: true }], strings: [{ kind: 'single' }, { kind: 'double' }] },
    haskell: { id: 'haskell', extensions: ['.hs', '.lhs'], line: ['--'], block: [{ open: '{-', close: '-}', nested: true }], strings: [{ kind: 'single' }, { kind: 'double' }] },
    elixir: { id: 'elixir', extensions: ['.ex', '.exs'], line: ['#'], block: [], strings: [{ kind: 'single' }, { kind: 'double' }] },
    erlang: { id: 'erlang', extensions: ['.erl', '.hrl'], line: ['%'], block: [], strings: [{ kind: 'single' }, { kind: 'double' }] },
    clojure: { id: 'clojure', extensions: ['.clj', '.cljs', '.cljc'], line: [';'], block: [], strings: [{ kind: 'single' }, { kind: 'double' }] },
    r: { id: 'r', extensions: ['.r', '.R'], line: ['#'], block: [], strings: [{ kind: 'single' }, { kind: 'double' }] },
    matlab: { id: 'matlab', extensions: ['.matlab'], line: ['%'], block: [{ open: '%{', close: '%}' }], strings: [{ kind: 'single' }] },
    ada: { id: 'ada', extensions: ['.adb', '.ads'], line: ['--'], block: [], strings: [{ kind: 'double' }] },
    shell: { id: 'shell', extensions: ['.sh', '.bash', '.zsh', '.fish'], line: ['#'], block: [], strings: [{ kind: 'single' }, { kind: 'double' }], hashNotAfterDollar: true },
    perl: { id: 'perl', extensions: ['.pl', '.pm'], line: ['#'], block: [], strings: [{ kind: 'single' }, { kind: 'double' }] },
    sql: { id: 'sql', extensions: ['.sql'], line: ['--'], block: [{ open: '/*', close: '*/' }], strings: [{ kind: 'single' }, { kind: 'double' }] },
    graphql: { id: 'graphql', extensions: ['.graphql', '.gql'], line: ['#'], block: [], strings: [{ kind: 'single' }, { kind: 'double' }] },
    yaml: { id: 'yaml', extensions: ['.yaml', '.yml'], line: ['#'], block: [], strings: [{ kind: 'single' }, { kind: 'double' }] },
    toml: { id: 'toml', extensions: ['.toml'], line: ['#'], block: [], strings: [{ kind: 'single' }, { kind: 'double' }] },
    ini: { id: 'ini', extensions: ['.ini', '.cfg'], line: [';', '#'], block: [], strings: [] },
    css: { id: 'css', extensions: ['.css', '.scss', '.less'], line: [], block: [{ open: '/*', close: '*/' }], strings: [{ kind: 'single' }, { kind: 'double' }] },
    markup: { id: 'markup', extensions: ['.html', '.htm', '.xml', '.svg', '.vue', '.svelte'], line: [], block: [{ open: '<!--', close: '-->' }], strings: [{ kind: 'single' }, { kind: 'double' }] },
    make: { id: 'make', extensions: ['makefile', 'Makefile', 'GNUmakefile'], line: ['#'], block: [], strings: [] },
    dockerfile: { id: 'dockerfile', extensions: ['Dockerfile'], line: ['#'], block: [], strings: [], hashLineStartOnly: true },
    json: { id: 'json', extensions: ['.json'], line: [], block: [], strings: [{ kind: 'double' }] },
    jsonc: { id: 'jsonc', extensions: ['.jsonc'], line: ['//'], block: [{ open: '/*', close: '*/' }], strings: [{ kind: 'double' }] },
};

export const EXTENSION_TO_LANG: Record<string, string> = (() => {
    const map: Record<string, string> = {};
    for (const cfg of Object.values(LANGUAGES)) {
        for (const ext of cfg.extensions) map[ext] = cfg.id;
    }
    return map;
})();

export const TS_LIKE = new Set(['typescript', 'javascript']);
