import { GramDbComponents } from './components';
import { GramDbSkills } from './skills';
import type { GramDbConfig } from './types';

export * from './components';
export * from './skills';
export * from './types';
export * from './td-binlog';

export function createStandaloneGramDb(config?: GramDbConfig): GramDbSkills {
  const components = new GramDbComponents(undefined, config);
  return new GramDbSkills(components, config || {});
}
