import { cpSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface SkillInventory {
    name: string;
    description: string;
    path: string;
    bytes: number;
}

export interface HarnessSnapshot {
    instructions: string[];
    skills: SkillInventory[];
    files: string[];
}

export function copyHarness(repoDir: string, targetDir: string): void {
    const opencodeDir = join(repoDir, '.opencode');
    const destDir = join(targetDir, '.opencode');
    cpSync(join(opencodeDir, 'opencode.json'), join(destDir, 'opencode.json'));
    for (const name of ['skills', 'mcp', 'scripts']) {
        const source = join(opencodeDir, name);
        if (existsSync(source)) cpSync(source, join(destDir, name), { recursive: true });
    }
}

export function readHarnessSnapshot(repoDir: string): HarnessSnapshot {
    const configPath = join(repoDir, '.opencode', 'opencode.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { instructions?: string[] };
    const skills: SkillInventory[] = [];
    const skillsDir = join(repoDir, '.opencode', 'skills');
    const files: string[] = ['.opencode/opencode.json'];
    if (existsSync(skillsDir)) {
        for (const entry of readdirSync(skillsDir).sort()) {
            const skillMd = join(skillsDir, entry, 'SKILL.md');
            const skillPathRelative = `.opencode/skills/${entry}/SKILL.md`;
            if (!existsSync(skillMd)) continue;
            const text = readFileSync(skillMd, 'utf8');
            const description = /^description:\s*(.+)$/m.exec(text)?.[1] ?? '';
            skills.push({ name: entry, description: description.trim().slice(0, 300), path: skillPathRelative, bytes: statSync(skillMd).size });
            files.push(...collectFiles(join(skillsDir, entry), skillPathRelative.slice(0, -'SKILL.md'.length)));
        }
    }
    return { instructions: config.instructions ?? [], skills, files };
}

function collectFiles(dir: string, prefix: string): string[] {
    const collected: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) collected.push(...collectFiles(full, `${prefix}${entry}/`));
        else collected.push(`${prefix}${entry}`);
    }
    return collected;
}

export function snapshotMarkdown(snapshot: HarnessSnapshot): string {
    const lines = ['# current harness', '## instructions (.opencode/opencode.json)', ...snapshot.instructions.map((text) => `- ${text}`), '## skills'];
    for (const skill of snapshot.skills) lines.push(`- ${skill.name} (${skill.bytes}b, ${skill.path}): ${skill.description}`);
    return lines.join('\n');
}
