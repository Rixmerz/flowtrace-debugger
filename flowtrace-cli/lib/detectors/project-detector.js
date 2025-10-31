/**
 * Project Detection Module
 * Detects project type, framework, and configuration
 */

const fs = require('fs-extra');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

class ProjectDetector {
  constructor(projectPath = process.cwd()) {
    this.projectPath = projectPath;
  }

  /**
   * Detect project type (Java or Node.js)
   */
  async detectProjectType() {
    const pomPath = path.join(this.projectPath, 'pom.xml');
    const gradlePath = path.join(this.projectPath, 'build.gradle');
    const packageJsonPath = path.join(this.projectPath, 'package.json');

    if (await fs.pathExists(pomPath)) {
      return 'java-maven';
    }

    if (await fs.pathExists(gradlePath)) {
      return 'java-gradle';
    }

    if (await fs.pathExists(packageJsonPath)) {
      return 'node';
    }

    return 'unknown';
  }

  /**
   * Detect package prefix for Java projects
   */
  async detectJavaPackagePrefix() {
    const pomPath = path.join(this.projectPath, 'pom.xml');

    if (!(await fs.pathExists(pomPath))) {
      return null;
    }

    try {
      const pomContent = await fs.readFile(pomPath, 'utf8');
      const parser = new XMLParser();
      const pom = parser.parse(pomContent);

      // Try to get groupId
      const groupId = pom.project?.groupId || pom.project?.parent?.groupId;

      if (groupId) {
        return groupId;
      }

      // Fallback: try to find package from source files
      const srcPath = path.join(this.projectPath, 'src/main/java');
      if (await fs.pathExists(srcPath)) {
        const files = await fs.readdir(srcPath);
        if (files.length > 0) {
          // Return first directory as package prefix
          const firstDir = files[0];
          const fullPath = path.join(srcPath, firstDir);
          const stat = await fs.stat(fullPath);
          if (stat.isDirectory()) {
            return firstDir;
          }
        }
      }

      return null;
    } catch (error) {
      console.error('Error detecting Java package prefix:', error.message);
      return null;
    }
  }

  /**
   * Detect package prefix for Node.js projects
   */
  async detectNodePackagePrefix() {
    const packageJsonPath = path.join(this.projectPath, 'package.json');

    if (!(await fs.pathExists(packageJsonPath))) {
      return null;
    }

    try {
      const packageJson = await fs.readJson(packageJsonPath);

      // Use package name as hint
      if (packageJson.name) {
        // Convert npm package name to prefix
        // e.g., @company/api-example -> company.example
        const name = packageJson.name
          .replace(/^@/, '')
          .replace(/\//g, '.')
          .replace(/-/g, '.');
        return name;
      }

      return null;
    } catch (error) {
      console.error('Error detecting Node package prefix:', error.message);
      return null;
    }
  }

  /**
   * Detect framework
   */
  async detectFramework() {
    const projectType = await this.detectProjectType();

    if (projectType.startsWith('java')) {
      return this.detectJavaFramework();
    } else if (projectType === 'node') {
      return this.detectNodeFramework();
    }

    return 'none';
  }

  /**
   * Detect Java framework (Spring Boot, etc.)
   */
  async detectJavaFramework() {
    const pomPath = path.join(this.projectPath, 'pom.xml');

    if (!(await fs.pathExists(pomPath))) {
      return 'none';
    }

    try {
      const pomContent = await fs.readFile(pomPath, 'utf8');

      if (pomContent.includes('spring-boot-starter')) {
        return 'spring-boot';
      }

      if (pomContent.includes('micronaut')) {
        return 'micronaut';
      }

      if (pomContent.includes('quarkus')) {
        return 'quarkus';
      }

      return 'java-plain';
    } catch (error) {
      return 'none';
    }
  }

  /**
   * Detect Node.js framework
   */
  async detectNodeFramework() {
    const packageJsonPath = path.join(this.projectPath, 'package.json');

    if (!(await fs.pathExists(packageJsonPath))) {
      return 'none';
    }

    try {
      const packageJson = await fs.readJson(packageJsonPath);
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

      if (deps.express) {
        return 'express';
      }

      if (deps['@nestjs/core']) {
        return 'nestjs';
      }

      if (deps.fastify) {
        return 'fastify';
      }

      if (deps.koa) {
        return 'koa';
      }

      if (deps['@angular/core']) {
        return 'angular';
      }

      if (deps.react) {
        return 'react';
      }

      if (deps.vue) {
        return 'vue';
      }

      if (deps.next) {
        return 'nextjs';
      }

      return 'node-plain';
    } catch (error) {
      return 'none';
    }
  }

  /**
   * Detect application entry point
   */
  async detectEntryPoint() {
    const projectType = await this.detectProjectType();

    if (projectType.startsWith('java')) {
      // For Java, find JAR in target/ and return full relative path
      const targetPath = path.join(this.projectPath, 'target');
      if (await fs.pathExists(targetPath)) {
        const files = await fs.readdir(targetPath);
        const jar = files.find(f =>
          f.endsWith('.jar') &&
          !f.includes('sources') &&
          !f.includes('javadoc')
        );
        // Return full relative path from project root
        return jar ? `target/${jar}` : null;
      }
      return null;
    } else if (projectType === 'node') {
      // For Node, check package.json main or common patterns
      const packageJsonPath = path.join(this.projectPath, 'package.json');
      if (await fs.pathExists(packageJsonPath)) {
        const packageJson = await fs.readJson(packageJsonPath);

        // Check main field
        if (packageJson.main) {
          return packageJson.main;
        }

        // Check scripts.start
        if (packageJson.scripts?.start) {
          const match = packageJson.scripts.start.match(/node\s+(\S+)/);
          if (match) {
            return match[1];
          }
        }
      }

      // Fallback to common patterns
      const commonEntries = ['index.js', 'app.js', 'server.js', 'main.js', 'src/index.js', 'src/app.js'];
      for (const entry of commonEntries) {
        if (await fs.pathExists(path.join(this.projectPath, entry))) {
          return entry;
        }
      }

      return null;
    }

    return null;
  }

  /**
   * Detect shell preference
   */
  detectShell() {
    if (process.platform === 'win32') {
      return 'powershell';
    }

    const shell = process.env.SHELL || '/bin/bash';

    if (shell.includes('zsh')) {
      return 'zsh';
    }

    return 'bash';
  }

  /**
   * Detect all project information
   */
  async detectAll() {
    const projectType = await this.detectProjectType();
    const framework = await this.detectFramework();
    const entryPoint = await this.detectEntryPoint();
    const shell = this.detectShell();

    let packagePrefix = null;
    if (projectType.startsWith('java')) {
      packagePrefix = await this.detectJavaPackagePrefix();
    } else if (projectType === 'node') {
      packagePrefix = await this.detectNodePackagePrefix();
    }

    return {
      projectType,
      framework,
      packagePrefix,
      entryPoint,
      shell,
      projectPath: this.projectPath
    };
  }
}

module.exports = ProjectDetector;
