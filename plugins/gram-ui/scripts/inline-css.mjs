import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const css = readFileSync(join(root, 'src', 'styles.css'), 'utf-8');

const out = `// Auto-generated from styles.css — do not edit directly
export const TGUI_CSS: string = ${JSON.stringify(css)};
`;

writeFileSync(join(root, 'src', 'tgui-css.ts'), out);
