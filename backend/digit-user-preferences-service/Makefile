.PHONY: all build test clean run docker-build docker-run lint fmt help

# Variables
BINARY_NAME=server
BUILD_DIR=./cmd/server
DOCKER_IMAGE=digit-user-preferences-service
DOCKER_TAG=latest

# Default target
all: build

# Build the binary
build:
	@echo "Building..."
	go build -o $(BINARY_NAME) $(BUILD_DIR)

# Run tests
test:
	@echo "Running tests..."
	go test -v -race -cover ./...

# Run tests with coverage report
test-coverage:
	@echo "Running tests with coverage..."
	go test -v -race -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report generated: coverage.html"

# Clean build artifacts
clean:
	@echo "Cleaning..."
	rm -f $(BINARY_NAME)
	rm -f coverage.out coverage.html

# Run the service locally
run:
	@echo "Running locally..."
	go run $(BUILD_DIR)/main.go

# Run with hot reload (requires air: go install github.com/cosmtrek/air@latest)
dev:
	@echo "Running with hot reload..."
	air

# Format code
fmt:
	@echo "Formatting code..."
	go fmt ./...

# Run linter (requires golangci-lint)
lint:
	@echo "Running linter..."
	golangci-lint run ./...

# Download dependencies
deps:
	@echo "Downloading dependencies..."
	go mod download
	go mod tidy

# Build Docker image
docker-build:
	@echo "Building Docker image..."
	docker build -t $(DOCKER_IMAGE):$(DOCKER_TAG) .

# Run with Docker Compose
docker-up:
	@echo "Starting services with Docker Compose..."
	docker-compose up -d

# Stop Docker Compose
docker-down:
	@echo "Stopping services..."
	docker-compose down

# View Docker logs
docker-logs:
	docker-compose logs -f

# Run database migrations (requires migrate tool)
migrate-up:
	@echo "Running migrations..."
	migrate -path ./db/migrations -database "$(DB_URL)" up

migrate-down:
	@echo "Rolling back migrations..."
	migrate -path ./db/migrations -database "$(DB_URL)" down 1

# Show help
help:
	@echo "Available targets:"
	@echo "  build          - Build the binary"
	@echo "  test           - Run tests"
	@echo "  test-coverage  - Run tests with coverage report"
	@echo "  clean          - Remove build artifacts"
	@echo "  run            - Run the service locally"
	@echo "  dev            - Run with hot reload (requires air)"
	@echo "  fmt            - Format code"
	@echo "  lint           - Run linter (requires golangci-lint)"
	@echo "  deps           - Download and tidy dependencies"
	@echo "  docker-build   - Build Docker image"
	@echo "  docker-up      - Start services with Docker Compose"
	@echo "  docker-down    - Stop Docker Compose services"
	@echo "  docker-logs    - View Docker logs"
	@echo "  migrate-up     - Run database migrations"
	@echo "  migrate-down   - Rollback last migration"
	@echo "  help           - Show this help"
