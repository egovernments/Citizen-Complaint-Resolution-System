// Package repository provides data access layer for user preferences.
package repository

import (
	"context"
	"fmt"

	"gorm.io/gorm"

	"github.com/egovernments/digit-user-preferences-service/internal/model"
)

// PreferenceRepository handles database operations for preferences using GORM.
type PreferenceRepository struct {
	db *gorm.DB
}

// NewPreferenceRepository creates a new repository instance.
func NewPreferenceRepository(db *gorm.DB) *PreferenceRepository {
	return &PreferenceRepository{db: db}
}

// Create creates a new preference record.
func (r *PreferenceRepository) Create(ctx context.Context, pref *model.PreferenceDB) (*model.PreferenceDB, error) {
	if err := r.db.WithContext(ctx).Create(pref).Error; err != nil {
		return nil, fmt.Errorf("failed to create preference: %w", err)
	}
	return pref, nil
}

// Update updates an existing preference record.
func (r *PreferenceRepository) Update(ctx context.Context, pref *model.PreferenceDB) (*model.PreferenceDB, error) {
	result := r.db.WithContext(ctx).Model(pref).
		Where("id = ?", pref.ID).
		Updates(map[string]interface{}{
			"payload":            pref.Payload,
			"last_modified_by":   pref.LastModifiedBy,
			"last_modified_time": pref.LastModifiedTime,
		})

	if result.Error != nil {
		return nil, fmt.Errorf("failed to update preference: %w", result.Error)
	}

	// Fetch the updated record
	var updated model.PreferenceDB
	if err := r.db.WithContext(ctx).First(&updated, "id = ?", pref.ID).Error; err != nil {
		return nil, fmt.Errorf("failed to fetch updated preference: %w", err)
	}

	return &updated, nil
}

// FindByKey finds a preference by user_id, tenant_id, and preference_code.
func (r *PreferenceRepository) FindByKey(ctx context.Context, userID, tenantID, preferenceCode string) (*model.PreferenceDB, error) {
	var pref model.PreferenceDB

	query := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Where("preference_code = ?", preferenceCode)

	if tenantID != "" {
		query = query.Where("tenant_id = ?", tenantID)
	} else {
		query = query.Where("tenant_id IS NULL OR tenant_id = ''")
	}

	if err := query.First(&pref).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to find preference: %w", err)
	}

	return &pref, nil
}

// Search finds preferences matching the given criteria.
func (r *PreferenceRepository) Search(ctx context.Context, criteria *model.PreferenceCriteria) ([]*model.PreferenceDB, int64, error) {
	var preferences []*model.PreferenceDB
	var totalCount int64

	query := r.db.WithContext(ctx).Model(&model.PreferenceDB{})

	// Apply filters
	if criteria.UserId != "" {
		query = query.Where("user_id = ?", criteria.UserId)
	}
	if criteria.TenantId != "" {
		query = query.Where("tenant_id = ?", criteria.TenantId)
	}
	if criteria.PreferenceCode != "" {
		query = query.Where("preference_code = ?", criteria.PreferenceCode)
	}

	// Count total
	if err := query.Count(&totalCount).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count preferences: %w", err)
	}

	// Apply pagination
	limit := 10
	if criteria.Limit > 0 {
		limit = criteria.Limit
	}
	if limit > 100 {
		limit = 100
	}

	query = query.Order("created_time DESC").
		Limit(limit).
		Offset(criteria.Offset)

	// Execute query
	if err := query.Find(&preferences).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to search preferences: %w", err)
	}

	return preferences, totalCount, nil
}

// GetByID retrieves a preference by its ID.
func (r *PreferenceRepository) GetByID(ctx context.Context, id string) (*model.PreferenceDB, error) {
	var pref model.PreferenceDB

	if err := r.db.WithContext(ctx).First(&pref, "id = ?", id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get preference: %w", err)
	}

	return &pref, nil
}

// Delete deletes a preference by its ID.
func (r *PreferenceRepository) Delete(ctx context.Context, id string) error {
	result := r.db.WithContext(ctx).Delete(&model.PreferenceDB{}, "id = ?", id)
	if result.Error != nil {
		return fmt.Errorf("failed to delete preference: %w", result.Error)
	}
	return nil
}
