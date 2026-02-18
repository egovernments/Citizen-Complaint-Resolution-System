// Package enrichment provides data enrichment utilities.
package enrichment

import (
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/egovernments/digit-user-preferences-service/internal/model"
	"github.com/egovernments/digit-user-preferences-service/pkg/digit"
)

// PreferenceEnricher enriches preference data.
type PreferenceEnricher struct{}

// NewPreferenceEnricher creates a new enricher.
func NewPreferenceEnricher() *PreferenceEnricher {
	return &PreferenceEnricher{}
}

// EnrichForCreate enriches a preference for creation.
func (e *PreferenceEnricher) EnrichForCreate(pref *model.Preference, userID string) {
	now := time.Now().UnixMilli()

	// Generate UUID if not provided
	if pref.Id == "" {
		pref.Id = uuid.New().String()
	}

	// Normalize inputs
	pref.UserId = strings.TrimSpace(pref.UserId)
	pref.TenantId = strings.TrimSpace(pref.TenantId)
	pref.PreferenceCode = strings.TrimSpace(pref.PreferenceCode)

	// Set audit details
	if userID == "" {
		userID = "system"
	}

	pref.AuditDetails = &digit.AuditDetails{
		CreatedBy:        userID,
		CreatedTime:      now,
		LastModifiedBy:   userID,
		LastModifiedTime: now,
	}
}

// EnrichForUpdate enriches a preference for update.
func (e *PreferenceEnricher) EnrichForUpdate(pref *model.Preference, existing *model.Preference, userID string) {
	now := time.Now().UnixMilli()

	// Keep existing ID
	pref.Id = existing.Id

	// Normalize inputs
	pref.UserId = strings.TrimSpace(pref.UserId)
	pref.TenantId = strings.TrimSpace(pref.TenantId)
	pref.PreferenceCode = strings.TrimSpace(pref.PreferenceCode)

	// Update audit details
	if userID == "" {
		userID = "system"
	}

	pref.AuditDetails = &digit.AuditDetails{
		CreatedBy:        existing.AuditDetails.CreatedBy,
		CreatedTime:      existing.AuditDetails.CreatedTime,
		LastModifiedBy:   userID,
		LastModifiedTime: now,
	}
}

// GetUserIDFromRequestInfo extracts user ID from request info.
func GetUserIDFromRequestInfo(reqInfo *digit.RequestInfo) string {
	if reqInfo == nil {
		return ""
	}
	if reqInfo.UserInfo != nil {
		if reqInfo.UserInfo.UUID != "" {
			return reqInfo.UserInfo.UUID
		}
		return reqInfo.UserInfo.Id
	}
	return reqInfo.RequesterId
}
