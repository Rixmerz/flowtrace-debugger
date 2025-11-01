#!/usr/bin/env python3
"""
Test script to validate FlowTrace Python agent traces private methods.

Tests:
1. Public methods
2. Single underscore private methods (_private)
3. Double underscore private methods (__private - name mangling)
"""

import time
from flowtrace_agent import Config, start_tracing


class UserService:
    """User service with public and private methods"""

    def __init__(self):
        self.users = {
            42: {'id': 42, 'name': 'User42', 'email': 'user42@example.com'},
            999: {'id': 999, 'name': 'Invalid', 'email': 'not-an-email'}
        }

    # PUBLIC METHOD
    def load_user(self, user_id):
        """Public method - Load user by ID"""
        print(f"\n[PUBLIC] load_user({user_id})")
        self._sleep(50)
        self._validate_user_id(user_id)
        return self.__internal_load(user_id)

    # PUBLIC METHOD
    def save_user(self, user):
        """Public method - Save user"""
        print(f"\n[PUBLIC] save_user({user['name']})")
        self._sleep(30)
        email = user['email']
        if not self._is_valid_email(email):
            raise ValueError(f"Invalid email: {email}")
        self.users[user['id']] = user
        return user

    # SINGLE UNDERSCORE - Private by convention
    def _validate_user_id(self, user_id):
        """Private method - Validate user ID"""
        print(f"  [_PRIVATE] _validate_user_id({user_id})")
        if user_id <= 0:
            raise ValueError(f"Invalid user ID: {user_id}")

    # SINGLE UNDERSCORE - Private by convention
    def _is_valid_email(self, email):
        """Private method - Validate email format"""
        print(f"  [_PRIVATE] _is_valid_email({email})")
        return '@' in email if email else False

    # SINGLE UNDERSCORE - Private by convention
    def _sleep(self, millis):
        """Private method - Sleep simulation"""
        print(f"  [_PRIVATE] _sleep({millis}ms)")
        time.sleep(millis / 1000.0)

    # DOUBLE UNDERSCORE - Private with name mangling
    def __internal_load(self, user_id):
        """Very private method - Internal load with name mangling"""
        print(f"  [__PRIVATE] __internal_load({user_id})")
        return self.users.get(user_id, None)


class OrderService:
    """Order service with public and private methods"""

    # PUBLIC METHOD
    def process_order(self, order_id, amount):
        """Public method - Process order"""
        print(f"\n[PUBLIC] process_order({order_id}, {amount})")
        self.__validate_amount(amount)
        self._sleep(100)
        return {'id': order_id, 'amount': amount, 'status': 'COMPLETED'}

    # PUBLIC METHOD
    def cancel_order(self, order_id):
        """Public method - Cancel order"""
        print(f"\n[PUBLIC] cancel_order({order_id})")
        self._sleep(30)
        self.__internal_audit(order_id)

    # DOUBLE UNDERSCORE - Private with name mangling
    def __validate_amount(self, amount):
        """Very private method - Validate amount"""
        print(f"  [__PRIVATE] __validate_amount({amount})")
        if amount <= 0:
            raise ValueError("Amount must be positive")

    # DOUBLE UNDERSCORE - Private with name mangling
    def __internal_audit(self, order_id):
        """Very private method - Internal audit"""
        print(f"  [__PRIVATE] __internal_audit({order_id})")
        print(f"    Auditing order {order_id}")

    # SINGLE UNDERSCORE - Private by convention
    def _sleep(self, millis):
        """Private method - Sleep simulation"""
        print(f"  [_PRIVATE] _sleep({millis}ms)")
        time.sleep(millis / 1000.0)


def run_user_scenario():
    """Test scenario for UserService"""
    print("\n" + "="*60)
    print("SCENARIO 1: User Service - Success Case")
    print("="*60)

    service = UserService()

    # Test 1: Load user (should call private methods)
    user = service.load_user(42)
    print(f"✅ Loaded user: {user}")

    # Test 2: Save user (should call private methods)
    service.save_user(user)
    print(f"✅ Saved user: {user['name']}")


def run_error_scenario():
    """Test scenario with errors"""
    print("\n" + "="*60)
    print("SCENARIO 2: Error Handling")
    print("="*60)

    service = UserService()

    # Test 3: Invalid email (should call _is_valid_email and raise error)
    try:
        invalid_user = {'id': 999, 'name': 'Invalid', 'email': 'not-an-email'}
        service.save_user(invalid_user)
    except ValueError as e:
        print(f"❌ Expected error: {e}")

    # Test 4: Invalid user ID (should call _validate_user_id and raise error)
    try:
        service.load_user(-1)
    except ValueError as e:
        print(f"❌ Expected error: {e}")


def run_order_scenario():
    """Test scenario for OrderService"""
    print("\n" + "="*60)
    print("SCENARIO 3: Order Service")
    print("="*60)

    service = OrderService()

    # Test 5: Process order (should call __validate_amount)
    order = service.process_order(101, 99.99)
    print(f"✅ Processed order: {order}")

    # Test 6: Cancel order (should call __internal_audit)
    service.cancel_order(101)
    print(f"✅ Cancelled order 101")


def main():
    """Main test execution"""
    print("\n" + "="*60)
    print("FlowTrace Python Agent - Private Methods Test")
    print("="*60)

    # Configure FlowTrace
    # NOTE: package_prefix='' means trace ALL non-stdlib modules
    # This avoids the '__main__' exclusion issue
    config = Config(
        package_prefix='',  # Empty = trace all non-stdlib
        logfile='flowtrace-python-private.jsonl',
        stdout=False,
        max_arg_length=500,
        exclude_patterns=['flowtrace_agent']  # Exclude the agent itself
    )

    print(f"\n📊 FlowTrace Configuration:")
    print(f"  - Package prefix: {config.package_prefix}")
    print(f"  - Log file: {config.logfile}")
    print(f"  - Stdout: {config.stdout}")

    # Start tracing
    start_tracing(config)
    print(f"\n✅ FlowTrace agent started")

    try:
        # Run test scenarios
        run_user_scenario()
        run_order_scenario()
        run_error_scenario()

    finally:
        print("\n" + "="*60)
        print("Test Execution Complete")
        print("="*60)
        print(f"\n📄 Trace logs written to: {config.logfile}")
        print(f"\n💡 Analyze logs:")
        print(f"  cat {config.logfile} | jq .")
        print(f"  cat {config.logfile} | jq -r '.method' | sort | uniq")


if __name__ == '__main__':
    main()
