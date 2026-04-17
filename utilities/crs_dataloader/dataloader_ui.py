# dataloader_ui.py
# All widget UI logic for DataLoader.ipynb.
# Notebook cells import and call these functions — no widget code in the notebook.

import os, shutil, sys, time, json
import ipywidgets as widgets
from IPython.display import display, clear_output, HTML
import requests as _requests
from datetime import datetime

# ── imports that may not be installed yet at module load ──────────────────────
def _get_loader_imports():
    from unified_loader_v1 import UnifiedExcelReader, APIUploader, clean_nans
    return UnifiedExcelReader, APIUploader, clean_nans

def _uploader(state):
    """Return the authenticated uploader from state, or raise a clear error."""
    if not state.uploader or not state.uploader.authenticated:
        raise RuntimeError("Not authenticated -- run Cell 2 first.")
    return state.uploader


# ═════════════════════════════════════════════════════════════════════════════
# Shared state
# ═════════════════════════════════════════════════════════════════════════════
class State:
    """Mutable container shared across all phase UIs."""
    def __init__(self):
        self.config                 = {}
        self.uploader               = None
        self.tenant_file            = None
        self.common_master_file     = None
        self.employee_master_file   = None
        self.uploaded_tenants       = []
        self.selected_tenant        = None
        self.boundary_tenant        = None
        self.boundary_hierarchy_type= None
        self.template_filestore_id  = None
        # results
        self.result_tenants         = None
        self.result_branding        = None
        self.result_dept            = None
        self.result_desig           = None
        self.result_ct              = None
        self.result_employees       = None


# ═════════════════════════════════════════════════════════════════════════════
# Setup & auth  (Cell 2)
# ═════════════════════════════════════════════════════════════════════════════
def setup_env(base_url, username, password, user_type, tenant_id):
    """
    Install packages, reload local modules, clear upload dir, authenticate.
    Returns a populated State object.
    """
    import warnings
    warnings.filterwarnings("ignore")

    for _mod in ("unified_loader_v1", "mdms_validator", "dataloader_ui"):
        if _mod in sys.modules:
            del sys.modules[_mod]

    _, APIUploader, _ = _get_loader_imports()

    os.makedirs("upload", exist_ok=True)
    for _f in os.listdir("upload"):
        _fp = os.path.join("upload", _f)
        shutil.rmtree(_fp) if os.path.isdir(_fp) else os.unlink(_fp)

    state = State()
    state.config = {"base_url": base_url, "tenant_id": tenant_id}

    if not username or not password:
        print("USERNAME or PASSWORD not set -- edit Cell 1 and re-run.")
        return state

    print(f"Authenticating as {username} @ {base_url} ...")
    state.uploader = APIUploader(base_url, username, password, user_type, tenant_id)
    if state.uploader.authenticated:
        ui = state.uploader.user_info
        roles = ", ".join(r.get("code", "") for r in ui.get("roles", []))
        print(f"Authenticated!  User: {ui.get('userName')}  |  Tenant: {ui.get('tenantId')}")
        print(f"Roles: {roles}")
        print("\nRun phase cells below in order.")
    else:
        print("Authentication failed -- check credentials in Cell 1.")

    return state


# ═════════════════════════════════════════════════════════════════════════════
# Phase 0 – New Tenant Setup  (optional, run before Phase 1)
# ═════════════════════════════════════════════════════════════════════════════
def new_tenant_ui(state: State, base_url_ref: list, username_ref: list,
                  password_ref: list, user_type_ref: list):
    """
    Phase 0: optionally create a brand-new root tenant via setup_default_data,
    then re-authenticate under that tenant so the rest of the phases target it.

    Parameters are single-element lists so the re-auth closure can write back
    the refreshed state without a global variable.
    """
    import re as _re

    # ── info banner ──────────────────────────────────────────────────────────
    info_html = widgets.HTML(
        "<h3>Phase 0 - New Tenant Setup</h3>"
        "<p style='color:#555'>"
        "You are currently authenticated as <b>SUPERADMIN</b> on the "
        "<b>default state tenant</b>. Use this step only if you want to "
        "create a brand-new root tenant. Leave it blank and proceed to "
        "Phase 1 if you are loading data into an existing tenant."
        "</p>"
    )

    # ── current tenant display ───────────────────────────────────────────────
    current_tenant_html = widgets.HTML(
        f"<p style='margin:0'>Current login tenant: "
        f"<code>{state.config.get('tenant_id', '—')}</code></p>"
    )

    # ── new tenant input ─────────────────────────────────────────────────────
    new_tenant_w = widgets.Text(
        placeholder="e.g. statea, citynew",
        description="New Tenant ID:",
        style={"description_width": "140px"},
        layout=widgets.Layout(width="70%"),
    )

    create_btn   = widgets.Button(
        description="Create New Tenant",
        button_style="primary",
        layout=widgets.Layout(width="70%", height="38px"),
    )
    reauth_btn   = widgets.Button(
        description="Re-authenticate with New Tenant",
        button_style="warning",
        layout=widgets.Layout(width="70%", height="38px", visibility="hidden"),
    )
    out = widgets.Output()

    def on_create(b):
        with out:
            clear_output()
            try:
                uploader = _uploader(state)
            except RuntimeError as e:
                print(str(e)); return

            code = new_tenant_w.value.strip().lower()
            if not code:
                print("Enter a tenant ID"); return
            if "." in code or not _re.match(r"^[a-zA-Z0-9_]+$", code):
                print("Tenant ID must be alphanumeric/underscore only (no dots)"); return

            print(f"Creating new tenant '{code}' via setup_default_data ...")
            print("This may take 5-10 minutes, please wait ...")
            result = uploader.setup_default_data(
                targetTenantId=code,
                module="tenant",
                schemaCodes=["tenant.citymodule", "tenant.tenants"],
                onlySchemas=False,
            )
            if result.get("success"):
                print(f"Tenant '{code}' created successfully!")
                print("Click 'Re-authenticate with New Tenant' to switch context.")
                state.config["tenant_id"] = code
                reauth_btn.layout.visibility = "visible"
            else:
                print(f"Failed: {result.get('error', 'unknown error')}")

    def on_reauth(b):
        with out:
            clear_output()
            new_tid = state.config.get("tenant_id", "")
            print(f"Re-authenticating as {username_ref[0]} @ {base_url_ref[0]} "
                  f"with tenant {new_tid} ...")
            _, APIUploader, _ = _get_loader_imports()
            uploader = APIUploader(
                base_url_ref[0], username_ref[0], password_ref[0],
                user_type_ref[0], new_tid,
            )
            if uploader.authenticated:
                state.uploader = uploader
                ui = uploader.user_info
                roles = ", ".join(r.get("code", "") for r in ui.get("roles", []))
                print(f"Authenticated!  User: {ui.get('userName')}  |  "
                      f"Tenant: {ui.get('tenantId')}")
                print(f"Roles: {roles}")
                print("Proceed to Phase 1.")
                current_tenant_html.value = (
                    f"<p style='margin:0'>Current login tenant: "
                    f"<code>{new_tid}</code></p>"
                )
                reauth_btn.layout.visibility = "hidden"
            else:
                print("Re-authentication failed -- check credentials.")

    create_btn.on_click(on_create)
    reauth_btn.on_click(on_reauth)

    return widgets.VBox([
        info_html,
        current_tenant_html,
        new_tenant_w,
        create_btn,
        reauth_btn,
        out,
    ])


# ═════════════════════════════════════════════════════════════════════════════
# Helper: small widget shortcuts
# ═════════════════════════════════════════════════════════════════════════════
def _txt(label, value, w="70%"):
    return widgets.Text(value=value, description=label,
                        style={"description_width": "140px"},
                        layout=widgets.Layout(width=w))

def _btn(label, style="success", w="70%", visible=True):
    vis = "visible" if visible else "hidden"
    return widgets.Button(description=label, button_style=style,
                          layout=widgets.Layout(width=w, height="38px",
                                                visibility=vis))

def _template_link(filename, label="Download Template"):
    """Return an HTML widget that downloads a bundled template as a data URI.

    Using a base64 data URI avoids the Jupyter file-server routing issue where
    an <a href='templates/...'> creates a blank new file instead of serving
    the existing one.
    """
    import base64
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates", filename)
    try:
        with open(path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
        mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        href = f"data:{mime};base64,{b64}"
    except Exception as e:
        return widgets.HTML(
            f"<span style='color:#dc3545;font-size:13px'>"
            f"Template not found: {filename} ({e})</span>"
        )
    return widgets.HTML(
        f"<a href='{href}' download='{filename}' "
        f"style='display:inline-block;padding:6px 16px;background:#17a2b8;"
        f"color:white;border-radius:4px;text-decoration:none;font-size:13px;"
        f"font-weight:bold;margin-bottom:6px'>"
        f"⬇ {label}</a>"
    )

def _upload_w(label="Excel file:", accept=".xlsx,.xls"):
    return widgets.FileUpload(accept=accept, multiple=False,
                              description=label,
                              style={"description_width": "140px"},
                              layout=widgets.Layout(width="70%"))

def _save_upload(file_widget, dest_path):
    """Save first file from a FileUpload widget to dest_path."""
    os.makedirs("upload", exist_ok=True)
    with open(dest_path, "wb") as f:
        f.write(file_widget.value[0]["content"])
    return dest_path

def _validate(file_path, tenant_id, schema_code, uploader):
    """Run MDMS schema validation; returns True if passed or validator unavailable."""
    try:
        from mdms_validator import MDMSValidator
        v = MDMSValidator(base_url=uploader.base_url,
                          auth_token=uploader.auth_token,
                          user_info=uploader.user_info)
        r = v.validate_excel_file(file_path, tenant_id, schema_code)
        if not r["valid"]:
            print(f"Validation failed ({len(r['errors'])} errors):")
            for e in r["errors"][:5]:
                print(f"  - {e['message']}")
            return False
        print("Validation passed")
        return True
    except Exception as ex:
        print(f"Validator skipped: {ex}")
        return True


# ═════════════════════════════════════════════════════════════════════════════
# Phase 1 – Tenant Setup
# ═════════════════════════════════════════════════════════════════════════════
def tenant_ui(state: State):
    """Phase 1: upload Tenant Master Excel."""
    UnifiedExcelReader, _, clean_nans = _get_loader_imports()

    t_w    = _txt("Tenant ID:", state.config.get("tenant_id", "pg"))
    file_w = _upload_w()
    btn    = _btn("Upload Tenant Master")
    out    = widgets.Output()

    def on_upload(b):
        with out:
            clear_output()
            try:
                uploader = _uploader(state)
            except RuntimeError as e:
                print(str(e)); return
            if not t_w.value.strip():  print("Tenant ID required"); return
            if not file_w.value:       print("Select an Excel file"); return
            state.config["tenant_id"] = t_w.value.strip().lower()
            dest = os.path.join("upload", "Tenant_Master.xlsx")
            _save_upload(file_w, dest)
            print(f"Saved: {dest}")
            if not _validate(dest, state.config["tenant_id"],
                             "tenant.masterschemavalidation", uploader):
                return
            state.tenant_file = dest
            reader = UnifiedExcelReader(dest)
            tenants_data, tenants_loc = reader.read_tenant_info()
            state.uploaded_tenants = [t["code"] for t in tenants_data]
            print(f"Uploading {len(tenants_data)} tenant(s): {', '.join(state.uploaded_tenants)}")
            state.result_tenants = uploader.create_mdms_data(
                "tenant.tenants", clean_nans(tenants_data),
                state.config["tenant_id"], "Tenant Info", dest)
            uploader.create_localization_messages(
                clean_nans(tenants_loc), state.config["tenant_id"], "Tenants_Localization")
            branding = reader.read_tenant_branding(state.config["tenant_id"])
            if branding:
                print(f"Uploading {len(branding)} branding record(s) ...")
                state.result_branding = uploader.create_mdms_data(
                    "common-masters.StateInfo", clean_nans(branding),
                    state.config["tenant_id"], "Tenant Branding Details", dest)
            ok = state.result_tenants.get("failed", 0) == 0
            print("Phase 1 complete!" if ok
                  else "Done with errors -- check status columns in the Excel.")

    btn.on_click(on_upload)
    return widgets.VBox([
        widgets.HTML("<h3>Phase 1 - Tenant Setup</h3>"),
        widgets.HTML(
            "<ol style='color:#555;margin:0 0 10px 0;padding-left:20px;line-height:1.8'>"
            "<li>Download the template using the button below.</li>"
            "<li>Fill in the <b>Tenant Info</b> sheet with your tenant code, name, city, state, and other details.</li>"
            "<li>Fill in the <b>Branding</b> sheet with logo URLs and colour codes.</li>"
            "<li>Verify all mandatory columns are filled and codes have no spaces or special characters.</li>"
            "<li>Upload the filled file and click <b>Upload Tenant Master</b>.</li>"
            "</ol>"
        ),
        _template_link("Tenant And Branding Master.xlsx", "Download Tenant Master Template"),
        t_w, file_w, btn, out,
    ])


# ═════════════════════════════════════════════════════════════════════════════
# Phase 2 – Boundary Management
# ═════════════════════════════════════════════════════════════════════════════
def boundary_ui(state: State):
    """Phase 2: boundary hierarchy setup, template download & upload."""
    b_tenant_w = _txt("Tenant ID:", state.config.get("tenant_id", "pg"))

    # ── Step 2a: create new hierarchy ────────────────────────────────────────
    hier_type_w    = _txt("Hierarchy:", "ADMIN")
    levels_box     = widgets.VBox()
    level_widgets  = []
    gen_tmpl_btn   = _btn("Generate Template",   "warning", visible=False)
    check_again_btn= _btn("Check Status Again",  "warning", visible=False)
    dl_tmpl_btn    = _btn("Download Template",   "info",    visible=False)
    step2a_out     = widgets.Output()

    def add_level(b=None):
        n = len(level_widgets) + 1
        w = widgets.Text(placeholder=f"Level {n} name  e.g. City",
                         description=f"Level {n}:",
                         style={"description_width": "140px"},
                         layout=widgets.Layout(width="70%"))
        level_widgets.append(w)
        levels_box.children = tuple(level_widgets)
    add_level()

    add_level_btn    = _btn("+ Add Level",       "info",    "140px")
    create_hier_btn  = _btn("Create Hierarchy",  "primary")
    add_level_btn.on_click(add_level)

    def on_create_hier(b):
        with step2a_out:
            clear_output()
            try:
                uploader = _uploader(state)
            except RuntimeError as e:
                print(str(e)); return
            tenant = b_tenant_w.value.strip()
            htype  = hier_type_w.value.strip()
            levels = [w.value.strip() for w in level_widgets if w.value.strip()]
            if not tenant or not htype or not levels:
                print("Fill tenant, hierarchy type, and at least one level"); return
            state.boundary_tenant          = tenant
            state.boundary_hierarchy_type  = htype
            items = []; prev = None
            for lvl in levels:
                items.append({"boundaryType": lvl, "parentBoundaryType": prev, "active": True})
                prev = lvl
            result = uploader.create_boundary_hierarchy(
                {"tenantId": tenant, "hierarchyType": htype, "boundaryHierarchy": items})
            if result:
                print(f"Hierarchy '{htype}' created: {' -> '.join(levels)}")
                gen_tmpl_btn.layout.visibility = "visible"
                # Update CMS-BOUNDARY.HierarchySchema so CMS/HRMS UI reflects
                # the correct hierarchy type and boundary level range
                schema_r = uploader.update_hierarchy_schema(
                    tenant_id=tenant,
                    hierarchy_type=htype,
                    highest_hierarchy=levels[-1],
                    lowest_hierarchy=levels[-1],
                )
                if schema_r["updated"] > 0:
                    print(f"HierarchySchema updated ({schema_r['updated']} record(s))")
                elif schema_r["failed"] > 0:
                    print(f"HierarchySchema update had errors -- "
                          f"{[e.get('error','') for e in schema_r['errors']]}")
            else:
                print("Hierarchy creation failed")
    create_hier_btn.on_click(on_create_hier)

    def poll_and_show(uploader, dl_btn, check_btn):
        res = uploader.poll_boundary_template_status(
            state.boundary_tenant, state.boundary_hierarchy_type)
        if res and res.get("status") == "completed":
            state.template_filestore_id = res.get("fileStoreid")
            print("Template ready -- click Download")
            dl_btn.layout.visibility    = "visible"
            check_btn.layout.visibility = "hidden"
        else:
            print("Still not ready -- click Check Status Again to retry.")
            check_btn.layout.visibility = "visible"

    def on_gen_tmpl(b):
        with step2a_out:
            clear_output()
            try:
                uploader = _uploader(state)
            except RuntimeError as e:
                print(str(e)); return
            print(f"Generating template for {state.boundary_tenant} / {state.boundary_hierarchy_type} ...")
            uploader.generate_boundary_template(
                state.boundary_tenant, state.boundary_hierarchy_type)
            poll_and_show(uploader, dl_tmpl_btn, check_again_btn)
    gen_tmpl_btn.on_click(on_gen_tmpl)

    def on_check_again(b):
        with step2a_out:
            clear_output(wait=True)
            try:
                uploader = _uploader(state)
            except RuntimeError as e:
                print(str(e)); return
            poll_and_show(uploader, dl_tmpl_btn, check_again_btn)
    check_again_btn.on_click(on_check_again)

    def on_dl_tmpl(b):
        with step2a_out:
            if not state.template_filestore_id:
                print("Generate template first"); return
            try:
                uploader = _uploader(state)
            except RuntimeError as e:
                print(str(e)); return
            result = uploader.download_boundary_template(
                state.boundary_tenant, state.template_filestore_id,
                state.boundary_hierarchy_type, return_url=True)
            if result:
                display(HTML(
                    f"<div style='background:#d4edda;padding:12px;border-radius:6px'>"
                    f"<b>Downloaded:</b> {result['path']}<br>"
                    f"<a href='{result['url']}' download='boundary_template.xlsx' "
                    f"style='display:inline-block;margin-top:8px;padding:8px 18px;"
                    f"background:#007bff;color:white;border-radius:5px;text-decoration:none;"
                    f"font-weight:bold'>Click to Download</a>"
                    f"<br><small>Fill boundary data, save, then use Step 2b to upload.</small>"
                    f"</div>"
                ))
    dl_tmpl_btn.on_click(on_dl_tmpl)

    # ── Step 2a: use existing hierarchy ──────────────────────────────────────
    search_btn      = _btn("Search Hierarchies",   "primary")
    hier_dd         = widgets.Dropdown(options=[], description="Select:",
                                       style={"description_width": "140px"},
                                       layout=widgets.Layout(width="70%", visibility="hidden"))
    search_gen_btn  = _btn("Generate Template",    "warning", visible=False)
    search_check_btn= _btn("Check Status Again",   "warning", visible=False)
    search_dl_btn   = _btn("Download Template",    "info",    visible=False)
    search_out      = widgets.Output()

    def on_search(b):
        with search_out:
            clear_output()
            try:
                uploader = _uploader(state)
            except RuntimeError as e:
                print(str(e)); return
            tenant = b_tenant_w.value.strip()
            if not tenant: print("Enter tenant ID"); return
            state.boundary_tenant = tenant
            hierarchies = uploader.search_boundary_hierarchies(tenant)
            if hierarchies:
                hier_dd.options = [
                    (f"{h['hierarchyType']} ({len(h.get('boundaryHierarchy', []))} levels)",
                     h["hierarchyType"])
                    for h in hierarchies
                ]
                hier_dd.layout.visibility    = "visible"
                search_gen_btn.layout.visibility = "visible"
                print(f"Found {len(hierarchies)} hierarchy/ies")
            else:
                print("No hierarchies found")
    search_btn.on_click(on_search)

    def on_search_gen(b):
        with search_out:
            clear_output()
            try:
                uploader = _uploader(state)
            except RuntimeError as e:
                print(str(e)); return
            state.boundary_hierarchy_type = hier_dd.value
            print(f"Generating template for {state.boundary_hierarchy_type} ...")
            uploader.generate_boundary_template(
                state.boundary_tenant, state.boundary_hierarchy_type)
            poll_and_show(uploader, search_dl_btn, search_check_btn)
            # Update CMS-BOUNDARY.HierarchySchema from the existing hierarchy definition
            hier_def = uploader._get_boundary_hierarchy(
                state.boundary_tenant, state.boundary_hierarchy_type)
            if hier_def:
                bh = hier_def.get("boundaryHierarchy", [])
                if bh:
                    schema_r = uploader.update_hierarchy_schema(
                        tenant_id=state.boundary_tenant,
                        hierarchy_type=state.boundary_hierarchy_type,
                        highest_hierarchy=bh[-1]["boundaryType"],
                        lowest_hierarchy=bh[-1]["boundaryType"],
                    )
                    if schema_r["updated"] > 0:
                        print(f"HierarchySchema updated ({schema_r['updated']} record(s))")
                    elif schema_r["failed"] > 0:
                        print(f"HierarchySchema update had errors -- "
                              f"{[e.get('error','') for e in schema_r['errors']]}")
    search_gen_btn.on_click(on_search_gen)

    def on_search_check(b):
        with search_out:
            clear_output(wait=True)
            try:
                uploader = _uploader(state)
            except RuntimeError as e:
                print(str(e)); return
            poll_and_show(uploader, search_dl_btn, search_check_btn)
    search_check_btn.on_click(on_search_check)

    def on_search_dl(b):
        with search_out:
            try:
                uploader = _uploader(state)
            except RuntimeError as e:
                print(str(e)); return
            result = uploader.download_boundary_template(
                state.boundary_tenant, state.template_filestore_id,
                state.boundary_hierarchy_type, return_url=True)
            if result:
                display(HTML(
                    f"<a href='{result['url']}' download='boundary_template.xlsx' "
                    f"style='padding:8px 18px;background:#007bff;color:white;"
                    f"border-radius:5px;text-decoration:none;font-weight:bold'>"
                    f"Click to Download</a>"
                ))
    search_dl_btn.on_click(on_search_dl)

    tab_2a = widgets.Tab()
    tab_2a.children = [
        widgets.VBox([
            widgets.HTML("<p style='color:#555'>Create a new boundary hierarchy from scratch.</p>"),
            hier_type_w, widgets.HTML("<b>Boundary Levels:</b>"), levels_box,
            add_level_btn, create_hier_btn,
            gen_tmpl_btn, check_again_btn, dl_tmpl_btn,
            step2a_out,
        ]),
        widgets.VBox([
            widgets.HTML("<p style='color:#555'>Use an existing hierarchy.</p>"),
            search_btn, hier_dd,
            search_gen_btn, search_check_btn, search_dl_btn,
            search_out,
        ]),
    ]
    tab_2a.set_title(0, "Create New Hierarchy")
    tab_2a.set_title(1, "Use Existing Hierarchy")

    # ── Step 2b: upload boundary data ────────────────────────────────────────
    bnd_file_w     = _upload_w("Filled template:")
    upload_bnd_btn = _btn("Upload & Process Boundary")
    bnd_out        = widgets.Output()

    def on_upload_bnd(b):
        with bnd_out:
            clear_output()
            try:
                uploader = _uploader(state)
            except RuntimeError as e:
                print(str(e)); return
            if not state.boundary_tenant or not state.boundary_hierarchy_type:
                print("Complete Step 2a first"); return
            if not bnd_file_w.value:
                print("Select a filled template Excel"); return
            path = os.path.join(
                "upload",
                f"boundary_{state.boundary_tenant}_{state.boundary_hierarchy_type}.xlsx")
            _save_upload(bnd_file_w, path)
            print(f"Saved: {path}")
            # Upload to filestore, then submit to boundary management process API
            fst_id = uploader.upload_file_to_filestore(
                path, state.boundary_tenant, "HCM-ADMIN-CONSOLE")
            if not fst_id:
                print("Filestore upload failed -- aborting"); return
            resource = uploader.process_boundary_data(
                state.boundary_tenant,
                filestore_id=fst_id,
                hierarchy_type=state.boundary_hierarchy_type,
                action="create",
            )
            if not resource:
                print("Boundary processing failed — could not submit job."); return
            # Poll until the boundary management service finishes processing
            final = uploader.poll_boundary_process_status(
                state.boundary_tenant, state.boundary_hierarchy_type)
            if final.get("status") == "completed":
                print(f"Phase 2 complete! Boundary data processed successfully.")
                processed_id = final.get("processedFileStoreId")
                if processed_id:
                    print(f"   Processed FileStore ID: {processed_id}")
            else:
                print(f"Boundary processing ended with status: {final.get('status', 'unknown')}")
    upload_bnd_btn.on_click(on_upload_bnd)

    acc = widgets.Accordion(children=[
        widgets.VBox([
            widgets.HTML("<p style='color:#555'>Set up or select a hierarchy, then download the template.</p>"),
            b_tenant_w, tab_2a,
        ]),
        widgets.VBox([
            widgets.HTML(
                "<p style='color:#555'>Upload the filled template. Tenant/hierarchy taken from Step 2a.</p>"
                "<div style='background:#f8f9fa;border:1px solid #dee2e6;border-radius:6px;padding:12px;margin-bottom:10px'>"
                "<b>How to fill the boundary template:</b>"
                "<p style='margin:6px 0 4px'>Each row represents one boundary node. "
                "Fill from left to right — repeat parent values on every child row, "
                "and leave child columns blank when listing a parent-only row.</p>"
                "<table style='border-collapse:collapse;font-size:13px;width:100%'>"
                "<thead><tr style='background:#e9ecef'>"
                "<th style='border:1px solid #ccc;padding:4px 10px'>ADMIN_CITY</th>"
                "<th style='border:1px solid #ccc;padding:4px 10px'>ADMIN_ZONE</th>"
                "<th style='border:1px solid #ccc;padding:4px 10px'>ADMIN_BLOCK</th>"
                "<th style='border:1px solid #ccc;padding:4px 10px;color:#555'>Purpose</th>"
                "</tr></thead>"
                "<tbody>"
                "<tr><td style='border:1px solid #ccc;padding:3px 10px'>AddisAbaba</td><td style='border:1px solid #ccc;padding:3px 10px'></td><td style='border:1px solid #ccc;padding:3px 10px'></td><td style='border:1px solid #ccc;padding:3px 10px;color:#555'>City only</td></tr>"
                "<tr style='background:#f8f9fa'><td style='border:1px solid #ccc;padding:3px 10px'>AddisAbaba</td><td style='border:1px solid #ccc;padding:3px 10px'>Bole</td><td style='border:1px solid #ccc;padding:3px 10px'></td><td style='border:1px solid #ccc;padding:3px 10px;color:#555'>Zone under city</td></tr>"
                "<tr><td style='border:1px solid #ccc;padding:3px 10px'>AddisAbaba</td><td style='border:1px solid #ccc;padding:3px 10px'>Bole</td><td style='border:1px solid #ccc;padding:3px 10px'>BoleAirport</td><td style='border:1px solid #ccc;padding:3px 10px;color:#555'>Block under Bole</td></tr>"
                "<tr style='background:#f8f9fa'><td style='border:1px solid #ccc;padding:3px 10px'>AddisAbaba</td><td style='border:1px solid #ccc;padding:3px 10px'>Bole</td><td style='border:1px solid #ccc;padding:3px 10px'>BoleMedhaneAlem</td><td style='border:1px solid #ccc;padding:3px 10px;color:#555'>Another block under Bole</td></tr>"
                "<tr><td style='border:1px solid #ccc;padding:3px 10px'>AddisAbaba</td><td style='border:1px solid #ccc;padding:3px 10px'>Yeka</td><td style='border:1px solid #ccc;padding:3px 10px'></td><td style='border:1px solid #ccc;padding:3px 10px;color:#555'>Second zone under city</td></tr>"
                "<tr style='background:#f8f9fa'><td style='border:1px solid #ccc;padding:3px 10px'>AddisAbaba</td><td style='border:1px solid #ccc;padding:3px 10px'>Yeka</td><td style='border:1px solid #ccc;padding:3px 10px'>YekaMedhaneAlem</td><td style='border:1px solid #ccc;padding:3px 10px;color:#555'>Block under Yeka</td></tr>"
                "</tbody></table>"
                "<p style='margin:6px 0 0;color:#555;font-size:12px'>"
                "<b>Rules:</b> Column names must match the hierarchy levels exactly (case-sensitive). "
                "Always repeat the parent value in every child row. "
                "Leave deeper columns empty when defining a higher-level boundary.</p>"
                "</div>"
            ),
            bnd_file_w, upload_bnd_btn, bnd_out,
        ]),
    ])
    acc.set_title(0, "Step 2a -- Hierarchy Setup & Template Download")
    acc.set_title(1, "Step 2b -- Upload Filled Boundary Template")
    acc.selected_index = 0
    return widgets.VBox([widgets.HTML("<h3>Phase 2 - Boundary Management</h3>"), acc])


# ═════════════════════════════════════════════════════════════════════════════
# Phase 3 – Common Masters
# ═════════════════════════════════════════════════════════════════════════════
def common_masters_ui(state: State):
    """Phase 3: upload departments, designations, complaint types."""
    UnifiedExcelReader, _, clean_nans = _get_loader_imports()

    t_w    = _txt("Tenant ID:", state.config.get("tenant_id", "pg"))
    file_w = _upload_w()
    btn    = _btn("Upload Common Master")
    out    = widgets.Output()

    def on_upload(b):
        with out:
            clear_output()
            try:
                uploader = _uploader(state)
            except RuntimeError as e:
                print(str(e)); return
            if not t_w.value.strip():  print("Tenant ID required"); return
            if not file_w.value:       print("Select an Excel file"); return
            state.selected_tenant = t_w.value.strip().lower()
            dest = os.path.join("upload", "Common_Master.xlsx")
            _save_upload(file_w, dest)
            print(f"Saved: {dest}")
            if not _validate(dest, state.selected_tenant,
                             "common.masterschemavalidation", uploader):
                return
            state.common_master_file = dest
            reader = UnifiedExcelReader(dest)
            (dept_data, desig_data,
             dept_loc, desig_loc,
             dept_name_to_code) = reader.read_departments_designations(
                state.selected_tenant, uploader)
            if dept_data:
                state.result_dept = uploader.create_mdms_data(
                    "common-masters.Department", clean_nans(dept_data),
                    state.selected_tenant, "Department And Desgination Mast", dest)
                r = state.result_dept
                print(f"Departments: {r.get('created',0)} created, "
                      f"{r.get('exists',0)} exist, {r.get('failed',0)} failed")
            if dept_loc:
                uploader.create_localization_messages(
                    clean_nans(dept_loc), state.selected_tenant, "Department_Localization")
            if desig_data:
                state.result_desig = uploader.create_mdms_data(
                    "common-masters.Designation", clean_nans(desig_data),
                    state.selected_tenant, "Department And Desgination Mast", dest)
                r = state.result_desig
                print(f"Designations: {r.get('created',0)} created, "
                      f"{r.get('exists',0)} exist, {r.get('failed',0)} failed")
            if desig_loc:
                uploader.create_localization_messages(
                    clean_nans(desig_loc), state.selected_tenant, "Designation_Localization")
            ct_data, ct_loc = reader.read_complaint_types(state.selected_tenant, dept_name_to_code)
            if ct_data:
                state.result_ct = uploader.create_mdms_data(
                    "RAINMAKER-PGR.ServiceDefs", clean_nans(ct_data),
                    state.selected_tenant, "Complaint Type Master", dest)
                r = state.result_ct
                print(f"Complaint Types: {r.get('created',0)} created, "
                      f"{r.get('exists',0)} exist, {r.get('failed',0)} failed")
            if ct_loc:
                uploader.create_localization_messages(
                    clean_nans(ct_loc), state.selected_tenant, "ComplaintType_Localization")
            all_ok = all(
                (r or {}).get("failed", 0) == 0
                for r in [state.result_dept, state.result_desig, state.result_ct]
                if r
            )
            print("Phase 3 complete!" if all_ok
                  else "Done with errors -- check status columns in the Excel.")

    btn.on_click(on_upload)
    return widgets.VBox([
        widgets.HTML("<h3>Phase 3 - Common Masters</h3>"),
        widgets.HTML(
            "<ol style='color:#555;margin:0 0 10px 0;padding-left:20px;line-height:1.8'>"
            "<li>Download the template using the button below.</li>"
            "<li>Fill in the <b>Departments</b> sheet — each department needs a unique code and name.</li>"
            "<li>Fill in the <b>Designations</b> sheet — link each designation to a department code.</li>"
            "<li>Fill in the <b>Complaint Types</b> sheet — each type needs a service code, name, and mapped department.</li>"
            "<li>Ensure no duplicate codes exist across sheets and all referenced department codes are valid.</li>"
            "<li>Upload the filled file and click <b>Upload Common Master</b>.</li>"
            "</ol>"
        ),
        _template_link("Common and Complaint Master.xlsx", "Download Common Masters Template"),
        t_w, file_w, btn, out,
    ])


# ═════════════════════════════════════════════════════════════════════════════
# Phase 4 – Employees
# ═════════════════════════════════════════════════════════════════════════════
def employee_ui(state: State):
    """Phase 4: generate employee template and bulk-create employees."""
    UnifiedExcelReader, _, clean_nans = _get_loader_imports()

    # ── Step 4a: generate ────────────────────────────────────────────────────
    eg_t_w  = _txt("Tenant ID:", state.config.get("tenant_id", "pg"))
    gen_btn = _btn("Generate Employee Template", "primary")
    gen_out = widgets.Output()

    def on_gen_emp(b):
        with gen_out:
            clear_output()
            try:
                uploader = _uploader(state)
            except RuntimeError as e:
                print(str(e)); return
            tenant = eg_t_w.value.strip().lower()
            if not tenant: print("Tenant ID required"); return
            print(f"Fetching MDMS data for {tenant} ...")
            try:
                path = uploader.generate_employee_template(tenant)
                display(HTML(
                    f"<div style='background:#d4edda;padding:12px;border-radius:6px'>"
                    f"<b>Template generated:</b> {path}<br>"
                    f"<a href='{path}' download='Employee_Template.xlsx' "
                    f"style='display:inline-block;margin-top:8px;padding:8px 18px;"
                    f"background:#28a745;color:white;border-radius:5px;text-decoration:none;"
                    f"font-weight:bold'>Download Template</a>"
                    f"<br><small>Fill rows, save, then use Step 4b to upload.</small></div>"
                ))
            except Exception as ex:
                print(f"Error: {ex}")
    gen_btn.on_click(on_gen_emp)

    # ── Step 4b: upload ───────────────────────────────────────────────────────
    eu_t_w   = _txt("Tenant ID:", state.config.get("tenant_id", "pg"))
    eu_file_w = _upload_w()
    eu_btn   = _btn("Upload Employees")
    eu_out   = widgets.Output()

    def on_emp_upload(b):
        with eu_out:
            clear_output()
            try:
                uploader = _uploader(state)
            except RuntimeError as e:
                print(str(e)); return
            if not eu_t_w.value.strip():  print("Tenant ID required"); return
            if not eu_file_w.value:       print("Select an Excel file"); return
            tenant = eu_t_w.value.strip().lower()
            dest   = os.path.join("upload", "Employee_Master.xlsx")
            _save_upload(eu_file_w, dest)
            print(f"Saved: {dest}")
            state.employee_master_file = dest
            reader    = UnifiedExcelReader(dest)
            employees = reader.read_employees_bulk(tenant, uploader)
            print(f"Found {len(employees)} employee(s)")
            state.result_employees = uploader.create_employees(
                clean_nans(employees), tenant, "Employee Master", dest)
            ok = state.result_employees.get("failed", 0) == 0
            print("Phase 4 complete!" if ok
                  else "Done with errors -- check status columns in the Excel.")
    eu_btn.on_click(on_emp_upload)

    acc4 = widgets.Accordion(children=[
        widgets.VBox([
            widgets.HTML("<p style='color:#555'>Generates a template with dropdowns "
                         "pre-filled from MDMS.</p>"),
            eg_t_w, gen_btn, gen_out,
        ]),
        widgets.VBox([
            widgets.HTML("<p style='color:#555'>Upload the filled template to "
                         "bulk-create employees in HRMS.</p>"),
            eu_t_w, eu_file_w, eu_btn, eu_out,
        ]),
    ])
    acc4.set_title(0, "Step 4a -- Generate Template")
    acc4.set_title(1, "Step 4b -- Upload Employees")
    acc4.selected_index = 0
    return widgets.VBox([
        widgets.HTML("<h3>Phase 4 - Employee Bulk Creation</h3>"),
        acc4,
    ])


# ═════════════════════════════════════════════════════════════════════════════
# Phase 5 – Workflow
# ═════════════════════════════════════════════════════════════════════════════
_WORKFLOW_TEMPLATE = os.path.join(
    os.path.dirname(__file__), "templates", "PgrWorkflowConfig.json"
)

def workflow_ui(state: State):
    """Phase 5: download default workflow template, edit, then apply via create/update."""
    # ── Step 5a: download template ────────────────────────────────────────────
    wf_t_w = _txt("Tenant ID:", state.config.get("tenant_id", "pg"))

    import base64 as _b64

    def _build_wf_link(tenant):
        try:
            with open(_WORKFLOW_TEMPLATE, "r", encoding="utf-8") as _f:
                content = _f.read()
            content = content.replace("{tenantid}", tenant).replace("{tenantId}", tenant)
            b64 = _b64.b64encode(content.encode("utf-8")).decode()
            return (
                f"<a href='data:application/json;base64,{b64}' "
                f"download='PgrWorkflowConfig.json' "
                f"style='display:inline-block;padding:7px 16px;background:#007bff;"
                f"color:white;border-radius:4px;text-decoration:none;font-weight:bold;"
                f"font-size:13px'>⬇ Download Default Workflow Template</a>"
                f"<span style='margin-left:12px;color:#555;font-size:12px'>"
                f"Tenant: <b>{tenant}</b> — edit, then apply via Step 5b.</span>"
            )
        except Exception as _e:
            return f"<span style='color:#dc3545'>Template not found: {_e}</span>"

    dl_wf_btn = widgets.HTML(_build_wf_link(wf_t_w.value))

    def _on_wf_tenant_change(change):
        dl_wf_btn.value = _build_wf_link(change['new'])

    wf_t_w.observe(_on_wf_tenant_change, names='value')

    # ── Step 5b: apply modified workflow ─────────────────────────────────────
    wf_file_w = widgets.FileUpload(accept=".json", multiple=False,
                                   description="JSON file:",
                                   style={"description_width": "140px"},
                                   layout=widgets.Layout(width="70%"))
    up_wf_btn = _btn("Apply Workflow")
    up_wf_out = widgets.Output()
    wf_file   = [None]

    def on_wf_file_change(change):
        if not change["new"]: return
        files   = change["new"]
        fname   = (files[0]["name"]    if isinstance(files, (list, tuple))
                   else list(files.keys())[0])
        content = (files[0]["content"] if isinstance(files, (list, tuple))
                   else files[fname]["content"])
        wf_file[0] = os.path.join("upload", f"uploaded_{fname}")
        os.makedirs("upload", exist_ok=True)
        with open(wf_file[0], "wb") as f:
            f.write(content)
        with up_wf_out:
            clear_output()
            print(f"Loaded: {fname} -- click Apply Workflow")
    wf_file_w.observe(on_wf_file_change, names="value")

    def on_up_wf(b):
        with up_wf_out:
            clear_output()
            try:
                uploader = _uploader(state)
            except RuntimeError as e:
                print(str(e)); return
            path = wf_file[0] or _wf_path[0]
            if not path or not os.path.exists(path):
                print("Download the template (Step 5a) or upload a JSON file first"); return
            try:
                with open(path) as f:
                    data = json.load(f)
                # Support both full request body {BusinessServices:[...]} and bare object
                services = data.get("BusinessServices") if isinstance(data, dict) else None
                if services is None:
                    services = [data]
                tenant = wf_t_w.value.strip()
                for svc_obj in services:
                    svc_obj["tenantId"] = tenant or svc_obj.get("tenantId", "")
                    svc_code = svc_obj.get("businessService", "?")
                    existing = uploader.search_workflow(svc_obj["tenantId"], svc_code)
                    if existing:
                        result = uploader.update_workflow(svc_obj["tenantId"], svc_obj)
                        if result.get("updated", False):
                            print(f"✅ Workflow '{svc_code}' successfully updated for tenant '{svc_obj['tenantId']}'")
                        else:
                            print(f"❌ Workflow '{svc_code}' update failed — {result.get('error', 'unknown error')}")
                    else:
                        result = uploader.create_workflow(svc_obj["tenantId"], svc_obj)
                        if result.get("created", False):
                            print(f"✅ Workflow '{svc_code}' successfully loaded for tenant '{svc_obj['tenantId']}'")
                        else:
                            print(f"❌ Workflow '{svc_code}' load failed — {result.get('error', 'unknown error')}")
            except Exception as ex:
                print(f"Error: {ex}")
    up_wf_btn.on_click(on_up_wf)

    acc5 = widgets.Accordion(children=[
        widgets.VBox([
            widgets.HTML("<p style='color:#555'>Downloads the default PGR workflow template "
                         "to your browser's Downloads folder. Edit it, then use Step 5b.</p>"),
            wf_t_w, dl_wf_btn,
        ]),
        widgets.VBox([
            widgets.HTML("<p style='color:#555'>Upload your modified JSON. Applies create or "
                         "update based on whether the business service already exists.</p>"),
            wf_file_w, up_wf_btn, up_wf_out,
        ]),
    ])
    acc5.set_title(0, "Step 5a -- Download Workflow Template")
    acc5.set_title(1, "Step 5b -- Apply Modified Workflow")
    acc5.selected_index = 0
    return widgets.VBox([
        widgets.HTML("<h3>Phase 5 - Workflow Configuration</h3>"),
        acc5,
    ])


# ═════════════════════════════════════════════════════════════════════════════
# Summary
# ═════════════════════════════════════════════════════════════════════════════
def render_summary(state: State):
    """Render a consolidated HTML upload-status table from the shared state."""
    summary_data = []
    cm = state.common_master_file
    em = state.employee_master_file
    tf = state.tenant_file

    if state.result_tenants:
        summary_data.append({"module": "Tenants",
                              **{k: state.result_tenants.get(k, 0)
                                 for k in ("created", "exists", "failed")},
                              "excel_file": tf, "sheet": "Tenant Info"})
    if state.result_dept:
        summary_data.append({"module": "Departments",
                              **{k: state.result_dept.get(k, 0)
                                 for k in ("created", "exists", "failed")},
                              "excel_file": cm, "sheet": "Depts"})
    if state.result_desig:
        summary_data.append({"module": "Designations",
                              **{k: state.result_desig.get(k, 0)
                                 for k in ("created", "exists", "failed")},
                              "excel_file": cm, "sheet": "Desigs"})
    if state.result_ct:
        summary_data.append({"module": "Complaint Types",
                              **{k: state.result_ct.get(k, 0)
                                 for k in ("created", "exists", "failed")},
                              "excel_file": cm, "sheet": "CT Master"})
    if state.result_employees:
        summary_data.append({"module": "Employees (HRMS)",
                              **{k: state.result_employees.get(k, 0)
                                 for k in ("created", "exists", "failed")},
                              "excel_file": em, "sheet": "Employee Master"})

    if not summary_data:
        print("No results yet -- run phases 1-4 first.")
        return

    totals       = {k: sum(d[k] for d in summary_data)
                    for k in ("created", "exists", "failed")}
    total_records = sum(totals.values())

    rows = "".join(
        f"<tr>"
        f"<td style='padding:8px;border:1px solid #ddd'>{d['module']}</td>"
        f"<td style='padding:8px;border:1px solid #ddd;text-align:center;"
        f"color:green;font-weight:bold'>{d['created']}</td>"
        f"<td style='padding:8px;border:1px solid #ddd;text-align:center;"
        f"color:orange;font-weight:bold'>{d['exists']}</td>"
        f"<td style='padding:8px;border:1px solid #ddd;text-align:center;"
        f"color:red;font-weight:bold'>{d['failed']}</td>"
        f"<td style='padding:8px;border:1px solid #ddd;text-align:center;"
        f"font-weight:bold'>{d['created']+d['exists']+d['failed']}</td>"
        f"</tr>"
        for d in summary_data
    )

    updated_files = {}
    for d in summary_data:
        fp = d.get("excel_file")
        if fp and os.path.exists(fp):
            entry = updated_files.setdefault(
                fp, {"name": os.path.basename(fp), "modules": [], "has_errors": False})
            entry["modules"].append(d["module"])
            if d["failed"] > 0:
                entry["has_errors"] = True

    dl = ""
    if updated_files:
        dl = ("<div style='margin:20px 0;padding:15px;background:#e7f3ff;"
              "border-left:4px solid #007bff;border-radius:5px'>")
        for fp, info in updated_files.items():
            badge = (
                '<span style="background:#dc3545;color:white;padding:3px 8px;'
                'border-radius:3px;font-size:11px">HAS ERRORS</span>'
                if info["has_errors"] else
                '<span style="background:#28a745;color:white;padding:3px 8px;'
                'border-radius:3px;font-size:11px">ALL SUCCESS</span>'
            )
            dl += (
                f"<div style='margin-bottom:10px;padding:10px;background:white;"
                f"border-radius:5px;border:1px solid #ddd'>"
                f"<strong style='color:#007bff'>{info['name']}</strong> {badge}<br>"
                f"<span style='font-size:12px;color:#666'>"
                f"Modules: {', '.join(info['modules'])}</span><br>"
                f"<a href='{fp}' download='{info['name']}' "
                f"style='display:inline-block;padding:8px 16px;background:#007bff;"
                f"color:white;text-decoration:none;border-radius:5px;"
                f"font-weight:bold;margin-top:5px'>Download</a></div>"
            )
        dl += "</div>"

    ts   = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    html = (
        f"<div style='font-family:Arial,sans-serif;padding:20px;border:2px solid #007bff;"
        f"border-radius:10px;background:#f8f9fa'>"
        f"<h2 style='color:#007bff;margin-top:0'>Upload Summary ({ts})</h2>"
        f"<table style='width:100%;border-collapse:collapse;background:white'>"
        f"<thead><tr style='background:#007bff;color:white'>"
        f"<th style='padding:12px;border:1px solid #ddd;text-align:left'>Module</th>"
        f"<th style='padding:12px;border:1px solid #ddd;text-align:center'>Created</th>"
        f"<th style='padding:12px;border:1px solid #ddd;text-align:center'>Exists</th>"
        f"<th style='padding:12px;border:1px solid #ddd;text-align:center'>Failed</th>"
        f"<th style='padding:12px;border:1px solid #ddd;text-align:center'>Total</th>"
        f"</tr></thead><tbody>{rows}"
        f"<tr style='background:#e9ecef;font-weight:bold'>"
        f"<td style='padding:12px;border:1px solid #ddd'>TOTAL</td>"
        f"<td style='padding:12px;border:1px solid #ddd;text-align:center;"
        f"color:green'>{totals['created']}</td>"
        f"<td style='padding:12px;border:1px solid #ddd;text-align:center;"
        f"color:orange'>{totals['exists']}</td>"
        f"<td style='padding:12px;border:1px solid #ddd;text-align:center;"
        f"color:red'>{totals['failed']}</td>"
        f"<td style='padding:12px;border:1px solid #ddd;text-align:center'>"
        f"{total_records}</td>"
        f"</tr></tbody></table>"
        f"<div style='display:flex;justify-content:space-around;margin:20px 0;flex-wrap:wrap'>"
        f"<div style='text-align:center;padding:15px;background:#d4edda;border-radius:5px;"
        f"flex:1;margin:5px;min-width:120px'>"
        f"<div style='font-size:32px;font-weight:bold;color:#155724'>{totals['created']}</div>"
        f"<div style='color:#155724'>Created</div></div>"
        f"<div style='text-align:center;padding:15px;background:#fff3cd;border-radius:5px;"
        f"flex:1;margin:5px;min-width:120px'>"
        f"<div style='font-size:32px;font-weight:bold;color:#856404'>{totals['exists']}</div>"
        f"<div style='color:#856404'>Exists</div></div>"
        f"<div style='text-align:center;padding:15px;background:#f8d7da;border-radius:5px;"
        f"flex:1;margin:5px;min-width:120px'>"
        f"<div style='font-size:32px;font-weight:bold;color:#721c24'>{totals['failed']}</div>"
        f"<div style='color:#721c24'>Failed</div></div>"
        f"</div>{dl}</div>"
    )
    display(HTML(html))
