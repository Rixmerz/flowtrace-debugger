package io.flowtrace.extension;

import net.bytebuddy.asm.Advice;
import net.bytebuddy.description.method.MethodDescription;
import net.bytebuddy.description.type.TypeDescription;
import net.bytebuddy.implementation.bytecode.StackManipulation;
import net.bytebuddy.implementation.bytecode.assign.Assigner;
import net.bytebuddy.implementation.bytecode.constant.IntegerConstant;
import net.bytebuddy.implementation.bytecode.constant.TextConstant;

/**
 * Binds {@code @SourceFile String} and {@code @SourceLine int} advice
 * parameters to constants taken from {@link SourceLocations}, so each woven
 * method loads its own location with a single {@code ldc} / {@code sipush}.
 *
 * <p>"Unknown" is the empty string and {@code 0}, not {@code null}: both are
 * plain constants in every ByteBuddy version, and neither is a value a real
 * location can take.
 */
final class SourceLocationMapping implements Advice.OffsetMapping {

    static final SourceLocationMapping FILE = new SourceLocationMapping(false);
    static final SourceLocationMapping LINE = new SourceLocationMapping(true);

    private final boolean line;

    private SourceLocationMapping(boolean line) {
        this.line = line;
    }

    @Override
    public Target resolve(TypeDescription instrumentedType,
                          MethodDescription instrumentedMethod,
                          Assigner assigner,
                          Advice.ArgumentHandler argumentHandler,
                          Sort sort) {
        SourceLocations locations = SourceLocations.current(instrumentedType.getName());
        StackManipulation constant;
        if (line) {
            constant = IntegerConstant.forValue(locations.firstLine(
                    instrumentedMethod.getInternalName(), instrumentedMethod.getDescriptor()));
        } else {
            String file = locations.file();
            constant = new TextConstant(file == null ? "" : file);
        }
        return new Target.ForStackManipulation(constant);
    }
}
