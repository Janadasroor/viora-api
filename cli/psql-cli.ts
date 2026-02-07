#!/usr/bin/env tsx

import { pool } from './psql.js';
import { readFileSync } from 'fs';
import * as path from 'path';

async function runQuery(query: string, statementNumber?: number) {
  const client = await pool.connect();
  try {
    const trimmedQuery = query.trim();
    if (statementNumber !== undefined) {
      console.log(`\n Executing statement ${statementNumber + 1}:`, trimmedQuery.substring(0, 50) + (trimmedQuery.length > 50 ? '...' : ''));
    } else {
      console.log('Executing query:', trimmedQuery);
    }

    const result = await client.query(trimmedQuery);

    console.log('\n Results:');
    console.log('Rows:', result.rowCount);
    if (result.rows.length > 0) {
      console.table(result.rows);
    }
    if (result.command) {
      console.log('Command:', result.command);
    }
    console.log('─'.repeat(50));
  } catch (error:any) {
    console.error(' Query failed:', error.message);
    if (statementNumber !== undefined) {
      console.error(`Statement ${statementNumber + 1} failed, continuing with next statements...`);
    }
  } finally {
    client.release();
  }
}

async function runSqlFile(filePath: string) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath);

    console.log(` Executing SQL file: ${fileName}`);
    console.log('═'.repeat(60));

    // Split by semicolons but be careful with semicolons in strings
    const statements = splitSqlStatements(content);

    console.log(`Found ${statements.length} SQL statements to execute\n`);

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i].trim();
      if (statement) {
        await runQuery(statement, i);
      }
    }

    console.log(` Finished executing ${fileName}`);
  } catch (error:any) {
    console.error(' Failed to execute SQL file:', error.message);
    process.exit(1);
  }
}

function splitSqlStatements(sql: string): string[] {
  // Remove comments (basic approach)
  const withoutComments = sql
    .replace(/--.*$/gm, '') // Remove single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, ''); // Remove multi-line comments

  // Split by semicolons and filter out empty statements
  const statements = withoutComments
    .split(';')
    .map(stmt => stmt.trim())
    .filter(stmt => stmt.length > 0)
    .map(stmt => stmt + ';'); // Add semicolon back

  return statements;
}

async function main() {
  const args = process.argv.slice(2);

  // Handle help and version flags
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log('psql-cli v1.0.0');
    return;
  }

  if (args.length === 0) {
    showHelp();
    process.exit(1);
  }

  let query = '';
  let isFile = false;

  // Parse command line arguments
  if (args[0] === '-f' && args[1]) {
    // Execute SQL file
    const filePath = args[1];
    if (!filePath.endsWith('.sql')) {
      console.warn('⚠️  Warning: File does not have .sql extension, but proceeding...');
    }
    await runSqlFile(filePath);
    return;
  } else if (args[0]) {
    // Query from command line
    query = args.join(' ');
  }

  if (!query.trim()) {
    // Try reading from stdin
    process.stdin.setEncoding('utf8');
    query = await new Promise((resolve) => {
      let data = '';
      process.stdin.on('data', chunk => data += chunk);
      process.stdin.on('end', () => resolve(data));
    });
  }

  if (!query.trim()) {
    console.error(' No query provided');
    process.exit(1);
  }

  await runQuery(query);
}

function showHelp() {
  console.log(`
 PostgreSQL CLI Tool for Viora

USAGE:
  psql-cli [OPTIONS] [QUERY]
  psql-cli -f FILE.sql
  command | psql-cli

OPTIONS:
  -f, --file FILE    Execute SQL statements from file
  -h, --help         Show this help message
  -v, --version      Show version information

EXAMPLES:
  # Run a simple query
  psql-cli "SELECT * FROM users LIMIT 5"

  # Execute SQL file with multiple statements
  psql-cli -f migration.sql

  # Pipe query from another command
  echo "SELECT COUNT(*) FROM posts" | psql-cli

  # Multi-line query
  psql-cli "
    SELECT u.name, COUNT(p.id) as posts
    FROM users u
    LEFT JOIN posts p ON u.id = p.user_id
    GROUP BY u.id, u.name
    ORDER BY posts DESC
    LIMIT 10
  "

DATABASE:
  Uses PostgreSQL connection: viora_pluse_v1@localhost:5432
`);
}

main().catch(error => {
  console.error(' Unexpected error:', error);
  process.exit(1);
});
