// Package digit provides common DIGIT platform contracts and types.
package digit

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"
)

// FlexibleString is a type that can unmarshal both string and number JSON values.
type FlexibleString string

// UnmarshalJSON implements json.Unmarshaler to handle both string and numeric values.
func (fs *FlexibleString) UnmarshalJSON(data []byte) error {
	// Try to unmarshal as string first
	var str string
	if err := json.Unmarshal(data, &str); err == nil {
		*fs = FlexibleString(str)
		return nil
	}

	// If that fails, try as number
	var num float64
	if err := json.Unmarshal(data, &num); err == nil {
		*fs = FlexibleString(fmt.Sprintf("%.0f", num))
		return nil
	}

	// Try as integer
	var intNum int64
	if err := json.Unmarshal(data, &intNum); err == nil {
		*fs = FlexibleString(strconv.FormatInt(intNum, 10))
		return nil
	}

	return fmt.Errorf("cannot unmarshal %s into FlexibleString", data)
}

// String returns the string representation.
func (fs FlexibleString) String() string {
	return string(fs)
}

// RequestInfo contains metadata about the API request (DIGIT standard).
type RequestInfo struct {
	APIId          string    `json:"apiId,omitempty"`
	Ver            string    `json:"ver,omitempty"`
	Ts             int64     `json:"ts,omitempty"`
	Action         string    `json:"action,omitempty"`
	Did            string    `json:"did,omitempty"`
	Key            string    `json:"key,omitempty"`
	MsgId          string    `json:"msgId,omitempty"`
	RequesterId    string    `json:"requesterId,omitempty"`
	AuthToken      string    `json:"authToken,omitempty"`
	UserInfo       *UserInfo `json:"userInfo,omitempty"`
	CorrelationId  string    `json:"correlationId,omitempty"`
}

// UserInfo contains authenticated user details.
type UserInfo struct {
	TenantId     string         `json:"tenantId,omitempty"`
	Id           FlexibleString `json:"id,omitempty"` // Can accept both string and number
	UserName     string         `json:"userName,omitempty"`
	Name         string         `json:"name,omitempty"`
	Type         string         `json:"type,omitempty"`
	MobileNumber string         `json:"mobileNumber,omitempty"`
	EmailId      string         `json:"emailId,omitempty"`
	Roles        []Role         `json:"roles,omitempty"`
	UUID         string         `json:"uuid,omitempty"`
}

// Role represents a user role.
type Role struct {
	Id          int64  `json:"id,omitempty"`
	Name        string `json:"name,omitempty"`
	Code        string `json:"code,omitempty"`
	TenantId    string `json:"tenantId,omitempty"`
}

// ResponseInfo contains metadata about the API response (DIGIT standard).
type ResponseInfo struct {
	APIId      string `json:"apiId,omitempty"`
	Ver        string `json:"ver,omitempty"`
	Ts         int64  `json:"ts,omitempty"`
	ResMsg     string `json:"resMsgId,omitempty"`
	MsgId      string `json:"msgId,omitempty"`
	Status     string `json:"status,omitempty"`
}

// AuditDetails contains audit trail information.
type AuditDetails struct {
	CreatedBy        string `json:"createdBy,omitempty"`
	CreatedTime      int64  `json:"createdTime,omitempty"`
	LastModifiedBy   string `json:"lastModifiedBy,omitempty"`
	LastModifiedTime int64  `json:"lastModifiedTime,omitempty"`
}

// Pagination contains pagination information.
type Pagination struct {
	Limit        int   `json:"limit,omitempty"`
	Offset       int   `json:"offset,omitempty"`
	TotalCount   int64 `json:"totalCount,omitempty"`
	SortBy       string `json:"sortBy,omitempty"`
	Order        string `json:"order,omitempty"`
}

// Error represents a single error.
type Error struct {
	Code        string `json:"code"`
	Message     string `json:"message"`
	Description string `json:"description,omitempty"`
	Params      []string `json:"params,omitempty"`
}

// ErrorRes represents an error response.
type ErrorRes struct {
	ResponseInfo *ResponseInfo `json:"responseInfo,omitempty"`
	Errors       []Error       `json:"errors"`
}

// NewResponseInfo creates a ResponseInfo from a RequestInfo.
func NewResponseInfo(reqInfo *RequestInfo, status string) *ResponseInfo {
	return &ResponseInfo{
		APIId:  reqInfo.APIId,
		Ver:    reqInfo.Ver,
		Ts:     time.Now().UnixMilli(),
		MsgId:  reqInfo.MsgId,
		Status: status,
	}
}

// NewAuditDetails creates audit details for a new record.
func NewAuditDetails(userId string) *AuditDetails {
	now := time.Now().UnixMilli()
	return &AuditDetails{
		CreatedBy:        userId,
		CreatedTime:      now,
		LastModifiedBy:   userId,
		LastModifiedTime: now,
	}
}

// UpdateAuditDetails updates audit details for an existing record.
func (a *AuditDetails) Update(userId string) {
	a.LastModifiedBy = userId
	a.LastModifiedTime = time.Now().UnixMilli()
}
