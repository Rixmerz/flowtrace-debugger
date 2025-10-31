#!/bin/bash

###############################################################################
# Test FlowTrace Exclusions
# Verifies that Spring Framework classes are properly excluded
###############################################################################

set -e

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║         FlowTrace Exclusion Verification Test            ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# Check if agent exists
if [ ! -f "flowtrace-agent/target/flowtrace-agent-1.0.0.jar" ]; then
    echo "❌ Agent JAR not found. Building..."
    cd flowtrace-agent
    mvn clean package -DskipTests
    cd ..
fi

# Check if example exists
if [ ! -f "flowtrace-example/target/flowtrace-example-1.0.0.jar" ]; then
    echo "❌ Example JAR not found. Building..."
    cd flowtrace-example
    mvn clean package -DskipTests
    cd ..
fi

echo "✅ Agent and example JARs found"
echo ""

# Test 1: Run WITHOUT package-prefix (should see some framework noise)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 Test 1: Running WITHOUT package-prefix filter"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd flowtrace-example
rm -f flowtrace.log

java -javaagent:../flowtrace-agent/target/flowtrace-agent-1.0.0.jar \
     -jar target/flowtrace-example-1.0.0.jar > /dev/null 2>&1

if [ -f flowtrace.log ]; then
    total_lines=$(wc -l < flowtrace.log)
    unique_classes=$(jq -r '.className' flowtrace.log | sort -u | wc -l)
    spring_classes=$(jq -r '.className' flowtrace.log | grep -c "^org\.springframework\." || echo "0")

    echo "📊 Results WITHOUT filter:"
    echo "   Total log entries: $total_lines"
    echo "   Unique classes: $unique_classes"
    echo "   Spring classes: $spring_classes"

    if [ "$spring_classes" -gt 0 ]; then
        echo ""
        echo "⚠️  Spring classes detected (this is expected without package-prefix):"
        jq -r '.className' flowtrace.log | grep "^org\.springframework\." | sort -u | head -5
        echo "   ... (showing first 5)"
    else
        echo "   ✅ NO Spring classes (exclusions working!)"
    fi
else
    echo "❌ No log file generated"
fi

echo ""

# Test 2: Run WITH package-prefix (should see NO framework noise)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 Test 2: Running WITH package-prefix filter"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

rm -f flowtrace.log

java -javaagent:../flowtrace-agent/target/flowtrace-agent-1.0.0.jar \
     -Dflowtrace.package-prefix=io.flowtrace.example \
     -jar target/flowtrace-example-1.0.0.jar > /dev/null 2>&1

if [ -f flowtrace.log ]; then
    total_lines=$(wc -l < flowtrace.log)
    unique_classes=$(jq -r '.className' flowtrace.log | sort -u | wc -l)
    spring_classes=$(jq -r '.className' flowtrace.log | grep -c "^org\.springframework\." || echo "0")
    example_classes=$(jq -r '.className' flowtrace.log | grep -c "^io\.flowtrace\.example\." || echo "0")

    echo "📊 Results WITH package-prefix=io.flowtrace.example:"
    echo "   Total log entries: $total_lines"
    echo "   Unique classes: $unique_classes"
    echo "   Spring classes: $spring_classes"
    echo "   Example classes: $example_classes"

    if [ "$spring_classes" -eq 0 ]; then
        echo ""
        echo "✅ SUCCESS: NO Spring classes in log!"
        echo "✅ Package-prefix filter working correctly"
    else
        echo ""
        echo "❌ FAIL: Spring classes still present:"
        jq -r '.className' flowtrace.log | grep "^org\.springframework\." | sort -u
    fi

    echo ""
    echo "📋 Classes logged (should be only io.flowtrace.example.*):"
    jq -r '.className' flowtrace.log | sort -u
else
    echo "❌ No log file generated"
fi

cd ..

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎯 Conclusion"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "For your project:"
echo ""
echo "✅ CORRECT usage:"
echo "   java -javaagent:flowtrace-agent-1.0.0.jar \\"
echo "        -Dflowtrace.package-prefix=com.example.app \\"
echo "        -jar your-app.jar"
echo ""
echo "❌ WRONG usage (will show framework noise):"
echo "   java -javaagent:flowtrace-agent-1.0.0.jar \\"
echo "        -jar your-app.jar"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
