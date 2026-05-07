package io.flowtrace.extension;

import io.opentelemetry.sdk.autoconfigure.spi.AutoConfigurationCustomizerProvider;
import io.opentelemetry.sdk.autoconfigure.spi.AutoConfigurationCustomizer;

/**
 * OTel SPI entry point for the FlowTrace extension.
 *
 * <p>Registered via META-INF/services. This class performs minimal OTel SDK
 * customization — FlowTrace emits JSONL directly from advice, not via OTel
 * span batching (design §key-decision-1). We do not register a custom
 * SpanExporter; instead we let the user pass {@code -Dotel.traces.exporter=none}
 * to suppress the default OTLP exporter.
 */
public class FlowtraceExtension implements AutoConfigurationCustomizerProvider {

    @Override
    public void customize(AutoConfigurationCustomizer autoConfiguration) {
        // FlowTrace emits directly from ByteBuddy advice — no SDK exporter needed.
        // This hook exists so the SPI is discovered and the InstrumentationModule
        // is registered by the OTel agent classloader.
    }
}
