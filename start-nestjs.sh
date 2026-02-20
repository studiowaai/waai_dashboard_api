#!/bin/bash

echo "🚀 NestJS Migration - Quick Start"
echo "=================================="
echo ""

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    echo "Please install Node.js 20 or higher"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "⚠️  Warning: Node.js version is $NODE_VERSION, but 20+ is recommended"
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed"
    exit 1
fi

echo "✅ Node.js $(node -v)"
echo "✅ npm v$(npm -v)"
echo ""

# Install dependencies
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
else
    echo "✅ Dependencies already installed"
    echo ""
fi

# Check for .env file
if [ ! -f ".env" ]; then
    echo "⚠️  No .env file found"
    echo "Please create a .env file with the following variables:"
    echo ""
    echo "DATABASE_URL=postgresql://user:password@localhost:5432/dbname"
    echo "JWT_SECRET=your-secret-key"
    echo "JWT_EXPIRE_MIN=43200"
    echo "CORS_ORIGIN=http://localhost:3000"
    echo "PORT=3000"
    echo ""
    read -p "Do you want to continue without .env? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo "✅ .env file found"
    echo ""
fi

echo "🎯 Ready to start!"
echo ""
echo "Available commands:"
echo "  npm run start:dev    - Start in development mode (hot reload)"
echo "  npm run build        - Build for production"
echo "  npm run start:prod   - Start in production mode"
echo "  npm run lint         - Run linter"
echo "  npm run test         - Run tests"
echo ""

read -p "Start development server now? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🚀 Starting development server..."
    echo ""
    npm run start:dev
fi
