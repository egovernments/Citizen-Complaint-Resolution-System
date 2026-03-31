// Package routes provides route registration for the API.
package routes

import (
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/egovernments/digit-user-preferences-service/db"
	"github.com/egovernments/digit-user-preferences-service/internal/config"
	"github.com/egovernments/digit-user-preferences-service/internal/handler"
	"github.com/egovernments/digit-user-preferences-service/internal/repository"
	"github.com/egovernments/digit-user-preferences-service/internal/service"
)

// RegisterRoutes registers all API routes.
func RegisterRoutes(r *gin.Engine, database *gorm.DB, cfg *config.Config) {
	// Create repository
	prefRepo := repository.NewPreferenceRepository(database)

	// Create service
	prefService := service.NewPreferenceService(prefRepo)

	// Create handlers
	prefHandler := handler.NewPreferenceHandler(prefService)
	healthHandler := handler.NewHealthHandler(db.HealthCheck)

	// Register health check at root
	r.GET("/health", healthHandler.Health)

	// Register API routes with context path
	api := r.Group(cfg.Server.ContextPath)
	{
		api.POST("/v1/_upsert", prefHandler.Upsert)
		api.POST("/v1/_search", prefHandler.Search)
	}
}
