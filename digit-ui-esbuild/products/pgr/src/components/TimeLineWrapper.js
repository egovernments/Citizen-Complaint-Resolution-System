import React, { useState, useEffect } from 'react';
import { useTranslation } from "react-i18next";
import { PopUp, Timeline, TimelineMolecule, Loader } from '@egovernments/digit-ui-components';
import { convertEpochFormateToDate } from '../utils';

// NOTE: no useMyContext() here — the citizen route tree has no MyContext
// provider, and this wrapper renders on BOTH citizen and employee details.
// CCSD-1971 (B4): when a complaint is marked confidential, the CITIZEN's
// identity must not surface in the employee timeline. Names show first char +
// asterisks; contact numbers keep the last 4 digits (the backend already
// masks the mobile, this covers the name and any unmasked residue).
// Fixed-shape mask, mirroring the number convention (*****0104): first letter
// of each word + exactly three stars — "CMS Case Manager" → "C*** C*** M***".
// Fixed star count so the mask doesn't leak the real name's length.
const maskName = (name) => {
  if (!name || name.length < 2) return name;
  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0) + "***")
    .join(" ");
};
const maskPhone = (phone) => {
  if (!phone || phone.length < 4) return phone;
  return "******" + phone.slice(-4);
};
const isCitizenActor = (person) =>
  Array.isArray(person?.roles) && person.roles.some((r) => (r?.code || r) === "CITIZEN");

const TimelineWrapper = ({ businessId, isWorkFlowLoading, workflowData, labelPrefix = "", currentStateChildren = null, maskConfidential = false }) => {
    const { t } = useTranslation();

    const tenantId = Digit.ULBService.getCurrentTenantId();

    // Manage timeline data
    const [timelineSteps, setTimelineSteps] = useState([]);
    // CCSD-1965: fileStoreId -> viewable URL, resolved once per workflow load.
    const [docUrls, setDocUrls] = useState({});

    // Resolve viewable URLs for EVERY document across ALL workflow steps in one
    // pass. Attachments live under the complaint's (city) tenant and Filefetch
    // is tenant-scoped, so group by each instance's tenantId before fetching.
    useEffect(() => {
        const instances = workflowData?.ProcessInstances || [];
        const byTenant = {};
        instances.forEach((inst) => {
            (inst?.documents || []).forEach((d) => {
                if (!d?.fileStoreId) return;
                const tid = inst?.tenantId || tenantId;
                (byTenant[tid] = byTenant[tid] || []).push(d.fileStoreId);
            });
        });
        const tenants = Object.keys(byTenant);
        if (!tenants.length) { setDocUrls({}); return; }
        let cancelled = false;
        (async () => {
            const map = {};
            for (const tid of tenants) {
                try {
                    const res = await Digit.UploadServices.Filefetch(byTenant[tid], tid);
                    const entries = Array.isArray(res?.data?.fileStoreIds) ? res.data.fileStoreIds : [];
                    entries.forEach((e) => {
                        // `url` is a comma-joined variant list. The filestore emits
                        // several variants (full,large,medium,small,…) ONLY for
                        // images; non-image files (PDF/doc/…) come back as a single
                        // URL. So multiple variants ⟹ image, and we can pick a
                        // "small" variant for the 44x44 thumbnail (mirrors
                        // ComplaintPhotos.js). We deliberately do NOT trust the
                        // document's `documentType` here — the generic action
                        // uploader (ActionUploadComponent) stamps every file as
                        // "PHOTO" regardless of its real type.
                        const variants = typeof e?.url === "string"
                            ? e.url.split(",").map((u) => u.trim()).filter(Boolean)
                            : [];
                        const full = variants[0] || "";
                        if (!e?.id || !full) return;
                        const thumb = variants.find((u) => /small/i.test(u)) || full;
                        const isImage = variants.length > 1 ||
                            /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(full);
                        map[e.id] = { full, thumb, isImage };
                    });
                } catch (e) {
                    /* leave those ids unresolved — chip still renders as a plain link */
                }
            }
            if (!cancelled) setDocUrls(map);
        })();
        return () => { cancelled = true; };
    }, [workflowData, tenantId]);

    // A compact per-step attachments row (thumbnails for images, a labelled
    // chip otherwise). Returns null when the step has no documents.
    const renderStepDocs = (documents) => {
        if (!Array.isArray(documents) || documents.length === 0) return null;
        return (
            <div key="docs" style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.25rem" }}>
                <span style={{ fontSize: "0.78rem", color: "var(--color-text-secondary, #64748b)", width: "100%" }}>
                    {t("CS_TIMELINE_ATTACHMENTS")}
                </span>
                {documents.map((doc, i) => {
                    const entry = docUrls[doc?.fileStoreId];
                    const url = entry?.full;
                    const label = `${t("CS_TIMELINE_ATTACHMENT")} ${i + 1}`;
                    if (url && entry?.isImage) {
                        return (
                            <a key={i} href={url} target="_blank" rel="noopener noreferrer" title={label}>
                                <img src={entry.thumb || url} alt={label}
                                    style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: "1px solid var(--color-border, #e2e8f0)" }} />
                            </a>
                        );
                    }
                    return (
                        <a key={i} href={url || undefined} target="_blank" rel="noopener noreferrer"
                            style={{
                                display: "inline-flex", alignItems: "center", gap: "0.3rem",
                                fontSize: "0.78rem", padding: "0.2rem 0.5rem", borderRadius: 6,
                                border: "1px solid var(--color-border, #cbd5e1)", color: "var(--color-primary-1, #c84c0e)",
                                pointerEvents: url ? "auto" : "none", opacity: url ? 1 : 0.6,
                            }}>
                            📎 {label}
                        </a>
                    );
                })}
            </div>
        );
    };

    useEffect(() => {
        if (workflowData && workflowData.ProcessInstances) {
            // ASSIGN / REASSIGN / ESCALATE all move the complaint to a new
            // assignee (ESCALATE via the auto-escalator picking the next-level
            // employee), so the timeline row should show that assignee
            // (instance.assignes[0]) not the actor who performed the action
            // (instance.assigner). egovernments/CCRS#490 originally listed
            // ASSIGN / REASSIGN; ESCALATE shipped after and inherits the
            // same intent.
            const isAssigningAction = (action) =>
                action === "ASSIGN" || action === "REASSIGN" || action === "ESCALATE";

            // Just the person's name. The prior implementation appended the
            // localized role list as " - <role1>, <role2>, ..." which for
            // admin-tier users with 8 roles produced an unreadable wall of
            // text on every timeline row (egovernments/CCRS#524). The row
            // label already describes the action (ASSIGN / REJECT / etc.),
            // so role context isn't needed in the caption. CS_NA fallback
            // so a missing assignee renders "NA" instead of silently
            // dropping the row caption (CCRS#490 sub-bug 4).
            const formatPerson = (person) => {
                if (!person?.name) return t("CS_NA");
                return person.name;
            };

            // Reject-action audit comments come from the reject modal as
            // "[<CODE>] <free text>" (e.g. "[NOT_PUBLIC_INFRA] sfdgdsfg").
            // When the [CODE] resolves to a `CS_REJECTION__<CODE>`
            // localization key, surface the localized reason and append
            // any trailing free text after an em-dash. Falls back to the
            // existing "Employee Comments: \"...\"" framing for any other
            // comment shape (egovernments/CCRS#489).
            const formatComment = (raw) => {
                if (typeof raw !== "string" || raw.length === 0) return null;
                const match = raw.match(/^\[([A-Z_][A-Z0-9_]*)\]\s*(.*)$/s);
                if (match) {
                    const reasonKey = `CS_REJECTION__${match[1]}`;
                    const reasonLabel = t(reasonKey);
                    if (reasonLabel && reasonLabel !== reasonKey) {
                        const trailing = (match[2] || "").trim();
                        return trailing
                            ? `${t("CS_REJECT_COMPLAINT")}: ${reasonLabel} — ${trailing}`
                            : `${t("CS_REJECT_COMPLAINT")}: ${reasonLabel}`;
                    }
                }
                return `${t('CS_COMMON_EMPLOYEE_COMMENTS')} : "${raw}"`;
            };

            // Map API response to timeline steps
            const steps = workflowData.ProcessInstances.map((instance, index) => {
                const assignee = instance?.assignes?.[0];
                const personRecord = isAssigningAction(instance?.action) ? assignee : instance?.assigner;
                // Confidential complaints: mask the CITIZEN actor's identity
                // (employees stay visible — accountability is intact).
                const maskThis = maskConfidential && isCitizenActor(personRecord);
                const mobile = isAssigningAction(instance?.action) ? assignee?.mobileNumber : instance?.assigner?.mobileNumber;
                // The backend already masks the mobile per viewer privilege
                // ("Contact Details: *****0104"). Mirror that decision onto the
                // NAME: a viewer the backend won't show the number to shouldn't
                // see the person's identity either.
                const backendMasked = typeof mobile === "string" && mobile.includes("*");
                const personLine =
                  maskThis || backendMasked ? maskName(formatPerson(personRecord)) : formatPerson(personRecord);
                const shownMobile = maskThis ? maskPhone(mobile) : mobile;
                const contactLine = shownMobile ? `${t("ES_COMMON_CONTACT_DETAILS")}: ${shownMobile}` : null;

                // Workflow-driven label: try the localized key, else fall back to the
                // raw action code so ANY workflow's actions (standard PGR + CMS) render
                // legibly even before their WF_PGR_* keys are seeded.
                const labelKey = `${labelPrefix}${instance?.action}`;
                const localizedLabel = t(labelKey);
                return {
                    label: localizedLabel && localizedLabel !== labelKey ? localizedLabel : (instance?.action || ""),
                    variant: 'completed',
                    subElements: [
                        convertEpochFormateToDate(instance?.auditDetails?.lastModifiedTime),
                        personLine,
                        contactLine,
                        formatComment(instance?.comment),
                    ].filter(Boolean),
                    // CCSD-1965: the attachments uploaded AT this workflow step
                    // (verificationDocuments persist per transition). Rendered
                    // per-step below so the timeline keeps the FULL history, not
                    // just the latest upload — same on citizen + employee UIs.
                    documents: Array.isArray(instance?.documents) ? instance.documents : [],
                    showConnector: true,
                };
            });
            setTimelineSteps(steps);
        }
    }, [workflowData]);

    return (
        isWorkFlowLoading ? <Loader /> :
            <TimelineMolecule key="timeline" initialVisibleCount={4} hidePastLabel={timelineSteps.length < 5}>
                {timelineSteps.map((step, index) => {
                    // Base sub-elements + this step's attachments (CCSD-1965) +
                    // current-state children on the first row.
                    const docsNode = renderStepDocs(step.documents);
                    const subElements = [
                        ...step.subElements,
                        ...(docsNode ? [docsNode] : []),
                        ...(index === 0 && currentStateChildren ? [currentStateChildren] : []),
                    ];
                    return (
                        <Timeline
                            key={index}
                            label={step.label}
                            subElements={subElements}
                            variant={step.variant}
                            showConnector={step.showConnector}
                        />
                    );
                })}
            </TimelineMolecule>
    );
};

export default TimelineWrapper;
