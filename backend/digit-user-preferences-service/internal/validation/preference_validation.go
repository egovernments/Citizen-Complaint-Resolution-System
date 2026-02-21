// Package validation provides input validation for preferences.
package validation

import (
	"encoding/json"
	"fmt"

	"github.com/egovernments/digit-user-preferences-service/internal/model"
	"github.com/egovernments/digit-user-preferences-service/pkg/digit"
)

// PreferenceValidator validates preference data.
type PreferenceValidator struct{}

// NewPreferenceValidator creates a new validator.
func NewPreferenceValidator() *PreferenceValidator {
	return &PreferenceValidator{}
}

// ValidatePreference validates a preference for upsert.
func (v *PreferenceValidator) ValidatePreference(pref *model.Preference) []digit.Error {
	var errors []digit.Error

	if pref.UserId == "" {
		errors = append(errors, digit.Error{
			Code:    "INVALID_USER_ID",
			Message: "userId is required",
		})
	}

	if len(pref.UserId) > 64 {
		errors = append(errors, digit.Error{
			Code:    "INVALID_USER_ID",
			Message: "userId must not exceed 64 characters",
		})
	}

	if pref.PreferenceCode == "" {
		errors = append(errors, digit.Error{
			Code:    "INVALID_PREFERENCE_CODE",
			Message: "preferenceCode is required",
		})
	}

	if len(pref.PreferenceCode) < 2 || len(pref.PreferenceCode) > 128 {
		errors = append(errors, digit.Error{
			Code:    "INVALID_PREFERENCE_CODE",
			Message: "preferenceCode must be between 2 and 128 characters",
		})
	}

	if len(pref.Payload) == 0 {
		errors = append(errors, digit.Error{
			Code:    "INVALID_PAYLOAD",
			Message: "payload is required",
		})
	}

	if pref.TenantId != "" && (len(pref.TenantId) < 2 || len(pref.TenantId) > 64) {
		errors = append(errors, digit.Error{
			Code:    "INVALID_TENANT_ID",
			Message: "tenantId must be between 2 and 64 characters",
		})
	}

	// Validate payload is valid JSON
	if len(pref.Payload) > 0 && !json.Valid(pref.Payload) {
		errors = append(errors, digit.Error{
			Code:    "INVALID_PAYLOAD",
			Message: "payload must be valid JSON",
		})
	}

	return errors
}

// ValidateCriteria validates search criteria.
func (v *PreferenceValidator) ValidateCriteria(criteria *model.PreferenceCriteria) []digit.Error {
	var errors []digit.Error

	if criteria.UserId == "" && criteria.TenantId == "" && criteria.PreferenceCode == "" {
		errors = append(errors, digit.Error{
			Code:    "INVALID_CRITERIA",
			Message: "at least one search criteria (userId, tenantId, or preferenceCode) is required",
		})
	}

	if criteria.Limit < 0 {
		errors = append(errors, digit.Error{
			Code:    "INVALID_LIMIT",
			Message: "limit must be non-negative",
		})
	}

	if criteria.Offset < 0 {
		errors = append(errors, digit.Error{
			Code:    "INVALID_OFFSET",
			Message: "offset must be non-negative",
		})
	}

	return errors
}

// ValidateNotificationPayload validates the notification preferences payload.
func (v *PreferenceValidator) ValidateNotificationPayload(payload json.RawMessage) []digit.Error {
	var p model.PreferencePayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return []digit.Error{{
			Code:    "INVALID_PAYLOAD_FORMAT",
			Message: "payload must match USER_NOTIFICATION_PREFERENCES schema",
		}}
	}

	var errors []digit.Error

	// Validate preferred language if provided
	validLanguages := map[string]bool{"en_IN": true, "hi_IN": true, "ta_IN": true}
	if p.PreferredLanguage != "" && !validLanguages[p.PreferredLanguage] {
		errors = append(errors, digit.Error{
			Code:    "INVALID_LANGUAGE",
			Message: fmt.Sprintf("preferredLanguage must be one of: en_IN, hi_IN, ta_IN; got: %s", p.PreferredLanguage),
		})
	}

	// Validate consent if provided
	if p.Consent != nil {
		errors = append(errors, v.validateConsent(p.Consent)...)
	}

	return errors
}

func (v *PreferenceValidator) validateConsent(consent *model.Consent) []digit.Error {
	var errors []digit.Error

	validatePolicy := func(channel string, policy *model.ConsentPolicy) {
		if policy == nil {
			return
		}

		// Validate status
		if policy.Status != "" && policy.Status != model.ConsentGranted && policy.Status != model.ConsentRevoked {
			errors = append(errors, digit.Error{
				Code:    "INVALID_CONSENT_STATUS",
				Message: fmt.Sprintf("%s consent status must be GRANTED or REVOKED; got: %s", channel, policy.Status),
			})
		}

		// Validate scope
		if policy.Scope != "" && policy.Scope != model.ScopeGlobal && policy.Scope != model.ScopeTenant {
			errors = append(errors, digit.Error{
				Code:    "INVALID_CONSENT_SCOPE",
				Message: fmt.Sprintf("%s consent scope must be GLOBAL or TENANT; got: %s", channel, policy.Scope),
			})
		}

		// If scope is TENANT, tenantId is required
		if policy.Scope == model.ScopeTenant && policy.TenantId == "" {
			errors = append(errors, digit.Error{
				Code:    "MISSING_TENANT_ID",
				Message: fmt.Sprintf("%s consent with TENANT scope requires tenantId", channel),
			})
		}
	}

	validatePolicy("WHATSAPP", consent.WhatsApp)
	validatePolicy("SMS", consent.SMS)
	validatePolicy("EMAIL", consent.Email)

	return errors
}

// ValidateRequestInfo validates the request info.
func (v *PreferenceValidator) ValidateRequestInfo(reqInfo *digit.RequestInfo) []digit.Error {
	if reqInfo == nil {
		return []digit.Error{{
			Code:    "INVALID_REQUEST_INFO",
			Message: "requestInfo is required",
		}}
	}
	return nil
}
