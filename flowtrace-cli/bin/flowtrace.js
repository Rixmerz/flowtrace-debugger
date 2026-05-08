#!/usr/bin/env node
/**
 * FlowTrace v2 CLI — slim dispatcher.
 * Three commands only: init, run, analyze.
 */

'use strict';

const { program } = require('commander');
const chalk = require('chalk');
const pkg = require('../package.json');

program
  .name('flowtrace')
  .description('FlowTrace v2 — captura full call trace sin tocar tu código (Java, Python, Node, TS)')
  .version(pkg.version, '-v, --version', 'imprime la versión actual');

program
  .command('init')
  .description('Inicializa FlowTrace en el proyecto actual (.flowtrace/config.json)')
  .option('--lang <lang>', 'Forza el lenguaje: java|python|node|ts')
  .option('-y, --yes', 'Acepta valores por defecto')
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
  --lang <java|python|node|ts>   Lenguaje del proyecto (auto-detectado si se omite)
  --package-prefix <pkg>         Prefijo de paquete a instrumentar (Java/Python)
  --inject <mvn|gradle|java>     Estrategia de inyección JVM (default: auto)
  --output <path>                Ruta del JSONL (default: .flowtrace/<ISO-UTC>.jsonl)

Auto-detección:
  Sin --lang el CLI detecta el lenguaje según archivos del proyecto:
    Java   : pom.xml, build.gradle, build.gradle.kts
    Python : pyproject.toml, setup.py, requirements.txt
    Node   : package.json (ts si tsconfig.json también existe)

Ejemplos:
  flowtrace run -- node app.js
  flowtrace run -- python main.py
  flowtrace run -- java -jar app.jar
  flowtrace run --lang java --package-prefix com.example -- java -jar app.jar
  flowtrace run --lang java -- mvn spring-boot:run`)
  .option('--lang <lang>', 'Lenguaje de la app: java|python|node|ts (auto-detectado si se omite)')
  .option('--package-prefix <pkg>', 'Prefijo de paquete a instrumentar (Java)')
  .option('--inject <strategy>', 'Estrategia de inyección JVM: mvn|gradle|java (default: auto)')
  .option('-o, --out <path>', 'Ruta de salida JSONL (default: .flowtrace/<ISO>.jsonl)')
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

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
