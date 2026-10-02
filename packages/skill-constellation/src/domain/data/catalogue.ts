/**
 * The skill catalogue - data only.
 *
 * Maps what Developer Intelligence records (a category and a name) to a
 * canonical skill. It names skills; it never creates one. A skill appears only
 * when a technology fact, TODO or commit maps to it.
 *
 * Keys are lowercase. Edit freely; the tests check every entry is well formed.
 */

import type { SkillCategory } from '../types.ts';

export interface CatalogueSkill {
  id: string;
  name: string;
  category: SkillCategory;
}

export const CATALOGUE_SKILLS: readonly CatalogueSkill[] = [
  // Languages - the names Developer Intelligence's detector emits.
  { id: 'typescript', name: 'TypeScript', category: 'language' },
  { id: 'javascript', name: 'JavaScript', category: 'language' },
  { id: 'python', name: 'Python', category: 'language' },
  { id: 'go', name: 'Go', category: 'language' },
  { id: 'rust', name: 'Rust', category: 'language' },
  { id: 'java', name: 'Java', category: 'language' },
  { id: 'kotlin', name: 'Kotlin', category: 'language' },
  { id: 'csharp', name: 'C#', category: 'language' },
  { id: 'ruby', name: 'Ruby', category: 'language' },
  { id: 'php', name: 'PHP', category: 'language' },
  { id: 'swift', name: 'Swift', category: 'language' },
  { id: 'c', name: 'C', category: 'language' },
  { id: 'cpp', name: 'C++', category: 'language' },
  // Runtimes.
  { id: 'nodejs', name: 'Node.js', category: 'runtime' },
  // Package managers.
  { id: 'npm', name: 'npm', category: 'packageManager' },
  { id: 'pnpm', name: 'pnpm', category: 'packageManager' },
  { id: 'yarn', name: 'Yarn', category: 'packageManager' },
  { id: 'bun', name: 'Bun', category: 'packageManager' },
  // Frameworks.
  { id: 'react', name: 'React', category: 'framework' },
  { id: 'vue', name: 'Vue', category: 'framework' },
  { id: 'svelte', name: 'Svelte', category: 'framework' },
  { id: 'angular', name: 'Angular', category: 'framework' },
  { id: 'nextjs', name: 'Next.js', category: 'framework' },
  { id: 'electron', name: 'Electron', category: 'framework' },
  { id: 'express', name: 'Express', category: 'framework' },
  { id: 'fastify', name: 'Fastify', category: 'framework' },
  { id: 'nestjs', name: 'NestJS', category: 'framework' },
  // Libraries.
  { id: 'sqlite', name: 'SQLite', category: 'library' },
  { id: 'prisma', name: 'Prisma', category: 'library' },
  { id: 'graphql', name: 'GraphQL', category: 'library' },
  { id: 'redux', name: 'Redux', category: 'library' },
  { id: 'zod', name: 'Zod', category: 'library' },
  { id: 'd3', name: 'D3', category: 'library' },
  { id: 'threejs', name: 'three.js', category: 'library' },
  { id: 'tailwindcss', name: 'Tailwind CSS', category: 'library' },
  // Tooling.
  { id: 'docker', name: 'Docker', category: 'tooling' },
  { id: 'vite', name: 'Vite', category: 'tooling' },
  { id: 'vitest', name: 'Vitest', category: 'tooling' },
  { id: 'jest', name: 'Jest', category: 'tooling' },
  { id: 'playwright', name: 'Playwright', category: 'tooling' },
  { id: 'eslint', name: 'ESLint', category: 'tooling' },
  { id: 'prettier', name: 'Prettier', category: 'tooling' },
  { id: 'webpack', name: 'webpack', category: 'tooling' },
];

/**
 * Developer Intelligence category -> lowercase recorded name -> catalogue id.
 * A category absent here (project, baseImage, toolchain) never becomes a skill.
 */
export const CATALOGUE_NAMES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  language: {
    typescript: 'typescript',
    javascript: 'javascript',
    python: 'python',
    go: 'go',
    rust: 'rust',
    java: 'java',
    kotlin: 'kotlin',
    'c#': 'csharp',
    ruby: 'ruby',
    php: 'php',
    swift: 'swift',
    c: 'c',
    'c++': 'cpp',
  },
  runtime: {
    node: 'nodejs',
    python: 'python',
    go: 'go',
  },
  packageManager: {
    npm: 'npm',
    pnpm: 'pnpm',
    yarn: 'yarn',
    bun: 'bun',
  },
  tooling: {
    docker: 'docker',
  },
  library: {
    typescript: 'typescript',
    react: 'react',
    'react-dom': 'react',
    vue: 'vue',
    svelte: 'svelte',
    '@angular/core': 'angular',
    next: 'nextjs',
    electron: 'electron',
    express: 'express',
    fastify: 'fastify',
    '@nestjs/core': 'nestjs',
    'better-sqlite3': 'sqlite',
    'sql.js': 'sqlite',
    sqlite3: 'sqlite',
    prisma: 'prisma',
    '@prisma/client': 'prisma',
    graphql: 'graphql',
    redux: 'redux',
    '@reduxjs/toolkit': 'redux',
    zod: 'zod',
    d3: 'd3',
    three: 'threejs',
    tailwindcss: 'tailwindcss',
    vite: 'vite',
    vitest: 'vitest',
    jest: 'jest',
    playwright: 'playwright',
    '@playwright/test': 'playwright',
    eslint: 'eslint',
    prettier: 'prettier',
    webpack: 'webpack',
  },
};
