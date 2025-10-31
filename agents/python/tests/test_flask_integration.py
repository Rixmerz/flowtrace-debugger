"""
Integration tests for Flask framework
"""

import pytest
import json
import tempfile
from flask import Flask
from flowtrace_agent import Config, init_decorator_logger
from flowtrace_agent.frameworks.flask import init_flowtrace


def test_flask_integration():
    """Test Flask integration"""
    app = Flask(__name__)

    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.jsonl') as f:
        logfile = f.name

    config = Config(
        package_prefix='__main__',
        logfile=logfile,
        stdout=False
    )

    init_flowtrace(app, config)

    @app.route('/test')
    def test_route():
        return {'message': 'test'}

    # Test client
    client = app.test_client()
    response = client.get('/test')

    assert response.status_code == 200
    assert response.json['message'] == 'test'


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
