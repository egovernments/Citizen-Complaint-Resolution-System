// Package config provides configuration loading for the service.
package config

import (
	"os"
	"strconv"
	"time"
)

// Config holds all configuration for the service.
type Config struct {
	Server   ServerConfig
	Database DatabaseConfig
}

// ServerConfig holds HTTP server configuration.
type ServerConfig struct {
	Port            string
	ContextPath     string
	ReadTimeout     time.Duration
	WriteTimeout    time.Duration
	ShutdownTimeout time.Duration
}

// DatabaseConfig holds PostgreSQL connection configuration.
type DatabaseConfig struct {
	Host            string
	Port            string
	User            string
	Password        string
	Name            string
	SSLMode         string
	MaxConns        int32
	MinConns        int32
	MaxConnLifetime time.Duration
	MaxConnIdleTime time.Duration
}

// Load loads configuration from environment variables with defaults.
func Load() *Config {
	return &Config{
		Server: ServerConfig{
			Port:            getEnv("SERVER_PORT", "8080"),
			ContextPath:     getEnv("SERVER_CONTEXT_PATH", "/user-preferences"),
			ReadTimeout:     getDurationEnv("SERVER_READ_TIMEOUT", 15*time.Second),
			WriteTimeout:    getDurationEnv("SERVER_WRITE_TIMEOUT", 15*time.Second),
			ShutdownTimeout: getDurationEnv("SERVER_SHUTDOWN_TIMEOUT", 30*time.Second),
		},
		Database: DatabaseConfig{
			Host:            getEnv("DB_HOST", "localhost"),
			Port:            getEnv("DB_PORT", "5432"),
			User:            getEnv("DB_USER", "postgres"),
			Password:        getEnv("DB_PASSWORD", ""),
			Name:            getEnv("DB_NAME", "user_preferences"),
			SSLMode:         getEnv("DB_SSL_MODE", "disable"),
			MaxConns:        getInt32Env("DB_MAX_CONNS", 25),
			MinConns:        getInt32Env("DB_MIN_CONNS", 5),
			MaxConnLifetime: getDurationEnv("DB_MAX_CONN_LIFETIME", 1*time.Hour),
			MaxConnIdleTime: getDurationEnv("DB_MAX_CONN_IDLE_TIME", 30*time.Minute),
		},
	}
}

// ConnectionString returns the PostgreSQL connection string.
func (d *DatabaseConfig) ConnectionString() string {
	return "postgres://" + d.User + ":" + d.Password + "@" + d.Host + ":" + d.Port + "/" + d.Name + "?sslmode=" + d.SSLMode
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getInt32Env(key string, defaultValue int32) int32 {
	if value := os.Getenv(key); value != "" {
		if parsed, err := strconv.ParseInt(value, 10, 32); err == nil {
			return int32(parsed)
		}
	}
	return defaultValue
}

func getDurationEnv(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		if parsed, err := time.ParseDuration(value); err == nil {
			return parsed
		}
	}
	return defaultValue
}
