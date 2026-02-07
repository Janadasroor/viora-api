#!/usr/bin/env -S npx tsx
import { Command } from 'commander';
import { runHealthCheck } from './health.js';
import { spawn } from 'child_process';
import path from 'path';

const program = new Command();

program
    .name('viora')
    .description('Viora CLI for managing the Viora Server')
    .version('1.0.0');

// viora doctor
program
    .command('doctor')
    .description('Run system health checks (environment, dependencies, DB, Redis, etc.)')
    .action(async () => {
        try {
            await runHealthCheck();
        } catch (error) {
            console.error('An unexpected error occurred during health check:', error);
            process.exit(1);
        }
    });

// viora run <script>
program
    .command('run <script>')
    .description('Run a project script via npm')
    .action((script) => {
        console.log(`> Running 'npm run ${script}'...`);
        const npm = spawn('npm', ['run', script], { stdio: 'inherit', shell: true });
        npm.on('close', (code) => {
            process.exit(code ?? 0);
        });
    });

// viora start
program
    .command('start')
    .description('Start the production server')
    .action(() => {
        console.log(`> Starting Viora Server...`);
        const npm = spawn('npm', ['start'], { stdio: 'inherit', shell: true });
        npm.on('close', (code) => {
            process.exit(code ?? 0);
        });
    });

program.parse(process.argv);
