// Package model defines domain models for the user preferences service.
package model

import (
	"encoding/json"

	"github.com/egovernments/digit-user-preferences-service/pkg/digit"
)

// ConsentStatus represents the consent status.
type ConsentStatus string

const (
	ConsentGranted ConsentStatus = "GRANTED"
	ConsentRevoked ConsentStatus = "REVOKED"
)

// ConsentScope represents the scope of consent.
type ConsentScope string

const (
	ScopeGlobal ConsentScope = "GLOBAL"
	ScopeTenant ConsentScope = "TENANT"
)

// Channel represents a notification channel.
type Channel string

const (
	ChannelWhatsApp Channel = "WHATSAPP"
	ChannelSMS      Channel = "SMS"
	ChannelEmail    Channel = "EMAIL"
)

// ConsentPolicy represents consent settings for a channel.
type ConsentPolicy struct {
	Status   ConsentStatus `json:"status,omitempty"`
	Scope    ConsentScope  `json:"scope,omitempty"`
	TenantId string        `json:"tenantId,omitempty"`
}

// Consent represents consent settings per channel.
type Consent struct {
	WhatsApp *ConsentPolicy `json:"WHATSAPP,omitempty"`
	SMS      *ConsentPolicy `json:"SMS,omitempty"`
	Email    *ConsentPolicy `json:"EMAIL,omitempty"`
}

// PreferencePayload represents the preference payload structure.
type PreferencePayload struct {
	PreferredLanguage string   `json:"preferredLanguage,omitempty"`
	Consent           *Consent `json:"consent,omitempty"`
}

// PreferenceDB is the database model for user preferences (GORM).
type PreferenceDB struct {
	ID               string          `json:"id" gorm:"column:id;type:uuid;primaryKey"`
	UserID           string          `json:"userId" gorm:"column:user_id;type:varchar(64);not null;index:idx_user_id"`
	TenantID         string          `json:"tenantId,omitempty" gorm:"column:tenant_id;type:varchar(64);index:idx_tenant_id"`
	PreferenceCode   string          `json:"preferenceCode" gorm:"column:preference_code;type:varchar(128);not null;index:idx_preference_code"`
	Payload          json.RawMessage `json:"payload" gorm:"column:payload;type:jsonb;not null;default:'{}'"`
	CreatedBy        string          `json:"createdBy,omitempty" gorm:"column:created_by;type:varchar(64);not null"`
	CreatedTime      int64           `json:"createdTime,omitempty" gorm:"column:created_time;type:bigint;not null;index:idx_created_time"`
	LastModifiedBy   string          `json:"lastModifiedBy,omitempty" gorm:"column:last_modified_by;type:varchar(64);not null"`
	LastModifiedTime int64           `json:"lastModifiedTime,omitempty" gorm:"column:last_modified_time;type:bigint;not null"`
}

// TableName returns the table name for GORM.
func (PreferenceDB) TableName() string {
	return "user_preference"
}

// Preference represents a user preference record (API model).
type Preference struct {
	Id             string              `json:"id,omitempty"`
	UserId         string              `json:"userId"`
	TenantId       string              `json:"tenantId,omitempty"`
	PreferenceCode string              `json:"preferenceCode"`
	Payload        json.RawMessage     `json:"payload"`
	AuditDetails   *digit.AuditDetails `json:"auditDetails,omitempty"`
}

// ToDBModel converts API model to database model.
func (p *Preference) ToDBModel() *PreferenceDB {
	db := &PreferenceDB{
		ID:             p.Id,
		UserID:         p.UserId,
		TenantID:       p.TenantId,
		PreferenceCode: p.PreferenceCode,
		Payload:        p.Payload,
	}
	if p.AuditDetails != nil {
		db.CreatedBy = p.AuditDetails.CreatedBy
		db.CreatedTime = p.AuditDetails.CreatedTime
		db.LastModifiedBy = p.AuditDetails.LastModifiedBy
		db.LastModifiedTime = p.AuditDetails.LastModifiedTime
	}
	return db
}

// ToAPIModel converts database model to API model.
func (db *PreferenceDB) ToAPIModel() *Preference {
	return &Preference{
		Id:             db.ID,
		UserId:         db.UserID,
		TenantId:       db.TenantID,
		PreferenceCode: db.PreferenceCode,
		Payload:        db.Payload,
		AuditDetails: &digit.AuditDetails{
			CreatedBy:        db.CreatedBy,
			CreatedTime:      db.CreatedTime,
			LastModifiedBy:   db.LastModifiedBy,
			LastModifiedTime: db.LastModifiedTime,
		},
	}
}

// PreferenceCriteria defines search criteria for preferences.
type PreferenceCriteria struct {
	UserId         string `json:"userId,omitempty"`
	TenantId       string `json:"tenantId,omitempty"`
	PreferenceCode string `json:"preferenceCode,omitempty"`
	Limit          int    `json:"limit,omitempty"`
	Offset         int    `json:"offset,omitempty"`
}

// PreferenceRequest is the request wrapper for upsert operations.
type PreferenceRequest struct {
	RequestInfo *digit.RequestInfo `json:"requestInfo"`
	Preference  *Preference        `json:"preference"`
}

// PreferenceSearchRequest is the request wrapper for search operations.
type PreferenceSearchRequest struct {
	RequestInfo *digit.RequestInfo  `json:"requestInfo"`
	Criteria    *PreferenceCriteria `json:"criteria"`
}

// PreferenceResponse is the response wrapper for preference operations.
type PreferenceResponse struct {
	ResponseInfo *digit.ResponseInfo `json:"responseInfo,omitempty"`
	Preferences  []*Preference       `json:"preferences"`
	Pagination   *digit.Pagination   `json:"pagination,omitempty"`
}

// Error represents a DIGIT error response.
type Error struct {
	Code        string `json:"code"`
	Message     string `json:"message"`
	Description string `json:"description,omitempty"`
}

// ErrorResponse represents the error response structure.
type ErrorResponse struct {
	ResponseInfo *digit.ResponseInfo `json:"responseInfo,omitempty"`
	Errors       []Error             `json:"Errors"`
}

// GetPayload parses and returns the preference payload.
func (p *Preference) GetPayload() (*PreferencePayload, error) {
	var payload PreferencePayload
	if err := json.Unmarshal(p.Payload, &payload); err != nil {
		return nil, err
	}
	return &payload, nil
}

// SetPayload sets the preference payload from a struct.
func (p *Preference) SetPayload(payload *PreferencePayload) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	p.Payload = data
	return nil
}
