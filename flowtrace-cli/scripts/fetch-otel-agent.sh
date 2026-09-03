#!/bin/sh
# fetch-otel-agent.sh — Downloads the OpenTelemetry javaagent into vendor/java.
#
# The version and digest MUST match lib/assets.js (OTEL_VERSION / OTEL_SHA256):
# this script and that module fetch the same artifact for the same purpose, and
# they used to pin different versions — so a vendored jar and a cache-fetched
# jar were two different agents depending on which path ran first.
#
# The jar is handed to the JVM as `-javaagent:`, i.e. it runs before the
# application's main(). The digest is verified before it is put in place; a
# mismatch deletes the download and exits non-zero.
#
# Idempotent: skips the download if a verified jar already exists.
set -e

VENDOR_DIR="$(cd "$(dirname "$0")/../vendor/java" && pwd)"
JAR_NAME="opentelemetry-javaagent.jar"
JAR_PATH="$VENDOR_DIR/$JAR_NAME"
VERSION="2.30.0"
SHA256="9d6bc2ad8dd8fb7f730984988e57b8ac0a82d81c7b3b8ae795378718733a509d"
URL="https://repo1.maven.org/maven2/io/opentelemetry/javaagent/opentelemetry-javaagent/${VERSION}/opentelemetry-javaagent-${VERSION}.jar"

verify() {
  # Prints the sha256 of "$1", using whichever tool this machine has.
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    echo ""
  fi
}

if [ -f "$JAR_PATH" ]; then
  echo "  [ok] $JAR_PATH ya existe — omitiendo descarga."
  exit 0
fi

echo "  [fetch] Descargando opentelemetry-javaagent ${VERSION}..."
TMP="$JAR_PATH.partial"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL --proto '=https' --max-time 300 -o "$TMP" "$URL"
elif command -v wget >/dev/null 2>&1; then
  wget -q --https-only --timeout=300 -O "$TMP" "$URL"
else
  echo "  [error] curl o wget requeridos para descargar el agente OTel."
  exit 1
fi

ACTUAL="$(verify "$TMP")"
if [ -z "$ACTUAL" ]; then
  rm -f "$TMP"
  echo "  [error] no hay sha256sum ni shasum para verificar la descarga; se descartó el archivo."
  exit 1
fi
if [ "$ACTUAL" != "$SHA256" ]; then
  rm -f "$TMP"
  echo "  [error] checksum sha256 no coincide: esperado $SHA256, obtenido $ACTUAL."
  echo "          El archivo se descartó y no se cargó nada en la JVM."
  exit 1
fi

mv "$TMP" "$JAR_PATH"
echo "  [ok] Descargado y verificado en $JAR_PATH"
