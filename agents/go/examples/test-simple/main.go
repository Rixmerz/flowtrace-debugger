package main

import (
	"fmt"

	"github.com/rixmerz/flowtrace-agent-go/flowtrace"
)

// Simple function with single return
func add(x, y int) (__ft_ret0 int) {
	__ft_ctx := flowtrace.

		// Function with multiple returns (error handling)
		Enter("", "add", map[string]interface {
		}{"x": x, "y": y})
	defer func() {
		if r := recover(); r != nil {
			__ft_ctx.ExceptionString(fmt.Sprintf("panic: %v", r))
			panic(r)
		}
	}()
	defer __ft_ctx.Exit(

		// Function with conditional returns
		func() interface {
		} {
			return map[string]interface {
			}{"result_0": __ft_ret0}
		})
	__ft_ret0 = x + y
	return
}

func divide(x, y int) (__ft_ret0 int, __ft_ret1 error) {
	__ft_ctx := flowtrace.Enter("", "divide", map[string]interface {
	}{"x": x, "y": y})
	defer func() {
		if r := recover(); r != nil {
			__ft_ctx.ExceptionString(fmt.Sprintf("panic: %v", r))
			panic(r)
		}
	}()
	defer __ft_ctx.

		// Void function
		Exit(func() interface {
		} {
			return map[string]interface {
			}{"result_0": __ft_ret0, "result_1": __ft_ret1}
		})
	if y == 0 {
		__ft_ret0, __ft_ret1 = 0, fmt.Errorf("division by zero")
		return
	}
	__ft_ret0, __ft_ret1 = x/y, nil
	return
}

func abs(x int) (__ft_ret0 int) {
	__ft_ctx := flowtrace.Enter("", "abs", map[string]interface {
	}{"x": x})
	defer func() {
		if r := recover(); r != nil {
			__ft_ctx.ExceptionString(fmt.Sprintf("panic: %v", r))
			panic(r)
		}
	}()
	defer __ft_ctx.Exit(func() interface {
	} {
		return map[string]interface {
		}{"result_0": __ft_ret0}
	})
	if x < 0 {
		__ft_ret0 = -x
		return
	}
	__ft_ret0 = x
	return
}

func printSum(x, y int) {
	__ft_ctx := flowtrace.Enter("", "printSum", map[string]interface {
	}{"x": x, "y": y})
	defer func() {
		if r := recover(); r != nil {
			__ft_ctx.ExceptionString(fmt.Sprintf("panic: %v", r))
			panic(r)
		}
	}()
	defer __ft_ctx.

		// Test 1: Simple function
		Exit(nil)
	result := x + y
	fmt.Printf("%d + %d = %d\n", x, y, result)
}

func main() {
	__ft_ctx := flowtrace.Enter("", "main", map[string]interface {
	}{})
	defer func() {
		if r := recover(); r != nil {
			__ft_ctx.ExceptionString(fmt.Sprintf("panic: %v", r))
			panic(r)
		}
	}()
	defer __ft_ctx.Exit(nil)
	fmt.Println("FlowTrace Go - Simple Test Example")
	fmt.Println("===================================")

	result1 := add(5, 3)
	fmt.Printf("add(5, 3) = %d\n", result1)

	// Test 2: Function with error handling
	result2, err := divide(10, 2)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	} else {
		fmt.Printf("divide(10, 2) = %d\n", result2)
	}

	// Test 3: Conditional returns
	result3 := abs(-42)
	fmt.Printf("abs(-42) = %d\n", result3)

	// Test 4: Void function
	printSum(7, 8)

	fmt.Println("\n✅ All tests completed")
}
