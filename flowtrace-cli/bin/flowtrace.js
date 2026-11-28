#!/usr/bin/env node
/**
 * FlowTrace v2 CLI — slim dispatcher.
 * Four commands only: init, run, analyze, diff.
 */

'use strict';

const { program } = require('commander');
const chalk = require('chalk');
const pkg = require('../package.json');

program
  .name('flowtrace')
  .description('FlowTrace v2 — captura full call trace sin tocar tu código (Java, Python, Node, TS, Go, Rust)')
  .version(pkg.version, '-v, --version', 'imprime la versión actual');

program
  .command('init')
  .description('Inicializa FlowTrace en el proyecto actual (.flowtrace/config.json)')
  .option('--lang <lang>', 'Forza el lenguaje: java|python|node|ts|go|rust')
  .option('-y, --yes', 'No pregunta: acepta el primer lenguaje detectado')
  .action(async (options) => {
    try {
      await require('../lib/commands/init')(options);
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

program
  .command('run')
  .description('Ejecuta la app con instrumentación FlowTrace y emite JSONL v2')
  .addHelpText('after', `
Opciones:
  --lang <java|python|node|ts|go|rust>   Lenguaje del proyecto (auto-detectado si se omite)
  --package-prefix <pkg>            Prefijo a instrumentar (paquete en Java/Python/Go, ruta en Node/TS)
  --inject <mvn|gradle|java>        Estrategia de inyección JVM (default: auto)
  -o, --out <path>                  Ruta del JSONL (default: .flowtrace/<ISO-UTC>.jsonl)

Auto-detección:
  Sin --lang el CLI detecta el lenguaje según archivos del proyecto:
    Java   : pom.xml, build.gradle, build.gradle.kts
    Python : pyproject.toml, setup.py, requirements.txt
    Node   : package.json (ts si tsconfig.json también existe)
    Go     : go.mod
    Rust   : Cargo.toml

Ejemplos:
  flowtrace run -- node app.js
  flowtrace run -- python main.py
  flowtrace run -- java -jar app.jar
  flowtrace run --lang java --package-prefix com.example -- java -jar app.jar
  flowtrace run --lang java -- mvn spring-boot:run
  flowtrace run --lang go -- go run ./cmd/api
  flowtrace run --lang rust -- cargo run --release`)
  .option('--lang <lang>', 'Lenguaje de la app: java|python|node|ts|go|rust (auto-detectado si se omite)')
  .option('--package-prefix <pkg>', 'Prefijo a instrumentar (paquete en Java/Python/Go, ruta en Node/TS, nombre de crate en Rust)')
  .option('--inject <strategy>', 'Estrategia de inyección JVM: mvn|gradle|java (default: auto)')
  .option('-o, --out <path>', 'Ruta de salida JSONL (default: .flowtrace/<ISO>.jsonl). Se vacía al empezar')
  .option('--append', 'Con --out: añade a la traza existente en vez de vaciarla al empezar')
  .allowUnknownOption(true)
  .action(async (options, cmd) => {
    try {
      await require('../lib/commands/run')(options, cmd.args || []);
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

program
  .command('analyze [file]')
  .description('Abre el dashboard sobre un JSONL v2 (default: el más reciente en .flowtrace/)')
  .option('--last', 'Usa el JSONL más reciente en .flowtrace/')
  .action(async (file, options) => {
    try {
      await require('../lib/commands/analyze')(file, options);
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

const collect = (value, previous) => [...previous, value];

program
  .command('diff <base> <actual>')
  .description('Compara el comportamiento de dos trazas del mismo flujo (test de caracterización)')
  .option('--ignore-method <glob>', 'Ignora llamadas cuyo módulo.clase.método calce (y todo lo que llaman). Repetible', collect, [])
  .option('--ignore-key <clave>', 'Ignora una clave volátil en args/result: nombre, glob, o ruta (result.user.id). Repetible', collect, [])
  .option('--ignore-order', 'No considera el orden entre llamadas hermanas (flujos concurrentes)')
  .option('--no-normalize-addresses', 'Compara las direcciones de memoria (0x7f...) tal cual, sin normalizarlas a 0x<addr>')
  .option('--no-error-msg', 'No compara los mensajes de error, solo su tipo')
  .option('--ignore-file <path>', 'JSON con los ignores por defecto (default: characterisation.json junto a la traza base). Cada entrada puede ser un string o {"name"|"key": ..., "reason": "..."}; el motivo sale en --json')
  .option('--limit <n>', 'Máximo de ejemplos por categoría (default: 10)')
  .option('--max-spans <n>', 'Máximo de spans a comparar por traza (default: 2000000)')
  .option('--json', 'Imprime el resultado como JSON (el mismo objeto que la tool MCP trace_behavior_diff)')
  .addHelpText('after', `
Ignora siempre: ts, duration_ns, trace_id/span_id/parent_id, thread, file/line.
Normaliza: <redacted>, hashes de identidad (Foo@1a2b3c) y direcciones (0x7f...).

Código de salida:
  0  las trazas se comportan igual
  1  hay diferencias de comportamiento
  2  error de uso o de lectura, o comparación incompleta

Ejemplos:
  flowtrace diff characterisation/checkout.jsonl .flowtrace/ultima.jsonl
  flowtrace diff base.jsonl actual.jsonl --ignore-key created_at --ignore-key 'result.id'
  flowtrace diff base.jsonl actual.jsonl --ignore-method 'app.Logger.*' --json`)
  // Usage errors (missing argument, unknown option) exit 2, not commander's
  // default 1: in this command 1 means "the traces differ".
  .exitOverride((err) => process.exit(err.exitCode === 0 ? 0 : 2))
  .action(async (base, actual, options) => {
    // exitCode rather than process.exit(): a --json result piped to another
    // process must be flushed before the process ends.
    process.exitCode = await require('../lib/commands/diff')(base, actual, options);
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
