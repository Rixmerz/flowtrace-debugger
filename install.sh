#!/bin/bash

# Script de instalación de FlowTrace Agent
# Este script instala FlowTrace en tu repositorio Maven local

set -e

echo "=========================================="
echo "  FlowTrace Agent - Installation Script"
echo "=========================================="
echo ""

# Verificar que Maven está instalado
if ! command -v mvn &> /dev/null; then
    echo "❌ Error: Maven no está instalado"
    echo "   Instala Maven primero: https://maven.apache.org/install.html"
    exit 1
fi

# Verificar que estamos en el directorio correcto
if [ ! -f "flowtrace-agent/pom.xml" ]; then
    echo "❌ Error: Debes ejecutar este script desde el directorio raíz de flowtrace"
    exit 1
fi

echo "📦 Compilando FlowTrace Agent..."
cd flowtrace-agent
mvn clean install -DskipTests

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ FlowTrace Agent instalado exitosamente!"
    echo ""
    echo "📍 Ubicación:"
    echo "   $HOME/.m2/repository/io/flowtrace/flowtrace-agent/1.0.0/"
    echo ""
    echo "🚀 Uso en tu proyecto:"
    echo ""
    echo "   # 1. Agrega la dependencia a tu pom.xml (opcional, solo para @FlowTrace):"
    echo "   <dependency>"
    echo "       <groupId>io.flowtrace</groupId>"
    echo "       <artifactId>flowtrace-agent</artifactId>"
    echo "       <version>1.0.0</version>"
    echo "       <scope>provided</scope>"
    echo "   </dependency>"
    echo ""
    echo "   # 2. Ejecuta tu aplicación:"
    echo "   java -javaagent:\$HOME/.m2/repository/io/flowtrace/flowtrace-agent/1.0.0/flowtrace-agent-1.0.0.jar \\"
    echo "        -jar tu-aplicacion.jar"
    echo ""
    echo "📚 Documentación completa: USAGE_GUIDE.md"
else
    echo ""
    echo "❌ Error durante la instalación"
    exit 1
fi
