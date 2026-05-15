import { type Page } from '@playwright/test';

export class HrmsCreatePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto('/digit-ui/employee/hrms/create', {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    // DIGIT form loads async MDMS data (gender types, departments, etc.)
    await this.page.waitForTimeout(5000);
  }

  /** Select a DIGIT custom dropdown option by visible text within a container */
  private async selectDropdown(container: string, optionText: string) {
    // DIGIT dropdowns: click to open, then click the matching item text
    const wrapper = this.page.locator(container).first();
    await wrapper.click();
    await this.page.waitForTimeout(500);

    const allOptions = this.page.locator('.digit-dropdown-item');
    const count = await allOptions.count();
    for (let i = 0; i < count; i++) {
      const text = (await allOptions.nth(i).innerText()).trim();
      if (text.toLowerCase().includes(optionText.toLowerCase())) {
        await allOptions.nth(i).click();
        await this.page.waitForTimeout(300);
        return;
      }
    }
    // Fallback: click first option if no match
    if (count > 0) {
      await allOptions.first().click();
    }
  }

  /** Fill a date field. Accepts DD/MM/YYYY and auto-converts for type="date" inputs (YYYY-MM-DD). */
  private async fillDate(labelText: string, dateStr: string) {
    // DIGIT date pickers are usually text inputs near their label.
    // Try multiple label variations: raw key, common localized versions
    const labelVariants = [labelText, 'Date of Birth', 'Appointment Date', 'From Date'];
    let input: import('@playwright/test').Locator | null = null;

    for (const variant of labelVariants) {
      const label = this.page.locator(`text=${variant}`).first();
      if (!(await label.isVisible({ timeout: 1000 }).catch(() => false))) continue;

      const card = label.locator('xpath=ancestor::div[contains(@class,"LabelFieldPair") or contains(@class,"label-field-pair")]').first();
      const cardInput = card.locator('input').first();
      if (await cardInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        input = cardInput;
        break;
      }
      // Fallback: input near label
      const nearInput = label.locator('xpath=following::input[1]');
      if (await nearInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        input = nearInput;
        break;
      }
    }

    // Last resort: find date inputs by type
    if (!input) {
      const dateInputs = this.page.locator('input[type="date"]');
      if (await dateInputs.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        input = dateInputs.first();
      } else {
        console.log(`Could not find date input for "${labelText}" — skipping`);
        return;
      }
    }

    // Browser <input type="date"> requires YYYY-MM-DD format
    const inputType = await input.getAttribute('type');
    let value = dateStr;
    if (inputType === 'date' && /^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
      const [dd, mm, yyyy] = dateStr.split('/');
      value = `${yyyy}-${mm}-${dd}`;
    }

    await input.fill(value);
    await this.page.waitForTimeout(300);
    // Press Escape to close any calendar overlay
    await this.page.keyboard.press('Escape');
  }

  async fillPersonalDetails(opts: {
    name: string;
    phone: string;
    gender: string;
    dob: string;
    address: string;
  }) {
    // Employee name — find by placeholder or label
    const nameInput = this.page.locator('input[type="text"]').first();
    await nameInput.fill(opts.name);
    await this.page.waitForTimeout(300);

    // Phone number — the second text input, or the one near mobile label
    const phoneInput = this.page.locator('input[type="text"]').nth(1);
    await phoneInput.fill(opts.phone);
    await this.page.waitForTimeout(500);
    // Click away to trigger validation (duplicate phone check)
    await this.page.locator('body').click({ position: { x: 0, y: 0 } });
    await this.page.waitForTimeout(1000);

    // Gender — radio button
    const genderLabel = this.page.locator(`label:has-text("${opts.gender}")`).first();
    if (await genderLabel.isVisible({ timeout: 3000 }).catch(() => false)) {
      await genderLabel.click();
    } else {
      // Try the raw gender text as a radio option
      const radio = this.page.locator(`text=${opts.gender}`).first();
      await radio.click();
    }
    await this.page.waitForTimeout(300);

    // Date of Birth
    await this.fillDate('HR_BIRTH_DATE_LABEL', opts.dob);

    // Correspondence address — textarea or text input near address label
    const addressInput = this.page.locator('textarea').first();
    if (await addressInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addressInput.fill(opts.address);
    } else {
      // Might be a text input
      const addrInput = this.page.locator('input[type="text"]').last();
      await addrInput.fill(opts.address);
    }
    await this.page.waitForTimeout(300);
  }

  async fillHRDetails(opts: {
    employeeType: string;
    appointmentDate: string;
  }) {
    // Employee Type — DIGIT dropdown
    // The dropdown is typically in the employment details section
    const empTypeDropdowns = this.page.locator('.digit-dropdown-employee-select-wrap--elipses');
    const empTypeDropdown = empTypeDropdowns.first();
    if (await empTypeDropdown.isVisible({ timeout: 3000 }).catch(() => false)) {
      await empTypeDropdown.click();
      await this.page.waitForTimeout(500);
      const option = this.page.locator(`.digit-dropdown-item:has-text("${opts.employeeType}")`).first();
      if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
        await option.click();
      } else {
        // Click first available
        await this.page.locator('.digit-dropdown-item').first().click();
      }
      await this.page.waitForTimeout(300);
    }

    // Appointment date
    await this.fillDate('HR_APPOINTMENT_DATE_LABEL', opts.appointmentDate);
  }

  async fillJurisdiction(opts: {
    hierarchy: string;
    boundaryType: string;
    boundary: string;
    roles: string[];
  }) {
    // Jurisdiction section has multiple dropdowns in sequence:
    // 1. Hierarchy, 2. Boundary Type, 3. Boundary, 4. Roles (multi-select)
    const dropdowns = this.page.locator('.digit-dropdown-employee-select-wrap--elipses');

    // We need to identify which dropdown corresponds to which field.
    // They appear in order within the jurisdiction section.
    // The employee type dropdown is the first one (HR details section),
    // so jurisdiction dropdowns start after that.

    // Wait for jurisdiction section to render
    await this.page.waitForTimeout(1000);

    const dropdownCount = await dropdowns.count();

    // Hierarchy dropdown (should be 2nd overall — 1st is employee type)
    if (dropdownCount > 1) {
      await dropdowns.nth(1).click();
      await this.page.waitForTimeout(500);
      const items = this.page.locator('.digit-dropdown-item');
      const itemCount = await items.count();
      for (let i = 0; i < itemCount; i++) {
        const text = (await items.nth(i).innerText()).trim();
        if (text.toLowerCase().includes(opts.hierarchy.toLowerCase())) {
          await items.nth(i).click();
          break;
        }
      }
      await this.page.waitForTimeout(500);
    }

    // Boundary Type dropdown (3rd overall)
    const dropdownsAfterHierarchy = this.page.locator('.digit-dropdown-employee-select-wrap--elipses');
    const countAfterHierarchy = await dropdownsAfterHierarchy.count();
    if (countAfterHierarchy > 2) {
      await dropdownsAfterHierarchy.nth(2).click();
      await this.page.waitForTimeout(500);
      const items = this.page.locator('.digit-dropdown-item');
      const itemCount = await items.count();
      for (let i = 0; i < itemCount; i++) {
        const text = (await items.nth(i).innerText()).trim();
        if (text.toLowerCase().includes(opts.boundaryType.toLowerCase())) {
          await items.nth(i).click();
          break;
        }
      }
      await this.page.waitForTimeout(500);
    }

    // Boundary dropdown (4th overall)
    const dropdownsAfterBType = this.page.locator('.digit-dropdown-employee-select-wrap--elipses');
    const countAfterBType = await dropdownsAfterBType.count();
    if (countAfterBType > 3) {
      await dropdownsAfterBType.nth(3).click();
      await this.page.waitForTimeout(500);
      const items = this.page.locator('.digit-dropdown-item');
      const itemCount = await items.count();
      for (let i = 0; i < itemCount; i++) {
        const text = (await items.nth(i).innerText()).trim();
        if (text.toLowerCase().includes(opts.boundary.toLowerCase())) {
          await items.nth(i).click();
          break;
        }
      }
      await this.page.waitForTimeout(500);
    }

    // Roles multi-select — this is typically a separate multi-select dropdown
    // DIGIT multi-select uses a different component pattern
    for (const role of opts.roles) {
      const roleDropdowns = this.page.locator('.digit-dropdown-employee-select-wrap--elipses');
      const roleCount = await roleDropdowns.count();
      if (roleCount > 4) {
        await roleDropdowns.nth(4).click();
        await this.page.waitForTimeout(500);
        const items = this.page.locator('.digit-dropdown-item');
        const itemCount = await items.count();
        for (let i = 0; i < itemCount; i++) {
          const text = (await items.nth(i).innerText()).trim();
          if (text.toLowerCase().includes(role.toLowerCase())) {
            await items.nth(i).click();
            break;
          }
        }
        await this.page.waitForTimeout(300);
      }
    }
    // Close any open dropdown
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(300);
  }

  async fillAssignment(opts: {
    department: string;
    designation: string;
    fromDate: string;
    currentAssignment: boolean;
  }) {
    // Assignment section has: department, designation, from date, current assignment checkbox

    // Department dropdown
    const dropdowns = this.page.locator('.digit-dropdown-employee-select-wrap--elipses');
    const dropdownCount = await dropdowns.count();

    // Department is typically the last section of dropdowns
    // After jurisdiction dropdowns. Find them by position.
    if (dropdownCount > 5) {
      await dropdowns.nth(dropdownCount - 2).click();
      await this.page.waitForTimeout(500);
      const items = this.page.locator('.digit-dropdown-item');
      const itemCount = await items.count();
      for (let i = 0; i < itemCount; i++) {
        const text = (await items.nth(i).innerText()).trim();
        if (text.toLowerCase().includes(opts.department.toLowerCase())) {
          await items.nth(i).click();
          break;
        }
      }
      await this.page.waitForTimeout(500);
    }

    // Designation dropdown (last dropdown)
    const updatedDropdowns = this.page.locator('.digit-dropdown-employee-select-wrap--elipses');
    const updatedCount = await updatedDropdowns.count();
    if (updatedCount > 0) {
      await updatedDropdowns.nth(updatedCount - 1).click();
      await this.page.waitForTimeout(500);
      const items = this.page.locator('.digit-dropdown-item');
      const itemCount = await items.count();
      for (let i = 0; i < itemCount; i++) {
        const text = (await items.nth(i).innerText()).trim();
        if (text.toLowerCase().includes(opts.designation.toLowerCase())) {
          await items.nth(i).click();
          break;
        }
      }
      await this.page.waitForTimeout(500);
    }

    // From date
    await this.fillDate('HR_ASSIGN_DET_HEADER', opts.fromDate);

    // Current assignment checkbox
    if (opts.currentAssignment) {
      const checkbox = this.page.locator('input[type="checkbox"]').first();
      if (await checkbox.isVisible({ timeout: 2000 }).catch(() => false)) {
        const isChecked = await checkbox.isChecked();
        if (!isChecked) {
          await checkbox.dispatchEvent('click');
        }
      }
    }
    await this.page.waitForTimeout(300);
  }

  async submit() {
    // Submit button — look for text matching HR_COMMON_BUTTON_SUBMIT or "Submit"
    const submitBtn = this.page.locator('button[type="submit"], button:has-text("Submit"), button:has-text("HR_COMMON_BUTTON_SUBMIT")').first();
    await submitBtn.waitFor({ state: 'visible', timeout: 5000 });
    await submitBtn.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(500);
    await submitBtn.dispatchEvent('click');
  }

  async getBodyText(): Promise<string> {
    return this.page.locator('body').innerText();
  }
}
