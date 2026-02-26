// Package handler provides HTTP handlers for the user preferences API.
package handler

import (
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/egovernments/digit-user-preferences-service/internal/model"
	"github.com/egovernments/digit-user-preferences-service/internal/service"
	"github.com/egovernments/digit-user-preferences-service/pkg/digit"
)

// PreferenceHandler handles HTTP requests for preferences.
type PreferenceHandler struct {
	service *service.PreferenceService
}

// NewPreferenceHandler creates a new handler instance.
func NewPreferenceHandler(svc *service.PreferenceService) *PreferenceHandler {
	return &PreferenceHandler{
		service: svc,
	}
}

// Upsert handles POST /v1/_upsert - creates or updates a preference.
func (h *PreferenceHandler) Upsert(c *gin.Context) {
	var req model.PreferenceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{
			Errors: []model.Error{{
				Code:    "INVALID_JSON",
				Message: "Invalid JSON format: " + err.Error(),
			}},
		})
		return
	}

	response, err := h.service.Upsert(c.Request.Context(), &req)
	if err != nil {
		h.handleServiceError(c, err, req.RequestInfo)
		return
	}

	log.Printf("Preference upserted successfully: userId=%s, preferenceCode=%s",
		req.Preference.UserId, req.Preference.PreferenceCode)

	c.JSON(http.StatusOK, response)
}

// Search handles POST /v1/_search - searches for preferences.
func (h *PreferenceHandler) Search(c *gin.Context) {
	var req model.PreferenceSearchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{
			Errors: []model.Error{{
				Code:    "INVALID_JSON",
				Message: "Invalid JSON format: " + err.Error(),
			}},
		})
		return
	}

	response, err := h.service.Search(c.Request.Context(), &req)
	if err != nil {
		h.handleServiceError(c, err, req.RequestInfo)
		return
	}

	log.Printf("Preferences search completed: resultCount=%d, totalCount=%d",
		len(response.Preferences), response.Pagination.TotalCount)

	c.JSON(http.StatusOK, response)
}

// handleServiceError converts service errors to HTTP responses.
func (h *PreferenceHandler) handleServiceError(c *gin.Context, err error, reqInfo *digit.RequestInfo) {
	var svcErr *service.ServiceError
	if errors.As(err, &svcErr) {
		var status int
		switch {
		case errors.Is(svcErr.Err, service.ErrValidation):
			status = http.StatusBadRequest
		case errors.Is(svcErr.Err, service.ErrNotFound):
			status = http.StatusNotFound
		case errors.Is(svcErr.Err, service.ErrInvalidPayload):
			status = http.StatusBadRequest
		default:
			status = http.StatusInternalServerError
			log.Printf("Internal service error: %v", err)
		}

		// Convert to model.Error
		modelErrors := make([]model.Error, len(svcErr.Errors))
		for i, e := range svcErr.Errors {
			modelErrors[i] = model.Error{
				Code:        e.Code,
				Message:     e.Message,
				Description: e.Description,
			}
		}

		var respInfo *digit.ResponseInfo
		if reqInfo != nil {
			respInfo = digit.NewResponseInfo(reqInfo, "failed")
		}

		c.JSON(status, model.ErrorResponse{
			ResponseInfo: respInfo,
			Errors:       modelErrors,
		})
		return
	}

	// Unknown error type
	log.Printf("Unexpected error: %v", err)
	c.JSON(http.StatusInternalServerError, model.ErrorResponse{
		Errors: []model.Error{{
			Code:    "INTERNAL_ERROR",
			Message: "An unexpected error occurred",
		}},
	})
}

// HealthHandler handles health check requests.
type HealthHandler struct {
	checkDB func() error
}

// NewHealthHandler creates a new health handler.
func NewHealthHandler(checkDB func() error) *HealthHandler {
	return &HealthHandler{checkDB: checkDB}
}

// Health handles GET /health.
func (h *HealthHandler) Health(c *gin.Context) {
	status := "UP"
	httpStatus := http.StatusOK
	dbStatus := "UP"

	if h.checkDB != nil {
		if err := h.checkDB(); err != nil {
			status = "DOWN"
			httpStatus = http.StatusServiceUnavailable
			dbStatus = "DOWN"
		}
	}

	c.JSON(httpStatus, gin.H{
		"status": status,
		"components": gin.H{
			"database": gin.H{
				"status": dbStatus,
			},
		},
	})
}
