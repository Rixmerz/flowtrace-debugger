"""
Flask Advanced Example - Complete REST API with FlowTrace
Demonstrates: CRUD operations, database simulation, custom spans, error handling
"""

from flask import Flask, request, jsonify
import time
import random
from flowtrace_agent import Config, start_tracing, trace, init_decorator_logger
from flowtrace_agent.frameworks.flask import init_flowtrace

# Initialize Flask app
app = Flask(__name__)

# Configure FlowTrace
config = Config(
    package_prefix='__main__',
    logfile='flowtrace-flask.jsonl',
    stdout=True,
    max_arg_length=500
)

# Initialize decorator logger
init_decorator_logger(config)

# Initialize FlowTrace for Flask
init_flowtrace(app, config)


# Database simulation
class Database:
    """Simulated database with latency"""

    def __init__(self):
        self.users = {
            1: {'id': 1, 'name': 'Alice', 'email': 'alice@example.com', 'age': 30},
            2: {'id': 2, 'name': 'Bob', 'email': 'bob@example.com', 'age': 25},
            3: {'id': 3, 'name': 'Charlie', 'email': 'charlie@example.com', 'age': 35},
        }
        self.next_id = 4

    @trace
    def get_user(self, user_id: int):
        """Get user by ID"""
        # Simulate database latency
        time.sleep(random.uniform(0.01, 0.05))
        return self.users.get(user_id)

    @trace
    def list_users(self, limit: int = 100):
        """List all users"""
        time.sleep(random.uniform(0.02, 0.08))
        users = list(self.users.values())
        return users[:limit]

    @trace
    def create_user(self, name: str, email: str, age: int):
        """Create new user"""
        time.sleep(random.uniform(0.03, 0.1))

        user = {
            'id': self.next_id,
            'name': name,
            'email': email,
            'age': age
        }

        self.users[self.next_id] = user
        self.next_id += 1

        return user

    @trace
    def update_user(self, user_id: int, **fields):
        """Update user fields"""
        time.sleep(random.uniform(0.02, 0.07))

        if user_id not in self.users:
            return None

        user = self.users[user_id]

        for key, value in fields.items():
            if key in user and key != 'id':
                user[key] = value

        return user

    @trace
    def delete_user(self, user_id: int):
        """Delete user"""
        time.sleep(random.uniform(0.01, 0.04))

        if user_id in self.users:
            del self.users[user_id]
            return True

        return False

    @trace
    def search_users(self, query: str):
        """Search users by name or email"""
        time.sleep(random.uniform(0.05, 0.15))

        query_lower = query.lower()
        results = []

        for user in self.users.values():
            if (query_lower in user['name'].lower() or
                query_lower in user['email'].lower()):
                results.append(user)

        return results


# Initialize database
db = Database()


# Validation helpers
@trace
def validate_user_data(data):
    """Validate user data"""
    errors = []

    if 'name' not in data or not data['name']:
        errors.append('Name is required')
    elif len(data['name']) < 2:
        errors.append('Name must be at least 2 characters')

    if 'email' not in data or not data['email']:
        errors.append('Email is required')
    elif '@' not in data['email']:
        errors.append('Invalid email format')

    if 'age' in data:
        try:
            age = int(data['age'])
            if age < 0 or age > 150:
                errors.append('Age must be between 0 and 150')
        except (ValueError, TypeError):
            errors.append('Age must be a number')

    return errors


# Routes
@app.route('/health', methods=['GET'])
@trace
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'flask-advanced',
        'timestamp': int(time.time() * 1000)
    })


@app.route('/users', methods=['GET'])
@trace
def list_users():
    """List all users"""
    try:
        limit = request.args.get('limit', 100, type=int)
        users = db.list_users(limit)

        return jsonify({
            'users': users,
            'count': len(users)
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/users/<int:user_id>', methods=['GET'])
@trace
def get_user(user_id):
    """Get user by ID"""
    try:
        user = db.get_user(user_id)

        if user is None:
            return jsonify({'error': 'User not found'}), 404

        return jsonify(user)

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/users', methods=['POST'])
@trace
def create_user():
    """Create new user"""
    try:
        data = request.get_json()

        if not data:
            return jsonify({'error': 'Request body is required'}), 400

        # Validate data
        errors = validate_user_data(data)
        if errors:
            return jsonify({'error': 'Validation failed', 'details': errors}), 400

        # Create user
        user = db.create_user(
            name=data['name'],
            email=data['email'],
            age=data.get('age', 0)
        )

        return jsonify(user), 201

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/users/<int:user_id>', methods=['PUT'])
@trace
def update_user(user_id):
    """Update user"""
    try:
        data = request.get_json()

        if not data:
            return jsonify({'error': 'Request body is required'}), 400

        # Validate data
        errors = validate_user_data(data)
        if errors:
            return jsonify({'error': 'Validation failed', 'details': errors}), 400

        # Update user
        user = db.update_user(user_id, **data)

        if user is None:
            return jsonify({'error': 'User not found'}), 404

        return jsonify(user)

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/users/<int:user_id>', methods=['DELETE'])
@trace
def delete_user(user_id):
    """Delete user"""
    try:
        success = db.delete_user(user_id)

        if not success:
            return jsonify({'error': 'User not found'}), 404

        return jsonify({'message': 'User deleted successfully'})

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/users/search', methods=['GET'])
@trace
def search_users():
    """Search users"""
    try:
        query = request.args.get('q', '')

        if not query:
            return jsonify({'error': 'Query parameter "q" is required'}), 400

        results = db.search_users(query)

        return jsonify({
            'results': results,
            'count': len(results),
            'query': query
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    print("🚀 Flask Advanced Example - FlowTrace enabled")
    print("📊 Traces will be written to: flowtrace-flask.jsonl")
    print("🌐 Server running on http://localhost:5000")
    print("\n💡 Try these endpoints:")
    print("  GET    /health")
    print("  GET    /users")
    print("  GET    /users/1")
    print("  POST   /users")
    print("  PUT    /users/1")
    print("  DELETE /users/1")
    print("  GET    /users/search?q=alice")

    app.run(debug=True, port=5000)
