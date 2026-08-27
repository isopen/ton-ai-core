/** Jest transformer for compiled (tsc) ESM files in gram-ui/dist.
 *  Handles the exact emit patterns tsc produces: import declarations,
 *  export {..}, export function/class/const. No default exports used. */

function transformEsmToCjs(src, filename) {
  const requires = [];
  let code = src;

  // import.meta.url → CJS equivalent (worker URLs in compiled tgs/media code)
  code = code.replace(/import\.meta\.url/g, "require('url').pathToFileURL(__filename).href");
  code = code.replace(/\bimport\.meta\b/g, '({})');

  // import { a, b as c } from 'mod';  |  import X from 'mod';  |  import 'mod';
  code = code.replace(
    /^[ \t]*import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm,
    (m, defaultName, named, from) => {
      const specs = [];
      if (defaultName) specs.push(`${defaultName}: ${defaultName}`);
      if (named) {
        for (const part of named.split(',')) {
          const t = part.trim();
          if (!t) continue;
          const [local, imported] = t.split(/\s+as\s+/);
          specs.push(imported ? `${imported}: ${local}` : local);
        }
      }
      if (specs.length === 0) return `require(${JSON.stringify(from)});`;
      requires.push(`const { ${specs.join(', ')} } = require(${JSON.stringify(from)});`);
      return '';
    },
  );

  // export { A, B as C } from 'mod';
  code = code.replace(
    /^[ \t]*export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm,
    (m, names, from) => {
      const specs = [];
      const assigns = [];
      for (const part of names.split(',')) {
        const t = part.trim();
        if (!t) continue;
        const [local, imported] = t.split(/\s+as\s+/);
        if (imported) { specs.push(`${imported}: ${local}`); assigns.push(`exports.${local} = ${local};`); }
        else { specs.push(local); assigns.push(`exports.${local} = ${local};`); }
      }
      requires.push(`const { ${specs.join(', ')} } = require(${JSON.stringify(from)});`);
      return assigns.join('\n');
    },
  );

  // export { A, B as C };
  const exportLists = [];
  code = code.replace(/^[ \t]*export\s*\{([^}]*)\};?[ \t]*$/gm, (m, names) => {
    for (const part of names.split(',')) {
      const t = part.trim();
      if (!t) continue;
      const [local, exported] = t.split(/\s+as\s+/);
      exportLists.push(exported ? `exports.${exported} = ${local};` : `exports.${local} = ${local};`);
    }
    return '';
  });

  // export function name / export async function name
  code = code.replace(/^[ \t]*export\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
    (m, isAsync, name) => {
      exportLists.push(`exports.${name} = ${name};`);
      return `${isAsync || ''}function ${name}`;
    });

  // export class Name
  code = code.replace(/^[ \t]*export\s+class\s+([A-Za-z_$][\w$]*)/gm,
    (m, name) => {
      exportLists.push(`exports.${name} = ${name};`);
      return `class ${name}`;
    });

  // export const/let/var Name = ...
  code = code.replace(/^[ \t]*export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
    (m, kw, name) => {
      exportLists.push(`exports.${name} = ${name};`);
      return `${kw} ${name}`;
    });

  const out = requires.join('\n') + (requires.length ? '\n' : '') +
    code.trim() + '\n' + exportLists.join('\n') + '\n';
  return out;
}

module.exports = {
  process(src) {
    return { code: transformEsmToCjs(src) };
  },
};
