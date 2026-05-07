#!/bin/sh
# fetch-otel-agent.sh — Downloads opentelemetry-javaagent-2.27.0.jar from Maven Central.
# Idempotent: skips download if the jar already exists.
set -e

VENDOR_DIR="$(cd "$(dirname "$0")/../vendor/java" && pwd)"
JAR_NAME="opentelemetry-javaagent.jar"
JAR_PATH="$VENDOR_DIR/$JAR_NAME"
VERSION="2.27.0"
URL="https://repo1.maven.org/maven2/io/opentelemetry/javaagent/opentelemetry-javaagent/${VERSION}/opentelemetry-javaagent-${VERSION}.jar"

if [ -f "$JAR_PATH" ]; then
  echo "  [ok] $JAR_PATH ya existe — omitiendo descarga."
  exit 0
fi

echo "  [fetch] Descargando opentelemetry-javaagent ${VERSION}..."
if command -v curl >/dev/null 2>&1; then
  curl -fsSL -o "$JAR_PATH" "$URL"
elif command -v wget >/dev/null 2>&1; then
  wget -q -O "$JAR_PATH" "$URL"
else
  echo "  [error] curl o wget requeridos para descargar el agente OTel."
  exit 1
fi
echo "  [ok] Descargado en $JAR_PATH"
