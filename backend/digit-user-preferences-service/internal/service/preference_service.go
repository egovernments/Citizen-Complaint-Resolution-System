// Package service provides business logic for user preferences.
package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/egovernments/digit-user-preferences-service/internal/enrichment"
	"github.com/egovernments/digit-user-preferences-service/internal/model"
	"github.com/egovernments/digit-user-preferences-service/internal/repository"
	"github.com/egovernments/digit-user-preferences-service/internal/validation"
	"github.com/egovernments/digit-user-preferences-service/pkg/digit"
)

// Custom error types for better error handling.
var (
	ErrValidation     = errors.New("validation error")
	ErrNotFound       = errors.New("preference not found")
	ErrInvalidPayload = errors.New("invalid payload format")
	ErrInternalError  = errors.New("internal server error")
)

// ServiceError wraps errors with DIGIT error format.
type ServiceError struct {
	Err    error
	Errors []digit.Error
}

func (e *ServiceError) Error() string {
	if len(e.Errors) > 0 {
		return e.Errors[0].Message
	}
	return e.Err.Error()
}

func (e *ServiceError) Unwrap() error {
	return e.Err
}

// NewValidationError creates a validation error.
func NewValidationError(errors []digit.Error) *ServiceError {
	return &ServiceError{
		Err:    ErrValidation,
		Errors: errors,
	}
}

// NewInternalError creates an internal error.
func NewInternalError(message string) *ServiceError {
	return &ServiceError{
		Err: ErrInternalError,
		Errors: []digit.Error{{
			Code:    "INTERNAL_ERROR",
			Message: message,
		}},
	}
}

// PreferenceService handles business logic for preferences.
type PreferenceService struct {
	repo      *repository.PreferenceRepository
	validator *validation.PreferenceValidator
	enricher  *enrichment.PreferenceEnricher
}

// NewPreferenceService creates a new service instance.
func NewPreferenceService(repo *repository.PreferenceRepository) *PreferenceService {
	return &PreferenceService{
		repo:      repo,
		validator: validation.NewPreferenceValidator(),
		enricher:  enrichment.NewPreferenceEnricher(),
	}
}

// Upsert creates or updates a preference with validation.
func (s *PreferenceService) Upsert(ctx context.Context, req *model.PreferenceRequest) (*model.PreferenceResponse, error) {
	// Validate request info
	if errs := s.validator.ValidateRequestInfo(req.RequestInfo); len(errs) > 0 {
		return nil, NewValidationError(errs)
	}

	// Validate preference
	if req.Preference == nil {
		return nil, NewValidationError([]digit.Error{{
			Code:    "INVALID_REQUEST",
			Message: "preference is required",
		}})
	}

	// Validate preference fields
	if errs := s.validator.ValidatePreference(req.Preference); len(errs) > 0 {
		return nil, NewValidationError(errs)
	}

	// Validate payload structure if it's for notification preferences
	if req.Preference.PreferenceCode == "USER_NOTIFICATION_PREFERENCES" {
		if errs := s.validator.ValidateNotificationPayload(req.Preference.Payload); len(errs) > 0 {
			return nil, NewValidationError(errs)
		}
	}

	// Get user ID from request info for audit
	userID := enrichment.GetUserIDFromRequestInfo(req.RequestInfo)

	// Check if preference exists
	existing, err := s.repo.FindByKey(ctx, req.Preference.UserId, req.Preference.TenantId, req.Preference.PreferenceCode)
	if err != nil {
		return nil, NewInternalError(fmt.Sprintf("failed to check existing preference: %v", err))
	}

	var result *model.PreferenceDB
	if existing != nil {
		// Update existing
		s.enricher.EnrichForUpdate(req.Preference, existing.ToAPIModel(), userID)
		result, err = s.repo.Update(ctx, req.Preference.ToDBModel())
	} else {
		// Create new
		s.enricher.EnrichForCreate(req.Preference, userID)
		result, err = s.repo.Create(ctx, req.Preference.ToDBModel())
	}

	if err != nil {
		return nil, NewInternalError(fmt.Sprintf("failed to save preference: %v", err))
	}

	return &model.PreferenceResponse{
		ResponseInfo: digit.NewResponseInfo(req.RequestInfo, "successful"),
		Preferences:  []*model.Preference{result.ToAPIModel()},
	}, nil
}

// Search finds preferences matching criteria.
func (s *PreferenceService) Search(ctx context.Context, req *model.PreferenceSearchRequest) (*model.PreferenceResponse, error) {
	// Validate request info
	if errs := s.validator.ValidateRequestInfo(req.RequestInfo); len(errs) > 0 {
		return nil, NewValidationError(errs)
	}

	// Validate criteria
	if req.Criteria == nil {
		return nil, NewValidationError([]digit.Error{{
			Code:    "INVALID_REQUEST",
			Message: "criteria is required",
		}})
	}

	// Validate criteria fields
	if errs := s.validator.ValidateCriteria(req.Criteria); len(errs) > 0 {
		return nil, NewValidationError(errs)
	}

	// Set default limit
	if req.Criteria.Limit == 0 {
		req.Criteria.Limit = 10
	}
	if req.Criteria.Limit > 100 {
		req.Criteria.Limit = 100
	}

	// Perform search
	results, totalCount, err := s.repo.Search(ctx, req.Criteria)
	if err != nil {
		return nil, NewInternalError(fmt.Sprintf("failed to search preferences: %v", err))
	}

	// Convert to API models
	preferences := make([]*model.Preference, len(results))
	for i, r := range results {
		preferences[i] = r.ToAPIModel()
	}

	return &model.PreferenceResponse{
		ResponseInfo: digit.NewResponseInfo(req.RequestInfo, "successful"),
		Preferences:  preferences,
		Pagination: &digit.Pagination{
			Limit:      req.Criteria.Limit,
			Offset:     req.Criteria.Offset,
			TotalCount: totalCount,
		},
	}, nil
}
