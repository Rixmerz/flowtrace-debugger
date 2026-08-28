package fixture

/*
#include <stdlib.h>
*/
import "C"

func UseC() {
	_ = C.malloc
}
