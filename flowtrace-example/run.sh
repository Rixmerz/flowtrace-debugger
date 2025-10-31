#!/bin/bash

# Script de ejecución para la aplicación de ejemplo con FlowTrace Agent

set -e

AGENT_JAR="../flowtrace-agent/target/flowtrace-agent-1.0.0.jar"
APP_JAR="target/flowtrace-example-1.0.0.jar"

echo "======================================"
echo "  Running FlowTrace Example"
echo "======================================"

# Verificar que el agente existe
if [ ! -f "$AGENT_JAR" ]; then
    echo "❌ Error: Agent JAR not found at $AGENT_JAR"
    echo "Run 'cd ../flowtrace-agent && ./build.sh' first"
    exit 1
fi

# Verificar que la app existe
if [ ! -f "$APP_JAR" ]; then
    echo "❌ Error: Example JAR not found at $APP_JAR"
    echo "Run 'mvn package' first"
    exit 1
fi

# Limpiar log anterior
rm -f flowtrace.jsonl

# Configurar modo de ejecución
MODE=${1:-"full"}  # full | annotation | package

case $MODE in
    "full")
        echo "🚀 Running in FULL mode (all methods instrumented)"
        java -javaagent:$AGENT_JAR \
             -Dflowtrace.stdout=true \
             -jar $APP_JAR
        ;;
    "annotation")
        echo "🎯 Running in ANNOTATION mode (only @FlowTrace methods)"
        java -javaagent:$AGENT_JAR \
             -Dflowtrace.annotation-only=true \
             -Dflowtrace.stdout=true \
             -jar $APP_JAR
        ;;
    "package")
        echo "📦 Running in PACKAGE mode (only io.flowtrace.example)"
        java -javaagent:$AGENT_JAR \
             -Dflowtrace.package-prefix=io.flowtrace.example \
             -Dflowtrace.stdout=false \
             -jar $APP_JAR
        ;;
    *)
        echo "❌ Invalid mode: $MODE"
        echo "Usage: ./run.sh [full|annotation|package]"
        exit 1
        ;;
esac

echo ""
echo "✅ Execution completed"
echo "📄 Log file: flowtrace.jsonl"
echo ""
echo "View logs:"
echo "  cat flowtrace.jsonl | jq ."
