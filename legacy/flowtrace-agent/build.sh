#!/bin/bash

# Script de compilación para FlowTrace Agent

set -e  # Exit on error

echo "======================================"
echo "  Building FlowTrace Agent"
echo "======================================"

# Verificar que Maven está instalado
if ! command -v mvn &> /dev/null; then
    echo "❌ Error: Maven no está instalado. Instala Maven primero."
    exit 1
fi

# Limpiar builds anteriores
echo "🧹 Cleaning previous builds..."
mvn clean

# Compilar y empaquetar
echo "📦 Building agent JAR..."
mvn package -DskipTests

# Verificar que el JAR fue creado
AGENT_JAR="target/flowtrace-agent-1.0.0.jar"
if [ -f "$AGENT_JAR" ]; then
    echo "✅ Build successful!"
    echo "📍 Agent JAR: $AGENT_JAR"
    echo ""
    echo "Usage:"
    echo "  java -javaagent:$AGENT_JAR -jar your-app.jar"
else
    echo "❌ Build failed - JAR not found"
    exit 1
fi

echo ""
echo "Optional System Properties:"
echo "  -Dflowtrace.annotation-only=true    # Solo instrumentar métodos con @FlowTrace"
echo "  -Dflowtrace.package-prefix=com.app  # Solo instrumentar paquete específico"
echo "  -Dflowtrace.logfile=custom.jsonl    # Cambiar archivo de log (default: flowtrace.jsonl)"
echo "  -Dflowtrace.stdout=true             # También imprimir logs a stdout"
