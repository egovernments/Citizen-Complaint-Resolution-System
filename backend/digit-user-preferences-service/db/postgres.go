// Package db provides database connection management.
package db

import (
	"fmt"
	"log"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/egovernments/digit-user-preferences-service/internal/config"
	"github.com/egovernments/digit-user-preferences-service/internal/model"
)

// DB is the global database connection.
var DB *gorm.DB

// Connect initializes the database connection.
func Connect(cfg *config.DatabaseConfig) error {
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		cfg.Host, cfg.Port, cfg.User, cfg.Password, cfg.Name, cfg.SSLMode)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return fmt.Errorf("failed to get database instance: %w", err)
	}

	// Configure connection pool
	sqlDB.SetMaxOpenConns(int(cfg.MaxConns))
	sqlDB.SetMaxIdleConns(int(cfg.MinConns))
	sqlDB.SetConnMaxLifetime(cfg.MaxConnLifetime)
	sqlDB.SetConnMaxIdleTime(cfg.MaxConnIdleTime)

	DB = db
	log.Println("Database connection established")

	// Auto-migrate: Create tables if they don't exist
	if err := DB.AutoMigrate(&model.PreferenceDB{}); err != nil {
		return fmt.Errorf("failed to auto-migrate database: %w", err)
	}
	log.Println("Database migration completed")

	return nil
}

// ConnectDSN initializes the database connection with a DSN string.
func ConnectDSN(dsn string) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("failed to get database instance: %w", err)
	}

	// Configure connection pool with defaults
	sqlDB.SetMaxOpenConns(25)
	sqlDB.SetMaxIdleConns(5)
	sqlDB.SetConnMaxLifetime(1 * time.Hour)
	sqlDB.SetConnMaxIdleTime(30 * time.Minute)

	return db, nil
}

// HealthCheck verifies the database connection is alive.
func HealthCheck() error {
	if DB == nil {
		return fmt.Errorf("database connection not initialized")
	}

	sqlDB, err := DB.DB()
	if err != nil {
		return err
	}

	return sqlDB.Ping()
}

// Close closes the database connection.
func Close() error {
	if DB == nil {
		return nil
	}

	sqlDB, err := DB.DB()
	if err != nil {
		return err
	}

	return sqlDB.Close()
}
