"""
FlowTrace Python Agent
Intelligent tracing for Python applications with AI-powered analysis
"""

from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="flowtrace-agent",
    version="1.0.0",
    author="Juan Pablo Diaz",
    author_email="jpablo@rixmerz.dev",
    description="Python instrumentation agent for FlowTrace - runtime execution tracing",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/Rixmerz/flowtrace-debugger",
    project_urls={
        "Bug Tracker": "https://github.com/Rixmerz/flowtrace-debugger/issues",
        "Documentation": "https://github.com/Rixmerz/flowtrace-debugger#readme",
    },
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "Topic :: Software Development :: Debuggers",
        "Topic :: Software Development :: Testing",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
    ],
    packages=find_packages(),
    python_requires=">=3.8",
    install_dependencies=[],
    extras_require={
        "async": ["aiofiles>=23.0.0"],
        "django": ["django>=3.2"],
        "flask": ["flask>=2.0"],
        "fastapi": ["fastapi>=0.68.0"],
    },
    entry_points={
        "console_scripts": [
            "flowtrace-python=flowtrace_agent.cli:main",
        ],
    },
    keywords="tracing debugging instrumentation profiling monitoring flowtrace ai-debugging",
    license="MIT",
)
