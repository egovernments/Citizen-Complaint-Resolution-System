--
-- PostgreSQL database dump
--
-- ============================================================================
-- TENANT-FILTERED (#1034) — kept only pg/pg.* rows, dropped ke*, uitest*,
-- statea*/statea.citya (legacy pre-"pg" naming, superseded everywhere else
-- in this repo), and CI-test-run leftover tenants (ciwf*, cids*, ciregtest,
-- etc). Rows across 21 tenant-scoped tables went from 41,540 to 1,478.
--
-- pg.citya DEMO DATA (#1034) — pg.citya had zero Department rows and a
-- 4-level boundary hierarchy (City/Zone/Block/Locality) before this pass.
-- Added 4 representative departments (DEPT_1-4) and collapsed the
-- hierarchy to City -> Zone -> Ward (2 zones, 3 wards), hand-inserted
-- to match exactly what boundary-service/mdms-v2 would have written
-- (verified by reloading into a scratch Postgres and checking the
-- resulting rows). No PGR complaints referenced the old Block/Locality
-- codes, so this was safe to restructure.
--
-- NOT done here: demo employees (CSR/GRO/department-head/supervisor)
-- per role wired to these departments/boundaries — employee records
-- require the live egov-user/egov-hrms APIs for PII encryption
-- (username/name are encrypted at rest; can't be hand-crafted), and
-- employee creation in this sandbox is separately blocked by a
-- pre-existing boundary-service bug (IllegalArgumentException:
-- "content" is null) unrelated to this seed-data work. Left as a
-- follow-up once that's fixed or a working environment is available.
-- ============================================================================
-- STALE COMPLAINT MASTERS — REGENERATE THIS DUMP FROM A MIGRATED TENANT
-- ----------------------------------------------------------------------------
-- This dump's eg_mdms_data table still seeds the RETIRED complaint masters:
--   * RAINMAKER-PGR.ServiceDefs   (legacy flat leaf rows, with "menuPath")
--   * (and any RAINMAKER-PGR.ClassificationNode / HierarchySchema /
--      ComplaintTypeDepartments rows, if present)
-- The complaint-type model is now the TWO-master adjacency hierarchy:
--   * RAINMAKER-PGR.ComplaintHierarchyDefinition  (ordered levels)
--   * RAINMAKER-PGR.ComplaintHierarchy            (interior nodes + leaf rows;
--       a leaf row's "code" IS the serviceCode; "menuPath" no longer exists —
--       grouping derives from parentCode/path)
--
-- DO NOT hand-edit the ServiceDefs/menuPath rows below — fixing them by hand is
-- error-prone and will drift from the schema. Instead REGENERATE this entire
-- dump by:
--   1. Standing up a stack on the current schema + backend.
--   2. Loading complaint masters via the dataloader (crs_loader.load_common_masters,
--      which now writes ComplaintHierarchyDefinition + ComplaintHierarchy), OR
--      running the configurator one-click migration on an existing tenant.
--   3. Re-running pg_dump to produce a fresh full-dump.sql.
-- Until regenerated, a stack restored from this dump will have NO complaint
-- types under the new model (the seeded ServiceDefs rows are ignored by the
-- cut-over backend).
-- ============================================================================

\restrict XCN8W99QyqbCXmfs0qAeFgB8W0g9mhulyxVgFl6MmobAdASkh4xR96gpgnjnR3i

-- Dumped from database version 16.12 (Debian 16.12-1.pgdg13+1)
-- Dumped by pg_dump version 16.12 (Debian 16.12-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: accesscontrol_schema_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accesscontrol_schema_version (
    installed_rank integer NOT NULL,
    version character varying(50),
    description character varying(200) NOT NULL,
    type character varying(20) NOT NULL,
    script character varying(1000) NOT NULL,
    checksum integer,
    installed_by character varying(100) NOT NULL,
    installed_on timestamp without time zone DEFAULT now() NOT NULL,
    execution_time integer NOT NULL,
    success boolean NOT NULL
);


--
-- Name: boundary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.boundary (
    id character varying(64) NOT NULL,
    tenantid character varying(64) NOT NULL,
    code character varying(64) NOT NULL,
    geometry jsonb,
    additionaldetails jsonb,
    createdtime bigint NOT NULL,
    createdby character varying(64) NOT NULL,
    lastmodifiedtime bigint,
    lastmodifiedby character varying(64)
);


--
-- Name: boundary_hierarchy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.boundary_hierarchy (
    id character varying(64) NOT NULL,
    tenantid character varying(64) NOT NULL,
    hierarchytype character varying(64) NOT NULL,
    boundaryhierarchy jsonb NOT NULL,
    createdtime bigint,
    createdby character varying(64),
    lastmodifiedtime bigint,
    lastmodifiedby character varying(64)
);


--
-- Name: boundary_relationship; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.boundary_relationship (
    id character varying(64),
    tenantid character varying(64) NOT NULL,
    code character varying(64) NOT NULL,
    hierarchytype character varying(64) NOT NULL,
    boundarytype character varying(64) NOT NULL,
    parent character varying(64),
    ancestralmaterializedpath text,
    createdtime bigint,
    createdby character varying(64),
    lastmodifiedtime bigint,
    lastmodifiedby character varying(64)
);


--
-- Name: boundary_schema_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.boundary_schema_version (
    installed_rank integer NOT NULL,
    version character varying(50),
    description character varying(200) NOT NULL,
    type character varying(20) NOT NULL,
    script character varying(1000) NOT NULL,
    checksum integer,
    installed_by character varying(100) NOT NULL,
    installed_on timestamp without time zone DEFAULT now() NOT NULL,
    execution_time integer NOT NULL,
    success boolean NOT NULL
);


--
-- Name: eg_action; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_action (
    id bigint NOT NULL,
    name character varying(100) NOT NULL,
    url character varying(100),
    servicecode character varying(50),
    queryparams character varying(100),
    parentmodule character varying(50),
    ordernumber bigint,
    displayname character varying(100),
    enabled boolean,
    createdby bigint DEFAULT 1,
    createddate timestamp without time zone DEFAULT now(),
    lastmodifiedby bigint DEFAULT 1,
    lastmodifieddate timestamp without time zone DEFAULT now()
);


--
-- Name: eg_address; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_address (
    housenobldgapt character varying(32),
    subdistrict character varying(100),
    postoffice character varying(100),
    landmark character varying(256),
    country character varying(50),
    type character varying(50),
    streetroadline character varying(256),
    citytownvillage character varying(256),
    arealocalitysector character varying(256),
    district character varying(100),
    state character varying(100),
    pincode character varying(10),
    id integer NOT NULL,
    version bigint DEFAULT 0,
    tenantid character varying(256) NOT NULL,
    userid bigint
);


--
-- Name: eg_address_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.eg_address_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: eg_address_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.eg_address_id_seq OWNED BY public.eg_address.id;


--
-- Name: eg_bm_generated_template; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_bm_generated_template (
    id character varying(64) NOT NULL,
    filestoreid character varying(256),
    status character varying(64),
    tenantid character varying(256) NOT NULL,
    hierarchytype character varying(128) NOT NULL,
    locale character varying(16) DEFAULT 'en_IN'::character varying,
    createdby character varying(256),
    createdtime bigint,
    lastmodifiedby character varying(256),
    lastmodifiedtime bigint,
    additionaldetails jsonb,
    referenceid character varying(256)
);


--
-- Name: eg_bm_processed_template; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_bm_processed_template (
    id character varying(64) NOT NULL,
    status character varying(64),
    tenantid character varying(256) NOT NULL,
    hierarchytype character varying(128) NOT NULL,
    filestoreid character varying(256),
    processedfilestoreid character varying(256),
    action character varying(64),
    createdby character varying(256),
    createdtime bigint,
    lastmodifiedby character varying(256),
    lastmodifiedtime bigint,
    additionaldetails jsonb,
    referenceid character varying(256)
);


--
-- Name: eg_enc_asymmetric_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_enc_asymmetric_keys (
    id integer NOT NULL,
    key_id integer NOT NULL,
    public_key text NOT NULL,
    private_key text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    tenant_id text NOT NULL
);


--
-- Name: eg_enc_asymmetric_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.eg_enc_asymmetric_keys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: eg_enc_asymmetric_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.eg_enc_asymmetric_keys_id_seq OWNED BY public.eg_enc_asymmetric_keys.id;


--
-- Name: eg_enc_symmetric_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_enc_symmetric_keys (
    id integer NOT NULL,
    key_id integer NOT NULL,
    secret_key text NOT NULL,
    initial_vector text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    tenant_id text NOT NULL
);


--
-- Name: eg_enc_symmetric_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.eg_enc_symmetric_keys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: eg_enc_symmetric_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.eg_enc_symmetric_keys_id_seq OWNED BY public.eg_enc_symmetric_keys.id;


--
-- Name: eg_filestoremap; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_filestoremap (
    id bigint NOT NULL,
    filestoreid character varying(36) NOT NULL,
    filename character varying(256) NOT NULL,
    contenttype character varying(100),
    module character varying(256),
    tag character varying(256),
    tenantid character varying(256) NOT NULL,
    version bigint,
    filesource character varying(64),
    createdby character varying(64),
    lastmodifiedby character varying(64),
    createdtime bigint,
    lastmodifiedtime bigint
);


--
-- Name: eg_hrms_assignment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_hrms_assignment (
    uuid character varying(1024) NOT NULL,
    employeeid character varying(1024) NOT NULL,
    "position" bigint,
    department character varying(250),
    designation character varying(250),
    fromdate bigint,
    todate bigint,
    govtordernumber character varying(250),
    reportingto character varying(250),
    ishod boolean,
    tenantid character varying(250) NOT NULL,
    createdby character varying(250) NOT NULL,
    createddate bigint NOT NULL,
    lastmodifiedby character varying(250),
    lastmodifieddate bigint,
    iscurrentassignment boolean,
    isactive boolean,
    CONSTRAINT ck_eghrms_employee_fromto CHECK ((fromdate <= todate))
);


--
-- Name: eg_hrms_deactivationdetails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_hrms_deactivationdetails (
    uuid character varying(1024) NOT NULL,
    employeeid character varying(1024) NOT NULL,
    reasonfordeactivation character varying(250),
    effectivefrom bigint,
    ordernumber character varying(250),
    remarks character varying(250),
    tenantid character varying(250) NOT NULL,
    createdby character varying(250) NOT NULL,
    createddate bigint NOT NULL,
    lastmodifiedby character varying(250),
    lastmodifieddate bigint,
    isactive boolean
);


--
-- Name: eg_hrms_departmentaltests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_hrms_departmentaltests (
    uuid character varying(1024) NOT NULL,
    employeeid character varying(1024) NOT NULL,
    test character varying(250),
    yearofpassing bigint,
    remarks character varying(250),
    tenantid character varying(250) NOT NULL,
    createdby character varying(250) NOT NULL,
    createddate bigint NOT NULL,
    lastmodifiedby character varying(250),
    lastmodifieddate bigint,
    isactive boolean
);


--
-- Name: eg_hrms_educationaldetails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_hrms_educationaldetails (
    uuid character varying(1024) NOT NULL,
    employeeid character varying(1024) NOT NULL,
    qualification character varying(250),
    stream character varying(250),
    yearofpassing bigint,
    university character varying(250),
    remarks character varying(250),
    tenantid character varying(250) NOT NULL,
    createdby character varying(250) NOT NULL,
    createddate bigint NOT NULL,
    lastmodifiedby character varying(250),
    lastmodifieddate bigint,
    isactive boolean
);


--
-- Name: eg_hrms_empdocuments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_hrms_empdocuments (
    uuid character varying(1024) NOT NULL,
    employeeid character varying(1024) NOT NULL,
    documentid character varying(250) NOT NULL,
    documentname character varying(250),
    referencetype character varying(250),
    referenceid character varying(250) NOT NULL,
    tenantid character varying(250) NOT NULL,
    createdby character varying(250) NOT NULL,
    createddate bigint NOT NULL,
    lastmodifiedby character varying(250),
    lastmodifieddate bigint
);


--
-- Name: eg_hrms_employee; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_hrms_employee (
    id bigint NOT NULL,
    uuid character varying(1024) NOT NULL,
    code character varying(250),
    dateofappointment bigint,
    employeestatus character varying(250),
    employeetype character varying(250),
    active boolean,
    tenantid character varying(250) NOT NULL,
    createdby character varying(250) NOT NULL,
    createddate bigint NOT NULL,
    lastmodifiedby character varying(250),
    lastmodifieddate bigint,
    reactivateemployee boolean
);


--
-- Name: eg_hrms_jurisdiction; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_hrms_jurisdiction (
    uuid character varying(1024) NOT NULL,
    employeeid character varying(1024) NOT NULL,
    hierarchy character varying(250) NOT NULL,
    boundarytype character varying(250) NOT NULL,
    boundary character varying(250) NOT NULL,
    tenantid character varying(250) NOT NULL,
    createdby character varying(250) NOT NULL,
    createddate bigint NOT NULL,
    lastmodifiedby character varying(250),
    lastmodifieddate bigint,
    isactive boolean
);


--
-- Name: eg_hrms_position; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.eg_hrms_position
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: eg_hrms_reactivationdetails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_hrms_reactivationdetails (
    uuid character varying(1024) NOT NULL,
    employeeid character varying(1024) NOT NULL,
    reasonforreactivation character varying(250),
    effectivefrom bigint,
    ordernumber character varying(250),
    remarks character varying(250),
    tenantid character varying(250) NOT NULL,
    createdby character varying(250) NOT NULL,
    createddate bigint NOT NULL,
    lastmodifiedby character varying(250),
    lastmodifieddate bigint
);


--
-- Name: eg_hrms_servicehistory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_hrms_servicehistory (
    uuid character varying(1024) NOT NULL,
    employeeid character varying(1024) NOT NULL,
    servicestatus character varying(250),
    servicefrom bigint,
    serviceto bigint,
    ordernumber character varying(250),
    iscurrentposition boolean,
    location character varying(250),
    tenantid character varying(250) NOT NULL,
    createdby character varying(250) NOT NULL,
    createddate bigint NOT NULL,
    lastmodifiedby character varying(250),
    lastmodifieddate bigint,
    isactive boolean
);


--
-- Name: eg_mdms_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_mdms_data (
    id character varying(64) NOT NULL,
    tenantid character varying(255) NOT NULL,
    uniqueidentifier character varying(255) NOT NULL,
    schemacode character varying(255) NOT NULL,
    data jsonb NOT NULL,
    isactive boolean NOT NULL,
    createdby character varying(64),
    lastmodifiedby character varying(64),
    createdtime bigint,
    lastmodifiedtime bigint
);


--
-- Name: eg_mdms_schema_definition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_mdms_schema_definition (
    id character varying(64) NOT NULL,
    tenantid character varying(255) NOT NULL,
    code character varying(255) NOT NULL,
    description character varying(512),
    definition jsonb NOT NULL,
    isactive boolean NOT NULL,
    createdby character varying(64),
    lastmodifiedby character varying(64),
    createdtime bigint,
    lastmodifiedtime bigint
);


--
-- Name: eg_ms_role; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_ms_role (
    name character varying(32) NOT NULL,
    code character varying(50) NOT NULL,
    description character varying(128),
    createddate timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    createdby bigint,
    lastmodifiedby bigint,
    lastmodifieddate timestamp without time zone,
    version bigint
);


--
-- Name: eg_pgr_address_v2; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_pgr_address_v2 (
    tenantid character varying(256) NOT NULL,
    id character varying(256) NOT NULL,
    parentid character varying(256) NOT NULL,
    doorno character varying(128),
    plotno character varying(256),
    buildingname character varying(1024),
    street character varying(1024),
    landmark character varying(1024),
    city character varying(512),
    pincode character varying(16),
    locality character varying(128) NOT NULL,
    district character varying(256),
    region character varying(256),
    state character varying(256),
    country character varying(512),
    latitude numeric(9,6),
    longitude numeric(10,7),
    createdby character varying(128) NOT NULL,
    createdtime bigint NOT NULL,
    lastmodifiedby character varying(128),
    lastmodifiedtime bigint,
    additionaldetails jsonb
);


--
-- Name: eg_pgr_service_v2; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_pgr_service_v2 (
    id character varying(64),
    tenantid character varying(256) NOT NULL,
    servicecode character varying(256) NOT NULL,
    servicerequestid character varying(256) NOT NULL,
    description character varying(4000),
    accountid character varying(256),
    additionaldetails jsonb,
    applicationstatus character varying(128),
    rating smallint,
    source character varying(256),
    createdby character varying(256) NOT NULL,
    createdtime bigint NOT NULL,
    lastmodifiedby character varying(256),
    lastmodifiedtime bigint,
    active boolean DEFAULT true
);


--
-- Name: eg_role; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_role (
    name character varying(128) NOT NULL,
    code character varying(50) NOT NULL,
    description character varying(128),
    createddate timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    createdby bigint,
    lastmodifiedby bigint,
    lastmodifieddate timestamp without time zone,
    version bigint,
    tenantid character varying(256) NOT NULL,
    id bigint NOT NULL
);


--
-- Name: eg_roleaction; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_roleaction (
    rolecode character varying(32) NOT NULL,
    actionid bigint NOT NULL,
    tenantid character varying(50) NOT NULL
);


--
-- Name: eg_url_shortener; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_url_shortener (
    id character varying(128) NOT NULL,
    validform bigint,
    validto bigint,
    url character varying(1024) NOT NULL
);


--
-- Name: eg_url_shorter_id; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.eg_url_shorter_id
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: eg_user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_user (
    title character varying(8),
    salutation character varying(5),
    dob timestamp without time zone,
    locale character varying(16),
    username character varying(180) NOT NULL,
    password character varying(64) NOT NULL,
    pwdexpirydate timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    mobilenumber character varying(150),
    altcontactnumber character varying(150),
    emailid character varying(300),
    createddate timestamp without time zone,
    lastmodifieddate timestamp without time zone,
    createdby bigint,
    lastmodifiedby bigint,
    active boolean,
    name character varying(250),
    gender smallint,
    pan character varying(65),
    aadhaarnumber character varying(85),
    type character varying(50),
    version numeric DEFAULT 0,
    guardian character varying(250),
    guardianrelation character varying(32),
    signature character varying(36),
    accountlocked boolean DEFAULT false,
    bloodgroup character varying(32),
    photo character varying(36),
    identificationmark character varying(300),
    tenantid character varying(256) NOT NULL,
    id bigint NOT NULL,
    uuid character(36),
    accountlockeddate bigint,
    alternatemobilenumber character varying(50) DEFAULT NULL::character varying,
    countrycode character varying(10)
);


--
-- Name: eg_user_address; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_user_address (
    id bigint NOT NULL,
    version numeric DEFAULT 0,
    createddate timestamp without time zone NOT NULL,
    lastmodifieddate timestamp without time zone,
    createdby bigint NOT NULL,
    lastmodifiedby bigint,
    type character varying(50) NOT NULL,
    address character varying(440),
    city character varying(300),
    pincode character varying(10),
    userid bigint NOT NULL,
    tenantid character varying(256) NOT NULL
);


--
-- Name: eg_user_audit_table; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_user_audit_table (
    id bigint NOT NULL,
    title character varying(8),
    salutation character varying(5),
    dob timestamp without time zone,
    locale character varying(16),
    username character varying(300) NOT NULL,
    password character varying(300) NOT NULL,
    pwdexpirydate timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    mobilenumber character varying(50),
    altcontactnumber character varying(50),
    emailid character varying(128),
    active boolean,
    name character varying(100),
    gender smallint,
    pan character varying(50),
    aadhaarnumber character varying(50),
    type character varying(50),
    version numeric DEFAULT 0,
    guardian character varying(100),
    guardianrelation character varying(32),
    signature character varying(36),
    accountlocked boolean DEFAULT false,
    bloodgroup character varying(32),
    photo character varying(36),
    identificationmark character varying(300),
    tenantid character varying(256) NOT NULL,
    uuid character varying(300),
    auditcreatedby character varying(100),
    auditcreatedtime bigint
);


--
-- Name: eg_user_login_failed_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_user_login_failed_attempts (
    user_uuid character varying(64) NOT NULL,
    ip character varying(46),
    attempt_date bigint NOT NULL,
    active boolean
);


--
-- Name: eg_userrole; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_userrole (
    roleid bigint NOT NULL,
    roleidtenantid character varying(256) NOT NULL,
    userid bigint NOT NULL,
    tenantid character varying(256) NOT NULL,
    lastmodifieddate timestamp without time zone DEFAULT now()
);


--
-- Name: eg_userrole_v1; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_userrole_v1 (
    role_code character varying(50),
    role_tenantid character varying(256),
    user_id bigint,
    user_tenantid character varying(256),
    lastmodifieddate timestamp without time zone
);


--
-- Name: eg_wf_action_v2; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_wf_action_v2 (
    uuid character varying(256) NOT NULL,
    tenantid character varying(256) NOT NULL,
    currentstate character varying(256),
    action character varying(256) NOT NULL,
    nextstate character varying(256),
    roles character varying(1024) NOT NULL,
    createdby character varying(256) NOT NULL,
    createdtime bigint,
    lastmodifiedby character varying(256) NOT NULL,
    lastmodifiedtime bigint,
    active boolean DEFAULT true
);


--
-- Name: eg_wf_assignee_v2; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_wf_assignee_v2 (
    processinstanceid character varying(64),
    tenantid character varying(128),
    assignee character varying(128),
    createdby character varying(64),
    lastmodifiedby character varying(64),
    createdtime bigint,
    lastmodifiedtime bigint
);


--
-- Name: eg_wf_businessservice_v2; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_wf_businessservice_v2 (
    businessservice character varying(256) NOT NULL,
    business character varying(256) NOT NULL,
    tenantid character varying(256) NOT NULL,
    uuid character varying(256) NOT NULL,
    geturi character varying(1024),
    posturi character varying(1024),
    createdby character varying(256) NOT NULL,
    createdtime bigint,
    lastmodifiedby character varying(256) NOT NULL,
    lastmodifiedtime bigint,
    businessservicesla bigint
);


--
-- Name: eg_wf_document_v2; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_wf_document_v2 (
    id character varying(64) NOT NULL,
    tenantid character varying(64),
    documenttype character varying(64),
    documentuid character varying(64),
    filestoreid character varying(64),
    processinstanceid character varying(64),
    active boolean,
    createdby character varying(64),
    lastmodifiedby character varying(64),
    createdtime bigint,
    lastmodifiedtime bigint
);


--
-- Name: eg_wf_processinstance_v2; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_wf_processinstance_v2 (
    id character varying(64),
    tenantid character varying(128),
    businessservice character varying(128),
    businessid character varying(128),
    action character varying(128),
    status character varying(128),
    comment character varying(1024),
    assigner character varying(128),
    assignee character varying(128),
    statesla bigint,
    previousstatus character varying(128),
    createdby character varying(64),
    lastmodifiedby character varying(64),
    createdtime bigint,
    lastmodifiedtime bigint,
    modulename character varying(64),
    businessservicesla bigint,
    rating smallint,
    escalated boolean DEFAULT false
);


--
-- Name: eg_wf_state_v2; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_wf_state_v2 (
    uuid character varying(256) NOT NULL,
    tenantid character varying(256) NOT NULL,
    businessserviceid character varying(256) NOT NULL,
    state character varying(256),
    applicationstatus character varying(256),
    sla bigint,
    docuploadrequired boolean,
    isstartstate boolean,
    isterminatestate boolean,
    createdby character varying(256) NOT NULL,
    createdtime bigint,
    lastmodifiedby character varying(256) NOT NULL,
    lastmodifiedtime bigint,
    seq integer,
    isstateupdatable boolean
);


--
-- Name: egov_idgen_schema_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.egov_idgen_schema_version (
    installed_rank integer NOT NULL,
    version character varying(50),
    description character varying(200) NOT NULL,
    type character varying(20) NOT NULL,
    script character varying(1000) NOT NULL,
    checksum integer,
    installed_by character varying(100) NOT NULL,
    installed_on timestamp without time zone DEFAULT now() NOT NULL,
    execution_time integer NOT NULL,
    success boolean NOT NULL
);


--
-- Name: egov_localization_schema_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.egov_localization_schema_version (
    installed_rank integer NOT NULL,
    version character varying(50),
    description character varying(200) NOT NULL,
    type character varying(20) NOT NULL,
    script character varying(1000) NOT NULL,
    checksum integer,
    installed_by character varying(100) NOT NULL,
    installed_on timestamp without time zone DEFAULT now() NOT NULL,
    execution_time integer NOT NULL,
    success boolean NOT NULL
);


--
-- Name: egov_url_shortening_schema_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.egov_url_shortening_schema_version (
    installed_rank integer NOT NULL,
    version character varying(50),
    description character varying(200) NOT NULL,
    type character varying(20) NOT NULL,
    script character varying(1000) NOT NULL,
    checksum integer,
    installed_by character varying(100) NOT NULL,
    installed_on timestamp without time zone DEFAULT now() NOT NULL,
    execution_time integer NOT NULL,
    success boolean NOT NULL
);


--
-- Name: egov_user_schema_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.egov_user_schema_version (
    installed_rank integer NOT NULL,
    version character varying(50),
    description character varying(200) NOT NULL,
    type character varying(20) NOT NULL,
    script character varying(1000) NOT NULL,
    checksum integer,
    installed_by character varying(100) NOT NULL,
    installed_on timestamp without time zone DEFAULT now() NOT NULL,
    execution_time integer NOT NULL,
    success boolean NOT NULL
);


--
-- Name: enc_schema_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enc_schema_version (
    installed_rank integer NOT NULL,
    version character varying(50),
    description character varying(200) NOT NULL,
    type character varying(20) NOT NULL,
    script character varying(1000) NOT NULL,
    checksum integer,
    installed_by character varying(100) NOT NULL,
    installed_on timestamp without time zone DEFAULT now() NOT NULL,
    execution_time integer NOT NULL,
    success boolean NOT NULL
);


--
-- Name: filestore_schema_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.filestore_schema_version (
    installed_rank integer NOT NULL,
    version character varying(50),
    description character varying(200) NOT NULL,
    type character varying(20) NOT NULL,
    script character varying(1000) NOT NULL,
    checksum integer,
    installed_by character varying(100) NOT NULL,
    installed_on timestamp without time zone DEFAULT now() NOT NULL,
    execution_time integer NOT NULL,
    success boolean NOT NULL
);


--
-- Name: hrms_schema_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hrms_schema_version (
    installed_rank integer NOT NULL,
    version character varying(50),
    description character varying(200) NOT NULL,
    type character varying(20) NOT NULL,
    script character varying(1000) NOT NULL,
    checksum integer,
    installed_by character varying(100) NOT NULL,
    installed_on timestamp without time zone DEFAULT now() NOT NULL,
    execution_time integer NOT NULL,
    success boolean NOT NULL
);


--
-- Name: id_generator; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.id_generator (
    id bigint NOT NULL,
    idname character varying(200) NOT NULL,
    tenantid character varying(200) NOT NULL,
    format character varying(200) NOT NULL,
    sequencenumber integer NOT NULL
);


--
-- Name: id_generator_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.id_generator_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: id_generator_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.id_generator_id_seq OWNED BY public.id_generator.id;


--
-- Name: mdms_schema_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mdms_schema_version (
    installed_rank integer NOT NULL,
    version character varying(50),
    description character varying(200) NOT NULL,
    type character varying(20) NOT NULL,
    script character varying(1000) NOT NULL,
    checksum integer,
    installed_by character varying(100) NOT NULL,
    installed_on timestamp without time zone DEFAULT now() NOT NULL,
    execution_time integer NOT NULL,
    success boolean NOT NULL
);


--
-- Name: message; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message (
    id character varying(512) NOT NULL,
    locale character varying(255) NOT NULL,
    code character varying(255) NOT NULL,
    message character varying(500) NOT NULL,
    tenantid character varying(256) NOT NULL,
    module character varying(255) NOT NULL,
    createdby bigint NOT NULL,
    createddate timestamp without time zone DEFAULT now() NOT NULL,
    lastmodifiedby bigint,
    lastmodifieddate timestamp without time zone
);


--
-- Name: pgr_services_schema; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pgr_services_schema (
    installed_rank integer NOT NULL,
    version character varying(50),
    description character varying(200) NOT NULL,
    type character varying(20) NOT NULL,
    script character varying(1000) NOT NULL,
    checksum integer,
    installed_by character varying(100) NOT NULL,
    installed_on timestamp without time zone DEFAULT now() NOT NULL,
    execution_time integer NOT NULL,
    success boolean NOT NULL
);


--
-- Name: seq_ack_num; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_ack_num
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_advocate_code; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_advocate_code
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_advocatepayment_code; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_advocatepayment_code
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_agency; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_agency
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_assesmnt_num; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_assesmnt_num
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_case_advocate; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_case_advocate
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_case_reference; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_case_reference
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_coll_rcpt_num; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_coll_rcpt_num
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_eg_action; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_eg_action
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_eg_filestoremap; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_eg_filestoremap
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_eg_hrms_emp_code; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_eg_hrms_emp_code
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_eg_ms_role; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_eg_ms_role
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_eg_pg_txn; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_eg_pg_txn
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_eg_pgr_id; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_eg_pgr_id
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_eg_pt_ack; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_eg_pt_ack
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_eg_pt_assm; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_eg_pt_assm
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_eg_pt_ln; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_eg_pt_ln
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_eg_pt_ptid; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_eg_pt_ptid
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_eg_role; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_eg_role
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_eg_tl_apl; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_eg_tl_apl
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_eg_user; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_eg_user
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_eg_user_address; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_eg_user_address
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_eg_wf_state_v2; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_eg_wf_state_v2
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_egf_bill_dft_num; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_egf_bill_dft_num
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_employee_code; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_employee_code
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_event; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_event
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_hearing_details; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_hearing_details
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_message; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_message
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_notice; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_notice
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_opinion_code; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_opinion_code
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_parawise_comments; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_parawise_comments
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_personal_details; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_personal_details
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_reference_evidence; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_reference_evidence
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_register; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_register
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_service; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_service
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_summon_code; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_summon_code
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_summon_reference; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_summon_reference
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_swm_ctrt_num; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_swm_ctrt_num
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_swm_shift_code_num; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_swm_shift_code_num
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_swm_snts_trgt_num; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_swm_snts_trgt_num
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_swm_splr_num; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_swm_splr_num
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_swm_stf_trn_num; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_swm_stf_trn_num
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_swm_trn_num; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_swm_trn_num
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_swm_vendor_payment_num; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_swm_vendor_payment_num
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_swm_vhl_trip_num; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_swm_vhl_trip_num
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_swm_vmr_trn_num; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_swm_vmr_trn_num
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_swm_vndr_ctrt_num; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_swm_vndr_ctrt_num
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_swm_vndr_num; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_swm_vndr_num
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_swm_vs_trn_num; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_swm_vs_trn_num
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_tl_app_num; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_tl_app_num
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_tl_num; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_tl_num
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_uc_demand_consumer_code; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_uc_demand_consumer_code
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_ulb_code; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_ulb_code
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_upic_num; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_upic_num
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_voucher_code; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_voucher_code
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: service; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service (
    id bigint NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(100) NOT NULL,
    enabled boolean,
    contextroot character varying(50),
    displayname character varying(100),
    ordernumber bigint,
    parentmodule character varying(100),
    tenantid character varying(50) NOT NULL
);


--
-- Name: workflow_schema_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_schema_version (
    installed_rank integer NOT NULL,
    version character varying(50),
    description character varying(200) NOT NULL,
    type character varying(20) NOT NULL,
    script character varying(1000) NOT NULL,
    checksum integer,
    installed_by character varying(100) NOT NULL,
    installed_on timestamp without time zone DEFAULT now() NOT NULL,
    execution_time integer NOT NULL,
    success boolean NOT NULL
);


--
-- Name: eg_address id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_address ALTER COLUMN id SET DEFAULT nextval('public.eg_address_id_seq'::regclass);


--
-- Name: eg_enc_asymmetric_keys id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_enc_asymmetric_keys ALTER COLUMN id SET DEFAULT nextval('public.eg_enc_asymmetric_keys_id_seq'::regclass);


--
-- Name: eg_enc_symmetric_keys id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_enc_symmetric_keys ALTER COLUMN id SET DEFAULT nextval('public.eg_enc_symmetric_keys_id_seq'::regclass);


--
-- Name: id_generator id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.id_generator ALTER COLUMN id SET DEFAULT nextval('public.id_generator_id_seq'::regclass);


--
-- Data for Name: accesscontrol_schema_version; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.accesscontrol_schema_version (installed_rank, version, description, type, script, checksum, installed_by, installed_on, execution_time, success) FROM stdin;
1	1	<< Flyway Baseline >>	BASELINE	<< Flyway Baseline >>	\N	egov	2026-02-09 05:24:45.470974	0	t
2	20170404105602	create action service data	SQL	V20170404105602__create_action_service_data.sql	1088244516	egov	2026-02-09 05:24:45.601013	50	t
3	20170418143202	updated constraints	SQL	V20170418143202__updated_constraints.sql	1751612411	egov	2026-02-09 05:24:45.838953	34	t
4	20170424181300	updated contextroot column size in service table	SQL	V20170424181300__updated_contextroot_column_size_in_service_table.sql	-881688592	egov	2026-02-09 05:24:45.905315	9	t
5	20170526125200	create role	SQL	V20170526125200__create_role.sql	-789651706	egov	2026-02-09 05:24:45.94028	8	t
6	20170529112100	drop tenantid from action	SQL	V20170529112100__drop_tenantid_from_action.sql	-612552893	egov	2026-02-09 05:24:45.964749	18	t
7	20170530152300	alter id to bigint in eg ms role	SQL	V20170530152300__alter_id_to_bigint_in_eg_ms_role.sql	804729830	egov	2026-02-09 05:24:46.008066	12	t
8	20170530155100	drop id column in eg ms role	SQL	V20170530155100__drop_id_column_in_eg_ms_role.sql	1777745195	egov	2026-02-09 05:24:46.037193	4	t
\.


--
-- Data for Name: boundary; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.boundary (id, tenantid, code, geometry, additionaldetails, createdtime, createdby, lastmodifiedtime, lastmodifiedby) FROM stdin;
d0bec3a6-8052-4e89-98f9-ad1cc45dc6ef	pg.cibndauth	TEST_BND_AUTH	{"type": "Point", "coordinates": [0, 0]}	null	1778655274558	394d099c-1eb4-4543-ba08-5717c1bd2764	1778655274558	394d099c-1eb4-4543-ba08-5717c1bd2764
098443ce-1c97-40d3-aec1-44a2e45d22da	pg	PG_CITYA	{"type": "Polygon", "coordinates": [[[74.8, 31.5], [74.9, 31.5], [74.9, 31.7], [74.8, 31.7], [74.8, 31.5]]]}	\N	1781073055245	system	1781073055245	system
a1fb63a5-8305-4365-a3f3-e86337b6c809	pg	PG_CITYA_B1	{"type": "Polygon", "coordinates": [[[74.83, 31.57], [74.87, 31.57], [74.87, 31.63], [74.83, 31.63], [74.83, 31.57]]]}	\N	1781073055245	system	1781073055245	system
215072ee-890f-4140-9451-f3c08929e614	pg	PG_CITYA_Z1	{"type": "Polygon", "coordinates": [[[74.82, 31.55], [74.88, 31.55], [74.88, 31.65], [74.82, 31.65], [74.82, 31.55]]]}	\N	1781073055245	system	1781073055245	system
f971f0f0-f691-4b3d-bde1-a539daf5029c	pg	PG_STATE	{"type": "Polygon", "coordinates": [[[74.0, 30.0], [78.0, 30.0], [78.0, 33.0], [74.0, 33.0], [74.0, 30.0]]]}	\N	1781073055245	system	1781073055245	system
8cf59d36-879b-498d-886c-969b799b9ed0	pg	SUN01_LOCALITY	{"type": "Point", "coordinates": [74.87155, 31.63089]}	\N	1781073055245	system	1781073055245	system
d160ceda-65a5-4d2a-b19d-e69ef9be2c22	pg	SUN02_LOCALITY	{"type": "Point", "coordinates": [74.85, 31.61]}	\N	1781073055245	system	1781073055245	system
78120481-4402-4284-a81c-c8f2b00e58ad	pg	SUN03_LOCALITY	{"type": "Point", "coordinates": [74.84, 31.60]}	\N	1781073055245	system	1781073055245	system
88ba1d4c-540f-4351-9289-becd79cfdeae	pg.citya	PG_CITYA_ADMIN_CITY	{"type": "Polygon", "coordinates": [[[77.17, 28.56], [70.11, 22.50], [77.58, 13.05], [86.42, 23.77], [77.17, 28.56]]]}	\N	1781072283555	system	1781072283555	system
665a5db2-b61f-4730-b769-fee204b70a0a	pg.citya	Z1_ADMIN_ZONE	{"type": "Polygon", "coordinates": [[[77.17, 28.56], [70.11, 22.50], [77.58, 13.05], [86.42, 23.77], [77.17, 28.56]]]}	\N	1781072283555	system	1781072283555	system
e7675727-dcfa-46b7-aa92-09bacb36f673	pg.citya	Z2_ADMIN_ZONE	{"type": "Polygon", "coordinates": [[[77.20, 28.60], [70.15, 22.55], [77.60, 13.10], [86.45, 23.80], [77.20, 28.60]]]}	\N	1783555200000	system	1783555200000	system
a04109d4-ace4-4608-9903-e279d4d9c158	pg.citya	W1_ADMIN_WARD	{"type": "Point", "coordinates": [74.871552, 31.63089]}	\N	1783555200000	system	1783555200000	system
8c1db4e2-50d7-4f1f-b3ed-0620944eafa9	pg.citya	W2_ADMIN_WARD	{"type": "Point", "coordinates": [74.9, 31.6]}	\N	1783555200000	system	1783555200000	system
d6fa339e-c7b3-4d0e-8ef4-d5f80837c8a0	pg.citya	W3_ADMIN_WARD	{"type": "Point", "coordinates": [74.85, 31.65]}	\N	1783555200000	system	1783555200000	system
\.


--
-- Data for Name: boundary_hierarchy; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.boundary_hierarchy (id, tenantid, hierarchytype, boundaryhierarchy, createdtime, createdby, lastmodifiedtime, lastmodifiedby) FROM stdin;
53ad64eb-6ea1-4e5b-927f-fa46a76cf77f	pg	ADMIN	[{"active": true, "boundaryType": "State", "parentBoundaryType": null}, {"active": true, "boundaryType": "City", "parentBoundaryType": "State"}, {"active": true, "boundaryType": "Zone", "parentBoundaryType": "City"}, {"active": true, "boundaryType": "Block", "parentBoundaryType": "Zone"}, {"active": true, "boundaryType": "Locality", "parentBoundaryType": "Block"}]	1781072811606	system	1781072811606	system
7c3ee1b7-0d7c-4f1b-bf98-2d21482bd7dc	pg.citya	ADMIN	[{"active": true, "boundaryType": "City", "parentBoundaryType": null}, {"active": true, "boundaryType": "Zone", "parentBoundaryType": "City"}, {"active": true, "boundaryType": "Ward", "parentBoundaryType": "Zone"}]	1783555200000	system	1783555200000	system
\.


--
-- Data for Name: boundary_relationship; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.boundary_relationship (id, tenantid, code, hierarchytype, boundarytype, parent, ancestralmaterializedpath, createdtime, createdby, lastmodifiedtime, lastmodifiedby) FROM stdin;
e0e17092-8f46-4412-ab8f-2b54adf1341e	pg	PG_CITYA	ADMIN	City	PG_STATE	PG_STATE|PG_CITYA	1781073055245	system	1781073055245	system
356f2eb0-d5dc-4ff0-b495-d1f207b5c5c2	pg	PG_CITYA_B1	ADMIN	Block	PG_CITYA_Z1	PG_STATE|PG_CITYA|PG_CITYA_Z1|PG_CITYA_B1	1781073055245	system	1781073055245	system
885fd3f4-6a66-4b74-8d7c-954e69833447	pg	PG_CITYA_Z1	ADMIN	Zone	PG_CITYA	PG_STATE|PG_CITYA|PG_CITYA_Z1	1781073055245	system	1781073055245	system
70517d85-02e4-45dd-a931-1743329ee392	pg	PG_STATE	ADMIN	State	\N	PG_STATE	1781073055245	system	1781073055245	system
efbe8abb-e405-46af-9155-9508574cf794	pg	SUN01_LOCALITY	ADMIN	Locality	PG_CITYA_B1	PG_STATE|PG_CITYA|PG_CITYA_Z1|PG_CITYA_B1|SUN01_LOCALITY	1781073055245	system	1781073055245	system
4ba318df-1337-47c0-8e2a-561b2952641d	pg	SUN02_LOCALITY	ADMIN	Locality	PG_CITYA_B1	PG_STATE|PG_CITYA|PG_CITYA_Z1|PG_CITYA_B1|SUN02_LOCALITY	1781073055245	system	1781073055245	system
77281ff2-34ef-4d35-b5bb-fcb453c76ee7	pg	SUN03_LOCALITY	ADMIN	Locality	PG_CITYA_B1	PG_STATE|PG_CITYA|PG_CITYA_Z1|PG_CITYA_B1|SUN03_LOCALITY	1781073055245	system	1781073055245	system
7af4fb46-91bc-40b3-bad5-41339464f48d	pg.citya	PG_CITYA_ADMIN_CITY	ADMIN	City	\N	PG_CITYA_ADMIN_CITY	1781072303298	system	1781072303298	system
d35f7376-f2e0-42b3-8a68-fa57ec7a56d9	pg.citya	Z1_ADMIN_ZONE	ADMIN	Zone	PG_CITYA_ADMIN_CITY	PG_CITYA_ADMIN_CITY|Z1_ADMIN_ZONE	1781072303298	system	1781072303298	system
e244488b-2bc5-4ad7-9bf3-167fd13ef410	pg.citya	Z2_ADMIN_ZONE	ADMIN	Zone	PG_CITYA_ADMIN_CITY	PG_CITYA_ADMIN_CITY|Z2_ADMIN_ZONE	1783555200000	system	1783555200000	system
61dd8a2d-5b43-4ee1-b5b4-81d29b766b6e	pg.citya	W1_ADMIN_WARD	ADMIN	Ward	Z1_ADMIN_ZONE	PG_CITYA_ADMIN_CITY|Z1_ADMIN_ZONE|W1_ADMIN_WARD	1783555200000	system	1783555200000	system
bd68986e-ed79-4307-a04e-1f816b4ddd9f	pg.citya	W2_ADMIN_WARD	ADMIN	Ward	Z1_ADMIN_ZONE	PG_CITYA_ADMIN_CITY|Z1_ADMIN_ZONE|W2_ADMIN_WARD	1783555200000	system	1783555200000	system
3a82bc2f-8fd3-4209-b379-636a19f1c795	pg.citya	W3_ADMIN_WARD	ADMIN	Ward	Z2_ADMIN_ZONE	PG_CITYA_ADMIN_CITY|Z2_ADMIN_ZONE|W3_ADMIN_WARD	1783555200000	system	1783555200000	system
\.


--
-- Data for Name: boundary_schema_version; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.boundary_schema_version (installed_rank, version, description, type, script, checksum, installed_by, installed_on, execution_time, success) FROM stdin;
1	1	<< Flyway Baseline >>	BASELINE	<< Flyway Baseline >>	\N	egov	2026-02-09 05:24:45.947744	0	t
2	20230728110535	boundary-service ddl	SQL	V20230728110535__boundary-service_ddl.sql	1587416147	egov	2026-02-09 05:24:46.067587	54	t
3	20231025110679	boundary hierarchy ddl	SQL	V20231025110679__boundary_hierarchy_ddl.sql	38639821	egov	2026-02-09 05:24:46.291622	31	t
4	20231031120752	boundary relationship ddl	SQL	V20231031120752__boundary_relationship_ddl.sql	1434917045	egov	2026-02-09 05:24:46.375928	25	t
\.


--
-- Data for Name: eg_action; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_action (id, name, url, servicecode, queryparams, parentmodule, ordernumber, displayname, enabled, createdby, createddate, lastmodifiedby, lastmodifieddate) FROM stdin;
\.


--
-- Data for Name: eg_address; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_address (housenobldgapt, subdistrict, postoffice, landmark, country, type, streetroadline, citytownvillage, arealocalitysector, district, state, pincode, id, version, tenantid, userid) FROM stdin;
\.


--
-- Data for Name: eg_bm_generated_template; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_bm_generated_template (id, filestoreid, status, tenantid, hierarchytype, locale, createdby, createdtime, lastmodifiedby, lastmodifiedtime, additionaldetails, referenceid) FROM stdin;
\.


--
-- Data for Name: eg_bm_processed_template; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_bm_processed_template (id, status, tenantid, hierarchytype, filestoreid, processedfilestoreid, action, createdby, createdtime, lastmodifiedby, lastmodifiedtime, additionaldetails, referenceid) FROM stdin;
\.


--
-- Data for Name: eg_enc_asymmetric_keys; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_enc_asymmetric_keys (id, key_id, public_key, private_key, active, tenant_id) FROM stdin;
1	822595	kOYrI8AmwiqKxhIEQFl3pCU6rLFLYjx+toLxqAfQ9C66U5wQF7ko6yOx0QHUvULfxgNZERlBH7rGd61iohPgCd+oE6cym5FXO+GTKZGuLwxoOvCYV78tQ6S8AQfLufzekeVrXKyM1ywvMZzuetmuOX9yvIoHHTdqkKfHqkCIO91EadFSpyF2/g1VRF0GQeBicUKLZpCkGFCxQiA8CDf4QHN9ODjc4mzLIi4rtLmKcvojMQTA8kwOrU/j/9ypwKibtNk0WZaPDQ+P0su+bPZd0BZNhtlnEAWWbD76OjKf0X/Lv4HAMvh0Rg==	kOYlBukQuy+I0SINUXd+5gkAgLQzRFl9tufzoAfV5C+Sb5IlF48hwC+zxSHN60318gwlWBtJJbrCXIUCwwbNKvu1SfNIl6hOMb/BSNL4fCs7E+eQTogjUoS+LgDfvvm+iokiSIj+2Sl/Soapfce4N0Rh3acRNzRimaqSti2AAZ5zS8Ba23xWkhJcQmB5d8wmaVqSKJ6oE2rHeWEkT3PAEgUjJy/a2RDnYFV3q4vnB/krPDnj0VUTyGXK+oOTuZ/3nPUTP8zaR3TWq7nyINVuvT4KqfoWCSmVxXNP/4t9agtJbKmRq+/HpM/QaWrmfIcFaEzPCuhezrOZBKcCoU/yfyfgNfFiuCDjfAatVrghAaobzYQE9O8pxC2o/luu/EoTtLzwCRgM4GLHbvFIITBdxtHwdv+y1w+dGJZN2cjuHu5JvO4BsU5h/0oFWNBsRx/FrwEqmX6vyga9yI0rgJC6qKugp3bFfbDXmdGYJyryhregyUpHUFG74slKmzO1CrtLTeEfRZj4WzAumc5uudTOR/7RcR3Lj5SbGW96++TTEbGX9a6Byrf/EX6k/qArMIGH5DKQ5I92m+CgqHFcgnHG7ytFe80qfXQLDkglM760ZBp/7Tp56BPGaIZC7cTYLrBMIeGDuysq5MNztZ5aiH6RA8OVzrnGJ94KxGj8athWaTv/uCDKYJ/vyYI428huarL39hvgxYJ84D1jv72edLu+TN8XHd4t3rzB7Lof16uULd/9oB5WvlLbrI4AgHlYHZbn6s448WUV/r0hx9Z2Mpz/moLPIr3QhdE+x3Bgsy7ICaKrgK7IbKUFIvlt/oonn2bnUea1zDjghfoFGnBwVrkea373kbpeY643LcXo5FC21cMGtK9CJt1FEefxVyK8UYEd7y7FoG1aRHtjmiZNLRESuYHT7aAILyJxRGjmdi+6T8BKoSdsI8t5O6EtwfGKUi/3UhtKqBOY1d3atPioj+enoFQ35gE2KXa0pmZKQy1qy0o9JlZFTujhe+Hnufc5zrHUc2lxCP92aHCUJW30121dq68l1pZ9wXi/CbL28G0+rQ7utMtfxrV8elVA5iJBUBvMWxrcvV5lCduZemyoMT/hMeFEH1dAPnDGYgfTELZ0tTnLQ7l7QlWI6bXBw79/v0zJ	t	pg
2	534353	kOYrI8AmwiqKxhIEQFl3pCU6rLFLYjx+toLxqAfQ9C66U5wQF7kv8Dif2iqjz2zz4i0kSRZgMrqZc4dM/zOkCOKMKvIImKIWMsSjSZqnWy49ar64caMxXpCBIkWY2r6ts7kdb7Hw+ipKELvTeIemH0Inx/U1OEVhxq+aiHuFGI5xA9I9r2JRkChAHk1nRf9EfSCIJLCWF32YR0ghUjTrKXYZJxPQ1WbDVS4NhumdK9AHCxnHz2EZgW/02pGthrvQkJ8qQteaBxXhqLvpZJ5chh9rhtlnEAWWw8Fwylq2vbr3X1VflNp76g==	kOYlBuk2uy+I0SINUXd+5gkAgLQzRFl9tufzoAfV5C+Sbu8lF48hxi+zxSHN60318gtfdV5gO+SCAYx13g3ZIMObTcURq7dtBN26CvK7NDpLNtKkNKg3OrOhFhrLmcqK97AEJaGR9QItDoDyesOOLiRlmec9Oih50I6DmnPeZqp6Cfwzv199oAAyaWZGBsRwPTe/WI2rEXqbRkxRaXfsMS4pCx2AjFbNf1QIk4zbCo5SEhLV134vkTTA+LGEx7Dwzv8JeeTCeSrDt/zHWPBDiAReifNMGzG+in1Yx4t9agtJbKmRq+/EmsSpalSFd7RxDEfnVNNlyLGGQcUgyAu3dTnPPL9BxBHjAg+nItFaMrUVtcMi2u031CGd6U6NqktRlbXWeWMOsWfmNfxjYSBEzqyHE+aV7UGxA6J9u7fiGLcdo/cR2DJ5kQ9ofo95MCXk6z4qrlKS2Ce/to53yKuP2bztunTZVsDp2PaJA1DJrIKUjjFEI1eC4tx/oXC9e4hZSKcBX6HXXDIUy4wUxJKtfOzRcR3LiujYZwgVp/7ROoSC1K+fsIfjAxL5vKlPXqO59gWj6tBR+POynFZuoHGU6BU0S/FTPGU/X0AFEbadXmd57gcl5Sq2QpNr/PfrO88zfvyHozsVnsU5vJ5aiH6RVc21y6uzLot++RrQOfZmdVu7pF7QTIvi8+ZD2ptKd7z28hrBv+FE/zU+1pG/aY6JPbkAHcwrwf2F0qoFvqaDFeDboFhWikXVg7EpsWYnCcTZtt0IsmUV/r5miNUKLsDx6JmrHcadtOgxqXgtjR3iXKOeyNekWvwSXOFb4bNYsiCYa7L/pCfOg8d/JzJ1d+cMFF/1iuFpUr8IJOSm5zq9yfkVg4B2G+hyIuvqeyy8UYUyh1igwjciGEttmzhMFRYDuqPmiptaKBNAe0++fwurC+8rmyNQPKJ2HoonxZCScWyXUAcjyVSHs4GliuiZh6HOmwU16h8xPjXM+0M+Nhx5yR0IOlVaRtLpAeL/gdJd8s/PbFRwC80mD0rifGf7hnV/8a8q6otf5jyOC+yP0UE7jT3LuOlYxqZ2WDxiwBgJWD2QZTaJ5F1kYY2qaxPWdkvpRsVIFEVyPSycbByjDO0/OTtR3g20eyCHkLEQ4p0=	t	pg.citya
3	72868	kOYrI8AmwiqKxhIEQFl3pCU6rLFLYjx+toLxqAfQ9C66U5wQF7koxT27sQ/AyXDY4wwnbB9HH+qcEq167zm+csS9I+4Kx71ofbOWFeCWSgpRHOyza4JwbrHYJSXsobHeo78WbaOTy3EoLp33f5mcHUB3ioEgfUlO192Kr17keKxza+VhulByvl9WX3NrY59LT16JKO+tSHi6THY8VW/ROygEGyjA8mDkIi4ws6nnMOkJJCX01X4OlHDUxJyox+ySreMUUemPVz71/9DjMpZ5o19rhtlnEAWWvpvAMkTyh8po7lvi9cXi4A==	kOYlBukAuy+I0SINUXd+5gkAgLQzRFl9tufzoAfV5C+Sb5YlF48hxy+zxSHN60318g9ha0RcMq+IdqUO/A/jDOO3F/JMmI5tIrzMMJObUCF+Cb2HeK8QQp6+NhPnyOSrkYpqbLGLygs1B4nyObiHJH47xZYvAQ5fyJ6bqm/1ILkrUO5Pgl5Jtjs8eWMHfuVUSwOieZr7O0GvYHN5DnuyMTEbPw37xRHkcSFrrriHB40rCWDj0W8Wykz//ZGkhpbQts4vc8ahdXDZxNvGf+NF1iBAhqxeKAznrkB54Yt9agtJbKmRq+/Hk63kQFnhE75sKyfsBuB6zKuMRdgw9myqczzbCf5ErhPUQSGvCtpsFo9Jy7sQuopD8yu17g6xpjBrnajPcxcpgUOBc9pweCJ5nPHpJYDRmjCOAaFG4JXgYqcUuNFynR1i6X54XJh+YC7Fgj0FgG+O+iyNv7IxoKGnwouM2mijcurR9sCuRl6ooKqFi28IJkzv5P1SgFTPJ7J9ffs8SpjHOhkU4rhAstvyQ/7RcR3LiLKQERsHpdvBBpyOg++A9rDtTmT9+aYsfNe2gxaH+eUIuc3UjkZnrXK6rAsWWfkWfUQoAEIlBJzjVjdIoRBm/WzyZrtY7rD4XacLKsaIjTkLsYZ5m91aiH6RM9S14N+/eZhi52nLbMlLeCaP7wHgecnGzd9N2Z1ASJzr6GDyz4Rg/mYcu+GKSJGeCP1/L9941aH/xZkMrK+8PN+SnxlmtHjusI49qDtQNNTTxMcTsGUV/qIoscAIKvWK9+HzJcOvuf8DyTwznz7XcayTn6+4ZfFsX8NA14xSqz/zAOOtsVbtoMABBHNLNO9wE2DbtZhxUZoTDdSm/ziHvNcHo/ZvC/NMNpewQSq8UYEdsz3umCAGUGlxniRBPx99kKPQ0OZEOjlUKXGwM3SMVOs9wiB4IJlEBI4NkvX6NBbxBClgpiLD1piEv8y7qvbl/QhI9jsSUyv33V0VQ2xwykhbG1tOUujhePr1ndE/2//tCmFFNPYZDzafK1LYuXA+u7wx0aZD+TupD6Ci2nwzpxjkz+JX6oEqTxFOwD9xK2yYPhba4mR4SISVWGCdMCrtQcdGPTlheXrBS0f9PpVhuDngUH/rHfIKNb7MvQILBgcC	t	pg.cityb
\.


--
-- Data for Name: eg_enc_symmetric_keys; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_enc_symmetric_keys (id, key_id, secret_key, initial_vector, active, tenant_id) FROM stdin;
1	489366	tt4JLNwvui7471pseCFx2Tgm2LlJdAh2n/L/0wjGj1qxdqcnNZgp7UHi2V0+xHeLez0liYpCDWWXRtdc	nOkcBOsptF2j4RAhdTt7rnEvQytEsq/ofagIbmSCUd0=	t	pg
2	804559	5OtaA84LsQ7x9BInI2Fe8BUu34VBRVFWltiErQrN+FyZaIRkAIVAj1mAuF3vrNz1a2n89A34iHrVVZ4T	7/lYdeo9lQuDpFI2PEVdwaoSF1GDdXXFGrpY/SAhO2A=	t	pg.citya
3	394913	h+gBKrU9nwuM01cGeEl+/AsbvIQ6ADBthNjms3LtgxuiY7NmJq8N1wm3511M6hDMERQKqBDZ2ly2Bd8Q	7vcgcckzmAuupwovdUJ/phY/zA2Jb3HFs83KgIirNEQ=	t	pg.cityb
\.


--
-- Data for Name: eg_filestoremap; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_filestoremap (id, filestoreid, filename, contenttype, module, tag, tenantid, version, filesource, createdby, lastmodifiedby, createdtime, lastmodifiedtime) FROM stdin;
\.


--
-- Data for Name: eg_hrms_assignment; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_hrms_assignment (uuid, employeeid, "position", department, designation, fromdate, todate, govtordernumber, reportingto, ishod, tenantid, createdby, createddate, lastmodifiedby, lastmodifieddate, iscurrentassignment, isactive) FROM stdin;
6fa4c69d-53f3-404e-8bad-499353c5e15b	79006ea0-100c-4332-8390-60edff9328c1	13	DEPT_5	DESIG_1003	1704067200000	\N	\N	\N	f	pg.citest	8155a8e1-86bb-4e5f-9450-f2f7ab2004de	1778664447473	\N	0	t	\N
\.


--
-- Data for Name: eg_hrms_deactivationdetails; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_hrms_deactivationdetails (uuid, employeeid, reasonfordeactivation, effectivefrom, ordernumber, remarks, tenantid, createdby, createddate, lastmodifiedby, lastmodifieddate, isactive) FROM stdin;
\.


--
-- Data for Name: eg_hrms_departmentaltests; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_hrms_departmentaltests (uuid, employeeid, test, yearofpassing, remarks, tenantid, createdby, createddate, lastmodifiedby, lastmodifieddate, isactive) FROM stdin;
\.


--
-- Data for Name: eg_hrms_educationaldetails; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_hrms_educationaldetails (uuid, employeeid, qualification, stream, yearofpassing, university, remarks, tenantid, createdby, createddate, lastmodifiedby, lastmodifieddate, isactive) FROM stdin;
\.


--
-- Data for Name: eg_hrms_empdocuments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_hrms_empdocuments (uuid, employeeid, documentid, documentname, referencetype, referenceid, tenantid, createdby, createddate, lastmodifiedby, lastmodifieddate) FROM stdin;
\.


--
-- Data for Name: eg_hrms_employee; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_hrms_employee (id, uuid, code, dateofappointment, employeestatus, employeetype, active, tenantid, createdby, createddate, lastmodifiedby, lastmodifieddate, reactivateemployee) FROM stdin;
35	79006ea0-100c-4332-8390-60edff9328c1	CI-ADMIN	1704067200000	EMPLOYED	PERMANENT	t	pg.citest	8155a8e1-86bb-4e5f-9450-f2f7ab2004de	1778664447473	\N	0	f
\.


--
-- Data for Name: eg_hrms_jurisdiction; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_hrms_jurisdiction (uuid, employeeid, hierarchy, boundarytype, boundary, tenantid, createdby, createddate, lastmodifiedby, lastmodifieddate, isactive) FROM stdin;
323cb027-3ed0-47de-8265-1f99a4ad2020	79006ea0-100c-4332-8390-60edff9328c1	REVENUE	City	pg.citest	pg.citest	8155a8e1-86bb-4e5f-9450-f2f7ab2004de	1778664447473	\N	0	t
\.


--
-- Data for Name: eg_hrms_reactivationdetails; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_hrms_reactivationdetails (uuid, employeeid, reasonforreactivation, effectivefrom, ordernumber, remarks, tenantid, createdby, createddate, lastmodifiedby, lastmodifieddate) FROM stdin;
\.


--
-- Data for Name: eg_hrms_servicehistory; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_hrms_servicehistory (uuid, employeeid, servicestatus, servicefrom, serviceto, ordernumber, iscurrentposition, location, tenantid, createdby, createddate, lastmodifiedby, lastmodifieddate, isactive) FROM stdin;
\.


--
-- Data for Name: eg_mdms_data; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime) FROM stdin;
tenant-root	pg	Tenant.pg	tenant.tenants	{"city": {"code": "PB", "name": "Punjab"}, "code": "pg", "name": "Punjab", "tenantId": "pg"}	t	system-mdms-seed	system-mdms-seed	1770614666000	1770614666000
role-dgro	pg	ACCESSCONTROL-ROLES.roles.DGRO	ACCESSCONTROL-ROLES.roles	{"code": "DGRO", "name": "Department GRO", "description": "Department Grievance Routing Officer"}	t	system-mdms-seed	system-mdms-seed	1770614667000	1770614667000
role-pgr-viewer	pg	ACCESSCONTROL-ROLES.roles.PGR_VIEWER	ACCESSCONTROL-ROLES.roles	{"code": "PGR_VIEWER", "name": "PGR Viewer", "description": "PGR Viewer role"}	t	system-mdms-seed	system-mdms-seed	1770614667000	1770614667000
eb5da1e6-f644-4112-9e80-57fe9448d060	pg	9829de864164ee14f614b58125f7a6377fb9726140de9905364f38ab3aeb38a9	DataSecurity.DecryptionABAC	{"key": "UserListOtherIndividual", "roleAttributeAccessList": [{"roleCode": "EMPLOYEE", "attributeAccessList": [{"attribute": {"jsonPath": "*/emailId"}, "accessType": "NONE"}, {"attribute": {"jsonPath": "*/username"}, "accessType": "NONE"}, {"attribute": {"jsonPath": "*/altContactNumber"}, "accessType": "NONE"}, {"attribute": {"jsonPath": "*/pan"}, "accessType": "NONE"}, {"attribute": {"jsonPath": "*/aadhaarNumber"}, "accessType": "NONE"}, {"attribute": {"jsonPath": "*/guardian"}, "accessType": "NONE"}, {"attribute": {"jsonPath": "*/permanentAddress/address"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/correspondenceAddress/address"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/addresses/*/address"}, "accessType": "PLAIN"}]}, {"roleCode": "SUPERUSER", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/emailId"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/username"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/altContactNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/guardian"}, "accessType": "PLAIN"}]}, {"roleCode": "GRO", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber"}, "accessType": "PLAIN"}]}, {"roleCode": "DGRO", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber"}, "accessType": "PLAIN"}]}, {"roleCode": "CSR", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber"}, "accessType": "PLAIN"}]}, {"roleCode": "PGR-ADMIN", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber"}, "accessType": "PLAIN"}]}, {"roleCode": "TL_CEMP", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/emailId"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/altContactNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/pan"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/aadhaarNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/guardian"}, "accessType": "PLAIN"}]}, {"roleCode": "TL_APPROVER", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/emailId"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/altContactNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/pan"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/aadhaarNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/guardian"}, "accessType": "PLAIN"}]}, {"roleCode": "TL_DOC_VERIFIER", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/emailId"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/altContactNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/pan"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/aadhaarNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/guardian"}, "accessType": "PLAIN"}]}, {"roleCode": "TL_FIELD_INSPECTOR", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/emailId"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/altContactNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/pan"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/aadhaarNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/guardian"}, "accessType": "PLAIN"}]}, {"roleCode": "CEMP", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/emailId"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/altContactNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/pan"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/guardian"}, "accessType": "PLAIN"}]}, {"roleCode": "FEMP", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/emailId"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/altContactNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/pan"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/aadhaarNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/guardian"}, "accessType": "PLAIN"}]}, {"roleCode": "STADMIN", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber", "maskingTechnique": "mobile"}, "accessType": "MASK"}]}]}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
dbe08068-8150-407b-958b-024677602d35	pg	cce7f67c8606278f0e90c67f99840dc3290e0546c4d12085017f1f73180f6370	DataSecurity.DecryptionABAC	{"key": "UserListOtherBulk", "roleAttributeAccessList": [{"roleCode": "EMPLOYEE", "attributeAccessList": [{"attribute": {"jsonPath": "*/emailId"}, "accessType": "NONE"}, {"attribute": {"jsonPath": "*/username"}, "accessType": "NONE"}, {"attribute": {"jsonPath": "*/altContactNumber"}, "accessType": "NONE"}, {"attribute": {"jsonPath": "*/pan"}, "accessType": "NONE"}, {"attribute": {"jsonPath": "*/aadhaarNumber"}, "accessType": "NONE"}, {"attribute": {"jsonPath": "*/guardian"}, "accessType": "NONE"}, {"attribute": {"jsonPath": "*/permanentAddress/address"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/correspondenceAddress/address"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/addresses/*/address"}, "accessType": "PLAIN"}]}, {"roleCode": "SUPERUSER", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber"}, "accessType": "PLAIN"}]}, {"roleCode": "GRO", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber", "maskingTechnique": "mobile"}, "accessType": "MASK"}]}, {"roleCode": "DGRO", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber", "maskingTechnique": "mobile"}, "accessType": "MASK"}]}, {"roleCode": "CSR", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber", "maskingTechnique": "mobile"}, "accessType": "MASK"}]}, {"roleCode": "PGR-ADMIN", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber", "maskingTechnique": "mobile"}, "accessType": "MASK"}]}, {"roleCode": "TL_CEMP", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber", "maskingTechnique": "mobile"}, "accessType": "MASK"}]}, {"roleCode": "TL_APPROVER", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber", "maskingTechnique": "mobile"}, "accessType": "MASK"}]}, {"roleCode": "TL_DOC_VERIFIER", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber", "maskingTechnique": "mobile"}, "accessType": "MASK"}]}, {"roleCode": "TL_FIELD_INSPECTOR", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber"}, "accessType": "PLAIN"}]}, {"roleCode": "CEMP", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber", "maskingTechnique": "mobile"}, "accessType": "MASK"}]}, {"roleCode": "FEMP", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber"}, "accessType": "PLAIN"}]}, {"roleCode": "STADMIN", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber", "maskingTechnique": "mobile"}, "accessType": "MASK"}]}]}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9ab0bcf9-d75f-41cc-9815-6507faf66161	pg	5871c0303cc454c69d70b7c44f847a8ac8569130d8f6605d7e2de445110d067b	DataSecurity.DecryptionABAC	{"key": "UserListSelf", "roleAttributeAccessList": [{"roleCode": "CITIZEN", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/emailId"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/username"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/altContactNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/pan"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/aadhaarNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/guardian"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/permanentAddress/address"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/correspondenceAddress/address"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/addresses/*/address"}, "accessType": "PLAIN"}]}, {"roleCode": "EMPLOYEE", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/emailId"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/username"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/altContactNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/pan"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/aadhaarNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/guardian"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/permanentAddress/address"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/correspondenceAddress/address"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/addresses/*/address"}, "accessType": "PLAIN"}]}]}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f40e49dd-c51a-4895-b9c6-a4403f652b98	pg	882faa006ea7dae884b7b8e2909ca8ad5c7bdbc3c1fa78a8b64194759d62c004	DataSecurity.DecryptionABAC	{"key": "ALL_ACCESS", "roleAttributeAccessList": [{"roleCode": "SYSTEM", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber"}, "accessType": "PLAIN"}]}, {"roleCode": "CITIZEN", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/emailId"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/username"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/altContactNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/pan"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/aadhaarNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/guardian"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/permanentAddress/address"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/correspondenceAddress/address"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/addresses/*/address"}, "accessType": "PLAIN"}]}, {"roleCode": "ANONYMOUS", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/emailId"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/username"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/altContactNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/pan"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/aadhaarNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/guardian"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/permanentAddress/address"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/correspondenceAddress/address"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/addresses/*/address"}, "accessType": "PLAIN"}]}, {"roleCode": "EMPLOYEE", "attributeAccessList": [{"attribute": {"jsonPath": "*/name"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/mobileNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/emailId"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/username"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/altContactNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/pan"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/aadhaarNumber"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/guardian"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/permanentAddress/address"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/correspondenceAddress/address"}, "accessType": "PLAIN"}, {"attribute": {"jsonPath": "*/addresses/*/address"}, "accessType": "PLAIN"}]}]}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
workflow-bsm-pgr	pg	Workflow.BusinessServiceMasterConfig.PGR	Workflow.BusinessServiceMasterConfig	{"active": "true", "isStatelevel": "true", "businessService": "PGR"}	t	system-mdms-seed	system-mdms-seed	1770614667000	1770614667000
workflow-bsm-pgr-citest	pg.citest	Workflow.BusinessServiceMasterConfig.PGR	Workflow.BusinessServiceMasterConfig	{"active": "true", "isStatelevel": "false", "businessService": "PGR"}	t	system-mdms-seed	system-mdms-seed	1770614667000	1770614667000
d5648939-aa2f-4f3b-8825-955da74efeef	pg	f7cd9c1fda54fb870a2c44c536e74ad01551872667957cb4c408e27638903237	DataSecurity.EncryptionPolicy	{"key": "UserSearchCriteria", "attributeList": [{"type": "Normal", "jsonPath": "userName"}, {"type": "Normal", "jsonPath": "name"}, {"type": "Normal", "jsonPath": "mobileNumber"}, {"type": "Normal", "jsonPath": "aadhaarNumber"}, {"type": "Normal", "jsonPath": "pan"}, {"type": "Normal", "jsonPath": "emailId"}]}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5af13532-4f93-421e-98d4-45372f3eae25	pg	94ed5340ba6419c9c24a5d55e8e1a1238faae9517f4830b3e269808d1e5af8c2	DataSecurity.EncryptionPolicy	{"key": "User", "attributeList": [{"type": "Normal", "jsonPath": "name"}, {"type": "Normal", "jsonPath": "mobileNumber"}, {"type": "Normal", "jsonPath": "emailId"}, {"type": "Normal", "jsonPath": "username"}, {"type": "Normal", "jsonPath": "altContactNumber"}, {"type": "Normal", "jsonPath": "pan"}, {"type": "Normal", "jsonPath": "aadhaarNumber"}, {"type": "Normal", "jsonPath": "guardian"}, {"type": "Normal", "jsonPath": "permanentAddress/address"}, {"type": "Normal", "jsonPath": "correspondenceAddress/address"}, {"type": "Normal", "jsonPath": "addresses/*/address"}]}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
04a817b3-d240-4715-9a46-fa4d69368f0d	pg	77a9086de2d30ae55ad67c5c02c1c460fcdbb2dbc32ca389ed807a8eec0033f1	DataSecurity.MaskingPatterns	{"pattern": ".(?=.{4})", "patternId": "001"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
89f20fc3-29f8-4552-a44a-2e34de034414	pg	17961e0d591c4f8e4442ebdaf2c5153cf12d5e0448ffc61439f2c9877a571dac	DataSecurity.MaskingPatterns	{"pattern": "\\\\B[a-zA-Z0-9]", "patternId": "002"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
c7e368f2-d9b2-4114-b0ff-9f2de076a576	pg	64262585c15089ca9e752acc791e490fbd21042d2a8f3257ef56aa89fbc9ec0c	DataSecurity.MaskingPatterns	{"pattern": ".(?=.{2})", "patternId": "003"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5be91eb0-92b7-42bf-8662-47e8faafe0fb	pg	6d817663848da54e6a1d486d89921bb2a79a9d11f1124abee17a43b4dfa2d850	DataSecurity.MaskingPatterns	{"pattern": "(?<=.)[^@\\\\n](?=[^@\\\\n]*?@)|(?:(?<=@.)|(?!^)\\\\G(?=[^@\\\\n]*$)).(?!$)", "patternId": "004"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
fbc34d61-c246-45f5-a797-5c62a73a9bc6	pg	205b7a5fd55a4c43399091bbe32fe53da2d90d29e97769901df3de62c166c2ac	DataSecurity.MaskingPatterns	{"pattern": "[A-Za-zÀ-ȕ0-9(),-_., ]", "patternId": "005"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b63995f5-7283-4077-9e03-07af7c3f13ab	pg	3fa4041866ad41d2bd1b29b85ef91bfc5d9484e5423476bd0f9a0409f44c6133	DataSecurity.MaskingPatterns	{"pattern": "\\\\w(?=(?:[ \\\\w]*\\\\w){2}$)", "patternId": "006"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
64f363e5-6874-4e1c-b2d4-e345dc0d1fdc	pg	c0ca642bc5822bebba40e7d387b89e5fc7376a45362f6288cb59fa7ee7a11af4	DataSecurity.MaskingPatterns	{"pattern": "(?<=.).(?=.{3})", "patternId": "007"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
760750b8-5157-4a63-a6c5-2f18aed01435	pg	f1e3a37458d82c11be8ee10bd28afdb02b0307c2b6ca63e618181aa72a1c4826	DataSecurity.MaskingPatterns	{"pattern": "(?<=.).(?=.{2})", "patternId": "008"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a5164fd2-4be2-46dd-865d-955dc0a79271	pg	d7a6c5c44337b462e9131339366d50f9308ff8bbd4cc396f5af99b475630ea3b	DataSecurity.SecurityPolicy	{"model": "User", "attributes": [{"name": "name", "jsonPath": "name", "patternId": "002", "defaultVisibility": "PLAIN"}, {"name": "mobileNumber", "jsonPath": "mobileNumber", "patternId": "001", "defaultVisibility": "PLAIN"}, {"name": "emailId", "jsonPath": "emailId", "patternId": "004", "defaultVisibility": "PLAIN"}, {"name": "username", "jsonPath": "username", "patternId": "002", "defaultVisibility": "PLAIN"}, {"name": "altContactNumber", "jsonPath": "altContactNumber", "patternId": "001", "defaultVisibility": "PLAIN"}, {"name": "alternatemobilenumber", "jsonPath": "alternatemobilenumber", "patternId": "001", "defaultVisibility": "PLAIN"}, {"name": "pan", "jsonPath": "pan", "patternId": "001", "defaultVisibility": "PLAIN"}, {"name": "aadhaarNumber", "jsonPath": "aadhaarNumber", "patternId": "001", "defaultVisibility": "PLAIN"}, {"name": "guardian", "jsonPath": "guardian", "patternId": "002", "defaultVisibility": "PLAIN"}, {"name": "permanentAddress", "jsonPath": "permanentAddress/address", "patternId": "005", "defaultVisibility": "PLAIN"}, {"name": "correspondenceAddress", "jsonPath": "correspondenceAddress/address", "patternId": "005", "defaultVisibility": "PLAIN"}, {"name": "fatherOrHusbandName", "jsonPath": "fatherOrHusbandName", "patternId": "002", "defaultVisibility": "PLAIN"}, {"name": "searchUsername", "jsonPath": "userName", "patternId": "002", "defaultVisibility": "PLAIN"}], "uniqueIdentifier": {"name": "uuid", "jsonPath": "/uuid"}, "roleBasedDecryptionPolicy": [{"roles": ["INTERNAL_MICROSERVICE_ROLE"], "attributeAccessList": [{"attribute": "mobileNumber", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "fatherOrHusbandName", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "correspondenceAddress", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "name", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "emailId", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "permanentAddress", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "username", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "altContactNumber", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "alternatemobilenumber", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "pan", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "aadhaarNumber", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "guardian", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}]}, {"roles": ["EMPLOYEE", "GRO", "PGR_LME", "DGRO", "CSR", "SUPERUSER", "PGR_VIEWER", "MDMS_ADMIN"], "attributeAccessList": [{"attribute": "name", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "mobileNumber", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "emailId", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "username", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "altContactNumber", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "alternatemobilenumber", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "pan", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "aadhaarNumber", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "guardian", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "fatherOrHusbandName", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "correspondenceAddress", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "permanentAddress", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}]}]}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
304c24ed-86b6-4bdf-84bd-c9a69ec30566	pg	438b44be5e95785f453ce99d53b52a2d262f657b5afa255d33bdbad655b7a3fe	DataSecurity.SecurityPolicy	{"model": "UserSelf", "attributes": [{"name": "name", "jsonPath": "name", "patternId": null, "defaultVisibility": "PLAIN"}, {"name": "mobileNumber", "jsonPath": "mobileNumber", "patternId": null, "defaultVisibility": "PLAIN"}, {"name": "emailId", "jsonPath": "emailId", "patternId": null, "defaultVisibility": "PLAIN"}, {"name": "username", "jsonPath": "username", "patternId": null, "defaultVisibility": "PLAIN"}, {"name": "altContactNumber", "jsonPath": "altContactNumber", "patternId": null, "defaultVisibility": "PLAIN"}, {"name": "alternatemobilenumber", "jsonPath": "alternatemobilenumber", "patternId": null, "defaultVisibility": "PLAIN"}, {"name": "pan", "jsonPath": "pan", "patternId": null, "defaultVisibility": "PLAIN"}, {"name": "aadhaarNumber", "jsonPath": "aadhaarNumber", "patternId": null, "defaultVisibility": "PLAIN"}, {"name": "guardian", "jsonPath": "guardian", "patternId": null, "defaultVisibility": "PLAIN"}, {"name": "permanentAddress", "jsonPath": "permanentAddress/address", "patternId": null, "defaultVisibility": "PLAIN"}, {"name": "correspondenceAddress", "jsonPath": "correspondenceAddress/address", "patternId": null, "defaultVisibility": "PLAIN"}, {"name": "fatherOrHusbandName", "jsonPath": "fatherOrHusbandName", "patternId": null, "defaultVisibility": "PLAIN"}], "uniqueIdentifier": {"name": "uuid", "jsonPath": "/uuid"}, "roleBasedDecryptionPolicy": [{"roles": ["INTERNAL_MICROSERVICE_ROLE"], "attributeAccessList": [{"attribute": "mobileNumber", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "fatherOrHusbandName", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "correspondenceAddress", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "name", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "emailId", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "permanentAddress", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "username", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "altContactNumber", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "alternatemobilenumber", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "pan", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "aadhaarNumber", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "guardian", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}]}, {"roles": ["EMPLOYEE", "GRO", "PGR_LME", "DGRO", "CSR", "SUPERUSER", "PGR_VIEWER", "MDMS_ADMIN"], "attributeAccessList": [{"attribute": "name", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "mobileNumber", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "emailId", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "username", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "altContactNumber", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "alternatemobilenumber", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "pan", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "aadhaarNumber", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "guardian", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "fatherOrHusbandName", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "correspondenceAddress", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}, {"attribute": "permanentAddress", "firstLevelVisibility": "PLAIN", "secondLevelVisibility": "PLAIN"}]}]}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
workflow-bsm-default	pg	Workflow.BusinessServiceMasterConfig.Default	Workflow.BusinessServiceMasterConfig	{"active": "true", "isStatelevel": "false", "businessService": "Default"}	t	system-mdms-seed	system-mdms-seed	1770614667000	1770614667000
e0a46285-9bd6-4d2a-9746-fa8e26dcbcb1	pg	f1071d5522254e096fbb88f3a7c2989e77504f9d2333ca6d4802c30f53cc2264	DataSecurity.SecurityPolicy	{"model": "DescriptionReport", "attributes": [{"name": "name", "jsonPath": "name", "patternId": "002", "defaultVisibility": "PLAIN"}], "uniqueIdentifier": {"name": "user_uuid", "jsonPath": "/user_uuid"}, "roleBasedDecryptionPolicy": []}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
role-supervisor	pg	ACCESSCONTROL-ROLES.roles.SUPERVISOR	ACCESSCONTROL-ROLES.roles	{"code": "SUPERVISOR", "name": "Supervisor", "description": "Auto Escalation Supervisor"}	t	system-mdms-seed	system-mdms-seed	1770614667000	1770614667000
f1650c61-d479-4eb4-81c1-b7c54b92f79c	pg	statea.g	tenant.tenants	{"city": {"code": "STATEA_G", "name": "My Tenant", "districtName": "My Tenant"}, "code": "statea.g", "name": "My Tenant", "type": "CITY", "tenantId": "statea.g"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1770614758459	1770614758459
98f44a61-20bd-4c91-b476-6d4fe20855cb	pg	e81a8c25e53c4ce4cd89ea2233be2a87775822e9ff8f8100b25e32dcb46d445f	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2568, "url": "/egov-user-event/v1/events/notifications/_count", "code": "null", "name": "mSeva Event Count", "path": "", "enabled": false, "displayName": "mSeva Event Notification", "orderNumber": 1, "serviceCode": "msea-event-notification"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ce90d6f7-82d2-42c6-a714-6b86ec2bdfab	pg	79f1d542a073ce94767063af495130c43b31407f8967b75ea41c52450ee62cc2	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2567, "url": "/egov-user-event/v1/events/_search", "code": "null", "name": "mSeva Event Search", "path": "", "enabled": false, "displayName": "mSeva Event Notification", "orderNumber": 1, "serviceCode": "msea-event-notification"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0f2547f3-7fef-4adc-b651-2e8256d35cca	pg	49dd5af11f0ea198e851c3994a77a02a9e33d3b867fab18a4eb2acfcf66db3dc	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2566, "url": "digit-ui-card", "code": "", "name": "CS_HOME_MY_COMPLAINTS", "path": "", "enabled": true, "sidebar": "digit-ui-links", "leftIcon": "PGRIcon", "rightIcon": "", "sidebarURL": "/digit-ui/citizen/pgr-home", "displayName": "My Complaints", "orderNumber": 2, "queryParams": "", "serviceCode": "", "parentModule": "PGR", "navigationURL": "/digit-ui/citizen/pgr/complaints"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0998198f-4f9d-43c8-b371-10e68b4a3258	pg	dc379cd72dc1dc0a3319228853cec0d8b5185b5b818abda9b2367ed827283368	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2565, "url": "digit-ui-card", "code": "", "name": "CS_COMMON_FILE_A_COMPLAINT", "path": "", "enabled": true, "sidebar": "digit-ui-links", "leftIcon": "PGRIcon", "rightIcon": "", "sidebarURL": "/digit-ui/citizen/pgr-home", "displayName": "File a Complaint", "orderNumber": 1, "queryParams": "", "serviceCode": "", "parentModule": "PGR", "navigationURL": "/digit-ui/citizen/pgr/create-complaint/complaint-type"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
517f8289-0862-4b83-ab23-2eeca60e81b5	pg	7f58774e1bf2ce11d2fcb3248ce467494c82b42ae7c36ea71b1517593c0bfe6d	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2564, "url": "/boundary-service/boundary-relationships/_search", "code": "null", "name": "Search boundary relationship", "path": "", "enabled": false, "displayName": "Search boundary relationship", "orderNumber": 0, "serviceCode": "boundary-hierarchy"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
bc4cd5fd-0244-4a6c-96fd-fccdb7e1e442	pg	4f090316cfef27c5758ddceab17324d9213ebf7302383c8218c21b01f77a8196	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2563, "url": "/boundary-service/boundary-relationships/_create", "code": "null", "name": "Create boundary relationship", "path": "", "enabled": false, "displayName": "Create boundary relationship", "orderNumber": 0, "serviceCode": "boundary-hierarchy"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
da552b9e-5590-4d35-9c5b-d26d841d7553	pg	68659181e972034f462082554beba557e5f3ece26139deba640ebfc24649510c	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2562, "url": "/boundary-service/boundary/_search", "code": "null", "name": "Search boundary entity", "path": "", "enabled": false, "displayName": "Search boundary entity", "orderNumber": 0, "serviceCode": "boundary-hierarchy"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0edd4ac3-f2b0-451f-bc5c-39bfdaeac476	pg	abb6677354a96e6d0e33888ec87cdb784cfe108a874dce0b6066f7244c8d894f	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2561, "url": "/boundary-service/boundary/_create", "code": "null", "name": "Create boundary entity", "path": "", "enabled": false, "displayName": "Create boundary entity", "orderNumber": 0, "serviceCode": "boundary-hierarchy"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
11f97c13-6973-40a8-9969-91f7cf2d17d9	pg	87bf99731f22d13808acb2ea0154d6bb6e85b11407078da917d3f87dcce91330	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2560, "url": "/boundary-service/boundary-hierarchy-definition/_search", "code": "null", "name": "Search boundary hierarchy", "path": "", "enabled": false, "displayName": "Search boundary hierarchy", "orderNumber": 0, "serviceCode": "boundary-hierarchy"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
fa75aa6c-16a8-4e6a-a92c-d1bde15fc040	pg	89b56d3d76b1a0609816c8024b330a7ce6f3cf634517b3684ad6a734b7cff1b8	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2559, "url": "/boundary-service/boundary-hierarchy-definition/_create", "code": "null", "name": "Create boundary hierarchy", "path": "", "enabled": false, "displayName": "Create boundary hierarchy", "orderNumber": 0, "serviceCode": "boundary-hierarchy"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1c08579b-3d4e-49ca-9425-360372d1f23b	pg	1082be94c19b312e148189cfeec0a18ee7e139cbe7aa0690d1264df5a992e436	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 4556, "url": "url", "name": "Home", "path": "Home", "enabled": true, "leftIcon": "action:home", "rightIcon": "", "displayName": "Home", "orderNumber": 1, "queryParams": "", "serviceCode": "PGR", "parentModule": "rainmaker-pgr", "navigationURL": "/digit-ui/employee/"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
92dbc116-e44f-49cb-a59a-bb6f68b106d1	pg	5a4d18ea57e105ae29aad34a42f93dfefb253d9b056aa3373c6ccca01e42f3c8	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1648, "url": "url", "name": "Home", "path": "0Home", "enabled": true, "leftIcon": "Home", "rightIcon": "", "displayName": "Home", "orderNumber": 1, "queryParams": "", "serviceCode": "workbench", "parentModule": "workbench", "navigationURL": "/digit-ui/employee/"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d1e7d1c0-bc32-4117-9437-552274fcb8a4	pg	b4591062801f7ddab786dca97236124852c8bb814d953db9f1b211fa9fa12fd0	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2558, "url": "/inbox/v2/video/upload", "code": "null", "name": "Inbox Search for UI", "path": "", "enabled": false, "displayName": "Inbox v2 video upload", "orderNumber": 0, "serviceCode": "inbox"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
afda92aa-1986-4666-9777-ec12e7d5140f	pg	85122f16fcd9a93076645b870205a62a7243bbebe85cbf832c47444aa9d1fa81	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2557, "url": "/inbox/v2/_search", "code": "null", "name": "Inbox Search for UI", "path": "", "enabled": true, "displayName": "Inbox v2 Search", "orderNumber": 0, "serviceCode": "inbox"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
4860b3c0-9e60-4dce-ac35-7a7cfbb71542	pg	3dc531cc6234aafa9e243533d5b8bbce30fafbc19e95f027d2073bce47a83386	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2556, "url": "/inbox/v2/_search", "code": "null", "name": "Inbox Search for UI", "path": "", "enabled": false, "displayName": "Inbox Search", "orderNumber": 0, "serviceCode": "inbox"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
57b8dc7a-7962-4fc2-9c79-ccfbc1b052d4	pg	a5843ca89169e671f5c3d237e0767f238569e43973f92ff1369f3894479206ff	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2560, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7adb9ab6-2300-487a-a9df-7e6f4b6b62f9	pg	aa956844a432c21c717fe8c1397601e430cf714cc57c4e83b2dcf2b1881893f9	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2540, "url": "/mdms-v2/v2/_update/ACCESSCONTROL-ROLES.rolesroles", "code": "null", "name": "MDMS", "path": "", "enabled": false, "displayName": "Update ACCESSCONTROL-ROLES rolesroles", "orderNumber": 1, "serviceCode": "MDMS", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d001873f-b67b-43c1-a7a1-ca5195ec2c5a	pg	3c47a836e243649aaf17d21bc18d8bd82f8e83cd635969f6874f5b208faae405	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2539, "url": "/mdms-v2/v2/_create/ACCESSCONTROL-ROLES.rolesroles", "code": "null", "name": "MDMS", "path": "", "enabled": false, "displayName": "Create AACCESSCONTROL-ROLES rolesroles", "orderNumber": 1, "serviceCode": "MDMS", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
52393e20-009b-45e9-bf8e-2b595ff4e8bf	pg	61a6c028ad982a695cb98e7b7e23d4ea5b2fcf443686e9e2925a379eebe3fe2c	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2538, "url": "url", "code": "null", "name": "MDMS", "path": "9MDMS.ACCESSCONTROL-ROLESrolesroles", "enabled": false, "leftIcon": "dynamic:ContractIcon", "displayName": "Roleactions Roles", "orderNumber": 1, "serviceCode": "MDMS", "parentModule": "", "navigationURL": "/workbench-ui/employee/workbench/mdms-search-v2?moduleName=ACCESSCONTROL-ROLES&masterName=rolesroles"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1ffa3be4-36a2-43bd-aeb0-1203d9034877	pg	5f9985b6f95ee8508d13b289b5b053150082b24855b6d5fb9a6933ee0f9a67e5	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2537, "url": "/mdms-v2/v2/_update/ACCESSCONTROL-ROLEACTIONS.roleactions", "code": "null", "name": "MDMS", "path": "", "enabled": false, "displayName": "Update ACCESSCONTROL-ROLEACTIONS roleactions", "orderNumber": 1, "serviceCode": "MDMS", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
3b18036b-05ee-4130-9b4f-1cd53886a8ea	pg	7d8a587c546820b4f01257a8a310f31080b3052c13a544fe9c9f0b6de67d42f4	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2536, "url": "/mdms-v2/v2/_create/ACCESSCONTROL-ROLEACTIONS.roleactions", "code": "null", "name": "MDMS", "path": "", "enabled": false, "displayName": "Create ACCESSCONTROL-ROLEACTIONS roleactions", "orderNumber": 1, "serviceCode": "MDMS", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
31ef2272-c32e-46c2-ac96-41a499160466	pg	7f5a5297e271d66361caca18ee7e4039efdd57677b42d089a0c357ecdc599c80	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2535, "url": "url", "code": "null", "name": "MDMS", "path": "9MDMS.ACCESSCONTROL-ROLEACTIONSroleactions", "enabled": false, "leftIcon": "dynamic:ContractIcon", "displayName": "Roleactions", "orderNumber": 1, "serviceCode": "MDMS", "parentModule": "", "navigationURL": "/workbench-ui/employee/workbench/mdms-search-v2?moduleName=ACCESSCONTROL-ROLEACTIONS&masterName=roleactions"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7f45fd44-8896-479d-8efc-86bc880a1a63	pg	efe19a0e417c8ed1bb271d8ae1e1030c6d5f82288f51a74556582705aecbc6d7	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2534, "url": "/mdms-v2/v2/_update/ACCESSCONTROL-ROLES.roles", "code": "null", "name": "MDMS", "path": "", "enabled": false, "displayName": "Update ACCESSCONTROL-ROLES roles", "orderNumber": 1, "serviceCode": "MDMS", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9654c5a3-4c86-45d9-b4f3-c38ad22b5a66	pg	90d53a96889ad204b9a3746c2d710e4211e9a01ccacce075a407dacba7d02078	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2533, "url": "/mdms-v2/v2/_create/ACCESSCONTROL-ROLES.roles", "code": "null", "name": "MDMS", "path": "", "enabled": false, "displayName": "Create ACCESSCONTROL-ROLES roles", "orderNumber": 1, "serviceCode": "MDMS", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
05c3e21b-fef2-4178-851f-227224aa7443	pg	7437ab4d5d1d5eedd3e3c652188430bdad53bb3375674fd5b32cd842d3087363	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2532, "url": "url", "code": "null", "name": "MDMS", "path": "9MDMS.ACCESSCONTROL-ROLESroles", "enabled": false, "leftIcon": "dynamic:ContractIcon", "displayName": "Roles", "orderNumber": 1, "serviceCode": "MDMS", "parentModule": "", "navigationURL": "/workbench-ui/employee/workbench/mdms-search-v2?moduleName=ACCESSCONTROL-ROLES&masterName=roles"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
01a8c4f1-04e6-499c-b106-be3759857e77	pg	5dbc848a9f5070372f06cde233b45fbc0e599c7d3d7db3dd5073f3c8f7b62f5e	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2531, "url": "/mdms-v2/v2/_update/ACCESSCONTROL-ACTIONS-TEST.actions-test", "code": "null", "name": "MDMS", "path": "", "enabled": false, "displayName": "Update ACCESSCONTROL-ACTIONS-TEST actions-test", "orderNumber": 1, "serviceCode": "MDMS", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
108243ed-2805-43e8-a8ed-b0e5ed0124b8	pg	6de38af6fb2eb085417cf1470317e056c632a7c59c39b8893932e860e5ae8682	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2530, "url": "/mdms-v2/v2/_create/ACCESSCONTROL-ACTIONS-TEST.actions-test", "code": "null", "name": "MDMS", "path": "", "enabled": false, "displayName": "Create ACCESSCONTROL-ACTIONS-TEST actions-test", "orderNumber": 1, "serviceCode": "MDMS", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
aba6b226-315d-4eac-9968-a763fef40070	pg	a162964dd0f44d86df3242f17e4f11466633674474ee932cd5a0fe6e720e0549	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2529, "url": "url", "code": "null", "name": "MDMS", "path": "9MDMS.ACCESSCONTROL-ACTIONS-TESTactions-test", "enabled": false, "leftIcon": "dynamic:ContractIcon", "displayName": "Actions test", "orderNumber": 1, "serviceCode": "MDMS", "parentModule": "", "navigationURL": "/workbench-ui/employee/workbench/mdms-search-v2?moduleName=ACCESSCONTROL-ACTIONS-TEST&masterName=actions-test"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
53d85624-5a4b-47a2-910a-3cc1f80c331f	pg	9b2c46c002b36633d8755c48be48c00794c032d0ce6b3a926409b780be111100	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2528, "url": "/mdms-v2/v2/_update/tenant.tenants", "code": "null", "name": "MDMS", "path": "", "enabled": false, "displayName": "Update tenant tenants", "orderNumber": 1, "serviceCode": "MDMS", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f27e2cbd-c32a-4aa7-accb-8620b7f3b8ab	pg	bc835bb2c0f31c6227c38e10ddb0472c1938a3b638bd428183b676ae4d5cfef7	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2527, "url": "/mdms-v2/v2/_create/tenant.tenants", "code": "null", "name": "MDMS", "path": "", "enabled": false, "displayName": "Create tenant tenants", "orderNumber": 1, "serviceCode": "MDMS", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
bdc2de97-f5a4-4f56-975f-4fb7f61077e1	pg	f98482430a1f3feffa596a74ff539695771fde98adfb845c12dca854bfa15e6a	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2526, "url": "url", "code": "null", "name": "MDMS", "path": "9MDMS.tenanttenants", "enabled": false, "leftIcon": "dynamic:ContractIcon", "displayName": "Tenant", "orderNumber": 1, "serviceCode": "MDMS", "parentModule": "", "navigationURL": "/workbench-ui/employee/workbench/mdms-search-v2?moduleName=tenant&masterName=tenants"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5ea19fc0-0893-4613-a020-50285d9bf3de	pg	b1fad33ac038b490a276b3670779633c4b8c73f5ab42d2118c25673b3f598c1f	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2516, "url": "/mdms-v2/v2/_update/TradeLicense.Usagee", "code": "null", "name": "MDMS v2 update data2", "path": "", "enabled": false, "displayName": "MDMS v2", "orderNumber": 1, "serviceCode": "MDMS v2", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5b68dcf0-2a1e-4c27-8dac-3ed3895c4a12	pg	13c458f3a23c1a46d64276f96b594f1a9a069b3555f90cee580d02aa9e240a8f	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2515, "url": "/mdms-v2/v2/_update/TradeLicense.Usage", "code": "null", "name": "MDMS v2 update data2", "path": "", "enabled": true, "displayName": "MDMS v2", "orderNumber": 1, "serviceCode": "MDMS v2", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
dc5ae65d-5793-46a6-beaa-4d64c045312b	pg	d6edbe81822577c3aeda256dce21329f9b051c980f7fd7f3f9b6c55df9840eb4	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2513, "url": "/mdms-v2/v2/_search", "code": "null", "name": "MDMS v2 (search v2)", "path": "", "enabled": true, "displayName": "MDMS v2", "orderNumber": 1, "serviceCode": "MDMS v2", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
bc2cb38c-a3c9-4f4c-b84f-76bfc0f93fbe	pg	4e6be0b482fb4b9b69e74f40127bf5df609c040382c93f4ff412efcd395ef984	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2510, "url": "/mdms-v2/schema/v1/_search", "code": "null", "name": "MDMS v2 Search", "path": "", "enabled": false, "displayName": "MDMS v2", "orderNumber": 1, "serviceCode": "MDMS v2", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b9949154-31e7-4e3f-a7a3-d9800746b986	pg	d058ba2becebdad572f9c024f55a3aed1d9072b1d35c43756b1c9c5bfd2369fb	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2509, "url": "/mdms-v2/schema/v1/_create", "code": "null", "name": "MDMS v2 create", "path": "", "enabled": false, "displayName": "MDMS v2", "orderNumber": 1, "serviceCode": "MDMS v2", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b8d63bb3-61d1-4d11-b932-a90a69d5a4cd	pg	03892ae8f418bf7e80bc777378fb7b29af7d623167a7ef7d1a0dcdbfd6aaf624	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2400, "url": "/filestore/v1/files/static", "code": "null", "name": "BND how it works", "path": "", "enabled": false, "displayName": "BND how it works", "orderNumber": 0, "serviceCode": "birth-death-services"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ac313e1c-7bea-4908-9032-4d2581afb65a	pg	511940f90355d827a724a3c6a7c9c77c793daa4834390a24f81fdf123126ac79	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2317, "url": "/filestore/v1/files", "code": "null", "name": "FilestoreUrl", "path": "", "enabled": false, "displayName": "Filestore Url", "orderNumber": 1, "serviceCode": "filestore url", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6796de8f-0d78-4bec-b77f-bead468f25e4	pg	da0067a5e26b09a27b9aac6fdffaa1bd97ae800f29e570e076f8ec15892e3bed	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2156, "url": "/egov-workflow-v2/egov-wf/escalate/_search", "code": "null", "name": "Workflow Escalation search", "path": "", "enabled": false, "displayName": "Workflow Escalation search", "orderNumber": 0, "serviceCode": "egov-workflow-v2", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
fd6a337e-4eac-4ada-8309-75c8e59ceace	pg	f18ccdfeff3e2828afd87dbab80af3f133a5be1662ce30573dd196bc09d17d04	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2149, "url": "/egov-hrms/employees/_count", "code": "null", "name": "Employee Count", "path": "", "enabled": false, "displayName": "Employee Count", "orderNumber": 0, "serviceCode": "egov-hrms", "parentModule": "egov-hrms"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
3c15b485-3682-462d-9784-878f26e68598	pg	f585cdd29741f9d20b31baacb0034afff988e98e61b2c9eab8583896754efdf2	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2086, "url": "/egov-enc-service/crypto/v1/_encrypt", "code": "null", "name": "Encrypt", "path": "Enc.Encrypt", "enabled": false, "displayName": "Encrypt", "orderNumber": 1, "serviceCode": "Enc"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d2242886-d042-45e3-92c9-72ee61fe2e0b	pg	d4eeef6268adc1acabbcebf494549906ef5a625dbf9693683fbf0f2d60c1f6fd	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2085, "url": "/egov-mdms-service/v1/_get", "code": "null", "name": "MDMS GET", "path": "", "enabled": false, "displayName": "MDMS GET", "orderNumber": 0, "serviceCode": "MDMS GET", "parentModule": "306"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0106c904-0477-4b11-b09a-2e828fa36a46	pg	776abd100cbf404fa6a8da61c4534d0bed4c0de6dbc69048be751b0d5d4875e7	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1555, "url": "url", "code": "null", "name": "AllComplaints", "path": "AllComplaints", "enabled": false, "leftIcon": "custom:open-complaints", "rightIcon": "", "displayName": "All Complaints", "orderNumber": 1, "serviceCode": "PGR", "parentModule": "rainmaker-pgr", "navigationURL": "/digit-ui/employee/pgr/inbox"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
bb2f4f4b-d71d-415c-87e5-cafbb93ac9be	pg	2a1ce72dbc025426b58f13b456a76aa623fb52eaacb3200f52d231b86ab8e54e	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2036, "url": "/collection-services/payments/WS/_search", "code": "null", "name": "WS Payment search", "path": "", "enabled": false, "displayName": "WS Payment search", "orderNumber": 1, "serviceCode": "", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2127d544-dfcc-4c3f-a0c6-7acc6442439e	pg	68b070e0078777de4a05927e6082d2d68d9c2e98020ca76d75a17e82850bb214	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2035, "url": "/collection-services/payments/FIRENOC/_search", "code": "null", "name": "FIRENOC Payment search", "path": "", "enabled": false, "displayName": "FIRENOC Payment search", "orderNumber": 1, "serviceCode": "", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
75056e20-4d60-4cf6-8186-1d6b634bd9f5	pg	4538f2125a64a85b0b6516924b93e8ecfdc3c8e891e243f2e2d9d9950e34c6ae	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2034, "url": "/collection-services/payments/TL/_search", "code": "null", "name": "TL Payment search", "path": "", "enabled": false, "displayName": "TL Payment search", "orderNumber": 1, "serviceCode": "", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9208fdd2-d5cb-427e-9d21-ab5d76e24757	pg	6babeb2b1ba10852d4d727a53b23408829a4d412b43f44d6b43b13503ee8e0eb	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2033, "url": "/collection-services/payments/PT.MUTATION/_search", "code": "null", "name": "PT Payment search", "path": "", "enabled": false, "displayName": "PT Payment search", "orderNumber": 1, "serviceCode": "", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7c0e0bc1-638a-4e9e-9b8c-e169e5daa2ca	pg	3cc38ff6dd829041962c7e8fc7d54b72376c6a1e748e14bbfcf7b250b8aedbd8	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2032, "url": "/collection-services/payments/BPA.LOW_RISK_PERMIT_FEE/_search", "code": "null", "name": "BPA LOW Payment search", "path": "", "enabled": false, "displayName": "BPA LOW Payment search", "orderNumber": 1, "serviceCode": "", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
68fea4a7-ba26-4d03-898c-0afb6356fe2c	pg	8e937caf7bbbf2c27f81929631176e57e1c6fa2ce4c7e9eab5de1bcecfdbb349	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2031, "url": "card", "code": "", "name": "ReceiptCancellation", "path": "receipts", "enabled": false, "leftIcon": "action:receipt", "rightIcon": "", "displayName": "ReceiptCancellation", "orderNumber": 25, "queryParams": "", "serviceCode": "", "parentModule": "", "navigationURL": "receipts/search"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
89be7eaa-a9fa-4381-9662-0966a56b6760	pg	5170d59abc3e80c841dcd0e592f9e78c53a748d6a9ec8d31f2543dea063e63e5	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2030, "url": "url", "code": "null", "name": "ReceiptCancellation", "path": "", "enabled": false, "leftIcon": "action:receipt", "displayName": "ReceiptCancellation", "orderNumber": 24, "serviceCode": "", "parentModule": "", "navigationURL": "receipts/search"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
85643d9c-c22b-4f91-9784-08a25e6e7dc0	pg	86e5411e25e6407392a7574b74dc23c7ebcb9718e00a607df9e6f4b5b8f5e501	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2029, "url": "/collection-services/payments/PT/_search", "code": "null", "name": "PT Payment search", "path": "", "enabled": false, "displayName": "PT Payment search", "orderNumber": 1, "serviceCode": "", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
601c55b8-58a1-4ff1-9b9c-f3126917a719	pg	cf66a328bcf1a5ded10f5e6efe3d770286cd2478cdc65e4882418e5b04ca51e4	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2028, "url": "/collection-services/payments/PT/_workflow", "code": "null", "name": "PT Receipt Update", "path": "", "enabled": false, "displayName": "PT Receipt Update", "orderNumber": 1, "serviceCode": "", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
02a3bf59-1ae2-4fe2-8ccc-d75c3075978e	pg	32fd518cfa5936f50f51efca5c48cdd387f35b794e03664f422abe19df473e06	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2027, "url": "/egov-workflow-v2/egov-wf/process/_count", "code": "null", "name": "WorkflowProcessCount", "path": "", "enabled": false, "displayName": "Workflow Count", "orderNumber": 1, "serviceCode": "", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
007cf714-c330-4dad-b506-bcfc90e45db4	pg	5938b92ef92629300659d3c8dcd64a4b087f95ee6d32a448e28dc68dfd3548c2	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2024, "url": "url", "code": "null", "name": "BillAmendment", "path": "", "enabled": false, "leftIcon": "action:receipt", "displayName": "BillAmendment", "orderNumber": 23, "serviceCode": "", "parentModule": "", "navigationURL": "bill-amend/search"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a9b009bc-72a1-49d2-96bb-5204f4a65b21	pg	d0723b5e3d9ac8d48065790f434833d5bd402c81b8b105b401a224f251db2b26	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2023, "url": "/sw-calculator/sewerageCalculator/_applyAdhocTax", "code": "null", "name": "Add adhoc tax to sewerage", "path": "", "enabled": false, "displayName": "Add adhoc tax", "orderNumber": 0, "serviceCode": "sw-calculator"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5fdde95d-4d61-4010-8348-adf200990c0e	pg	ce217b6025b10ace137a2c966d14dd3b2be9561f4f0af89b1be4e9ad1145523c	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2022, "url": "/ws-calculator/waterCalculator/_applyAdhocTax", "code": "null", "name": "Add adhoc tax", "path": "", "enabled": false, "displayName": "Add adhoc tax", "orderNumber": 0, "serviceCode": "ws-calculator"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
255cdb2d-b4e1-4802-9813-979d21e4737d	pg	2e295cce3c7f2017854ffb65bd3ba0d0582106de53aa264f976e63e60d3e2560	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2021, "url": "/report/pgr/GROPerformanceReport/_get", "code": "null", "name": "GROPerformanceReport", "path": "PGR Report", "enabled": false, "displayName": "PGR Report", "orderNumber": 0, "serviceCode": "PGRReports"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e43fc098-e28a-4bbf-b59d-b3b81c1c1658	pg	981d0e15382f0d67cec3e7970d15c556419be8be8e9256dc03a6fea90fb8a3f9	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2020, "url": "/report/pgr/LMEPerformanceReport/_get", "code": "null", "name": "LMEPerformanceReport", "path": "PGR Report", "enabled": false, "displayName": "PGR Report", "orderNumber": 0, "serviceCode": "PGRReports"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
144f95c1-8720-46c8-aa54-97dde13c01e8	pg	e3bbca4bbfafde3516ab24ea59b3e251d27e1d49684073ed96e95da0e4faa444	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2019, "url": "/report/pgr/DescriptionReport/_get", "code": "null", "name": "DescriptionReport", "path": "PGR Report", "enabled": false, "displayName": "PGR Report", "orderNumber": 0, "serviceCode": "PGRReports"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
056aadc7-c7ec-4444-a4a1-14fc5c216037	pg	07bdb9dc175e308841894d1746b1e9ae8743442c72d156f523c9379165b33a0a	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2018, "url": "/report/pgr/ULBReport/_get", "code": "null", "name": "ULBReport", "path": "PGR Report", "enabled": false, "displayName": "PGR Report", "orderNumber": 0, "serviceCode": "PGRReports"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
805ae7a7-916e-43d1-915b-d99c4af2a52b	pg	d7f73f2cbab14ec87355f97fa52899ced39f9709ad828a09023d85183e71fad7	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2017, "url": "/report/pgr/GROPerformanceReport/metadata/_get", "code": "null", "name": "PGR-GROPerformanceReport-Metadata", "path": "PGR Report", "enabled": false, "displayName": "Rainmaker PGR report", "orderNumber": 1, "serviceCode": "PGRReports", "parentModule": "147"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
18cde675-4fdc-446d-817b-b0ab00aed592	pg	9d994fb376da0240b5f37e1624688991e168b14805a4b5f2b82352591b5a9382	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2016, "url": "/report/pgr/LMEPerformanceReport/metadata/_get", "code": "null", "name": "PGR-LMEPerformanceReport-Metadata", "path": "PGR Report", "enabled": false, "displayName": "Rainmaker PGR report", "orderNumber": 1, "serviceCode": "PGRReports", "parentModule": "147"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
4d135627-a3b1-45b5-b69c-3c089e96b125	pg	3aed961045b93d8f60be5e8f8bf22eff8734aed10a7e45b4b153bd2a7a2c33e8	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2015, "url": "/report/pgr/ULBReport/metadata/_get", "code": "null", "name": "PGR-ULBReport-Metadata", "path": "PGR Report", "enabled": false, "displayName": "Rainmaker PGR report", "orderNumber": 1, "serviceCode": "PGRReports", "parentModule": "147"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
239357a8-46e2-428d-88cf-7f10259a263f	pg	87ef60971173e58d0be9ff03db6e968f496440772e71544c85c400ba010c6d7d	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2014, "url": "/report/pgr/DescriptionReport/metadata/_get", "code": "null", "name": "PGR-DescriptionReport-Metadata", "path": "PGR Report", "enabled": false, "displayName": "Rainmaker PGR report", "orderNumber": 1, "serviceCode": "PGRReports", "parentModule": "147"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
10d6dcb3-621c-47fc-bf03-03d15356eb3e	pg	e7c2ce6b9e1800bc02431457044b0c685e29c02194e8f5466dde3f9eedb06f9d	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2013, "url": "url", "code": "null", "name": "GROPerformanceReport", "path": "Complaints.PGR Reports.GROPerformanceReport", "enabled": false, "leftIcon": "action:assignment", "rightIcon": "", "displayName": "GRO Performance Report", "orderNumber": 6, "serviceCode": "PGR", "parentModule": "pgr", "navigationURL": "report/pgr/GROPerformanceReport"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8f89b756-0c41-4ba7-8d96-7f6c9667fa54	pg	f43d8ef843489909d34e78d44c33f941e5cfa68bb20478947cd8cafeb022b925	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2012, "url": "url", "code": "null", "name": "LMEPerformanceReport", "path": "Complaints.PGR Reports.LMEPerformanceReport", "enabled": false, "leftIcon": "action:assignment", "rightIcon": "", "displayName": "LME Performance Report", "orderNumber": 6, "serviceCode": "PGR", "parentModule": "pgr", "navigationURL": "report/pgr/LMEPerformanceReport"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
883fb365-b8cf-4f48-93a8-8553ec721f79	pg	ad515e7a5678b18bdf1f2f2a50ff363c6be01908bd5fc90486fbe0edee71d022	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2025, "url": "url", "code": "null", "name": "DescriptionReport", "path": "Complaints.PGR Reports.DescriptionReport", "enabled": false, "leftIcon": "action:assignment", "rightIcon": "", "displayName": "Description Report", "orderNumber": 6, "serviceCode": "PGR", "parentModule": "pgr", "navigationURL": "report/pgr/DescriptionReport"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
c035cbc7-eee6-4520-be80-5b71f81455ba	pg	d020b04dbabd90aae70aa05b26536c9a77c9d11bff94b53d00b8669c25a7a781	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2026, "url": "url", "code": "null", "name": "ULBReport", "path": "Complaints.PGR Reports.ULBReport", "enabled": false, "leftIcon": "action:assignment", "rightIcon": "", "displayName": "ULB Report", "orderNumber": 6, "serviceCode": "PGR", "parentModule": "pgr", "navigationURL": "report/pgr/ULBReport"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9ab4d2de-a4e0-423c-a046-11bfead9570a	pg	1fca001c4ac090488ff7677a1ca82ac1a98ed3e6a9d9257df2003aadd214b283	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2009, "url": "/pgr-services/v2/request/_count", "code": "null", "name": "Search PGR Request", "path": "", "enabled": false, "displayName": "Count PGR Request", "orderNumber": 0, "serviceCode": "pgr-services", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
89e82efb-c5b2-45bd-a1ad-657d33fb6882	pg	09124d06961e5b657a9813fc586486be1013b693af0e6c0ec856da1c7c247e88	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2008, "url": "/pgr-services/v2/request/_search", "code": "null", "name": "Search PGR Request", "path": "", "enabled": false, "displayName": "Search PGR Request", "orderNumber": 0, "serviceCode": "pgr-services", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
045347e2-8d89-4b13-a9cf-c388405ad822	pg	86665da0a458a4414649bdb1d23cf43f880051987581b3794298fa3145d8f441	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2007, "url": "/pgr-services/v2/request/_update", "code": "null", "name": "Update PGR Request", "path": "", "enabled": false, "displayName": "Update PGR Request", "orderNumber": 0, "serviceCode": "pgr-services", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
40489f54-f46d-429b-901d-833f7ab14f84	pg	6db0181592a75d133170c77acfc75cd32a106aa04f4f80be894bf191e96384dd	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2006, "url": "/pgr-services/v2/request/_create", "code": "null", "name": "Create PGR Request", "path": "", "enabled": false, "displayName": "Create PGR Request", "orderNumber": 0, "serviceCode": "pgr-services", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
390bf6a7-d6d5-4730-b91d-a164ba10ddaf	pg	b5f5128abcc67ff163d3c81b94887b5a0bde15dedf8ddfbfaa3f25f42eeb2863	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2562, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b52fa966-2749-49e1-955f-65135b8f6eb6	pg	fdbf60ec93a1e5981a867ea6f6148f3f823e7f2124ba81e1f57d72f473019281	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2005, "url": "/egov-searcher/locality/noc-services/_get", "code": "null", "name": "Locality searcher endpoint for Noc Servcies", "path": "", "enabled": false, "displayName": "Noc locality searcher", "orderNumber": 0, "serviceCode": "egov-searcher"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
608c4390-28a6-405c-a9da-99269f0f5cd0	pg	4741cc08fb6e17aac8dd9b7d21f8daaf656e56fd756520bd67dda5f35a6d6344	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2004, "url": "quickAction", "name": "search NOC application", "path": "Noc.Search NOC Application", "enabled": false, "leftIcon": "communication:business", "tenantId": "pg", "createdBy": null, "rightIcon": "", "createdDate": null, "displayName": "Search NOC Application", "orderNumber": 1, "queryParams": "", "quickAction": false, "serviceCode": "", "parentModule": "", "navigationURL": "noc/search", "lastModifiedBy": null, "lastModifiedDate": null}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2a8ad7bd-7942-4027-887f-9b76e303381d	pg	7a996c3f381abcd68e5befdc2e90c2c90fc83d513df6e6fe899bef8aa1365cc0	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2003, "url": "/noc-services/v1/noc/_update", "code": "null", "name": "NOC Update", "path": "", "enabled": false, "displayName": "Update", "orderNumber": 0, "serviceCode": "NOC"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e78e51f9-5493-4471-b5cd-10e7acf53f78	pg	9325f16d80a37de13d1675a20f75eecedc9b8b40afef1dc9275e33502b89eda8	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2002, "url": "/noc-services/v1/noc/_search", "code": "null", "name": "NOC Search", "path": "", "enabled": false, "displayName": "Search", "orderNumber": 0, "serviceCode": "NOC"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9c45c0cd-1aff-4dbc-a86a-508e82acba18	pg	bfb73101aab1c7e8e7dca18c5771251c971347a63aaa55ec79d511dad47a2021	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2001, "url": "/noc-services/v1/noc/_create", "code": "null", "name": "NOC Create", "path": "", "enabled": false, "displayName": "Create", "orderNumber": 0, "serviceCode": "NOC"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0fc8a662-1646-4ce6-9b4b-72d0efd2cbfb	pg	f20831f23dbc05f2e199588c6c567e3762aec212a9de95bb08e69d10b4212d28	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 2000, "url": "/localization/messages/v2/_search", "code": "null", "name": "LocalizationMessagesSearch", "path": "", "enabled": false, "displayName": "Localization Messages Search", "orderNumber": 1, "serviceCode": "localisation search", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
4a5e3af0-8541-40ec-af37-3e4c9ed0eb3e	pg	afa53de83b0b9087a21a9a6be61ddc3fd189904668c6956d785603d310e5ad6a	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1990, "url": "/land-services/v1/land/_search", "code": "null", "name": "BPA-Land-Search", "path": "", "enabled": false, "displayName": "Land Search", "orderNumber": 0, "serviceCode": "BPA"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
92b5f6ce-3627-4e2a-b456-f0a847d6e566	pg	942993bdcc78e5f9d38b69c3f2044c143229122868135efc1e4bfcf0e14da033	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1989, "url": "/land-services/v1/land/_update", "code": "null", "name": "BPA-Land-Update", "path": "", "enabled": false, "displayName": "Land Update", "orderNumber": 0, "serviceCode": "BPA"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
55206cd1-cbbe-4c3a-8a84-bfc50232a788	pg	09a49349e773bbd2105e860dbf48869fbd7ee16f03c64c4f1585e486a9cb0a3f	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1988, "url": "/land-services/v1/land/_create", "code": "null", "name": "BPA-Land-Create", "path": "", "enabled": false, "displayName": "Land Create", "orderNumber": 0, "serviceCode": "BPA"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
008a647f-52c8-42ae-b095-252272bb9ae5	pg	107c4cffdbb4f6a42031f167b05f728431e8e1d641ce0e277dfc64475d87980f	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1999, "url": "/egov-pdf/download/PT/ptreceipt", "code": "null", "name": "ptreceipt search", "path": "", "enabled": false, "displayName": "ptreceipt search", "orderNumber": 9, "serviceCode": "egov-pdf"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
01b90aea-1c46-4ca9-9940-64a700545bda	pg	26e0554bb2b40c787674651f49bad1175f9c2c633204cfc253e3c52a3fdaacd3	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1998, "url": "/egov-pdf/download/PT/ptbill", "code": "null", "name": "ptbill search", "path": "", "enabled": false, "displayName": "ptbill search", "orderNumber": 8, "serviceCode": "egov-pdf"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8f5158a7-2dcc-4927-bd31-d67111268846	pg	263b64cdf8a86d4856abf6772040a7e273d59a00688bb780984f58058f0a46fe	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1997, "url": "/egov-pdf/download/PT/ptmutationcertificate", "code": "null", "name": "ptmutationcertificate search", "path": "", "enabled": false, "displayName": "ptmutationcertificate search", "orderNumber": 7, "serviceCode": "egov-pdf"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9693d385-98dd-42f3-a4d7-03e4e87833cd	pg	067b8048393b6356491d717d86d39955e550545e15540fbdd59a34491afda15e	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1996, "url": "/egov-pdf/download/TL/tlbill", "code": "null", "name": "tlbill search", "path": "", "enabled": false, "displayName": "tlbill search", "orderNumber": 6, "serviceCode": "egov-pdf"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
905ce33a-254b-4b4d-9a75-30020f14082c	pg	0505913c0826444facde8eeea9357e1662e40ad807d14d668e083ac985cfed6d	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1995, "url": "/egov-pdf/download/TL/tlrenewalcertificate", "code": "null", "name": "tlrenewalcertificate search", "path": "", "enabled": false, "displayName": "tlrenewalcertificate search", "orderNumber": 5, "serviceCode": "egov-pdf"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a2147713-aeae-40a1-b95c-5b550d285cb4	pg	3396c08d8af059c311555527c9f2dec2f5713a89ce5fb598708727542f863c46	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1994, "url": "/egov-pdf/download/TL/tlcertificate", "code": "null", "name": "tlcertificate search", "path": "", "enabled": false, "displayName": "tlcertificate search", "orderNumber": 4, "serviceCode": "egov-pdf"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9395769c-74fb-4e4e-ac16-6b2abd5f98f3	pg	e14f3b60123d5237931702c21189b389d5aae58b03104c48373ec9121853757e	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1993, "url": "/egov-pdf/download/TL/tlreceipt", "code": "null", "name": "tlreceipt search", "path": "", "enabled": false, "displayName": "tlreceipt search", "orderNumber": 3, "serviceCode": "egov-pdf"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6b116c44-d60c-4d38-9c30-2e4b074b5f46	pg	7ebc0a4fadda3ffaac8c7b6491441576c737b61ff746e8507ea7c587c105de43	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1992, "url": "/egov-pdf/download/BILL/consolidatedbill", "code": "null", "name": "consolidatedbill search", "path": "", "enabled": false, "displayName": "consolidatedbill search", "orderNumber": 2, "serviceCode": "egov-pdf"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
fd351f62-c33f-46cc-9507-9ded2510a312	pg	ab9c00bc8c774ceab12308526cac77567f622ff360abdad4db61ba8c9b05d144	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1991, "url": "/egov-pdf/download/PAYMENT/consolidatedreceipt", "code": "null", "name": "consolidatedreceipt search", "path": "", "enabled": false, "displayName": "consolidatedreceipt search", "orderNumber": 1, "serviceCode": "egov-pdf"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b703ba75-b82a-4352-aa16-f63f52af00de	pg	e7780c627f9d23454fad7511b2ddf3530f4f7a4fe538d980a40af62e06c88af1	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1985, "url": "/egov-searcher/locality/ws-services/_get", "code": "null", "name": "Locality searcher endpoint for WS", "path": "", "enabled": false, "displayName": "WS-Service locality searcher", "orderNumber": 0, "serviceCode": "egov-searcher"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2efb0027-dc48-4a8f-987b-61754881f197	pg	6eb7d6aef91f602ecfdc7eef12ebdec11c7a103105504104c45e6173275e6530	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1984, "url": "/egov-searcher/locality/sw-services/_get", "code": "null", "name": "Locality searcher endpoint for SW", "path": "", "enabled": false, "displayName": "SW-Service locality searcher", "orderNumber": 0, "serviceCode": "egov-searcher"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
752c08ce-82c8-4cea-accc-c7a25a517122	pg	9f146af2da7d2cd84703364a32429fe7dd2e697c5b3a57b76420ec4a399617f5	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1983, "url": "url", "code": "null", "name": "Remittance Pending Report", "path": "Finance.Reports.Revenue Reports.Remittance Pending Report", "enabled": false, "leftIcon": "editor:insert-chart", "displayName": "Remittance Pending Report", "orderNumber": 6, "serviceCode": "FinanceReport", "parentModule": "", "navigationURL": "services/EGF/report/remittance/pending/form"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a4f0630d-bcf4-49c3-8781-26855fcb6d24	pg	5ec49b4785bc460d261b6ae8243b09ec93cf7e3fe7bf5367857280bcb2d92c55	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1982, "url": "url", "code": "null", "name": "Dishonored Cheque Report ", "path": "Finance.Reports.MIS Reports.Dishonored Cheque Report", "enabled": false, "leftIcon": "editor:insert-chart", "displayName": "Dishonored Cheque Report ", "orderNumber": 7, "serviceCode": "FinanceReport", "parentModule": "", "navigationURL": "services/collection/report/dishonouredcheque/searchform"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2bd1d751-2ed2-43d2-9a3b-bd5c7291d405	pg	ec888fb5df5c36bbb5e62ac3281e0f65c375747b6ceb3025f4aa7099549eb068	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1981, "url": "url", "code": "null", "name": "Dishonor Cheque/DD", "path": "Finance.Administration.Dishonor Cheque/DD", "enabled": false, "leftIcon": "editor:insert-chart", "displayName": "Dishonor Cheque/DD", "orderNumber": 1, "serviceCode": "FinanceAdmin", "parentModule": "", "navigationURL": "services/collection/dishonour/cheque/form"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
42d41b67-11e5-4419-94cc-cc61515cf48b	pg	9f82520721b655c1af1293e23e25d01ccf88b276cf57f8ee6f51026c5196ae70	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1980, "url": "url", "code": "", "name": "rainmaker-localization-screen", "path": "Localization", "enabled": false, "leftIcon": "places:business-center", "rightIcon": "", "displayName": "Localization", "orderNumber": 5, "queryParams": "", "serviceCode": "", "parentModule": "", "navigationURL": "integration/ui-localisation/localization"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
369d4063-6ff0-4dcc-b9c4-6fd011ba08ce	pg	11883c487532c574a8e4926757e2b621f1190ac0b4bf44b9a0e5628e26bd7898	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1979, "url": "url", "code": "null", "name": "Remittance Collection Report", "path": "Finance.Reports.Revenue Reports.Remittance Collection Report", "enabled": false, "leftIcon": "editor:insert-chart", "displayName": "Remittance Collection Report", "orderNumber": 6, "serviceCode": "FinanceReport", "parentModule": "", "navigationURL": "services/EGF/report/remittance/collection/form"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
4c5fd8c4-c6ae-4f6c-9ef0-5210c02a71c2	pg	89ba6a7c9544b8f0dbdef9dd8aa85ee093739a471a3b9d29e040a781f7045971	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1978, "url": "/property-services/property/_migration", "code": "null", "name": "Migrate Property v1 to v2", "path": "", "enabled": false, "displayName": "Migrate Property v1 to v2", "orderNumber": 5, "serviceCode": "property-services"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6b66a5c4-23d0-43fa-b3bc-00e1ba22245f	pg	7e6c6979b900fc38b168c6d32cb79527767c7169a584a7426066a720caa59236	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1977, "url": "/dashboard-ingest/ingest/migrate/paymentsindex-v1/v2", "code": "null", "name": "Dashboard Payments-v1", "path": "", "enabled": false, "displayName": "DSS", "orderNumber": 0, "serviceCode": "DSS", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5fd4abb2-c445-480d-9837-49d5b64dcc9d	pg	50c8f964d01b8954ddf648f4c497162d7bf62a43df83230c6761926956ca0663	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1976, "url": "/egov-searcher/locality/BPAREG/_get", "code": "null", "name": "Locality searcher endpoint for BPA", "path": "", "enabled": false, "displayName": "BPA locality searcher", "orderNumber": 0, "serviceCode": "egov-searcher"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
55f0e7e0-50f7-48d8-a079-6437ee6c7e63	pg	ba5f68b3fe1d79179c93cb984a674980f8ab1d512e23fa95c78635e386322dc6	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1975, "url": "/egov-searcher/locality/bpa-services/_get", "code": "null", "name": "Locality searcher endpoint for BPA", "path": "", "enabled": false, "displayName": "BPA locality searcher", "orderNumber": 0, "serviceCode": "egov-searcher"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d242fb75-6c5c-43be-9dc5-ed11298d8efb	pg	0bc960e0cbe1d9877f8176abb71e13243e64169304608f566d1fed2b0254f4f1	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1972, "url": "/bpa-services/v1/bpa/_permitorderedcr", "code": "null", "name": "BPA-PermitOrderEDCR Report", "path": "", "enabled": false, "displayName": "Apply", "orderNumber": 0, "serviceCode": "BPA"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8dda6e03-f5ff-4bb7-ada7-5b06095d210d	pg	e0e68956c8af9dc87fea0560c559b54c360aa5099f2ce671d1dcc27bce2f5ed9	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1971, "url": "url", "code": "null", "name": "Reopening Closed Period", "path": "Finance.Period End Activities.Close Period", "enabled": false, "leftIcon": "editor:insert-chart", "displayName": "Reopening Closed Period", "orderNumber": 4, "serviceCode": "FinanceMaster", "parentModule": "", "navigationURL": "services/EGF/closedperiod/search/reopen"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
fa76889c-a9a1-41d7-a3a7-ccaf55f97ad5	pg	d4f91bc74b6d0c37512faa3561b20543054269117db43195953280ddf69aea76	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1970, "url": "/dashboard-ingest/ingest/paymentsindex-v1/v2", "code": "null", "name": "Dashboard Payments-v1", "path": "", "enabled": false, "displayName": "DSS", "orderNumber": 0, "serviceCode": "DSS", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
96a8d685-a31c-4802-8863-a93dd68e4639	pg	e144b449c8931281f342806bd4e2032dcb643ff4c40fe80e6f4554a9ce57f04e	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1969, "url": "/egov-searcher/locality/pt-services/_get", "code": "null", "name": "Locality searcher endpoint for PT Service", "path": "", "enabled": false, "displayName": "PT locality searcher", "orderNumber": 0, "serviceCode": "egov-searcher"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
3c7ed834-a5ae-407f-9d57-088e204756bc	pg	879326e1d0e483d425cf8069507c4b7ae39e9c6c03899cf09d3616aeafbeafac	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1968, "url": "/egov-searcher/locality/PT/_get", "code": "null", "name": "Locality searcher endpoint for PT", "path": "", "enabled": false, "displayName": "PT locality searcher", "orderNumber": 0, "serviceCode": "egov-searcher"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
fd86ec7a-0321-4942-9060-78d175c7cf26	pg	4404becdfb295e6e3c8d58513e034ad06a25678ea278f66fab1d36afda1acfdc	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1965, "url": "/dashboard-ingest/update/publish", "code": "null", "name": "Dashboard Api W&S to update", "path": "", "enabled": false, "displayName": "DSS", "orderNumber": 0, "serviceCode": "DSS", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
cabcccc1-42ee-4649-8876-5bd12ee09601	pg	aff148a55b2e3d5fc086ac84dabf90d5351bd9f2df3fd75f1f218e8be79786ca	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1964, "url": "/dashboard-ingest/ingest/upload", "code": "null", "name": "Dashboard Static Upload", "path": "", "enabled": false, "displayName": "DSS", "orderNumber": 0, "serviceCode": "DSS", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
cc97e972-ff99-41f4-ac79-0d6dc7908d53	pg	f8b97705c03ad54ce8621e9e4460a6f90f4e23ab8b16a503dd53dcf260796133	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1963, "url": "/dashboard-ingest/ingest/migrate/collectionsindex-v1/v1", "code": "null", "name": "Dashboard collectionsindex-v1", "path": "", "enabled": false, "displayName": "DSS", "orderNumber": 0, "serviceCode": "DSS", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d846be73-6700-4c06-bc5a-6c7824d79470	pg	d1ba7c26fc75e25563dd37da68701c409c11cad1a343be4ba6d742e5f1ab4a97	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1967, "url": "/sw-calculator/sewerageCalculator/_estimate", "code": "null", "name": "Calculate Fee For Sewerage Application", "path": "", "enabled": false, "displayName": "Fee Calculation For Sewerage Application", "orderNumber": 0, "serviceCode": "sw-calculator"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
34ff7c0a-606c-40f2-9d4a-cc185e203661	pg	cc08b5937bc638db7380cd77d2cb98a7c0d54833c069504520559c0a5ff24ae4	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1966, "url": "/ws-calculator/waterCalculator/_estimate", "code": "null", "name": "Calculate Fee For Water Application", "path": "", "enabled": false, "displayName": "Fee Calculation For Water Application", "orderNumber": 0, "serviceCode": "ws-calculator"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f961ad5b-7d2e-4d40-9710-be21a3d2dc8d	pg	e6caedcaf853a3c1d4930e7c18396670db753e27dca90db3ca506557372a6704	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1961, "url": "/egov-searcher/bill-genie/seweragebills/_get", "code": "null", "name": "Search Sewerage Bill", "path": "", "enabled": false, "displayName": "Search Sewerage Bill", "orderNumber": 2, "serviceCode": "Searcher"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
798beaf6-1511-425b-8e92-af67e5dd00b7	pg	680bfbc7e508754d15af02a4e269d413c31877cd7074ed669de64f8b1d96f02c	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1960, "url": "/egov-searcher/bill-genie/waterbills/_get", "code": "null", "name": "Search Water Bill", "path": "", "enabled": false, "displayName": "Search Water Bill", "orderNumber": 1, "serviceCode": "Searcher"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
85e8a795-99d0-47cb-ad7f-04cc61e4d34e	pg	d515c2ad87ab7ea1906095007820de8f94047b79d7e4521a9520a1f4379dc122	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1959, "url": "url", "code": "null", "name": "Surrendered Cheque", "path": "Finance.Reports.MIS Reports.Surrendered Cheque", "enabled": false, "leftIcon": "editor:insert-chart", "displayName": "Surrendered Cheque", "orderNumber": 6, "serviceCode": "FinanceReport", "parentModule": "", "navigationURL": "services/EGF/report/cheque/surrendered/form"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
474bcefb-089e-475f-9e3c-282ff92c16dc	pg	0b64afb8da01c2461b8789c91c4042bc63b39ae65dbf9c9bf5b9d2c067ec92da	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1958, "url": "card", "code": "", "name": "rainmaker-common-wns", "path": "", "enabled": false, "leftIcon": "places:business-center", "rightIcon": "", "displayName": "SURE Dashboard", "orderNumber": 2, "queryParams": "", "serviceCode": "integration", "parentModule": "", "navigationURL": "integration/dss/home"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5631133a-1c9f-4dd9-a68b-e0627aec1ed7	pg	3d555802754448a3de0864749845fa963ae9b4c0a5fb37b530347a3a84f409f6	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1956, "url": "/pt-calculator-v2/billingslab/mutation/_update", "code": "null", "name": "MutationBillingSlabUpdate", "path": "", "enabled": false, "displayName": "Mutation Billing Slab Update", "orderNumber": 1, "serviceCode": "pt-calculator-v2", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
461f28cc-44f2-4bdc-90c9-9b20731291c5	pg	2219641ead956d537b4f34690a5e82722ceefebd7b6824c7526bad7ce58c00b4	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1955, "url": "/pt-calculator-v2/billingslab/mutation/_search", "code": "null", "name": "MutationBillingSlabSearch", "path": "", "enabled": false, "displayName": "Draft Search", "orderNumber": 1, "serviceCode": "pt-calculator-v2", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
549d42d5-37ab-48ba-9456-d799581b0dbd	pg	9588b0da6767a59cdfc63d7d4e9dc3d1295207bbc32938913a5d74c1d3c5a7f4	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1954, "url": "/pt-calculator-v2/billingslab/mutation/_create", "code": "null", "name": "MutationBillingSlabCreate", "path": "", "enabled": false, "displayName": "Draft Search", "orderNumber": 1, "serviceCode": "pt-calculator-v2", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
aea5104f-8f5c-4a18-a975-b4718c0f871c	pg	bfafa4145b0897b0d79821d3bc1b0a7c15384981538969814e601c1d38140696	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1950, "url": "quickAction", "name": "search BPA application", "path": "Building Plan Approval.Search Application", "enabled": false, "leftIcon": "communication:business", "tenantId": "pg", "createdBy": null, "rightIcon": "", "createdDate": null, "displayName": "Search Application", "orderNumber": 1, "queryParams": "", "quickAction": false, "serviceCode": "", "parentModule": "", "navigationURL": "egov-bpa/search", "lastModifiedBy": null, "lastModifiedDate": null}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
edf18d67-2907-4a92-bc26-8ff215b4a15d	pg	0372f3a4b5288fffad59bb6c2997ba9631c71abaa2cbdc0f4b71e79f4f106e5e	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1949, "url": "url", "code": "null", "name": "Dashboard Overview", "path": "Dashboard.Overview", "enabled": false, "leftIcon": "places:business-center", "rightIcon": "", "displayName": "Overview", "orderNumber": 3, "serviceCode": "DSS", "parentModule": "dss-dashboard", "navigationURL": "integration/dss/overview"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2fd250d1-8857-4051-81c0-59569add468d	pg	84e1804d3687190b32c020278c7a8284d8aaca23e8a6ca94671fb39b927b9658	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1948, "url": "/dashboard-analytics/dashboard/getDashboardConfig/overview", "code": "null", "name": "DSS Dashboard Config Overview", "path": "", "enabled": false, "displayName": "DSS", "orderNumber": 0, "serviceCode": "DSS", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
082505a9-173c-4448-87cc-5cae594055a3	pg	e53144c1b9477037ff513cf735750a009856d899d0a76b94554442c117297963	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1947, "url": "card", "code": "", "name": "rainmaker-citizen-edcrscrutiny", "path": "", "enabled": false, "leftIcon": "custom:edcr", "rightIcon": "", "displayName": "eDCR Scrutiny", "orderNumber": 1, "queryParams": "", "serviceCode": "", "parentModule": "", "navigationURL": "edcrscrutiny/home"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
646aeb09-dd38-4468-ba32-232d8a88d611	pg	96bafbed1a33670ac21089862c7d11cbe3540a0dc6abe95be0fa275f1eaecbf9	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1944, "url": "/property-services/assessment/_update", "code": "null", "name": "Update Assessment registry", "path": "", "enabled": false, "displayName": "Update Assessment Registry", "orderNumber": 1, "serviceCode": "property-services"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
efa06e13-a638-4709-a019-c4af9299492f	pg	d20d2fbd70e312afe0dcfbeea1a564d16a301b9e1c97b72b6584741d14be588d	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1943, "url": "/property-services/assessment/_create", "code": "null", "name": "Create Assessment registry", "path": "", "enabled": false, "displayName": "Create Assessment Registry", "orderNumber": 1, "serviceCode": "property-services"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ee93bdff-bca4-4dc2-b4a1-ae0352cd8dff	pg	6bd9b17aee1ff29763835efab3e42e8cd1b1135386b0166bf20e83befe2a5e9d	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1923, "url": "url", "code": "null", "name": "Dashboard PGR", "path": "Dashboard.PGR", "enabled": false, "leftIcon": "places:business-center", "rightIcon": "", "displayName": "PGR", "orderNumber": 6, "serviceCode": "DSS", "parentModule": "dss-dashboard", "navigationURL": "integration/dss/pgr"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f9c532b1-abf0-4f78-9e12-3f153d19a708	pg	a24f7136fafbdbea75536a9264406a4da063c1de6fe73e524f6bdd2d92f1c2bc	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1942, "url": "/egov-searcher/locality/BPAREG/_get", "code": "null", "name": "Locality searcher endpoint for BPA Reg", "path": "", "enabled": false, "displayName": "BPA locality searcher", "orderNumber": 0, "serviceCode": "egov-searcher"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
29919993-33b1-4f84-9d33-372c661b66ec	pg	89bbb9887612ff4cb4cc95d74d9fa4e0ae9a82602b0859ce604ea749fc9f254c	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1941, "url": "/sw-calculator/sewerageCalculator/_calculate", "code": "null", "name": "Sewerage Calculation", "path": "", "enabled": false, "displayName": "Sewerage Calculation", "orderNumber": 0, "serviceCode": "sw-calculator"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0a1b778d-4251-49b7-a5af-70b9acec18a6	pg	aab55ff105a51ac24c2803d123167cb576f9a195848f9dcf1f521c6a14ad18f5	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1940, "url": "/sw-services/swc/_search", "code": "null", "name": "Search Sewerage Connection", "path": "", "enabled": false, "displayName": "Search Sewerage Connection", "orderNumber": 0, "serviceCode": "sw-services"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1bc81e54-5610-4a39-a029-5d73ae4ec048	pg	f57c20cd56436db45c5b00a3159afff499ae52fcc137002ecd727533c2ed8820	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1939, "url": "/sw-services/swc/_update", "code": "null", "name": "Update Sewerage Connection", "path": "", "enabled": false, "displayName": "Update Sewerage Connection", "orderNumber": 0, "serviceCode": "sw-services"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ab7d88aa-3728-4fb4-b3c9-794bfaf43fa1	pg	4a50f7b69482f4c3b34db00f23f25ab1adbf5701a54b4ad2a1d2495a17269584	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1938, "url": "/sw-services/swc/_create", "code": "null", "name": "Create Sewerage Connection", "path": "", "enabled": false, "displayName": "Create Sewerage Connection", "orderNumber": 0, "serviceCode": "sw-services"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f4c75707-76dc-4110-8a51-aeac54749da7	pg	e28db5fa684a6e354617fdc64538d58377d156e18ba490d94561a5dba790dfbb	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1937, "url": "/ws-calculator/waterCalculator/_calculate", "code": "null", "name": "Calculate Water Bill", "path": "", "enabled": false, "displayName": "Calculate Water Bill", "orderNumber": 0, "serviceCode": "ws-calculator"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
65cb3139-64d2-491d-894f-1e6cd6b7b592	pg	928fff950997bf8013bc49f7ef20fb5d4dfe89755ca7b9999725a0f91934112d	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1936, "url": "/ws-calculator/meterConnection/_search", "code": "null", "name": "Search Meter Reading", "path": "", "enabled": false, "displayName": "Search Meter Reading", "orderNumber": 0, "serviceCode": "ws-calculator"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ccc4301d-f6b8-411f-93a3-dbebadc17336	pg	85ea2a5f6762400fbc87bdbc8e7b0f71f999fd645a03c8bf5910fe9d933449b1	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1935, "url": "/ws-calculator/meterConnection/_create", "code": "null", "name": "Enter Meter Reading", "path": "", "enabled": false, "displayName": "Enter Meter Reading", "orderNumber": 0, "serviceCode": "ws-calculator"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b7ccf439-1c9c-42f8-b13e-2dae0c50428a	pg	86e20e7278924ba42975315a8dbe53907a92d8acbd4a87bc659177c2cc5b95c4	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1901, "url": "/ws-services/wc/_update", "code": "null", "name": "Update Water Connection", "path": "", "enabled": false, "displayName": "Update Water COnnection", "orderNumber": 0, "serviceCode": "ws-services"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8b9b011d-bb14-4400-ad16-1b6367c307a9	pg	7fd5f1a51609443b93466f989b6595505308ecc499ad0158f0027d295cc40fee	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1900, "url": "/ws-services/wc/_search", "code": "null", "name": "Search Water Connection", "path": "", "enabled": false, "displayName": "Search Water COnnection", "orderNumber": 0, "serviceCode": "ws-services"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
061acf73-4fdb-4c12-84dc-c2cb9fc5c0db	pg	f13dfb48c36bfa00ede176ad64a2484e8016d2308e419b30bc0d757537ad20ad	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1899, "url": "/ws-services/wc/_create", "code": "null", "name": "Create Water Connection", "path": "", "enabled": false, "displayName": "Create Water COnnection", "orderNumber": 0, "serviceCode": "ws-services"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
61ba68b6-f880-4866-813f-a514421b3161	pg	ddedb9bfa4b36da260f12d240534e3d95c961ef1be9432fa3b0126d596dc49ec	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1934, "url": "/egov-searcher/locality/fireNoc/_get", "code": "null", "name": "Locality searcher endpoint for PT", "path": "", "enabled": false, "displayName": "FIRENOC locality searcher", "orderNumber": 0, "serviceCode": "egov-searcher"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ab5285ef-1b2e-4689-98d4-5f628616acc6	pg	a035f31ae449de1759d88ab2eaf1ca0f4f7337f51ab76b02b23dc89df868e59f	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1933, "url": "/egov-searcher/locality/tl-services/_get", "code": "null", "name": "Locality searcher endpoint for TL", "path": "", "enabled": false, "displayName": "TL locality searcher", "orderNumber": 0, "serviceCode": "egov-searcher"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
c9821f41-819f-41d3-8515-da28b82b97cf	pg	076484c72c59b2b0eed70dc10efa5f7892d3e2542c6be6c5c0f02e3b857519ad	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1932, "url": "quickAction", "code": "null", "name": "FIRE-NOC", "path": "FIRE-NOC.Search", "enabled": false, "leftIcon": "social:people", "displayName": "Search Fire Noc", "orderNumber": 3, "serviceCode": "FIRE-NOC", "parentModule": "", "navigationURL": "fire-noc/search"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
aa0bde22-5d27-4a7f-bba1-d0210527a44f	pg	2e0be3469a06892cce1993e65b40d77935181c52ed172197c41f3578715a82b0	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1929, "url": "quickAction", "code": "null", "name": "TradeLicenseApplication", "path": "TradeLicense.Apply", "enabled": false, "leftIcon": "places:business-center", "displayName": "Apply TL", "orderNumber": 13, "serviceCode": "TradeLicense", "parentModule": "", "navigationURL": "/digit-ui/employee/tl/new-application"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d945b5d5-952d-4575-844b-379aaec07c09	pg	9750dae737866b66b02568e1151f2a8ba83da588f4614e6b679b1458c3e3a4b3	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1928, "url": "quickAction", "code": "", "name": "rainmaker-common-tradelicence", "path": "", "enabled": false, "leftIcon": "places:business-center", "rightIcon": "", "displayName": "Search TL", "orderNumber": 2, "queryParams": "", "serviceCode": "", "parentModule": "", "navigationURL": "/digit-ui/employee/tl/inbox"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5262530c-4338-40b3-84b9-a237678d6aa7	pg	e638e96367b684e96357934bcf87b745e19d07be78a1f93e736d47953a5d7f10	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1927, "url": "quickAction", "code": "", "name": "rainmaker-common-complaints", "path": "", "enabled": false, "leftIcon": "action:announcement", "rightIcon": "", "displayName": "Search Complaints", "orderNumber": 2, "queryParams": "", "serviceCode": "", "parentModule": "", "navigationURL": "/digit-ui/employee/pgr/inbox"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5949fae1-6ec7-4db9-ab8c-6df839cbed2b	pg	00a1070252bf8698c8ba093f1076cf242b9e39ae32df2333c4539681bfd20cac	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1926, "url": "quickAction", "name": "Assess And Search Properties", "path": "Property Tax.Assess And Search Properties", "enabled": false, "leftIcon": "communication:business", "tenantId": "pg", "createdBy": null, "rightIcon": "", "createdDate": null, "displayName": "Search Property", "orderNumber": 1, "queryParams": "", "quickAction": false, "serviceCode": "", "parentModule": "", "navigationURL": "/digit-ui/employee/pt/inbox", "lastModifiedBy": null, "lastModifiedDate": null}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e1215c3e-97d3-4ba6-8005-603c23398079	pg	c427ad33fe031b38b6217440b7013e76e92bb6f512c6f82137b0b8eec9d42464	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1925, "url": "quickAction", "code": "null", "name": "CreateComplaint", "path": "Complaints.CreateComplaint", "enabled": false, "leftIcon": "content:add", "rightIcon": "", "displayName": "File Complaint", "orderNumber": 1, "quickAction": false, "serviceCode": "PGR", "parentModule": "rainmaker-pgr", "navigationURL": "/digit-ui/employee/pgr/complaint/create"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
4a04893e-f93b-4ea7-a111-148af47c8dcb	pg	4c9ae4fcfc9a59ff114358bdcc5e252bcf2b05276e7865a992365474abba88d8	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1872, "url": "/pdf-service/v1/_createnosave", "code": "null", "name": "Pdf Generator createnosave", "path": "", "enabled": false, "displayName": "Pdf Generator createnosave", "orderNumber": 3, "serviceCode": "pdf-generator-createnosave"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
09dbb2aa-90eb-40fb-82a6-e00bcfe34a73	pg	51558f2500a39b6c2d3c48cec25189f60c7fa4903dfd33ddd42f7172a9e898f4	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1835, "url": "/pdf-service/v1/_search", "code": "null", "name": "Pdf Generator search", "path": "", "enabled": false, "displayName": "Pdf Generator search", "orderNumber": 2, "serviceCode": "pdf-generator-search"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
77909aec-b18d-4cb4-b2b8-2b37ed0ef6b5	pg	b50bd96bdc8551f78f41b018919634f5fc587f7cf878a4b92aa8a3ba6019c5f0	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1834, "url": "/pdf-service/v1/_create", "code": "null", "name": "Pdf Generator create", "path": "", "enabled": false, "displayName": "Pdf Generator create", "orderNumber": 1, "serviceCode": "pdf-generator-create"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
45ee2760-2d10-4df7-a7e5-89c105852ab4	pg	f93ff574f38062371bb6d0d211e9f7023f9117de992e59d5cbb8282ae3bc6099	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1814, "url": "card", "code": "", "name": "rainmaker-citizen-complaints", "path": "", "enabled": false, "leftIcon": "custom:account-alert", "rightIcon": "", "displayName": "Complaints", "orderNumber": 2, "queryParams": "", "serviceCode": "", "parentModule": "", "navigationURL": "/digit-ui/citizen"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
39dd18ed-4eac-4256-abda-f3a6cf4a9af1	pg	43e11f69711a115dbaa41f8e5d0d957633b164e3d370e9368f3203e76e82f928	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1807, "url": "url", "code": "null", "name": "TradeLicense", "path": "TradeLicense", "enabled": false, "leftIcon": "places:business-center", "rightIcon": "", "displayName": "Trade License", "orderNumber": 13, "serviceCode": "TradeLicense", "parentModule": "", "navigationURL": "/digit-ui/citizen/"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
51274911-6d5a-4d78-9017-d85a03e0b4da	pg	7d97ee8bc37b98dfff5c89b5716c8f2dd9b83d06fb5e8c7e37b291023855a5ea	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2559, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
bcd0c26c-b76d-4545-9315-1ebcdf16c760	pg	fc8a9261219d08fe915a3f8c523a4361f7c1fe98efef3b9a7a45ea75dea59cad	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1806, "url": "url", "name": "PropertyTax", "path": "Property Tax", "enabled": false, "leftIcon": "communication:business", "rightIcon": "", "displayName": "Property Tax", "orderNumber": 1, "queryParams": "", "serviceCode": "", "parentModule": "", "navigationURL": "/digit-ui/citizen"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f9abcdda-e569-40ff-baa4-039b7ca67020	pg	76c73b9ca31a557ea266b0642bbbf7e125c42ffa7d57c7b22d81eb57fe74ae0a	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1805, "url": "url", "code": "null", "name": "Complaints", "path": "Complaints", "enabled": false, "leftIcon": "custom:account-alert", "rightIcon": "", "displayName": "Complaints", "orderNumber": 1, "serviceCode": "PGR", "parentModule": "rainmaker-pgr", "navigationURL": "/digit-ui/citizen/pgr/complaints"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1fd2fd64-e04d-44c0-bcd6-a8abf165343a	pg	bac1ca68c5793b62db8af146989dc134a6d30181da8a23fd7bd699a88360dc23	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1779, "url": "card", "code": "", "name": "rainmaker-common-hrms", "path": "", "enabled": false, "leftIcon": "social:people", "rightIcon": "", "displayName": "HRMS", "orderNumber": 2, "queryParams": "", "serviceCode": "", "parentModule": "", "navigationURL": "/digit-ui/employee/hrms/inbox"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
bca70bc6-3cca-47b6-aaa9-c0c2f80c21c5	pg	b1539da723f76528c31df4fd966d45218a68680e3a916a9e80ea4c50cb680a67	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1775, "url": "card", "code": "", "name": "rainmaker-common-complaints", "path": "", "enabled": false, "leftIcon": "action:announcement", "rightIcon": "", "displayName": "Complaints", "orderNumber": 2, "queryParams": "", "serviceCode": "", "parentModule": "", "navigationURL": "/digit-ui/employee/pgr/inbox"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
eb570d03-9dc1-4aef-8733-e9f69b31cb56	pg	aed62017f4e65e8677392faeb6a62542c5e1c0394642d7d6efcfbdbe419fde45	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1773, "url": "url", "code": "null", "name": "HRMS", "path": "HRMS.Search", "enabled": false, "leftIcon": "social:people", "displayName": "Search Employee", "orderNumber": 2, "serviceCode": "HRMS", "parentModule": "", "navigationURL": "/digit-ui/employee/hrms/inbox"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
41660bd7-286b-4db5-bd44-327eb83fe0ef	pg	478149fe1f72839f4468fa75b44f59793d5bcf7ef579352a0a8c9267989e9d99	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1752, "url": "/egov-hrms/employees/_search", "code": "null", "name": "Employee Search", "path": "", "enabled": false, "displayName": "Employee Search", "orderNumber": 0, "serviceCode": "egov-hrms", "parentModule": "egov-hrms"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
41447ea8-1ae5-4249-b285-ef8b6be70051	pg	e8e63b67bf0d590aa7e563748bbf339868ee479bdd928a967f1d07a843d16ce3	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1751, "url": "/egov-hrms/employees/_update", "code": "null", "name": "Employee Update", "path": "", "enabled": false, "displayName": "Employee Update", "orderNumber": 0, "serviceCode": "egov-hrms", "parentModule": "egov-hrms"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6cbc21f3-1113-4fb8-91b1-a5a4a7f0500a	pg	367070852414759806765e31ee8abe4d177c73bb6b3488fb3de301597c005425	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1750, "url": "/egov-hrms/employees/_create", "code": "null", "name": "Employee Create", "path": "", "enabled": false, "displayName": "Employee Create", "orderNumber": 0, "serviceCode": "egov-hrms", "parentModule": "egov-hrms"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
224db3b7-1dc9-4e24-97d9-98b7d1b3dc1c	pg	b7daf2e7198dd244e3fbcb49b14a7ffa0531459855fb004be567d2ee4f967b3f	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1743, "url": "/egov-workflow-v2/egov-wf/businessservice/_search", "code": "null", "name": "BusinessService Search", "path": "", "enabled": false, "displayName": "BusinessService Search", "orderNumber": 0, "serviceCode": "egov-workflow-v2", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
592e864c-b0ea-40c9-a583-8b15d68109f0	pg	19184b5fee65d6e2814db761e9b4c39b3a8ef0cb9ffbe880c7da72ec066e1fac	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1742, "url": "/egov-workflow-v2/egov-wf/businessservice/_update", "code": "null", "name": "BusinessService Update", "path": "", "enabled": false, "displayName": "BusinessService Update", "orderNumber": 0, "serviceCode": "egov-workflow-v2", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
297f1b8b-aac0-44f9-904c-98b4052c2e48	pg	8c36703bc48164eea4ca018c96a9540f12592f1c7773b234421daea548f3e67a	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1741, "url": "/egov-workflow-v2/egov-wf/businessservice/_create", "code": "null", "name": "BusinessService Create", "path": "", "enabled": false, "displayName": "BusinessService Create", "orderNumber": 0, "serviceCode": "egov-workflow-v2", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
c109f8a7-2953-4148-b5d8-03c646bc3044	pg	7df56f709ccdcc6d89011f62b5ad655ea15ae5ef4bdc14dd0e1b90611d65b0a5	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1734, "url": "/localization/messages/v1/_upsert", "code": "null", "name": "LocalizationMessagesUpsert", "path": "", "enabled": false, "displayName": "Localization Messages Upsert", "orderNumber": 1, "serviceCode": "filestore url", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9a0272b5-0fc4-4e6d-8b8b-f463adc9e343	pg	33b23b707006638dbda4fc0e44e076ac8057627888b29f892bef8a1920fcace1	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1730, "url": "/egov-workflow-v2/egov-wf/process/_search", "code": "null", "name": "Workflow search", "path": "", "enabled": false, "displayName": "Workflow search", "orderNumber": 0, "serviceCode": "egov-workflow-v2", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7628e255-a5e3-4db3-bab1-c7edec9a3cbc	pg	a7f4d52ce5f6d4bc89ceb84ac53594fe827f17f7b0948e0ea52e0787363652f7	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1729, "url": "/egov-workflow-v2/egov-wf/process/_transition", "code": "null", "name": "Workflow transition", "path": "", "enabled": false, "displayName": "Workflow transition", "orderNumber": 0, "serviceCode": "egov-workflow-v2", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
78f06d6a-4eb2-4bd1-a4cb-65f3e5854e90	pg	803bcb3e6f1d2d77607b8b5a2c4312cfc3f14aa5f74a5cfbd6a0ca1b33dff893	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1700, "url": "/user/users/_updatenovalidate", "code": "null", "name": "updateUsernovalidate", "path": "", "enabled": false, "displayName": "Update User novalidate", "orderNumber": 1, "serviceCode": "ADMIN"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9e86fb9d-5b5a-4e00-9cca-5ff63bbbff1d	pg	1ff7a44227126d63f175d3d3477ef270bbae8c94d859430a47922f2988fb90e2	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2561, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
eb77fb21-8f99-4390-8fa5-ec9afed35a4b	pg	73cef288fe632bbf9ca116b6f0dad7d6ef00c88727642b48b9d08a80b3ce5715	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1690, "url": "url", "code": "null", "name": "TradeLicenseSearch", "path": "TradeLicense.Search", "enabled": false, "leftIcon": "places:business-center", "displayName": "Search", "orderNumber": 13, "serviceCode": "TradeLicense", "parentModule": "", "navigationURL": "/digit-ui/employee/tl/inbox"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
45c83631-cb11-4826-bf7b-66926b8b1910	pg	f34eca3eac5ef928803da61e2889d8286d4e46cae3e497e30aef63ee81883d57	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1678, "url": "/egov-common-masters/businessDetails/_create", "code": "null", "name": "businessDetails create", "path": "", "enabled": false, "displayName": "", "orderNumber": 0, "serviceCode": "Collections", "parentModule": "", "navigationURL": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9fc76a6a-20c3-4697-b9be-e2cc3b092f6f	pg	5251c27b91bcb05105a0a6cab80b6384649ec53b6fc6184ac7006310f05aa513	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1677, "url": "/egov-common-masters/businessCategory/_create", "code": "null", "name": "business category create", "path": "", "enabled": false, "displayName": "business category search", "orderNumber": 0, "serviceCode": "Collections", "parentModule": "", "navigationURL": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
75c8e23b-5d31-419f-bb05-50ecaea1da2d	pg	b1d5f336668d105e98eea4b35c9ec5c4ab012e48350c78d64484b8a9d43b4197	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1676, "url": "/egov-common-masters/businessDetails/_search", "code": "null", "name": "businessDetails search", "path": "", "enabled": false, "displayName": "", "orderNumber": 0, "serviceCode": "Collections", "parentModule": "", "navigationURL": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2db9d03a-3b13-48c7-aaed-e90ae986ae7b	pg	4b01bef3104280e7be499b73f07dee47255e1a62b79eda85b46e1cdccd3c943b	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1675, "url": "/egov-common-masters/businessCategory/_search", "code": "null", "name": "business category search", "path": "", "enabled": false, "displayName": "business category search", "orderNumber": 0, "serviceCode": "Collections", "parentModule": "", "navigationURL": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f5e564f3-f627-4c55-a029-6192122f34f7	pg	fb974b22c23412d835c794068df2f48abedb3b99dc147b988f18fcc568f6a814	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1577, "url": "url", "name": "Assess New Property", "path": "Property Tax.Assess New Property", "enabled": false, "leftIcon": "communication:business", "tenantId": "pg", "createdBy": null, "rightIcon": "", "createdDate": null, "displayName": "Assess New Property", "orderNumber": 1, "queryParams": "", "serviceCode": "", "parentModule": "", "navigationURL": "/digit-ui/employee/pt/inbox", "lastModifiedBy": null, "lastModifiedDate": null}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2982b26e-805b-4884-a7a0-9cfe7300fb3d	pg	fb001baaef647a3e75bea9e4e2c79efca3b039962b2737bfa9171a0e1a0c2a31	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1559, "url": "url", "code": "null", "name": "CreateComplaint", "path": "Complaints.CreateComplaint", "enabled": false, "leftIcon": "content:add", "rightIcon": "", "displayName": "Create Complaint", "orderNumber": 1, "serviceCode": "PGR", "parentModule": "rainmaker-pgr", "navigationURL": "/digit-ui/employee/pgr/complaint/create"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a5db3d89-365b-49e9-9135-b0b20136b8a2	pg	7fd1246cff376ca86080561c10d4b31a24c48e07f634628d71415d8d0f1bedae	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1557, "url": "url", "code": "null", "name": "OpenComplaints", "path": "Complaints.MyComplaints", "enabled": false, "leftIcon": "action:announcement", "rightIcon": "", "displayName": "Open Complaints", "orderNumber": 1, "serviceCode": "PGR", "parentModule": "rainmaker-pgr", "navigationURL": "/digit-ui/employee/pgr/inbox"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6a4bf9fc-cc57-435e-8145-ba8ff2bcdc9c	pg	effb4f795d2bc1732d6800c3c62f9c5fe0b6b84f42d8475d560e9fe8286b0765	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1556, "url": "url", "code": "null", "name": "Home", "path": "Home", "enabled": true, "leftIcon": "action:home", "rightIcon": "", "displayName": "Home", "orderNumber": 1, "serviceCode": "PGR", "parentModule": "rainmaker-pgr", "navigationURL": "/digit-ui/employee"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
44ce28d9-841e-468e-9ea7-bb10926bf035	pg	a0cba32aacca0fdec66a1f78e55678741397b3d0261c29f686f5e634f55aba36	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1531, "url": "/localization/messages/v1/_search", "code": "null", "name": "LocalizationMessagesSearch", "path": "", "enabled": false, "displayName": "Localization Messages Search", "orderNumber": 1, "serviceCode": "filestore url", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0c1b564c-556d-4692-a8bb-35eb868ec87f	pg	be9537a5361d0e9fb2fe532d15f3f7d5640eb62f5316172e9e45127bc03277ce	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1530, "url": "/localization/messages/v1/_update", "code": "null", "name": "LocalizationMessagesUpdate", "path": "", "enabled": false, "displayName": "Localization Messages Update", "orderNumber": 1, "serviceCode": "filestore url", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
92b56f4a-e8f1-4740-a86a-56811afec17a	pg	bb83a87e9eb54ef6570e0204291eefb720b2e62ed70211f37375b8e776846016	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1529, "url": "/localization/messages/v1/_create", "code": "null", "name": "LocalizationMessagesCreate", "path": "", "enabled": false, "displayName": "Localization Messages Create", "orderNumber": 1, "serviceCode": "filestore url", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
15e1d863-ca95-4f22-ae29-d064aa85f549	pg	af8215a2d394aa4fe8efabcb12a77e70df718dae3e84bb36f9291e6fba586db6	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1528, "url": "/filestore/v1/files/url", "code": "null", "name": "FilestoreUrl", "path": "", "enabled": false, "displayName": "Filestore Url", "orderNumber": 1, "serviceCode": "filestore url", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a318c0d0-ab3b-40a4-9770-edbd3115ed70	pg	d4fb55d1b433c3920c54adbeaa2450b356d40cb5bb3651fdaf41008534c2f2a8	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1523, "url": "/egov-location/location/v11/tenant/_search", "code": "null", "name": "Resolve Tenant from Lat/Lng", "path": "Location.Search Tenant Resolve", "enabled": false, "displayName": "Tenant Search", "orderNumber": 0, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f7d726bc-efa7-453b-b0a5-c6ab69240bcf	pg	4bf0a26064276c9693f000fa2cbe1aefdb0a3359a3b135499f73f6b55c8c9361	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1522, "url": "/egov-location/location/v11/geography/_search", "code": "null", "name": "Get GeoJSON and other geographical data of requested tenant", "path": "Location.Search Geography GeoJSON", "enabled": false, "displayName": "Geographical Search", "orderNumber": 0, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
745d4e3a-eedb-4a2c-8fb2-7682fb2c9af1	pg	b28d49859ed91a126b650ee453e85363ebd2cbec3af1c106ec5069bbdece6b35	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1519, "url": "/filestore/v1/files/metadata", "code": "null", "name": "Uploaded File MetaData", "path": "", "enabled": false, "displayName": "Uploaded File MetaData", "orderNumber": 1, "queryParams": null, "serviceCode": "FILE_METADATA", "parentModule": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
c5b77138-bc98-4429-acba-bdee36057773	pg	4cd0675c09cd9593e8bc69a6c18a66af31aa8e83edf2a25ded80a0edd56f3418	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1429, "url": "/egov-location/location/v11/boundarys/_search", "code": "null", "name": "Search Boundaries With Mdms", "path": "Location.Search Boundary", "enabled": false, "displayName": "Boundaries Mdms Search", "orderNumber": 3, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
511ffa58-a231-4a7c-890d-8e0e57003d79	pg	9b55fd5c0aea30eb0a01e82a614623e6357c9da020449c29a002110e0f656326	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 797, "url": "/egov-common-masters/departments/v1/_search", "code": "null", "name": "View Department", "path": "Administration.Department.View Department", "enabled": true, "displayName": "View Department", "orderNumber": 3, "serviceCode": "DEPT", "parentModule": "273"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
05864a09-7937-43b0-8067-eb9e9d253d69	pg	ed423e1bb930ea262f88a9496a3ee48315571c49fb9a74e841a458ca59b74fdc	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 796, "url": "/egov-common-masters/departments/v1/_search", "code": "null", "name": "Modify Department", "path": "Administration.Department.Modify Department", "enabled": true, "displayName": "Modify Department", "orderNumber": 2, "serviceCode": "DEPT", "parentModule": "273"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ee1f9507-4ae8-4f7d-bcff-fbdd18faba89	pg	62d4deaa5381475cdf958c9d8838a203df60ce60e3e5b78c8a2d34a128916020	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 795, "url": "/egov-common-masters/departments/v1/_create", "code": "null", "name": "Create Department", "path": "Administration.Department.Create Department", "enabled": true, "displayName": "Create Department", "orderNumber": 1, "serviceCode": "DEPT", "parentModule": "273"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
4dc0f948-c0e5-4e0f-907d-a469c1211331	pg	ca1066bd9a1941acbd29fbb4ab5036b8042b180c3717cfe6789f8900e75447aa	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 697, "url": "/user/users/{id}/_updatenovalidate", "code": "null", "name": "UpdateUserWithoutValidation", "path": "Administration.UpdateUserWithoutValidation", "enabled": true, "displayName": "UserRole Mapping", "orderNumber": 1, "serviceCode": "ADMIN"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e289a896-00ee-4a81-b4ff-5c5095853d59	pg	03f6b2109a78e9d4e5813ac8d44bd50a324d84d380f345fb9ac3c4a37e8b7a81	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 1221, "url": "/access/v1/roles/mdms/_search", "name": "Get Roles from MDMS", "path": "AccessControl", "enabled": false, "displayName": "Get Roles from MDMS", "orderNumber": 0, "serviceCode": "AccessControl"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
c5e7163c-2aa0-465e-a4e3-e79aeb49e2f7	pg	e5f9ef12d4305a503cabd7c865b359eb5db9359736903e22bcea0a74006afbb3	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 870, "url": "/access/v1/actions/mdms/_get", "code": "null", "name": "Get Actions from MDMS", "path": "Access Control.Get Actions from MDMS", "enabled": false, "displayName": "Get Actions from mdms", "orderNumber": 1, "serviceCode": "AccessControl", "parentModule": "221"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b9328634-29fa-4565-946a-cfea4dce9261	pg	6e65aa8dd9544ca2cfaefb19ba2b02e4fed8a8f708db98614756b782f0740eeb	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 979, "url": "/egov-location/hierarchytypes/{code}", "code": "null", "name": "Update HierarchyType", "path": "Location.Update HierarchyType", "enabled": false, "displayName": "Update HierarchyType", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
09611aee-d365-43a7-8ae4-6dfa1c88a250	pg	41c9886e7cbbf5eb4d6a2ee07b04f5d991d3b83e8af1d9b3a417c4e0e91461e6	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 978, "url": "/egov-location/crosshierarchys/{code}", "code": "null", "name": "Update CrossHierarchy", "path": "Location.Update CrossHierarchy", "enabled": false, "displayName": "Update CrossHierarchy", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
72551115-0799-4293-8623-93867afa7d5d	pg	b4af80862c26ae83c992146a4e2288e00b1906f639dfbc3c082f7a48fb07c799	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 977, "url": "/egov-location/boundarytypes/{code}", "code": "null", "name": "Update BoundaryType", "path": "Location.Update BoundaryType", "enabled": false, "displayName": "Update BoundaryType", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e494b2c2-cb1b-4e8f-b544-3d2d9c3c669b	pg	113be2b79e4df3b9ecb90ca08f217bc686a3e2c6cd543101869915de291e0caf	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 976, "url": "/egov-location/boundarys/{code}", "code": "null", "name": "Update Boundary", "path": "Location.Update Boundary", "enabled": false, "displayName": "Update Boundary", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
14819bc9-d787-4b59-8724-0948ae3ae58c	pg	7d9ba9beaa8e61ab474ef44f265f50e0d8bbaaad1f798072475092e5958bf499	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 954, "url": "/egov-mdms-service/v1/_search", "code": "null", "name": "MDMS Search", "path": "", "enabled": false, "displayName": "MDMS Search", "orderNumber": 0, "serviceCode": "MDMS Search", "parentModule": "306"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
98b1cff9-88c1-41dc-a41b-9effbbc1213a	pg	8467919dcb9ee878494c2dcdc5c9fc053c7f7d10e4ace9fbb87f5639682c3589	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 948, "url": "/egov-location/hierarchytypes", "code": "null", "name": "Create HierarchyType", "path": "Location.Create HierarchyType", "enabled": false, "displayName": "Create HierarchyType", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f0aef138-3fb0-4fcb-908b-675ca83f919a	pg	b06d6dc0039ab3e29fcfd955b74047b195cf6bd5f2a828adfc128de237bc7f76	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 947, "url": "/egov-location/boundarys", "code": "null", "name": "Create Boundary", "path": "Location.Create Boundary", "enabled": false, "displayName": "Create Boundary", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
4ff54c68-28b2-4865-abf1-849687cb79c0	pg	e2575160941e17b482467bf3a72c99a166bf14f1d12f3663d864f26ad2663f96	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2562, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
18c441ed-9799-4a94-ab87-44722374f873	pg	bae47fa6e6c9fa174e308a0b46bc17d24213c2b2f7787b0f366efde7f801a14b	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 883, "url": "/egov-location/crosshierarchys/_search", "code": "null", "name": "Search Cross Hierarchy", "path": "Location.Search Cross Hierarchy", "enabled": false, "displayName": "Search Cross Hierarchys", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
534e6a74-454b-4243-9a5f-885b444b5b84	pg	2151b315fd4c92748a93a9927245ae63589d06ccb1c3417f618ee2877c910ff6	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 874, "url": "/egov-location/hierarchytypes/_search", "code": "null", "name": "SearchHierarchyTypes", "path": "Location.SearchHierarchyTypes", "enabled": false, "displayName": "Search HierarchyTypes", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2730d640-cef7-41bf-a437-7058eb80af72	pg	66c53205a33a9d80d596f65d150496202391763d6308b51d9adb3f44ebfcdc8d	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 873, "url": "/egov-location/boundarytypes/_search", "code": "null", "name": "SearchBoundaryType", "path": "Location.SearchBoundaryType", "enabled": false, "displayName": "Search BoundaryType", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
154e97a0-bc3a-47bf-ba5f-3be9f498e243	pg	d84c22c0c4e4eaa5bb2e01437278485bcb605dcf173179dca8da7a0ef75df316	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 798, "url": "/egov-common-masters/departments/v1/_update", "code": "null", "name": "Update Department", "path": "Administration.Department.Update Department", "enabled": false, "displayName": "Update Department", "orderNumber": 2, "serviceCode": "DEPT", "parentModule": "273"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
97c337ea-82ce-4de2-8266-34ec3bd293a0	pg	7233d9509a37bb95e6da98414ec2331c986262726408fe87c7f4f03ea7c50442	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 789, "url": "/egov-common-masters/businessDetails/_getBusinessTypes", "code": "null", "name": "GetBusinessTypes", "path": "Collection.Collection Masters.GetBusinessTypes", "enabled": false, "leftIcon": "editor:collections", "displayName": "Business Types", "orderNumber": 1, "serviceCode": "COLLECTION-MASTERS"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
25b7b034-1e80-4818-8e1f-79076e4555cb	pg	eb9ae73fc2590a704c10cc9325ea7eabda23ece98350e596374d2d24b80db30f	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 733, "url": "/egov-common-masters/modules/_search", "code": "null", "name": "SearchModules", "path": "Employee Management.Employee Masters.SearchModules", "enabled": false, "displayName": "Search Modules", "orderNumber": 1, "serviceCode": "EIS Masters"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
cccf8cfb-2348-4203-b7ca-8c55196c6739	pg	2eae7fc612b06202675a609f5682cd14b7029f410577ee1fc4003f71f8a000ce	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 732, "url": "/egov-location/boundarys/isshapefileexist", "code": "null", "name": "isShapeFileExist", "path": "Location.isShapeFileExist", "enabled": false, "displayName": "Is ShapeFile ExistOrNot", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5f37c4b7-72f0-4453-91b9-e36ef6ebcddd	pg	88e74e569c78a9affbaa78a6de24ca8cb5c1469b83201ee4e554e841a12fbcb0	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 731, "url": "/access/v1/roles/_update", "code": "null", "name": "updateRoles", "path": "Access Control.updateRoles", "enabled": false, "displayName": "Update Roles", "orderNumber": 1, "serviceCode": "AccessControl"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
345c2708-1784-4ef8-b013-fb2ba39a4959	pg	42565497ef42d9615807dfef20285b7b42cf0fb09c9a9a7a5bf864b94b2509dc	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 730, "url": "/access/v1/roles/_create", "code": "null", "name": "CreateRoles", "path": "Access Control.CreateRoles", "enabled": false, "displayName": "Create Roles", "orderNumber": 1, "serviceCode": "AccessControl"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9f259d9b-2818-4d82-a83d-a497984483b7	pg	96c3e4437f45b78001c3a1a9784198cdd1de1fb596b08c96b956ccb68187638c	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 729, "url": "/access/v1/roles/_search", "code": "null", "name": "SearchRoles", "path": "Access Control.SearchRoles", "enabled": false, "displayName": "Search Roles", "orderNumber": 1, "serviceCode": "AccessControl"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ac2ca75d-d6fd-4003-94ac-23e981b8dfb5	pg	b62058f37b5f542c323b6bdf332fd58c6180933db4a3a1a7aaebb78757d687b9	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 728, "url": "/access/v1/role-actions/_create", "code": "null", "name": "CreateRoleActions", "path": "Access Control.CreateRoleActions", "enabled": false, "displayName": "Create Role actions", "orderNumber": 1, "serviceCode": "AccessControl"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f00e65ec-1eb1-4189-b2e0-c5f625a1f464	pg	f189f02aba7431b5f03b5d26631f8ba1c3c54391cebdeb6c76539cecbdf3a769	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 727, "url": "/access/v1/actions/_update", "code": "null", "name": "UpdateActions", "path": "Access Control.UpdateActions", "enabled": false, "displayName": "Update Action", "orderNumber": 1, "serviceCode": "AccessControl"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d51d1f86-59ff-4e78-8651-0f8364803986	pg	741ba4d97973342072e29784d4c222d6bb9443b4e91924647dfb279de7c4164f	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 726, "url": "/access/v1/actions/_create", "code": "null", "name": "CreateActions", "path": "Access Control.CreateActions", "enabled": false, "displayName": "Create Action", "orderNumber": 1, "serviceCode": "AccessControl"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0bba068a-1275-4bad-bc82-2b7fb0d35f69	pg	52f5fdee86bacee36a9ce2b146d08f0bbf40c878b5c7b5543873c97382d7c7d9	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 725, "url": "/access/v1/actions/_validate", "code": "null", "name": "ValidateAction", "path": "Access Control.ValidateAction", "enabled": false, "displayName": "Validate Action", "orderNumber": 1, "serviceCode": "AccessControl"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
db23f5e7-bd3c-4fc7-9a25-beddad00be1a	pg	bc5e73596b99d759bc66a4b1f32cfac8cc3f55b38f7e628f13c6bbb07d51ce3a	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 724, "url": "/access/v1/actions/_search", "code": "null", "name": "SearchActions", "path": "Access Control.SearchActions", "enabled": false, "displayName": "Search Actions", "orderNumber": 1, "serviceCode": "AccessControl"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b77cc9f5-5c30-4700-8f8d-950fcd7af859	pg	39f37e13f35557a8e21304c879886f9d5f8bd778e3dda21d1d1c2cebee57f483	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 701, "url": "/user/_logout", "code": "null", "name": "Delete Token", "path": "Administration.Delete Token", "enabled": false, "displayName": "Delete Token", "orderNumber": 1, "serviceCode": "ADMIN"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6eab9b22-60a2-4812-857d-92a1c36e5254	pg	baa3b58c92d3aa0934ddbe2356e67450262551acc9aae4e7672ae75debcf7d88	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 700, "url": "/user/password/nologin/_update", "code": "null", "name": "UpdatePasswordForNonLoggedInUser", "path": "Administration.UpdatePasswordForNonLoggedInUser", "enabled": false, "displayName": "UpdatePassword For NonLogged InUser", "orderNumber": 1, "serviceCode": "ADMIN"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2b66d5aa-5f07-4e7e-a6a6-6b4e9172619c	pg	0c73222b145d2ea360c0bfef1991a3dba7e3b9c9e074aa555f1d6d4e40a0afb0	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 699, "url": "/user/password/_update", "code": "null", "name": "Update Password", "path": "Administration.Update Password", "enabled": false, "displayName": "Update Password", "orderNumber": 1, "serviceCode": "ADMIN"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
caaf3539-6584-4e3f-82b8-788f29075bad	pg	d8a43731eea79e3c027c25a6e3b77f3a68626cda964b5a89a55d07b55978901c	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 698, "url": "/user/profile/_update", "code": "null", "name": "Profile Update", "path": "Administration.Profile Update", "enabled": false, "displayName": "Profile Update", "orderNumber": 1, "serviceCode": "ADMIN"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a6068356-e2a6-4b66-b76a-30273a01161f	pg	0269da81243878f4d5182c4c8e290fba40430f8ec1adc6e1c3fcac20ff49f10f	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 696, "url": "/user/_details", "code": "null", "name": "Get User", "path": "Administration.Get User", "enabled": false, "displayName": "Get User Details", "orderNumber": 1, "serviceCode": "ADMIN"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9bbacbbe-0207-46a5-8a91-28894b1cdbd9	pg	38a70d747f1e0e3a21b5b2259e887342d524c62c3ef11b866ac1ffe9791c1df8	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 695, "url": "/user/v1/_search", "code": "null", "name": "Search User Details", "path": "Administration.Search User Details", "enabled": false, "displayName": "Search User Details", "orderNumber": 1, "serviceCode": "ADMIN"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
67ca1346-e481-4df6-adb9-9d77ddcdf2cc	pg	9d7cca3c3497608c11e547e2d4c938e2c288d27cfc9174445dabb27bfd13450d	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 694, "url": "/user/citizen/_create", "code": "null", "name": "Create Citizen", "path": "Administration.Create Citizen", "enabled": false, "displayName": "Create Citizen", "orderNumber": 1, "serviceCode": "ADMIN"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d2107c01-e190-4693-a70c-974abfec8d8b	pg	ad02154412f44a8df0c6aacb2a0588ea57ad2954ab6e8087725a58fa23bce3fb	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 693, "url": "/otp/v1/_search", "code": "null", "name": "SearchOtp", "path": "Otp.SearchOtp", "enabled": false, "displayName": "Search Otp", "orderNumber": 1, "serviceCode": "OTP", "parentModule": "247"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e594da44-f87d-446b-a653-10469a099ef8	pg	78ca406940552be3ea9a86a7cb26c891f91656896e47c7742635a088a6a8841a	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 692, "url": "/otp/v1/_validate", "code": "null", "name": "ValidateOtp", "path": "Otp.ValidateOtp", "enabled": false, "displayName": "Validate Otp", "orderNumber": 1, "serviceCode": "OTP", "parentModule": "247"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
81ed7f23-a065-498c-8f6f-1973fa0c2e39	pg	07aab54f22ffe7d17107dafd0d62107237e2d84330d4311fe79eb7aaea9f4550	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 691, "url": "/otp/v1/_create", "code": "null", "name": "CreateOtp", "path": "Otp.CreateOtp", "enabled": false, "displayName": "Create Otp", "orderNumber": 1, "serviceCode": "OTP", "parentModule": "247"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b761c846-bdc2-4824-b13e-9529d376d7cd	pg	0436056fd740917f9cc4facc2d311870b979b98871c543e1b8661797edcac883	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 627, "url": "/egov-location/boundarys/_search", "code": "null", "name": "Search Boundary", "path": "Location.Search Boundary", "enabled": false, "displayName": "Search Boundary", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
cd8b78a0-67d6-4f4f-98d9-c39faf6258f1	pg	73ad0b6629cb0cd5114d2b9f73a93ee04d74efc3b3bd9ca33a4d9bc0d7711ebf	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 623, "url": "/egov-idgen/id/_generate", "code": "null", "name": "GenerateNumber", "path": "Administration.GenerateNumber", "enabled": false, "displayName": "Generate Number", "orderNumber": 1, "serviceCode": "ADMIN"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
acddd6a0-7079-4c52-9eb1-91e784ec26dc	pg	29455213ed309180e548b4883cf39b129a9c4757081973ebd7abd74013b6c157	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 605, "url": "/user/users/_createnovalidate", "code": "null", "name": "CreateUsernovalidate", "path": "Administration.CreateUsernovalidate", "enabled": false, "displayName": "Create User novalidate", "orderNumber": 1, "serviceCode": "ADMIN"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
3df4f300-a2c8-42c8-94e3-4aac3da04538	pg	314dcd2a3958c7f687d3bb95061e74f3fd0e58465d95a80caeafdb71ef32e1ff	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 604, "url": "/user/_search", "code": "null", "name": "SearchUser", "path": "Administration.SearchUser", "enabled": false, "displayName": "Search User", "orderNumber": 1, "serviceCode": "ADMIN"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
fc5c33ba-ee15-4518-827b-ada04fc752a8	pg	093882cf08f22f0907e47b292d14f59b2bfd8352462bc7ba0d052a2667fe61c6	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 594, "url": "/access/v1/actions/_get", "code": "null", "name": "Get All Actions", "path": "Access Control.Get All Actions", "enabled": false, "displayName": "Get All Actions", "orderNumber": 1, "serviceCode": "AccessControl"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f04145bf-8d64-44b6-8645-cadbda76add5	pg	83c9f5624a3a176d7a4e40a78fc6e398331b9d07bdd7df23b73f2b75e49d5647	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 582, "url": "/egov-common-masters/categories/_search", "code": "null", "name": "SearchCategories", "path": "Employee Management.Employee Masters.Category.SearchCategories", "enabled": false, "displayName": "Search Categories", "orderNumber": 0, "serviceCode": "Category"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
17f49bdd-31cb-497d-9242-ed556a67f55f	pg	d77f0afe387c98f893510a0a17e9255c8902d5474432166c998051692d822add	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 355, "url": "/egov-common-masters/relationships/_search", "code": "null", "name": "SearchRelationship", "path": "Employee Management.Employee Masters.SearchRelationship", "enabled": false, "displayName": "SearchRelationship", "orderNumber": 0, "serviceCode": "EIS Masters", "parentModule": "71"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7ba87297-0f7e-45a0-870f-42fdf7d90cef	pg	6b3616e93daa77e7f9b2b7a20751f7ffde0ef3ca6d39f99de673ae834a3359b6	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2562, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8ded28a9-5270-461d-94f2-002c63bef17a	pg	853dd6d18b911a41e3810fe84bf67b1d939b115116f8c42523e85d403ebcdf0c	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 353, "url": "/egov-common-masters/genders/_search", "code": "null", "name": "SearchGender", "path": "Employee Management.Employee Masters.SearchGender", "enabled": false, "displayName": "SearchGender", "orderNumber": 0, "serviceCode": "EIS Masters", "parentModule": "71"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7802578d-b6f8-4acc-ae44-e36f4221c709	pg	f2e4bcf599bf7c0daf9709771e685dcb97df7e8fc456b3ba045da14338e00483	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 290, "url": "/boundarys", "code": "null", "name": "BoundarySearch", "path": "Location.BoundarySearch", "enabled": false, "displayName": "BoundarySearch", "orderNumber": 0, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
fa9c3fc9-c0ca-43aa-ba9c-1a24e5b122bb	pg	e95b62de3637b031ea46f8d8af2c0ed364e8e5d2de200e82b838621ea67c0918	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 278, "url": "/v1/files/tag", "code": "null", "name": "filesearchbytag", "path": "", "enabled": false, "displayName": "filesearchbytag", "orderNumber": 1, "serviceCode": "filesearchbytag", "parentModule": "76"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
321e5b08-70a2-4ce3-8d31-10beb07c8335	pg	14e251df6791710daa3a80ea15b4d315b9cc8e4cda06b6577593a9cf8fbea12f	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 277, "url": "/v1/files/id", "code": "null", "name": "filesearch", "path": "", "enabled": false, "displayName": "filesearch", "orderNumber": 1, "serviceCode": "filesearch", "parentModule": "76"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d648fe47-991a-4533-b333-630fb602d5dc	pg	3e69305363cec82c3558adab90080b3953c8b03979c5ab36316ea2d0777337e7	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 276, "url": "/v1/files", "code": "null", "name": "uploadfiles", "path": "", "enabled": false, "displayName": "uploadfiles", "orderNumber": 1, "serviceCode": "uploadfiles", "parentModule": "76"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b04f8635-8553-4987-9170-4386c3580984	pg	5575b73f9c0cb9fd1fa2637e426b58ddb2668fb68c1140c9c8ed018c30638b61	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 266, "url": "/boundarys/boundariesByBndryTypeNameAndHierarchyTypeName", "code": "null", "name": "Get Boundaries by boundarytype and hierarchy Type", "path": "Location.Get Boundaries by boundarytype and hierarchy Type", "enabled": false, "displayName": "Get Boundaries by boundarytype and hierarchy Type", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
662dec02-a543-42f0-833a-4bbe9eee4c9e	pg	267c8f3acdee0f63bf8ebec3a61aba985a104b62e4b78bc820b7bb983114a1a5	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 265, "url": "/boundarytype/create", "code": "null", "name": "Create Boundary Type", "path": "Location.Create Boundary Type", "enabled": false, "displayName": "Create Boundary Type", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d2e340a7-8896-4a5e-b9a4-572a8e5397be	pg	d10bf91a40ffea2fefe73de9bf32f482f3091a5d3c31984c44a63c84a30c04da	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 264, "url": "/crosshierarchys/{code}", "code": "null", "name": "Get Cross Hierarchy By Code", "path": "Location.Get Cross Hierarchy By Code", "enabled": false, "displayName": "Get Cross Hierarchy By Code", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f254ee7e-b6b8-4d6a-bdf6-e9ada3045f72	pg	51217c0c2562e631e8ea2aaa09dc6351e2c8a12d14f855d6dd648adadb1b2e22	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 263, "url": "/egov-location/crosshierarchys", "code": "null", "name": "Cross Hierarchys", "path": "Location.Cross Hierarchys", "enabled": false, "displayName": "Cross Hierarchys", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
c8b06b51-dafa-4d1d-9d45-e7cca731778f	pg	481bdd833693875900c08abc81f04a95a3f47323583587eb8704759f9c8b9dc2	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 262, "url": "/hierarchytypes/{code}", "code": "null", "name": "Get Heirarchy Type By Code", "path": "Location.Get Heirarchy Type By Code", "enabled": false, "displayName": "Get Heirarchy Type By Code", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
68330a97-b92e-402e-b4ec-b8de48615e35	pg	f15d25cc20b12a77f4fdb895185ab19f2d51daf7cb877c7c32ca3ac5d2479a37	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 261, "url": "/hierarchytypes", "code": "null", "name": "Get Heirarchy Type", "path": "Location.Get Heirarchy Type", "enabled": false, "displayName": "Get Heirarchy Type", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8c606ac6-c8d8-44ba-b58d-7e1e79550895	pg	2f2ac525b419b399381f5408bb36ff2ea5c7960f27a525dea4b41ec99ba54eec	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 260, "url": "/city/getCitybyCityRequest", "code": "null", "name": "Get City By City Request", "path": "Location.Get City By City Request", "enabled": false, "displayName": "Get City By City Request", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
44879ca3-f302-4fb9-b6c5-188df691efc8	pg	0b31f1c24a84b530c31feca9d307e523d12084c872ff622747bb57e0e4c0fcd9	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 259, "url": "/city", "code": "null", "name": "Get City", "path": "Location.Get City", "enabled": false, "displayName": "Get City", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
218102ef-0f40-4be4-a220-c15ccb3d2c13	pg	0abf7ae2c1c364c39aed397f7766e3d88c7d2e3f49947d328550ec0450006d6d	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 258, "url": "/egov-location/boundarytypes/getByHierarchyType", "code": "null", "name": "Get BoundaryTypes By Heirarchy Type", "path": "Location.Get BoundaryTypes By Heirarchy Type", "enabled": false, "displayName": "Get BoundaryTypes By Heirarchy Type", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
52e0bd81-2be8-4975-8a49-621520ca04b1	pg	766a37c59392ead8cdd8882a17385768778cbef86aa0271ab75eb2c952080f42	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 257, "url": "/egov-location/boundarytypes", "code": "null", "name": "Get Boundary Type", "path": "Location.Get Boundary Type", "enabled": false, "displayName": "Get Boundary Type", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
96a6d774-9223-4733-b13e-f5394420d5c0	pg	b8d6b456ff3c932de1da558a93c11fd8c377d9910efd9ce755923a96cc92ab84	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2562, "rolecode": "PGR_LME", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
394c31a3-6bc1-4562-a61f-42f93f2c95a2	pg	ff147f0444b0c7875581bd767adace2c9e1b3b0d89a24cf2701d36461701f149	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 256, "url": "/boundarys/{code}", "code": "null", "name": "Get Boundaries by Code", "path": "Location.Get Boundaries by Code", "enabled": false, "displayName": "Get Boundaries by Code", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
57ecb3bb-8f10-474d-904d-fca53f85b4e8	pg	368f106f92a6e49d51fdd08afc782e6f58a7bb373545691cb99e385aca67a0ec	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 255, "url": "/boundarys/getLocationByLocationName", "code": "null", "name": "Get Location by Location Name", "path": "Location.Get Location by Location Name", "enabled": false, "displayName": "Get Location by Location Name", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e1aa941a-95f8-4450-a89c-8ce12d71fcc4	pg	fcf79ab64f6ae1246d88e5bb955d5d70331083c82767151cedf2a60ccdb06c4c	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 254, "url": "/egov-location/boundarys/childLocationsByBoundaryId", "code": "null", "name": "Get Child locations by Boundary", "path": "Location.Get Child locations by Boundary", "enabled": false, "displayName": "Get Child locations by Boundary", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
75c754c5-e4e6-4e97-937f-98b1d05038c8	pg	de648bd11238776e14e64c9f2db961c9f7ebf33364945ef10ae5ca2187ae4797	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 253, "url": "/egov-location/boundarys/getByBoundaryType", "code": "null", "name": "Get Boundary by Boundary Type", "path": "Location.Get Boundary by Boundary Type", "enabled": false, "displayName": "Get Boundary by Boundary Type", "orderNumber": 1, "serviceCode": "LOCATION_MS", "parentModule": "67"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1f65e6b2-899a-48b0-a8c6-00a017d4526b	pg	c53d7098529a3f64d269d77fb0bdd964bef0d4ec0dfb42d0493e37b15cf3efbf	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 207, "url": "/egov-common-masters/departments/_search", "code": "null", "name": "CommonDepartmentsSearch", "path": "Employee Management.Employee Masters.CommonDepartmentsSearch", "enabled": false, "displayName": "CommonDepartmentsSearch", "orderNumber": 0, "serviceCode": "EIS Masters", "parentModule": "71"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5876c92a-73c8-4fad-ac00-f60115ddfa4d	pg	43fb7e5b2ca06fc9e9a33ad163c9d36176fa626a3d30f3b494bd25c5c298ae20	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"id": 14, "url": "/filestore/v1/files/id", "code": "null", "name": "Get File by FileStoreId", "path": "PGR.Get File by FileStoreId", "enabled": false, "displayName": "Get File by FileStoreId", "orderNumber": 0, "queryParams": "fileStoreId=", "serviceCode": "PGR", "parentModule": "PGR"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6b477438-3ad9-43a4-a0fc-b1abf8725c0e	pg	f9c5beb3ac6fc33f070922e5a4c40a3be5884bef72262d54d0145ff46882c312	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2568, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
3915a0c0-453c-4309-a89e-a1a2e295d4a3	pg	e4dcc945a036a3530864afd28e9ed6f36111784b4e072938a41fa2b11e9d7515	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2568, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0736a6ef-66cc-4aac-a29a-3bf032dac200	pg	b649ae9c5d44fd0774125796d7e51fd1653620bd4758e51b84066e725bb4c999	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2568, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
29aee88d-bbed-4a40-961f-8dc1634fd468	pg	79ef376ead958eb2609885beee139981c3f779d97c4dcd0982103ee395778a2d	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2568, "rolecode": "PGR_LME", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9aa30ed3-9ee8-4941-8176-a66e6e8d6d32	pg	692551ccc383a3525895b225a719245aaee425fc61a5d83d0512ec97ee88be0a	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2567, "rolecode": "PGR_LME", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
79e55f3f-3860-4f1c-a9f7-c7c74436b269	pg	c3bb28fa05c8d65107cbcdbad5e17a1b44e662fbabb0d17bec633e891d5347fd	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2567, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ab062238-7227-4e33-a7f6-00d465efe246	pg	043640001d2e9c52af46b75b07bad11f1494d7d42e643116eea0efb26e16116f	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2567, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1f1c272f-da7d-4d14-a6fb-1293a8879968	pg	7a01765a2abc197162d1e858fbad1bf97c33cfbb489438f10bb8145bf973dc35	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2567, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9c11be8b-fcd7-4ba1-b09b-452ac4be5d55	pg	e8f6f18ec3244e27241ae26fea8db17bf5c035e1c234e384274838aee46a49e0	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2566, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
489d52de-d4e2-4d87-9de0-cd92d61b8f2a	pg	6b5fbcb40288b0da7975ea16ba854e0f9bdfd7802448e6d33623b2e61025b23d	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2565, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5d533ede-225c-413d-bcc8-ffad83ef6fac	pg	7ad1c3b8c67f934f73669be67d9604fa590dc8f4988b5e4b486b4e0fc0ce09af	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2560, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
54321b17-5bd4-49b0-add3-a44a375f310d	pg	d883427cfc1778e3f49ff680d76d804bcea6ae9da034a0e40aeee20d9e9b42b4	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2560, "rolecode": "PGR_LME", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
49dbe6d1-155b-4ba9-b643-ee3e9fe39093	pg	ee9b72b9fcbf2dc4c8ba98447f2f4d7b4584133175f7cfd81e554152f4de060b	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2560, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
3db6955d-972e-4d85-bd8d-6370d4f1d0f6	pg	886e8888edc3f3c683db0a87c7c183a4082c841fb0bef8294cafd09be0b6eb76	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2560, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
560a78f2-ac51-4b76-b680-72e5ac50e03f	pg	6ba23b30758878220b9eda1f616f43db07bdb1de36ea71bfbfaeb440dc0db48f	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2562, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
17256769-72fd-47e1-add2-3c832c8241ea	pg	e4db40d456ebec1e626fe10511cf038bc3c721248f62ccdf31a59fa2cc6ca4e9	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2563, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ae548e98-ad74-4487-8fd6-de799d0bde1c	pg	ec28558214ee1c11d5382bc39facccecae3dde275e64c55c6c48f6f659b1700d	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2564, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2e8f41ec-1cdf-4907-a6bf-3c3a926db2e9	pg	cc4258153cfae764d9d8987a206d703aa82b9696887159a4ac78d82d92f71f6b	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2564, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
cf706d12-6ed3-444d-b2f2-db1b03455434	pg	182a82dced440a2b855e689f5bce4fd376339c1557c990d10562fbc5a9b5f890	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2564, "rolecode": "PGR_LME", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
4bfe8cba-1c07-4fe6-a413-2e86b4582a67	pg	17f8416d06380468761966ae3632e1cec6a09b11bef66c6bdc4ad3fabf60b910	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2564, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
c4b21e62-c565-475a-9101-dd5deb8adf82	pg	f18c3db0c4a39982a00b2e07400a69de8d25da2fe0c5204294c59fd3c262d771	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1101, "actionid": 2564, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8d046bcc-4188-4f0c-af6a-82837c413361	pg	3642c4183ecf565cd359eaad81fb2a3ec7e7a0af4013df7fb6f657a7b83482eb	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1100, "actionid": 2558, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
fa770ece-aa2f-4804-91fa-d627ce1fd23c	pg	82aa5fb0547acd229d8619c43444ddb75938c29ce487e10282a208e69cc7691c	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1099, "actionid": 2557, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
35f1a557-588a-40c9-bae3-bc01fd503afe	pg	da39c19492475aad4a6cdcbb1937e53b5c74335f3d0af14519f6c89072cba3b9	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1098, "actionid": 2557, "rolecode": "PGR_LME", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ffc3d1e5-ecf2-45d2-b43f-7a9e8c8036ba	pg	30ce82b8a2f3c241143b6a57072c3e0cadca51a98fae5f0c4dc259bc6208fe2c	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1097, "actionid": 2557, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7e68c38f-9949-404e-8b6a-a3fdbe1e9fdc	pg	7e7cffaf21529457f2dc8c7fe94284cf45a75db60b26923b195ca1855b5aa516	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1096, "actionid": 2557, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f75d64f4-f434-479f-b59b-4c5a3dd4f290	pg	33b8120824da06a7c71dc2fbb5ff5496e04f557564ca8de944012ff5322f0569	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1095, "actionid": 2556, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
abe0500c-45a6-4390-a2f5-9e17e6396279	pg	5b355c08aecc132cebee9458c1a24c792eca30a12d9083ea0406d8a3b6c9f7fa	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1094, "actionid": 2556, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
50189638-f271-49ea-9f04-6eac1e6fe208	pg	15c33e0cfc3b40392421acc68a852935d95b627073c6c9b259521206df9d819d	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1093, "actionid": 2556, "rolecode": "PGR_LME", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b68082a7-833f-42d8-8ab5-f5ba27a6c39f	pg	a1dea2e39f1a7e5c56d4e6847df833b5397eb8a86a2ba5ec3065377773038df0	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1092, "actionid": 2556, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d05ea37a-55a6-488e-80e6-778f0d705f24	pg	77a07de7b9790c8737f2cc2829fd731dd2b9c0f73db722aded68e39cb6024f06	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1091, "actionid": 2556, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6775306e-1c50-4d63-a39f-0c4b0eb38dc7	pg	5d1df909557ee337a5cbaa094f60f2e0cec29f102d57550b96d647ae01add508	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1087, "actionid": 1556, "rolecode": "PGR_LME", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
dec9a5f5-0051-4c48-b5d3-cea5f5127727	pg	f5879df8f3cfe4a33658024652ff80d3691730f65f101b3cd784eeeaea6acbe5	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1085, "actionid": 1556, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d462e760-bbb4-4637-b336-e2d752844ca3	pg	1c6d39a1ca9f4b4de8acd1300693274c558c2821d8bd873eaab57ce08c510fde	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1082, "actionid": 1429, "rolecode": "PGR_LME", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ba467a1c-129c-45f4-bfbe-dcab1648cd6d	pg	3bccb581a57c526b30db1f888492e94b6ddf872c09f12ee0277600836ec59de6	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1076, "actionid": 2025, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d25ccf9a-c14b-42cb-b220-f5f814ef9b7f	pg	c8b7dc6d1eaa4b45fd95b1edea21a01572097078dcc698700b68f62d054b90f9	egov-hrms.EmploymentTest	{"code": "PRELIMS", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5365b377-f85b-46d0-9de1-be95e612ea5c	pg	6e61bcb1f015e7c1a11fbfa7c6cb864c790f30219240756a484f1503a14bcbfb	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1066, "actionid": 604, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5c50a1b9-9193-43bd-baff-b8ed8f28a297	pg	35af067396aec87afcbf3b3616e262125ebddb838957a60bea7cc2338d2679be	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1065, "actionid": 604, "rolecode": "PGR_LME", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
aa1e99e0-15fc-46cc-94d2-e9903e5905dc	pg	b4aa7bf205e01cea249ce2fa34bc235b08886531bc2722f6d23d4d157b5f8352	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1064, "actionid": 604, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
66096ece-f15a-4425-bbca-c351a7b13f73	pg	107b3e5dcaac54caf2083031f36e4f8832125337c067402621729aa9ff9e31fc	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1063, "actionid": 604, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b46cd421-22df-44e2-aaaa-0bc1eaae338d	pg	b9f144ea5a2fb560a7e63ea6c6583733a655ac76bf7e0367313da96a197cd8ac	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1050, "actionid": 2540, "rolecode": "MDMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ce921ffc-9c0a-4f91-8aa4-4327081baf25	pg	a4c06df26d9f7c396605f89c6695bae1736a6055bd4cbc7aeedae6bdd3f54611	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1049, "actionid": 2539, "rolecode": "MDMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
cbdc3661-cc43-4a0a-8842-c14852b5445b	pg	8187774c59771493a531a3fabb722af963aac0ed6c818956086cf41b96ee6bac	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1048, "actionid": 2538, "rolecode": "MDMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b883b284-d61c-43d8-8afd-4847d0870534	pg	6d40628869df586a8113ff76ea74a2824b8eba668d3b995e6a93652a2e385810	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1047, "actionid": 1734, "rolecode": "LOC_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
81c18025-15a5-495c-8eb3-9c9725567c9e	pg	9887ff7a3a1f8144862f1de7022dbc3e516caabcb29df933140e45371e2f525e	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1046, "actionid": 2537, "rolecode": "MDMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
46f4d740-0476-4ea6-a705-530a5d8a66e7	pg	3394e48823bb0f0fc3e1fc0dc34e17dee1844d502bf1909ef11c5f923e0b3518	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1045, "actionid": 2536, "rolecode": "MDMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7428e460-485f-4029-8d7c-0fcb2648c9c0	pg	b9af7369130889a952ecaab9861279fcc8a5ea98a356bd2001499b0428369704	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1044, "actionid": 2535, "rolecode": "MDMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5772e22a-b7e3-41a9-b3be-2f6173af11f3	pg	ee1782e561e09eaac0046a0f250eaf78b6a144be6e5624f19d3d30013a253d49	egov-hrms.EmploymentTest	{"code": "APTITUDETEST", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d503d6c1-68f7-4de2-a34f-9fe1648dd6e3	pg	f9b96dbadfdd18f8736109526cd9d4f89c628082cd83547eeef086b8f494ba5f	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1043, "actionid": 2534, "rolecode": "MDMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
fe71a2d8-b283-4473-adc2-e410c297fd2a	pg	db3fc37df8b4beabb31a32e4a93aeb5c777aa266b7d4fab1986a691c8693d94f	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1042, "actionid": 2533, "rolecode": "MDMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e82c248d-5040-4b32-8542-e7a4ddd2d20b	pg	a5f7e8eb81fbefe02105d6fa84cbee38afdb620bf23c3ea03231698d0568ff44	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1041, "actionid": 2532, "rolecode": "MDMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
cafdb864-b6d2-452d-80c8-686f84ebba10	pg	b522166df7131aa252f829026b073080b54667ccdfca1104e4d3d2fb0c3d46f7	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1040, "actionid": 2531, "rolecode": "MDMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
4e547468-63d4-4cc9-8162-30876c24be4a	pg	60c09b3171198871f657e1ff0fbbd212fdffea4d66cc929408d7a813b4782b78	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1039, "actionid": 2530, "rolecode": "MDMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ca395e4b-a9b5-49ea-8661-16279f92891b	pg	3668e9591672ce240dca901ff46748fa73993d87e3936d809a338dabfa54b5ff	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1038, "actionid": 2529, "rolecode": "MDMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d7617c7b-6c62-4e71-8119-89bcdf590dff	pg	f5452f3469e501186e53f1e8433d8e87eb9d9b3e5f6e9d411d92712d8ad8087f	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1037, "actionid": 2528, "rolecode": "MDMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
07060875-61c1-4a55-b782-dccfd2e38ec6	pg	b9738ab92d130dc5d4249ae82c873bb8c893a188bb14c3b52a859836bdd0d5d8	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1036, "actionid": 2527, "rolecode": "MDMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2edafc65-de3a-4cde-9131-3c99cf533fad	pg	7d501c8c5b86f19f176df33de0df0539871d15b3ef3b06ec02422d13aa75b56a	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1035, "actionid": 2526, "rolecode": "MDMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
54031ad6-a8e8-41d7-9f21-c74892a7c58c	pg	e2fb293d66322bd39338b431f828f00135af44bb1eb62b401a92c700b765cc2e	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1034, "actionid": 1556, "rolecode": "MDMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d746bd68-278d-4d39-a596-cd1a963bbc7a	pg	5886a56d7b352e5d0eb71e71b7940020067a2bd5cfc00bfefa2f8366d379b360	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1033, "actionid": 699, "rolecode": "MDMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
37c66bc8-bd32-4614-9c9c-56a9aad4b0e9	pg	558207002ff29516abf7508f8c1889ae919dce5b9f2b50fe67db612f747f37f4	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1032, "actionid": 698, "rolecode": "MDMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e3ee64c1-fb00-48a4-826d-0c08ec0c8ca0	pg	6fee2a402b3dee51168fdfb528f6982e9ef5c318f4ea8cb8bf0f36c310def685	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1031, "actionid": 2516, "rolecode": "MDMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1af3e0b4-17fa-4284-821d-677f595bceb6	pg	7d45a8a2852315a30cf867fd25351a6bf8cb1c76e0babb04ef43b2dce7873d57	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1030, "actionid": 2515, "rolecode": "MDMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2e17b4e9-186e-44c4-9aba-bcf5377a0f66	pg	baf38b22737800d0233de72f8090844466ff3d5ffe6ebba40fe268b9cdc86f0b	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1029, "actionid": 2513, "rolecode": "MDMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b87e803d-68c1-43fb-b3d1-3086854625d7	pg	f4685debb0ed46258d5f2715884b989eefc4e85e2e115f22c502285f9c7e669a	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1028, "actionid": 2510, "rolecode": "MDMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
3de2551b-66b5-4121-bed5-5210923708f5	pg	f54dc3d29f1e933460725cc64896f530142008ac0f4d580eadd0fab91facc305	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1027, "actionid": 2509, "rolecode": "MDMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6db6dfcf-ad7a-42d8-854d-6dbab4863251	pg	a2d2f4c804179544054b7eb74282e3aa6bc85cb197923bf96a5ca8a2c9d73677	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1024, "actionid": 695, "rolecode": "REINDEXING_ROLE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
319d3a87-47cc-433b-a67a-1c83f3bfd2f3	pg	a91aba9809cd5012096dc809df5ebe2d961ce90b3cbd4c5c48282c71faf0ebba	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 990, "actionid": 701, "rolecode": "COMMON_EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8a0857ab-e9bf-488e-81c5-64a0471587d0	pg	1177685d29659237fb9a9442891604692f6df005cb97b2662fc1427866bd2b49	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 989, "actionid": 699, "rolecode": "COMMON_EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
52d01dc8-8c35-42de-a0c9-7153f66d92f9	pg	a21ec00481d22281b0912924b0de48925f97e05fba01aa24b4061520142a7f59	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 988, "actionid": 698, "rolecode": "COMMON_EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6371765f-f1fa-456f-9890-ebdba5a5c973	pg	c8b78349226d9f2af49243fa0f6c5b6f0634dcd96ce2038001413b5ad38bbfd3	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 968, "actionid": 698, "rolecode": "HRMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
441d9a21-19a3-4c1a-aa78-16f85bb5421e	pg	4308b0daf92b964480e606fa8048005c83597849073bd49cca01197064b63784	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 934, "actionid": 2317, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
17a826f4-ee4d-4913-94e4-e86211404c4a	pg	058dbfa1d06e9b07b5c9dc136ee5b9240b6bb006c5943ab1832225b195179dd2	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 933, "actionid": 2317, "rolecode": "HRMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b17760da-ae5b-4bb5-b0dc-3974f804f84b	pg	5fd3260cce2904c956d4e1b1f3be360228b92fd2e836084e72de92c82154a23f	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 931, "actionid": 2317, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
c9b8604d-fdd9-401b-850e-a8ee2342622c	pg	8fa3a6d842b4cf3e21cf9007f49e68df46401e1b1bf58802f867d07975a6e3c4	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 930, "actionid": 2317, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8bc953e3-f331-40e4-9afe-b207e2991dce	pg	0e34f4757f2ecb834f32bf36d5d42e48e7185415e65c66e22146ed372b7b5064	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 923, "actionid": 2317, "rolecode": "PGR_LME", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1484eda9-1fc8-46d4-968d-4b5e3b3cfdfe	pg	ea0dd63b54e5ed2ec4824697f2df4bf96ba8ec7f630b4867e3540f207c505fcc	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 921, "actionid": 2317, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9fd3560e-8441-4124-80ba-23f8be30e66b	pg	22cc763196d451fcd6ff333cb911a7c3570774a6057e298283e20cc037ee3efe	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 887, "actionid": 699, "rolecode": "SUPERVISOR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a6e3f272-a7b1-42dc-afb0-c38125370543	pg	a8cd1535e4b1e957fe53ddb83c10b926627fa53bbfba3aad700ed42f70ebc013	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 886, "actionid": 2008, "rolecode": "SUPERVISOR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
df4a3238-80ea-4dbf-8af2-81a819cd7758	pg	da95a22ba9e43566baff8bc6d614567851d657de28fe8de311a9689c0478cc32	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 885, "actionid": 2007, "rolecode": "SUPERVISOR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
c06d51c6-a72d-40e2-8461-3917ba48baed	pg	23c8ff9434e77f980410602121ddb36264c8ca6daff4a84a4f5279f6095892af	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 877, "actionid": 2156, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b5f9d19e-7808-46a7-b129-0910b066b62d	pg	dccc9154a4a0b8bcd92c71aec19307a19002f7da44681d55b71051b6ff972df0	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 852, "actionid": 2156, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
bd076358-4c17-4ccc-b289-f2c35d30f0a9	pg	36d00f37f9792a202763bc6da9fffc44d2337505d79d8bc64bf438a1b225e8f0	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 850, "actionid": 2156, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7ff7e8f6-a0c7-42de-ab75-7d2702825359	pg	0ef46324dd0c37cdb2346551e472629d9b55dee340927f6bca44e132153a1e40	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 849, "actionid": 2156, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0a5fa9dd-32bb-4f29-b5d0-0e32d4713897	pg	85f5babc45526c31ae9c05a91abb93f5bcd893a772c3f0f903cecd1d755edace	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 848, "actionid": 2156, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0246b82f-4a97-44e6-bb9f-09210536960c	pg	0892e16b6a7a1d8540b8c223b6d2f74e08988fd899704eef10c9f3c3ccfead93	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 840, "actionid": 1750, "rolecode": "HRMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
4381b765-b771-44f6-8ea6-832ca3e903b0	pg	7efca3e26355d0d20a9a38a97ead5afca3969fbddd7929349dac4f6eb397d7e4	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 839, "actionid": 1752, "rolecode": "HRMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2acc943d-aba1-4a34-a3b1-00c4479ee979	pg	0659d6599378803a81d086bde669285b3f702e4e730d55239edaf74d8cdde4bd	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 835, "actionid": 1752, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
dec6db38-03d4-4f9d-b3ba-160a5ca24c4c	pg	2ef6e25e9b8cdb0225720962109de32b8912a673f88b531c823d080ff9fbccaa	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 834, "actionid": 2149, "rolecode": "HRMS_ADMIN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
89642676-906a-4367-a45e-3e9c2d02ca46	pg	7355b875c53e60faf12211bbcca0241abd1eb4891a10a59207c488ce7b7bd9c7	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 833, "actionid": 2149, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
dc2492ea-07bd-467b-b763-942c7caf5918	pg	44f084778721eed4791d3e2a35fa36623bbea83aa8c6854776e6e2c974f0f48f	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 793, "actionid": 1991, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8cc8d7f5-68fe-4672-b564-345f496d7b0b	pg	92cd30abf4002396e106a1b4e5914cfb97cc9bec61966e11c09ddd0b669fce49	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 746, "actionid": 2009, "rolecode": "PGR_LME", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9e7bb185-0f53-4b4d-b2a4-df15e8362db2	pg	3d06e685fa24791349dd98f023580cf8ac04f072bd25b8c8373f3d6cc90543f6	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 745, "actionid": 1743, "rolecode": "PGR_LME", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d1e8eb7a-5f9d-43d6-8af4-1a61ca7e3e60	pg	f9787e1d703aa44fc7ae9d5139be46352d8b7d6bf89b022add4502a6f5ab0499	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 744, "actionid": 1743, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
cf234885-6b60-4e6d-a29f-aac8c981183b	pg	4435b82b4b15621006b3d2d78ec99549ce801a6a1c7863092f5f208a74ddead5	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 743, "actionid": 1743, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d24a439f-11c3-470f-a1f2-e288220a1e4d	pg	c6d829b62bf1541f37cc79339cae65d03fab8c865d40426013e181a1f21b17a2	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 742, "actionid": 1730, "rolecode": "PGR_LME", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0aed0fc4-0a29-4046-93ca-d496e1bb0b0f	pg	4b7d7485d3f9462aebd007a328b1ddb88428968dc31db35e4e2f50639eb5c2b6	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 741, "actionid": 1730, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
75a9e0b2-76f9-4269-ad31-07eb648a0f6b	pg	f3d46abd7e4b136c1f25b35d7e5e561941e842b1523335fd662771bbebef3a2e	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 713, "actionid": 699, "rolecode": "PGR_LME", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
721941fb-cd16-40e3-8114-225f58d95621	pg	a2dc5c9e25b022cc07c1e24ab701c4517757255ec8bffb747ac854ee53c46ee5	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 712, "actionid": 699, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1cdeaf5c-e3fd-4f42-a28a-21087bdcfa17	pg	1411cc7afa4d725a90b3a42dde9e787653e46bb4b533e37875e8152e8523450a	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 601, "actionid": 2036, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
33c94d4d-e6c9-4f66-8b81-03cff6b4f46b	pg	b8a3b5ad1f1ef8fbc5577717478d645997d003a528e652040452ee93765d06e5	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 599, "actionid": 2035, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
11e1dfa4-b43a-497c-92b7-2bd460bd9fca	pg	062bfb3462b38204e9ff837b2b34ac9ab886b87e465ab47b08b6f41eac1ad686	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 594, "actionid": 2034, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
3ad14300-097d-48fb-ac65-cc31369a931c	pg	98514c685ae9bb05c9a9901a8d404cf891b882d436deba6377f822f8831622fc	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 591, "actionid": 2033, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9c795d37-07e7-4d69-a514-a0ed0eb80777	pg	070de5bf8537139c8827e4a7978458c310181551bac0cb0072d0d1b1477cee8d	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 590, "actionid": 2032, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7276a1a8-da8f-473f-b4ac-589e9f1b7700	pg	93c46209303102433b16450a1aa4da1b4fad7a38eba250047ae7ed0f0186b745	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 578, "actionid": 2030, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
68a3fe98-ae68-44fa-b62f-aea0110b5c3a	pg	289522e69c9e9c202aac98e5099cee0daebbcbbcc644342fc2cc35716cee10be	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 576, "actionid": 2029, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
3a24f9a7-fe93-4c2b-8998-0af30e632047	pg	f3ba6d6defce092f0e6e10e4927e57ce3665b39822eca83af01ddd3b768cd34d	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 575, "actionid": 2036, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d29d78d1-a725-4393-b8a6-cbab860326f0	pg	d1535c2f4b98bfcb9ad5f1a52254d36839246253b7e2b08a68677988d3ebed4d	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 574, "actionid": 2029, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
45d5bbfb-46f2-4b92-8cae-7a73496017ab	pg	c07b5f5d8e5c6bbbc868739a0b4ddb7bb7bf1cd6e0d71ecd726e23680d028095	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 533, "actionid": 2021, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
70d373f3-4a36-4e83-8638-1bddad3641e8	pg	585f7ddbcb6a7f82822bc89e242e7368caf8e83fda6c8d93cc23669a969582b1	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 532, "actionid": 2021, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d63fa12d-26bc-4df3-8d5b-5e8e38c83263	pg	fee7236e7e5b4ff323c4629a542ce0f4329a3a347871ec6e4d36349ea898a767	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 531, "actionid": 2020, "rolecode": "PGR_LME", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
01ee8592-f90b-4f83-a4a4-2b3203e060eb	pg	902840f8f1b19d11bf2e771032261392f2371ee5de47f166255946deeb0b8725	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 530, "actionid": 2020, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d5e9cf71-aa3e-4316-a421-25aa927df987	pg	bbb951e2a9a18c28edb4a203f1682a27e87320fa69bdc7c1f86fb498247e296f	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 529, "actionid": 2020, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
dcd1e3a5-c613-4828-bfb1-38d4b1148014	pg	302f420b10ed00202ad3a7ee69f69813070b10472f27197a623afd117456bbcc	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 527, "actionid": 2018, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1b7452a3-54c5-4a6e-8527-72a6dabe4e9f	pg	7d1d8810f4e816a68500461a4b4b05548d478329e01bbd4cd33d34cec21cb581	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 526, "actionid": 2018, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
66859d60-a827-4d72-85a8-34e43a1b0c24	pg	4180a608091b7806de593a512644a6c6e7f5bc3fe348eaaa145c9e8f26049b8e	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 523, "actionid": 2015, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7a93179d-246e-40c2-b967-c0bbfe6f775a	pg	2a13117a43b7d8f411aecd4df31d006b6616494d2c2f0d10cb2db0103d73132b	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 522, "actionid": 2015, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e4ccdbb8-7e97-4c4d-956c-058e6574c8fe	pg	ec8524ad7be665760b86301185752dc16c3bf0fb91b9bd34b3a442070893acaa	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 519, "actionid": 2026, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
3a4cfb36-9af6-4fd2-96a3-55f3a4c248a2	pg	64cd711a9ca0318d0fb436b6b851a621926d79381c6f9a354d7d01c0056d8974	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 517, "actionid": 2009, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
07104373-fc72-443c-81e8-842634c1ce95	pg	98fc63722176ec03decd008397702e61225a2131eddfa5d88b1e3cad8a8728eb	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 516, "actionid": 2009, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e109971b-8491-4d67-87f3-794d97a3f29d	pg	ce9f6c2110875a0b9ebee1257e3a60793af2a3762aaa7da0cee758eb970a02fc	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 515, "actionid": 2009, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8012b7e0-73dc-4b73-9209-366b822b52d9	pg	b93a4314629dcd424d712e750bcebf718b9c8ea82bfa9240d9af8240b14973d8	egov-hrms.EmploymentTest	{"code": "MAINS", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e65f11ba-725e-44a5-a448-51db8733ce7c	pg	78a596a24ceaee20c010a732eebabdc02c484eefb33779066124bc47ec540c72	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 514, "actionid": 2009, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1841abdd-65ed-479a-8c3c-b042e796953a	pg	2de982f2dad239313677d6ed65bf67ea13f3dc14e69b5a19e410f4c6fb457b0a	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 499, "actionid": 2008, "rolecode": "PGR_LME", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8b80962a-9f66-4550-a9c9-7ae7f4d5837d	pg	f153dda54cbaf2f3141871c46c33d3d698af9f032bddee734959e4fde7f67333	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 498, "actionid": 2007, "rolecode": "PGR_LME", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
edc7a548-9bdd-4855-beb2-3371a6081a64	pg	e0666adeeed759d466dc5a7419c63fd23944946e3c2ebf9b270595a95cdacd2e	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 496, "actionid": 2008, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
3ea1e843-2776-4f5c-b98f-a393b53995b7	pg	d75de2b4deb10933ac5c84a34e769030ae8ee8513b9040ebe392eb32e4be26a7	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 495, "actionid": 2008, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2d7f5526-bfe1-4c21-977e-3cf6847de209	pg	c5feb2191e372dbd5a79d08ff66c788756c1e68e308bccd92063416df129c51c	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 494, "actionid": 2008, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
662b7042-d9a1-4040-9edc-0ed032c28c08	pg	a78e5d994947cb98a0bcddc6cca3a6c59576ef6a8500ecd997c5548b72ea8423	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 492, "actionid": 2007, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
86d260de-8877-4a64-b84d-5c1eb7128aea	pg	b49eb89e533a6f29e6dee5c8dc9fb57e0c93da4973a8547573e1e4d162f03caf	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 491, "actionid": 2007, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
af6eeec0-3d96-4a59-bc03-6df25c3a343f	pg	12e69d2c18297df1d7eb6cac64d516fda06f8985b60f6f6903b1e83c910d7e32	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 490, "actionid": 2007, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
38791df0-5c1a-4322-889f-38e300ed23ea	pg	ad4397d79c1efb8bfc7c83221c9efb2a8c537a430df2bf5a5f0d16448cd52717	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 489, "actionid": 2006, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
de028871-e47c-46f9-b3ca-5091969b8167	pg	2b5606216cba0b8dd5d99a23b6b07701f46adb248e6b8b0c050fb29f5e73df7e	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 488, "actionid": 2006, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7e69b42e-4796-4298-b829-accdea7e1d87	pg	11e45fae976ab916ba2c563656b9cc3f39b7fcd90f33cfb5024bdebd54ee29a4	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 482, "actionid": 2006, "rolecode": "PGR_LME", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0d66efb3-13c7-477c-b086-0762d07f2df0	pg	1864cf7e9ef55084d19f18084ca781a0c0f96a265a9dfabb740bf9ba14077adf	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 489, "actionid": 2006, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0e2599de-434d-4424-a664-2bbe5e70724c	pg	cac2a01710591f76fb3c9f3ea397c5fb7bd010c76059aff727f203337b35f69d	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 481, "actionid": 623, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
538667f5-06ee-4dfd-a84e-a77b0deb54f6	pg	86862537e5f859566c1b98ca3599f1479187951b0526ac2a8336a00e3a6c8f1c	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 480, "actionid": 2000, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2fc69396-226f-4bbc-8ad1-103e39c135cf	pg	9318a02e3b8ec29d326f6688f634559560811f39928afeb7e54738ce1a9efcad	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 479, "actionid": 2003, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5f201695-4a29-461e-82ab-8ccd42faabf4	pg	d94a18b13df62ec9b55b378c20f61b714ab0523644dd8217adb126c91d814d84	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 477, "actionid": 2001, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
08547d10-25da-4464-ae1d-f3eacbd5a7d8	pg	04abb9257e7999faae967704174561b45e34d0990c2d002bc76bb9cf0bccfdf4	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 475, "actionid": 2000, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ab0752dc-1517-4ecb-85f8-0e7e4cbc1330	pg	be4d110166c9c4490fd086d53f33562e4bba13ccac3266dc3e65d68100b9c429	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 474, "actionid": 2000, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a918ad0e-2254-42d5-a657-6b079fbc7fbe	pg	c5825c21ad5d0ec2600eee28b245a061a330d6a9e1e2db6c9e3466bc778c5c0e	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 464, "actionid": 1990, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
26cb36ad-9db6-4ab8-842b-6bfe2b6d416c	pg	56bf18aa8d2f261b1331143590371ba2421e371cbb6031eb5f479a7907df068c	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 453, "actionid": 1989, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
37951f67-e0f4-44cc-ab41-e826a5b0c50f	pg	212a078c50075fbd9567c138357a1bc468ab8e1e9d4bf60301f5fa3a47f014be	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 450, "actionid": 1999, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d152d535-81b8-4508-a87d-99862bc25069	pg	bab6301501ff2d3d43b8984f2567be3cfca343fafc36262bbc3574fb39bafe0a	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 434, "actionid": 1998, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
c12a5d74-c06d-428f-9701-2fbdaeee3fc3	pg	1ed1420c86d9d4d4ed39b6c5e6c9016252201957c595f45d7eafc154603aae2b	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 433, "actionid": 1997, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
381e7d59-0115-4697-aa0b-5d37edbae60d	pg	c31931089aa9f5a4db528fd56523a208abc69c5cb00bfde5828ffbd0a9336dae	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 432, "actionid": 1996, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8b9574d9-ea28-4ea6-a774-5237639c602a	pg	6a612e685cbee0751ad8709748e95fb79520ff6c3b4e96d1fd55b5c24986a126	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 431, "actionid": 1995, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9c3e4a82-2172-4dcb-a0d2-19b7d4a6354f	pg	0218cfed662440004b9f5e12f6304782cc4222869ff97273d91ce0ee8d79ffc2	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 430, "actionid": 1994, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
caddbab5-724a-4e75-83ec-6e2c278d3077	pg	e982a910e2b056665fdfe543bba8922f5a53ce82e0085cce49d741379e8f46f1	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 429, "actionid": 1993, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e5e96102-b490-4485-8165-05c63b0b3db6	pg	18303338495b196b0fad4c21ba24a4f2238c657ce746c5236f44b1a4cbf1096d	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 428, "actionid": 1992, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
27ebb648-30c0-4ad6-8cff-a160f577d2eb	pg	0944ed3ebec09190d57a4c17953805e7a21a86317031797300d719568a4e0860	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 427, "actionid": 1991, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5910f02e-ad98-4e67-92de-87384fe0aeb6	pg	58404bd2c2ae9b28b9f91873f664e40e95ad2f69e6fc2fe070965a597132641b	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 426, "actionid": 1983, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
3d12dfcb-242f-4b15-8323-a13c5069c82c	pg	bd8efd576f846736a8f9240e6676bfef40ae45ad5b47ffe6c2d8efd690cdc392	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 424, "actionid": 1982, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
3b7dd977-0bc1-4935-9b8f-cc63a552f724	pg	58dc559e9db558d31a1bc79bad395e22b3405007a3a399bd06b007a75e1f77ef	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 421, "actionid": 1981, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5b8d909b-18ed-458b-b2bf-bfb7548a19ba	pg	da557d94cc67d7ae5873e55d93f3d31e6f65ea600dc4daf0770ddca22f2c66a6	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 420, "actionid": 1980, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d0c65b2e-a781-4082-aae9-097404055163	pg	ef94abab5f22b44887a8a3a48848f217deb21f09105a7b9918114bd37d45e197	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 419, "actionid": 1979, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f67cd3fc-2afa-4afb-bebc-5e30c4cce348	pg	68f4a21332f3274f80a3cb29197b03488a1afd6c5a6c8d9a1f8d3c92b9ef9fc0	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 416, "actionid": 1942, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
dea33765-fd54-44a6-b8b9-45f55dbcef1c	pg	b4ea68d6e714ba87f3f7059745a67ee6327dfd44596e87edcf53e7aaadb1e0e6	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 415, "actionid": 1978, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0f28b4d6-aa11-4a13-8ae4-587f72371207	pg	920c8cdd42d9e154739e6eaa5774fb112660a87116a774836d452e9ee7a2183d	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 414, "actionid": 1977, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
118fd055-99c9-46e0-89c1-4ee7d59aa943	pg	579b9a60e29c2748d9aff26c7ea71b597a09dd041bc5cccde6f691d8c18a1859	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 405, "actionid": 1972, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8ed81248-dec1-4258-b1b4-fa733b5f61f8	pg	dc6e4fa3f140e684e5388aafa36d62950ea59eb976c9e75a3f009ed028af4770	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 393, "actionid": 1971, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6ec3140f-834c-4161-beed-13378ebf8f8f	pg	6ab3ad0678f09a4d89702c8b5fcd430aae2ed1cdae7f3ed2acb00128724cf7b4	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 391, "actionid": 1970, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9720cb65-d4f5-465a-8173-462851a228a3	pg	68f6bd3cb3eab9bbe3fed0c61a37bcf45c744beb4c15386b5b3575db54261fd6	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 375, "actionid": 1967, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
675f0926-0b94-413d-a33f-0c2bcac4aba2	pg	54e345a5aa4bc308db11481452de6625a33f8bd813d14985f2bfed50f59a1e31	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 369, "actionid": 1966, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
48352681-f178-484e-b43a-8c990c468858	pg	1d101df41031fcf3b1efae71d1f0f4f8a4f22cf0a9cdf18cd208ab33f5068398	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 351, "actionid": 1939, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
67863ef7-1627-4ccd-9286-62f41e210a44	pg	77f84e158f71be0881bf0f69bab1b0f9e4001d2e9ea628cb465463da5be95e70	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 338, "actionid": 1901, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
decc3a44-4934-401f-9ded-4f61396d5e5b	pg	946728ca1a929ff712c9422d4e69144eba0788340a1c8261f783d1083c88249e	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 335, "actionid": 1961, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
33f42403-1bbe-4fa2-a988-23aae76a08db	pg	9f851f1bba58984a684e83a33c9e2a4a4fdbea48ba083474f27e583230a99d9f	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 329, "actionid": 1960, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
186a158b-386e-41ca-b035-b7f8b0595bd5	pg	684d1cddaa29f974fad9d42d0ef3c1b5c5cf056f86465f8152c8db4150a6b3ed	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 323, "actionid": 1959, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f817f565-2581-4625-8d3c-48c0ac2148fc	pg	3bb4d4f36498b20a2d3945dd85121af4fec202086445aab91820088f93b4f688	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 320, "actionid": 1956, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
daf88ce7-e1ea-4c8d-9cfc-9d1508a13b0e	pg	1eb3705fc08a3bfc1c03421f3e601fb00afb4696a364919e40e11ecb035e629c	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 319, "actionid": 1955, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1d6a6f6e-00c8-4289-9689-796d51a79fa0	pg	cbc1311b5ff8550b3d6ec862078b446747ad680d8b63c03e487649b54a6bef9e	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 317, "actionid": 1955, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5c68ff5f-2eb8-40b4-b44e-8ac06eee8aa6	pg	3663f05d985693fa226eee2a1a7ba355bcb15b6a7f7a6d99f75fb8ede1087af7	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 316, "actionid": 1954, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5f22ed25-5632-45dc-b26c-1b50e3571ccc	pg	25e311b5f4c378a97f594d6516fd1ad26d7bcebb66a46d76b0d2be67ed52610c	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 309, "actionid": 1944, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
88f4ff71-1e06-477b-92f4-31fd89ddf301	pg	6dc95f330b701d0a2fd50e2974656e8fef343ba5b041ee3ccd2d1c1e36790dd6	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 308, "actionid": 1943, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
65ad366e-025d-44e9-beed-b930a64185e8	pg	5f8e22b06b8f6ce4ead4e235f83bb810a364342ca2b6a2546f33636342c9575a	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 305, "actionid": 1944, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
195951ce-4cd8-42d5-85e4-89a78d10087b	pg	6856041ae2fef6d527d991ba563031f6c97d2bc171f38ec7dd66c4f3660c09e3	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 304, "actionid": 1943, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
877d9e63-9dc9-4c99-8c1a-86939677ebbf	pg	0ccb0b085a865ce1ad3277d2bfac7e33ac765e8a9828729ba55183a51f42b6f6	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 303, "actionid": 1942, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
760e4ee0-aa99-4d08-af23-99e0059672ce	pg	01bcaa995e6f9057405ad16bdac6be12eb122f27b2ca091b89a0b63175bfd510	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 297, "actionid": 1940, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e1dfb54f-dcce-417f-95d2-bba9a350b3db	pg	9a1a6631f4b0af9e27fe9d468085a87dafec3edac99cb3366959776623c8320d	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 296, "actionid": 1938, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8174b778-6379-4a0c-b005-9b6830916306	pg	1b011e1eb61321ca638fc40793c8d06fc65967289c324627994e67ed46526fcf	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 294, "actionid": 1936, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d1fbebdc-f019-40b5-9aee-bfff164bfd4c	pg	e566e031731e9cdb524cb2be1a77939289082de4ab7bcde842b629b0550348c4	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 289, "actionid": 1899, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
aab6cbe8-36ec-4372-9d69-77336e65a61d	pg	82834b1923bf308a482d557b812acabce156fa3f524159c14ae5f50904e2d751	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 288, "actionid": 1900, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
560f0c78-5b06-414c-9ad7-4f75c49139ce	pg	75faa04b9f5f1d584e14ebc27b8b31e7fabadb15be4be68514b0c933f1fde5ac	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 287, "actionid": 1934, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
c7112637-afe4-4332-a780-924929dc49b1	pg	507ab91f9277be444207894955a481e976fb3dc69e8a1f2b1862272c91e9005a	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 286, "actionid": 1934, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
98e7570e-d9cc-432a-b041-c505a336bd73	pg	1c88937cc450385bc3bb8a88f4ecf516f86a3bb4d77b86f6f589d68f7a90517a	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 285, "actionid": 1933, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
eec85ffc-f950-4112-b6dc-308fb6999b03	pg	285ef660b8c101086b3e790eb07c7853b23f9031ac3d47f35eaf06ab669da774	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 278, "actionid": 1927, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f61deeaa-4d87-4b8a-936b-f5fd7b21a349	pg	1c560b3bdb814d9e98e4b4146da71c98676c2cac9727d232a2c26e2553fec37b	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 277, "actionid": 1925, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
42a4580c-d515-43e5-b5f4-6a6fcaf279c5	pg	ba0291bbe1736fe7b731e690bb0ed220bcd5977bedba70ba4f6b9f3f829e3438	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 269, "actionid": 1872, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f14a8e0a-4db1-4a32-abc6-5c8312af6053	pg	7df23c9facbcab32f0832a87927c4f468f74843a6ed603fbbfb83a1ed79a1409	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 268, "actionid": 1835, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6647f12a-87dc-42de-98eb-b8f93c665280	pg	f388e704eeefcc8c18e33b74189565d62f44a599dc6f654aae13552d16cc62bf	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 267, "actionid": 1834, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
65776480-2e86-4f81-b285-a2bdbc3e95dc	pg	de7da79a016e7f0e844cb5c0a8d41c32b9ca49f2d6e2fe75bf388c2cb096886c	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 266, "actionid": 1872, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
44ef4ed1-2a65-43f8-9cfe-af662e5ec1d7	pg	6338e242b3ffb76efac7f63f1f3cafc0967e90466c9fdedd32eb65d350bc04ae	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 265, "actionid": 1872, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9cccc9aa-4968-4879-a7ef-f456f336a5b3	pg	592a431317305e8fb48c9d6876025389c9bdb271b354104ea3f526337c5471de	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 260, "actionid": 701, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
46cb1b4b-5aa9-4e15-abc2-c9f62660062f	pg	de3aaa89edcc37ef5c916f04128c0802efcb1aa11c45a238798988dd38970deb	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 259, "actionid": 1835, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7c126637-0d48-4de9-b225-d98c87f5fe64	pg	48451589ae5af98aab0d1cba9f7e19905f69c385c9fb892f9a810c783094d675	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 258, "actionid": 1835, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f82e9df6-5bc6-45d0-ab18-565fdba40b7c	pg	8add9d6cfd8b2ac20018cba1e81c517a8b5451241cdbf398b6c66a99aa61b73c	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 257, "actionid": 1834, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ed73889e-8920-48e9-9906-ce0080bfaa07	pg	ad9a01413fde10f5e769eab192fc6a2c060398e5c16d4b2b34d64d8a8187923e	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 256, "actionid": 1834, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
288a1884-b798-4bc6-983e-b3a69af33cfc	pg	f4e20b67651ca9d59187770659ebbec93d6d72cb252d42d5c4bc3cddfdcb0a21	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 255, "actionid": 1814, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ccc2908c-b41f-463b-a629-84b7c5290adf	pg	82b0f917a46e9c13e1888d0e8f27105a3137a1fef0bae29c1cab2ec02b4274ed	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 254, "actionid": 1807, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
dacb5aa7-ea52-460b-bc69-7f9a6a8f430e	pg	1b000626227e7ceb2baa419cfae42596cf6e6dcb79f1a4cccd0651ec8ddc920d	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 253, "actionid": 1806, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
61eb48ad-82b5-4250-b0ff-22e30984fc94	pg	eda43897690d8910c97d1d09ade50433f0e1fa3afeadf2ef8975199552990b22	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 252, "actionid": 1805, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
c2060700-dd93-40d9-b381-0854c81beaea	pg	788ef87cedfb8862dc6041c4a35889e0cb351b312b3d5fbc8a5e068718e31d29	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 251, "actionid": 1752, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
3e7b22f5-3905-451e-8fbf-4eeae950483d	pg	655d5700044d129a729919661888830b97f0da5859bdce18d335c21209daeab3	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 249, "actionid": 1779, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1be96620-5c46-43e2-a99f-2ce47143b7bc	pg	85e275b778c92c5df8e345336893b6247e661213fae3f896fd068edf23dc286b	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 247, "actionid": 1775, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
92e8ed6d-5332-420e-bd07-37816cc2c678	pg	768d4a841c0a94acf7d7e50ebf45b696fbafaf5764cc7160c059ce5e51715b40	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 246, "actionid": 1752, "rolecode": "PGR_LME", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
11a14c67-ce19-4b90-b6b5-b025b95d0ab9	pg	5195d59e0093c16a07c8eb501c1f8efa2ff922b124bd2bc46ce8ea0f70d1f881	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 245, "actionid": 1775, "rolecode": "PGR_LME", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e44a7b05-a52a-40d0-a95c-6051fbe77527	pg	b951ec009e482735658278929d5a674b0ef0ff4a58c26c6c19b4186ef2595477	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 244, "actionid": 1775, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8db4faaa-37da-4c16-84ae-d9df50774e2f	pg	4d335d921c533481d62c5dd1bc039851ff310db3a46536b2acd3f9336f6b7cb1	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 243, "actionid": 1773, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
94e7e64a-a09a-46ba-b170-6288d4cc41b5	pg	6f936ebf89d5dc7460bf7356d2ee5886bd5de9386ede896d3777326c4a726eee	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 242, "actionid": 1752, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9080be0c-c337-44cb-bb5e-b39e87d3af75	pg	3b5f4377334d91f5c36e9bceb340aa897bcd6a22c307ba413b8d5ead398b83f3	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 241, "actionid": 1752, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d2a98276-49b4-4f64-9353-c995cd1e8cfe	pg	1669c2f82c6a43f8daab0999925872cc88ef0ac92df753cc477e76d2c483f9b9	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 240, "actionid": 1752, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
dca7ba65-1736-42fe-ac05-339bad32953e	pg	e83beb96af63b362d346459eb5b22c82298036c8c569c911851c7cb618c85809	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 239, "actionid": 1751, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
645230a1-a316-4026-bb50-1535b7e55ce4	pg	2f27b582ae91ed5dbdf42931eb9133b755002fe5e0f477b33ec8ad17984f716d	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 238, "actionid": 1751, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
05953518-8980-4e48-89e4-b1bf9e383364	pg	bb6d27aee86cbe3d797a2d18f5046296863581647a1cfe8aa19414f1e549d847	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 237, "actionid": 1750, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
af0d9045-40d2-4e19-9f3e-8107b2d1b057	pg	9dc06bd7fcd94602bd5591262aecf68d2cda3a8a10f543d1a317b7ba77c7a6ac	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 236, "actionid": 1743, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0ee25e71-7584-4e95-9b4e-bbeaa8774705	pg	a3d7c7cd40a4889445cb81661a4d574253014ff224423b9ec6b5998a25f4cf70	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 235, "actionid": 1743, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
902bdd23-48a6-4d54-bca7-f5d08e4a9c7f	pg	f4250cf5dbd771dc90183be90a7f63160f326a006abac504f86fd365320e2a8d	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 234, "actionid": 1743, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2cfed482-3c96-41e2-b3b7-d58f03593417	pg	35b322c4173b7626953ff3c2da355a5fa7247dff25ec87f0a873c9b1828bc169	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 233, "actionid": 1742, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
259f704a-3508-4936-a360-22f35e4d00d0	pg	13b1a73f06a15123d9eff848c29a05c8535a2b9c84561e9dfb02bc8955bd9285	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 232, "actionid": 1741, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6314e808-b3f5-4293-a03c-f7311d42389c	pg	9dff66e56269fb58218cfbe4cafa5c186f5f8b9284e0e0f99657b1e60fac1c81	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 231, "actionid": 1734, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
546015d7-03bd-4e91-a6d2-581221a3957e	pg	fe7695ce209f3d628934d3b15d4544c4131d82bb0bd21335e310e8a18480c11a	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 230, "actionid": 1730, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
fb043c00-6079-43a1-b863-1dbd14ea9ecb	pg	23663c8ad8655aaf915b31b7b113e28fdc6284a48a23597c60dd5135ce3c2362	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 229, "actionid": 1730, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
50ab5639-22b1-40d6-a84a-77dd05b3de67	pg	a496dbbd73abf15a3c45ab3ab3e236a9b4ff304281795b132690a4f002c81be7	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 228, "actionid": 1730, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0501e939-4a01-4aca-98b2-17449cb7dd9b	pg	9d26a1c74ca14cba5c39fe1599bf8f7313e97d7caf87245b399402f8f8dae534	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 227, "actionid": 1730, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
fc824842-65c0-46c2-8a9c-a2a998055182	pg	c6a6c9ea184f3bdc08f62fa156923f0658554daa34ce6f72771d0701fc44dd95	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 226, "actionid": 1729, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
bb1f3db6-8968-4b5b-ba1a-318c10737ec9	pg	43635504c726bfb86f49fcad5cb2f084c3d5719207a829b87bc774801b0b667b	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 225, "actionid": 1729, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e3de64a5-bc6b-4f73-8138-bc9949b7d85e	pg	eb43cdc9f58483e4761702c94734bc99fa9b3e00a723e3f2403b2c9d606d272d	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 224, "actionid": 1729, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f73d5207-e8c7-49bd-ba6d-cef2782c3806	pg	ea71ba74972ca8a67de79a0517013c3790d10be37720bd9ece967fe05ff0d98e	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 223, "actionid": 1700, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e0c65186-fb5d-4be9-97f6-f9ab1fc50ad7	pg	66abdafe33a7a3164e0971010084eaf42e7f7f4bd057cd31b4ec588765637fb2	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 188, "actionid": 1678, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
16400267-0388-4b3b-b8ba-048097a3fe7e	pg	57bd52fa26ecf45bebade604ee97c76d31ea67f7b2d92fa133c14c85a6123278	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 187, "actionid": 1677, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a5133266-03ed-464f-9d1e-2e6b9a62eed5	pg	d7798d16a7ce78fda0a613c9330dbcf9129bbe049889696ad87665c44ba6bbed	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 186, "actionid": 1676, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7ea83a66-8e75-4fc4-8e63-33db2ff0f5cc	pg	2c575ae1d2e28cd48f2b49fa611b780bfb241d560f9acf43a85839deea099e78	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 185, "actionid": 1675, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5e271f2d-7bff-4147-9862-d965bd7c9a41	pg	bcc63e185d849d7a28b47782fe17eb9df9cac9251282675357cf7200893bab32	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 183, "actionid": 1556, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a3c47d82-de66-4d25-b25f-c1cbada8702e	pg	3cb216ba483fa1f6d6c1f3e0388cf6c47d1615d71cbeb4842ef2feeac3f8ec82	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 182, "actionid": 1556, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d10e0057-5100-4aed-882d-807df362537f	pg	87ad61b8ce0ce0bab7f71d1f7286f31a713adaf73e2d974a13305ab725cc6235	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 180, "actionid": 1577, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8c04a98e-ed29-411d-8998-abf4251e64e7	pg	a423d4118eeeddcf044699ea5e6c01f9a4db096a1aa3db01ed8f0db19af50102	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 172, "actionid": 870, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7afdac55-35d8-4896-a427-ec8c40525031	pg	2d793b41ccb779a65249d1fb6a06ad378af24ede152d7f6a744657cd2f8a68e1	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 171, "actionid": 870, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b21371a3-b67d-4692-9a44-6c7e600fd3c0	pg	4782d0f3edd0b18b6b267e19178f9892a4d4b123584f26f62a9c5b9112f7b078	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 169, "actionid": 870, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f10971de-dc18-4042-b399-14ef7cc78351	pg	5fc8152c4d216dac8deaeb179746bf78e1f218cc0a35c859ffd4d9d6e0a0effd	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 168, "actionid": 870, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
4eb1e541-03b5-4300-8ba6-a2b11ca9d792	pg	ac3644a94f6ed7516c030a2ed4750cbbab2a1fd77ca3abfd6d00d277818504a8	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 167, "actionid": 1559, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
4a5f186b-b4ae-4ac2-9593-861b3e62dfc2	pg	840190c425244af2edfaa6e81adbc0d82803bdc472f347d86755071e257d4193	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 166, "actionid": 1556, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f80f986b-b90f-4e31-b94e-0eae49a336b4	pg	8387dd9c7eb2dda24a486a0a7c0d1ffb00dcec0da47e4dcfb775c58e318ef429	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 165, "actionid": 1557, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
493c2bed-8590-4833-9807-7da378321f7a	pg	3e3a57d8ecf61b9b1fb4093d8ccfe017b26d62fb12c600cf6128c3945d13fecc	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 163, "actionid": 1557, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
66c0a73a-33eb-4a93-9471-c0a888c0e1ba	pg	470c42903f05b5bb8d426d6366e2265ff154ad3dd72c535cac03c11e5f238995	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 162, "actionid": 1429, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
4c5e2fce-3861-484d-859f-a4d418288c9f	pg	d79c18d03695e8f79094ff55e94d0f5aa0a61fe349e5160d514e33a8076d7b36	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 161, "actionid": 1429, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
10739322-7b51-4801-944e-6ecedd09bec5	pg	dc290263d886d02847c6989e6cd44efc664d29f512771851a08c282a3e2a843a	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 160, "actionid": 1429, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
dcb18b73-f057-437a-94e7-24e43055d175	pg	65e09f1f79c4ef462ffeaee35464f21b2b6dfb3acdf525d0de1a73e77213a30a	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 159, "actionid": 1429, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b81a40ac-8097-4883-93c0-35b989660d5b	pg	071444ece26facafcf650a825070d13f519a89f4b0f6b47d68564f486412ffdc	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 158, "actionid": 698, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7b05d432-4afe-4c14-a43d-39fd4b332269	pg	c266f828430713ed52abc04c017ef14d468b50e692d3787875366b1dfa350aab	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 157, "actionid": 695, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
133d68b7-846f-4afc-8169-2e3c8e29d842	pg	68b36244167c5d7f0b957fb930aee3ab6190e989cbd77729b1c03de44a977fff	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 156, "actionid": 1523, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b787ba73-6641-48de-9362-ab56b4fa5293	pg	36af90b8168ce0cbcee77b6edebb8d99b0943789ce4a66aa07426dda2afb4c56	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 155, "actionid": 605, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
64a10d79-701e-43ee-bb7c-e8da0da5e74f	pg	093e0407cc8ff8662a7c5be4c2f45f7aef7d022b4c194fd8a9db6a85c2c60d3e	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 153, "actionid": 700, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2e1476b2-e960-492f-8142-b3ddb14ff41d	pg	ff64eb0a07fe77eab8ff6778e4861dcb91d510d13ee96ed55ea42eeb49c92d56	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 152, "actionid": 700, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ec3a41e6-1785-410d-84c0-4e2f32b2f885	pg	1b7fc4f23d1209215a52a0b3e52c424b08795878a0982f9150bfe53041e0286d	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 151, "actionid": 700, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
4ed22839-8118-45d4-b9eb-ae421ff885f2	pg	d0a599d8a026246b36a7dc0cc048e175e9806ad9e0b6261b4adc7c29053748c3	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 149, "actionid": 699, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d1a88240-7067-47d1-9718-f772456c2ffc	pg	e1ee818f929d54e792df288986751073eceae59501b23db0c2c64ea408c187d2	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 148, "actionid": 699, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1138b9c0-b25b-4c85-8346-35399f6a8fbb	pg	2c2b2de7b3a17d4fc8d3750d112cbb000dbd1f0fbc685deae010be27b73b6cb2	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 147, "actionid": 699, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b77dd822-c8db-49e6-9c93-19c991f3900a	pg	5cdeb7d9f00639c90670066e088e167f3b842106818a94c967273c2715bb060b	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 145, "actionid": 695, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
aeadc90d-3d88-4e6b-9e7f-e9902d7e5505	pg	cf12aa740a79133a0e846e5ed5a02f5f54488390f865d0fe920d6d7b18bedac9	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 144, "actionid": 695, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
c909ec8e-0106-45f7-b249-fe16a9a1795b	pg	aee59fb0469570966291b46e9ff9cedfe846d951b90efe6141cdf07d1dc24a57	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 142, "actionid": 698, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
bcbccb4f-a9ee-4bce-9f9d-1ef6329c1a10	pg	1f5d45c020d68e4b5b8635e170129604eec17fa78e90487c9d6457b05eddf5c0	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 140, "actionid": 701, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b347159c-7d65-4250-9980-7353999480f8	pg	c3976c0ff9fa475dcc1f1fb4effd95bd867721fbc8ce055e028e65f3ebe3ba77	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 139, "actionid": 697, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
aeb2bc0d-0bf9-4997-ac20-2694df5ff8f7	pg	97aa25e99e64a12fc90db6eed3f87948574672c2fde9181299c7b5be51fe65cf	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 134, "actionid": 1531, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1fce699b-89e4-4efc-ad75-4e6e50f1ef47	pg	32dd487a93495d99e9a05e7186f7bded025cda48fd3fccf8a6d798f07f13b694	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 133, "actionid": 1530, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9329157d-57ae-4caa-8232-aee425bf429d	pg	f1a051c4b95c1bd9d238357f15fb24a3978021c188b156d6f234dfd28398b369	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 132, "actionid": 1529, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e0981b34-6ce7-46ba-b7c6-9f46eb416115	pg	034a0d4e6db6d200dd63252127595c595baa5e92e5c48c62be4a40e28cc5edd7	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 131, "actionid": 1528, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
97f1f803-dc41-4cca-9352-43a1870ddf6a	pg	b02754bffdea64628fd292f54cfd528fab3163df846c322786025d1777ff0ca4	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 130, "actionid": 1531, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
977cc318-c36b-4f01-80ac-717652ae436a	pg	8921e15d06101997c986792dec53676bc2f2467243de4d1ae9080810e75e0bca	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 129, "actionid": 1529, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
63adc1f9-61e9-444d-81d0-24ae0a7cdb21	pg	c4fe9c44894a1909801cc765b0eff94350fbcb39666d382a7a1e125d31f40315	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 128, "actionid": 1528, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ee05dbd9-4ce5-4e40-b301-29270eacfcbc	pg	8f7fb1bf6b542d358dc546837f5e37fa100fc0d6ab5b16d8b05531a1da5b8460	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 127, "actionid": 1531, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9c087e9e-36d3-4328-a5a3-8dd4a4bf8fa4	pg	1b7d57e78c4838b86ff055ba389e69071f735477c78d3d5bb240ed42b0079f87	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 126, "actionid": 1530, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
39a0ceab-3ce5-4ce5-b79d-7c447630ec19	pg	ef4fcde6f88a9c94fa5ff59fde22f1fac0722132f5928c15c9ce4f0f86faff53	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 125, "actionid": 1529, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2cd644b8-8e2e-49ee-986a-d2fc1dfd3643	pg	b579eaa8307645c9f242a4df69c8f8218d8a13b1e6bb5935b484d3c1ba418e10	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 124, "actionid": 1528, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
da9efa0b-fb70-43fc-ba9a-00750aacc19e	pg	8d2748e8156b4441c2f039a1cb1f7b2d805f0c68e825af22604ebe8ea215c224	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 123, "actionid": 1531, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
12bef83d-87a0-40ff-8694-b7ea54ec80e2	pg	090f707f142da43e86e8273002c1af333e7e54bfb9a3719dd211a8edb2525173	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 122, "actionid": 1530, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ea88e62f-8619-4fa3-acb3-30a38bd61afd	pg	84e08f4fe9eeefd973d38e8311938fa68a79d414f588abed4fb28f89efaea3f9	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 121, "actionid": 1529, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
487aff72-7286-4840-959a-be120cb8b905	pg	db5447b39677fae4fa2190aed6ca2050e3d9d4bee0bedb27d773d91df34dda4d	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 120, "actionid": 1528, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
89b3208e-48ce-4fa6-bf68-eeb8f1332b6f	pg	b64b73bb336946ab77ca6e04c4785a36e64258dba822fbc990dee1fb39ce7a13	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 119, "actionid": 1523, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7312c09d-bb5f-4b13-8f06-d7f1732504e1	pg	8359190d58279f4b6b2736c8f9869ce7661878b2e5cd4e3f86cf1dcb14e9a5a2	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 118, "actionid": 1522, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
3ef2c291-c7ab-445b-a1d6-ba152bd960ee	pg	4ff53f55b5ff6679adf447213effca76bd493b5ca532fcdab46b45ce17437dbb	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 117, "actionid": 1523, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
29b369a0-d5e8-432f-baf4-ce4351d09967	pg	e08c9c09860521a23dc866c5a6b53b849ab51d4707e4ef354492f85bd6aa68ba	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 116, "actionid": 1522, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
4d82dd83-f7e4-4e5f-8a49-5f6c56862bc7	pg	95267a8049e2ebd2dbdf604eddfc035610a81e606e2d5f026bee4c1f0b2442db	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 115, "actionid": 698, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9c15750e-8a0a-4024-bcac-24068015cf58	pg	f7d9f4b291a6f3674f969ecc5273324b0e57814e65b93c2ed15b9b03c3c5b6f1	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 114, "actionid": 698, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f5d7da1f-cc5a-49b5-af5c-3d450deb2b6e	pg	d6528d5bef28bb201e3c9205158099ce61fd65984396bca3d1cfb5b4cd616a13	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 113, "actionid": 1519, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2b91352e-3d97-4f42-8c39-5698a6192d76	pg	cad3db417d2505d17a0e4f0f5abf9c2ad1cc5c643287b5c5fe2f6f79403ceefb	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 101, "actionid": 1429, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
44845418-006c-4e48-9a98-4da0a46ffcf8	pg	414e2e5498fd92710982544e5c565c16c752e05aac3dc89c4e7335403bdeeda7	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 100, "actionid": 1221, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b75a629d-a2ec-4370-8857-23530cce9b89	pg	387f3281b3404f039dbfbf47987222fcb95fb5dcd0fe05a41f7a1a39cfc39f17	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 98, "actionid": 979, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
397fff0f-f739-44d1-8161-4fde3d6a02c6	pg	4f4bd84dcb7b36371e6a15e72d05abe8f76e767607f2e52075cc344315d4eee4	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 97, "actionid": 978, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0f183e83-e31d-4afe-bab1-258e63e13146	pg	0f82b462dbf88b13478454b96125f43202a8c3c3370fd5700f0ed65b98d7dd71	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 96, "actionid": 977, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
cfb5c7e0-3ee9-40af-8959-948d6ba82019	pg	8282af95d445a2dd45e40c311a8e5442621c1ba22248ffbf83ba6286336253e8	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 95, "actionid": 976, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
33a8deeb-7f4a-48e1-955b-7e4bf8fad857	pg	a28e83151caa6a93b6a67499b17bcf6c1ba7219cfc07670f609e1e106f116611	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 94, "actionid": 954, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
46d7c52b-1556-4b23-bf27-14833f506079	pg	c08f5bbde9281181d2984ebb03991ef833eb5477ec33240c43663b1592dbf296	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 93, "actionid": 948, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
84eed12e-6401-4624-bbd8-e85e07ea11a8	pg	b0d5eeb75c2fa92db4b1909f101574b5960c057faf4b0cd33edcc2168b8bc808	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 92, "actionid": 947, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
cf04ea6e-b868-485d-9fe1-8a45f0bceabc	pg	3e628f34be49249ccb0d758a8f0a05825f2242c338a0a9569676fe74108b5a40	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 91, "actionid": 883, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7d06969c-4bcb-4fa3-842c-7788c9677be8	pg	be90656c605397a5ca68c801f6d8416f045db0d2daae7656ac75df61ccf3d71b	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 90, "actionid": 874, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
107feb82-aaa0-4586-9fea-3001bf6e7ae9	pg	026f82311f0c8c694cfcba2f04dc2df745d4bd4b0dfab81c298feca6f2040d21	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 89, "actionid": 873, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a284af11-a228-4100-b391-de24243d8f8f	pg	effcb050bc5d96d2caf18c2c9b8e7b34de14adc080929c1ddb61d6e7e53efeaf	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 88, "actionid": 353, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a5dc1933-c132-486e-88a4-e7814977e4ca	pg	0ecc8c98700380cbd5b3e326a6e63a7a39fbc7fc02fd1f15ab1faf08351a2f2f	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 87, "actionid": 627, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e6233c0c-a9c6-4432-9038-f8a6834abd0f	pg	a65e99f5bfb999712f21d9a983b1b45c3b144df031412c98be0c653f9d7a1bf4	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 83, "actionid": 870, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e0987485-c078-43f1-9226-4eb16c835390	pg	57b848fedfcb095b5a1740d2403f7132f8227cb59c0a73381011648b04dc2f58	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 82, "actionid": 701, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ac69a32f-0144-4dc0-b684-e45cd8e529a4	pg	ae1eb762577fd0b4f61dae04fde183f6fdd9b09c805547ada18663697fdc7509	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 81, "actionid": 701, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b95524e4-2767-4569-a7b3-0eaa43e49a33	pg	de436521fe0c59f952dd822f504722c25d9d4fa0af6711d80278c9ceed0751c0	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 80, "actionid": 798, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2b099472-0774-46c4-9ee7-d08f1879a001	pg	e3cb47bba7ad2b9df292c7884db75a641be7ffd05766f28a67004a6e4c94b884	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 79, "actionid": 797, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a2506feb-87ff-4801-84db-111820417d8e	pg	84d64efd7ac9289d88c48307e47b8495ec74e9e2d9f84ec5f0c320a2d0b103c4	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 78, "actionid": 796, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
960e9760-5a22-439a-a30e-e207c39e2903	pg	1c9ed0afede14311cd463636123809b7a89eb461f528c988076e6180ac9844fb	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 77, "actionid": 795, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
64bf51ea-434f-41d9-b0a0-4460844c6384	pg	7fabea114ea9d070e19ee85286a2c853f07bc013c165aa5e289103530906cec2	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 76, "actionid": 733, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
043922f6-fd3d-4760-8854-90bc4d3b8b7d	pg	2cd5237ea87f47f89eab1c60214da5ee1ebcaf6c6cf2da747f904a704c937676	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 75, "actionid": 732, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
dfc729bb-db90-4ccf-bdde-93314ef4f734	pg	c196f73371e57f206949d3d60bbf624a9448cca3cef2a7bc5c2ed136773854a0	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 74, "actionid": 731, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5ed24b69-c56d-42ac-831a-57134a12771f	pg	300dba4ce8ceb2eb782f024172a56e4472076cf07e05816db9fb28becada98de	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 73, "actionid": 730, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
16c11555-59a3-4736-b395-5e3cfe4c3087	pg	7fdfb048a6e732b85ff41021cb62bcb332d4e45757d32639509ecd56e2acbce7	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 72, "actionid": 729, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6652acfd-b9e6-4547-b3dd-215bc12d25a4	pg	b0e2a0dd9ec3212f82e14ddfd6e685e133ecc27d306b238ff0d3c3bb2bf19f3e	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 71, "actionid": 728, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
00a5f35e-9693-476c-8b95-c8834b99125e	pg	24e3fe04a0e001589822c1fb88188d84f17cbaf42a262416bd5bc32e21b44f84	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 70, "actionid": 727, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a52a38dd-e63d-4998-904e-335ff6f5a459	pg	6c821606fe8f3ca682be00e9e9e0a4b6482b34109619692d7e2bb596b918e792	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 69, "actionid": 726, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f4aacd11-407d-4402-a468-bbda600d75ff	pg	d0fb3c5623ec9538db082f9a9fd5e6e82d386eb21ed432a5d942b96e514d37bf	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 68, "actionid": 725, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
59d8d637-1ac8-4829-84fa-0984a6278168	pg	8deef8bbe7b5f37ecc5a5eb3efd88f2969437f425d6f55a17b3464f3ba89a998	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 67, "actionid": 724, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
09c29b4f-4480-4ed6-9f3a-a6445fd16c82	pg	dda909e163d71df6c4a929d4bfbeb08520c1ba34c3aab2e820e5310c8730d720	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 66, "actionid": 627, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f58efa7c-4120-40ea-89db-a12ea8aacedf	pg	1cde343daa87308ab4d9cd9ff71898694e76496a4bd2e8c76148749fecb61bf6	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 65, "actionid": 623, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2677f8f0-8286-4733-bb0c-dd303439d624	pg	6e7911b124577e981c71357cbb0d09551aa282c6f4b49bab8041966276688aec	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 64, "actionid": 254, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1cc0758c-25c9-4f03-b22d-d58af0683ec9	pg	1ed1d61d04816b289dea0c6276336e62a95fe2ad0642ad6c731ef8b5b28991df	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 63, "actionid": 254, "rolecode": "GRO", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
32142e73-6d79-422b-885e-7a6dddcee0ff	pg	519918cb19cfed9b0ca53ecb445d07f3dab75b72aade3a161daedb1eb588a44c	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 61, "actionid": 582, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d6b2c1dc-d519-4c71-80aa-c35d5d23ed81	pg	5f420d84baef2eb7a295a33d09f386512945bc960a2b76b2497947f84b904481	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 60, "actionid": 604, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
170d7f77-e479-456d-b7ff-e625430432f2	pg	ab6e876102a7723ab57e6892f60be96625bc255dea2523373fb3f4af33937fcd	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 59, "actionid": 605, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2f4ef09e-ed52-48d3-810b-2d9d6bee5b6b	pg	4828b3ab3c1143d393b29c4ad6597813dd408d4f04f35f479460f56bb44ab1e3	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 58, "actionid": 594, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e566a754-8424-49cd-af8e-6e6b5ff3d4d2	pg	fb19ff3824ad3a9f1cda8ed892a08ddc5e1548855df75290a6652224b9e17758	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 57, "actionid": 594, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
800d1463-7022-4c3a-b20e-54f11ff60486	pg	5be4e6cfe9d42b567ab23b1f69699e5ce6a28b43cb3af80c032b8a9f3c43be07	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 56, "actionid": 695, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
521a123e-9fc1-4b48-bfd6-1617d2d12fe5	pg	59733f844ea6cd15e5bc10e4ec0d3e0ba0117097528e193c3bec6f70d23b3aa5	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 55, "actionid": 355, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0159fb6c-4fdb-4a93-b561-bd4148faab70	pg	44408ddacc1523f31e7aab5132383114e7875f8736f465af6346801214d4ff9c	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 54, "actionid": 353, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
06224f4a-0dac-4885-b117-f8b83ef73807	pg	81ce38d5774d369963689ba610c4079b913d4d7847c9855b7cfe32dc19f3c11d	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 51, "actionid": 355, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d47b53cf-3c09-4b48-b00b-36b8e23bf550	pg	4aa3083b498bb8f0624f023dd52f830f4964ed8e8405e69a1a37196817005f3d	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 50, "actionid": 353, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8042c791-0488-48eb-a4d6-92e055d58368	pg	d2d1b6d7788b51354db921a37f8ca2d71f277eaeb53782011c20480f289916cd	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 49, "actionid": 207, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b2429f5b-b20c-4c55-a374-aa6c18522eab	pg	34ac0aa26a61e90c2ce156fe8d488d0dfc50e822366891cb6120c72a407bdc35	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 48, "actionid": 258, "rolecode": "EMPLOYEE", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
59fd1f6d-cf34-4416-bca4-28c10c7576fe	pg	2011cef2acf81b01d8e724e4bea1b517fbfa5357bba3d87ad000fa20bae916df	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 38, "actionid": 701, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6f10da07-0a18-4b0e-ab65-d57598cc6431	pg	f7d63ac6019718be1b199d5ec1199f4aaf16de5e6f4bb6538dc4155dd66c1b62	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 37, "actionid": 700, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
fcefb4c8-e0b0-405f-a6d3-e0289d0edf30	pg	4f6e497ebd38943bf06890d621dc6e359a4ab0152f0f481f0fcdcf9d836ebce6	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 36, "actionid": 699, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
fef9f53e-ac30-4d3b-baef-af01d3986d93	pg	9da9430f426b9dc2697c3661abe29933ad446355b41aec27b7fd5e05f9a8e1d3	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 35, "actionid": 698, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6b3e163e-b490-477c-bfb9-52ed7dc1b284	pg	dbf15e5ce5f2320f796debc64b9c47a5e96687de1f66191fbcfa884697714672	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 34, "actionid": 697, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6bf4b903-d729-42a9-9895-acfab4b6039c	pg	3d2f4a7ea87c6966983f258b448ce27f515f6878cc9acf8e65bae597ff28a2cc	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 32, "actionid": 290, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
111856d8-94b8-4cd1-b7dd-6289e2779e78	pg	07a75de8afcbdb2d36f41e69bafa1d647dca7c086c7fddb8335de4bfdfc28130	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 31, "actionid": 696, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
cf5a3be5-aee2-4bbf-b827-3d96fa2b2fa9	pg	4b095ad4b9e3cee9b8839c599e6676a691210a18434c84fa01807b8f2e87f42f	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 30, "actionid": 695, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a9a72574-a8b4-4471-ad06-463e1288ca97	pg	a38dfb73178f5ba0ad16e70fe4ca7d84409d6b2aeb0ff2735dab9a994fc41937	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 29, "actionid": 694, "rolecode": "CITIZEN", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
84730a36-aa9f-4c9d-a44f-cd3537567fc6	pg	894590cd99ab5b21d885646d48d6f765763435b1e3ccdff56e38b8d7e1aea341	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 28, "actionid": 694, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
10e654aa-8165-4f5a-8ecb-3b2dfdd115c1	pg	dae86604fd0c9c28f54df276e4cd164d8decc97e603b00687f1e398dae3e496e	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 27, "actionid": 278, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
4c289693-fdfb-44a8-9185-e389ebc0af02	pg	7be519455d11bc5abfca3dabf03c80fd87f4d9bf27fdbad96dff04d116109e53	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 26, "actionid": 277, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
87e6811d-63e2-4524-a95c-995532aef756	pg	73ab871f0b4e4e10e6b8c9b4df71ac872afc7ab35e770859b74f7c10c8cb6fe4	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 25, "actionid": 276, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0163dc88-658a-4a90-bf04-437693ae20df	pg	d8bb15207f561146bade59c5b9c119c78c9e84cb37762eb277db1f9f2044197e	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 24, "actionid": 693, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2237e329-41d0-48bb-9d0c-1650cbb925d4	pg	665f5a2567412d5a9f3458717eaafdf899b134bb6a8f093e81ce36081877bdf7	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 23, "actionid": 692, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
00cb785a-ff3e-488f-84e4-0178e02dadc7	pg	88774c86d81965fa8b698f930e5833420b6032871f39e5a639deb3a19059a535	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 22, "actionid": 691, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
536e3465-146c-4eec-85b6-a7f4242209cb	pg	a9396bbe82261342ab00656f70d5e134025219622ff09e63374b03f80f4c1906	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 14, "actionid": 266, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
fec05394-8526-4cab-bfe2-ef5940497f13	pg	317fab4299ac00aeda2cca310a496db8c9470591e4dc952cf32200c5a9c0df7b	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 13, "actionid": 265, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2c390854-5f02-487a-aefc-c7205901617c	pg	5e2cbc60c13e78f8827ce8cabfe24b1b1ce82151510c35475fa61cf241396339	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 12, "actionid": 264, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7ad898c8-d612-4794-8702-7aaae304a165	pg	90a05af4415f4e0b9c7294006f6aa57fea724b71182205748e296cc46567284b	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 11, "actionid": 263, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0a6f0bd1-d7d1-478c-a7bc-c0b42299060b	pg	69c91950970ef5f523f5c3774cfaaa90de5a7474846d11544b26b2f472cbab27	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 10, "actionid": 262, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7b15568f-065f-48b9-aa26-08a862c6be61	pg	9a040b8c57198e3872e56d3439b1a10839ccae95ad0a5739bae9fecfc11fced8	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 9, "actionid": 261, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
bfec03e8-100e-41ac-a60b-7c2580c53d1a	pg	c7293e03d1c57b3b06c7cdb8f5d35ecf831d9bfebfccdeb3df5482e4ac3c546c	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 8, "actionid": 260, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
35877794-a25c-4c63-ba96-ab0a14c91cbe	pg	3953e45c4818d6415a6ba61eb437e883d69a43fa4e9a216ec7354e31c30cf142	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 7, "actionid": 259, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ed926875-2fc6-4329-981d-53ca0ada6aec	pg	d6235f1643cc129c098667f5607510e823987de3e8128051cde98e5ca1a0decd	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 6, "actionid": 258, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0b42c38c-53e2-428b-84dd-ec7666ff33a6	pg	e8c6483d851045e99fc9c49e351705d1d2d8b130b571f033571189436b9407ac	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 5, "actionid": 257, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
4d290990-fed7-4bd5-a600-61ffb9a8e70a	pg	802f4156070f544fc8275700639447133441521f41708979d698b82d1719e971	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 4, "actionid": 256, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
32686b39-5d73-49a2-9a54-8d41c2113202	pg	809bc952c69458e2eeeadc72fa3f95503036ab3f731ba77e7ef69281ee36fe9e	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 3, "actionid": 255, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f6fb944b-4951-4ced-b751-de3ee002381d	pg	4a1428bccb2a51bf081bd0d28200c6b9924199cd743381a76ae055536b3dcc27	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 2, "actionid": 254, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
85c9775e-162d-4939-ac0b-cb970715d365	pg	be3e69c8552865b8313cea62c896b79d08158d943882b5b2e9e8bf19ad0f4b8f	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 1, "actionid": 253, "rolecode": "SUPERUSER", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a62b33dd-60ee-45f4-afa5-31d2256f5b37	pg	6e83e179fe2463785fc6df459d4598e30bcf8831609c45ddccb653b59e45b68e	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 745, "actionid": 1729, "rolecode": "CSR", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b26379b1-b047-4f51-9127-a8e6be6d7df9	pg	6d4ccbfafc7de1eef40b4be4934ba5217bb12a3b37e30082e62ad7009552f60d	ACCESSCONTROL-ROLEACTIONS.roleactions	{"id": 745, "actionid": 1729, "rolecode": "PGR_LME", "tenantId": "pg", "actioncode": ""}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e98cfee6-3dc6-42ab-a1dd-49e8c2f3af0e	pg	157863b908edfe94c6b767c0315165f84d26ce20b708db8af19766a96f975bb9	ACCESSCONTROL-ROLES.roles	{"code": "TICKET_REPORT_VIEWER", "name": "Report Viewer", "description": "One who will view the reports of tickets"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a8c939bb-6108-4994-aac5-84398ece1f2d	pg	47170e983c27408b53a065cf954ae439c7500c22ee96751d30cba07a2eee966d	ACCESSCONTROL-ROLES.roles	{"code": "PGR_LME", "name": "Complaint Resolver", "description": "One who will resolve complaints"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ee732c43-4367-4706-88df-f92730f37902	pg	aba232a466c823afa382219cdbae7ed87cbc8046f9747a9571f22bcb915d0e91	ACCESSCONTROL-ROLES.roles	{"code": "GRO", "name": "Complaint Assessor", "description": "One who will assess & assign complaints"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1a6fe2cf-2f77-4ae5-ab7b-907bff2c03ac	pg	272689c4e9576e424df20bca09339e1d993cfed8aa154395d85acaedbc0cec5e	ACCESSCONTROL-ROLES.roles	{"code": "CSR", "name": "Complainant", "description": "One who will create complaints"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
02ac2515-0145-4487-9d0a-f6e04cec99a6	pg	7f555489f87b3e530966b2a11d7ae6e048ef90c7c8da0504d61fcb5004e9ac1d	ACCESSCONTROL-ROLES.roles	{"code": "LOC_ADMIN", "name": "Localisation admin", "description": "LOC_ADMIN"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
49c99b1a-71d1-4e0a-8b56-698b9b96c099	pg	1bcaf9ad6d80439df411f35e7f74cf8be7c1c1de7e3b0ff5cc436a3d9951ce37	ACCESSCONTROL-ROLES.roles	{"code": "MDMS_ADMIN", "name": "MDMS ADMIN", "description": "MDMS User that can create and search schema"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
3853e856-ec41-491a-8b55-dce9b06efcc6	pg	202f1c86d385a0cfd04a96061a0312ff02e1614f90117eec61390b8a63b5bd3f	ACCESSCONTROL-ROLES.roles	{"code": "REINDEXING_ROLE", "name": "Reindexing Role", "description": "Role for reindexing for encrypted data access"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
037ebe29-3d4b-483e-b0e9-c263a3c4a5a9	pg	0c576081018117feddfc49892374a0b8a549f7bc17a3878386d236677e3550de	ACCESSCONTROL-ROLES.roles	{"code": "INTERNAL_MICROSERVICE_ROLE", "name": "Internal Microservice Role", "description": "Internal role for plain access"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1fcc7212-2320-4cf1-8ad2-1b0af20445fd	pg	9c31f533fa0d4cd87baa88455501751d8a126b325269d41060d6e8bd4319276f	ACCESSCONTROL-ROLES.roles	{"code": "COMMON_EMPLOYEE", "name": "Basic employee roles", "description": "Basic employee roles"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9beb4f33-b1b2-44f9-a0a2-83f9a238b6f8	pg	39aada8cc74c13cfc6696d1437c6b3d3311e53a98a8bb312a5997436e27cb342	ACCESSCONTROL-ROLES.roles	{"code": "SYSTEM", "name": "System user", "description": "System user role"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a6674ce0-467f-4a9a-a085-602ef597415b	pg	d7537d03da2078f117e306de760e0ee9a50d7734aca62d32b60dba90d2147696	ACCESSCONTROL-ROLES.roles	{"code": "SUPERVISOR", "name": "Auto Escalation Supervisor", "description": "Escalation to particular role"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8a9fc579-7458-4d57-970c-204986e64a4d	pg	adf5c5e0f94708983358f0fe3b1f8498fdc12a3615ee5c4d97fcffbe691ef0a7	ACCESSCONTROL-ROLES.roles	{"code": "AUTO_ESCALATE", "name": "Auto Escalation Employee", "description": "Auto Escalation Employee"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
de576462-abb3-4168-b4eb-15d74f9db209	pg	9574fd7c89a20234e602b4c9cea820e0cdcdd812b0bfad5c3032b9c121665e9e	ACCESSCONTROL-ROLES.roles	{"code": "QA_AUTOMATION", "name": "QA Automation", "description": "QA Automation"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d4a3e927-4b72-4484-8935-e697db84990d	pg	285381ae0f9e3b68ad1c794cc86cd0f19f4a05e1d00f82862428701515513fe3	ACCESSCONTROL-ROLES.roles	{"code": "HRMS_ADMIN", "name": "HRMS Admin", "description": "HRMS Admin"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
75b8cb6b-5ed1-4602-bb7b-aee8f722780e	pg	d152fb9523c59ec39759522de322e178c585e7644e69ccbbf77c2b3b0f20c724	ACCESSCONTROL-ROLES.roles	{"code": "SUPERUSER", "name": "Super User", "description": "System Administrator. Can change all master data and has access to all the system screens."}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7c1e0cfe-79a8-45c4-a4db-3d965f1d403e	pg	df87a9ba264c01321ac243ad46add4787ad13c9a13b7a45823ede3f6444852a4	ACCESSCONTROL-ROLES.roles	{"code": "EMPLOYEE", "name": "Employee", "description": "Default role for all employees"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d2a106d8-005e-4ef3-8104-fba93d0c247e	pg	0b303dd0ce3ab27c557c65acf9d9071ac97bf0846d3ae5a5cb15253cb697ea99	ACCESSCONTROL-ROLES.roles	{"code": "CITIZEN", "name": "Citizen", "description": "Citizen who can raise complaint"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
94251dd5-b2c7-4cfe-af56-a91f09c8329d	pg	456b68a3345b31a74bfde1d2ebe00a602bbbe4b4d8369896e76ed4d5e102502a	ACCESSCONTROL-ROLES.roles	{"code": "ANONYMOUS", "name": "Anonymous User", "description": "Anonymous User to be used in case of no auth"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
76927703-a6fd-4192-afc6-9c7ba40afb23	pg	9be5a187689c51d1b1e1f7e451adcffa2c3bfad1bedcf3ab47d4cd536f113d2d	ACCESSCONTROL-ROLES.roles	{"code": "WORKFLOW_ADMIN", "name": "WORKFLOW ADMIN", "description": "WORKFLOW User that can create and search Workflow"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
acd76f05-53d8-4591-8fbf-0c0c7c88ca6c	pg	2215b79651c369c9c941a0fd58ebebd6a14c2596ea98cb8304377bafd110370c	common-masters.Department	{"code": "CENTER", "name": "Center", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8a6b9737-9c20-4213-909c-6dd162d1afca	pg	702f50156ef6805e5b3bfb0fb6674f857fa0989c49a9ad53c9fc671dbe0d5a67	common-masters.Designation	{"code": "COMM", "name": "Commissioner", "active": true, "description": "Commissioner"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ebe9c7d6-8b94-470f-8e4a-60f02158a402	pg	cd109a200d8b97e0de3855e8128ffe1e7ffeccb8ab6b1f9f0225a997ba295f49	common-masters.GenderType	{"code": "MALE", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8a4eb565-fb52-4a76-a050-72d8a6fab681	pg	25f1014a1655b088fefdf9243db06ea4cdf35afe8a57023fd9b7015af0331e58	common-masters.GenderType	{"code": "FEMALE", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0d646692-c356-4e1b-a31c-2ff44043b13c	pg	31cc7c129034c3f79d01aa2b202382087810c43fafa06dfe0e810b80cfd1dcd8	common-masters.GenderType	{"code": "TRANSGENDER", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
58fae0c2-1491-4814-bd9b-47f4ce1c4abd	pg	f6734ad57526435f866e443ea1b3f2a7464b8a5544b71106237893313a4bd272	common-masters.GenderType	{"code": "OTHERS", "active": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9696efea-3e89-4c59-830e-0f01f79a8551	pg	2f322e4db5570f96c5abb7ad20f113178fc6879c7eeb37041aa09c52f62b7957	common-masters.IdFormat	{"format": "SW_AP/[CITY.CODE]/[fy:yyyy-yy]/DC-[SEQ_SW_APP_[TENANT_ID]]", "idname": "sewerageservice.disconnection.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7e7361da-6e6e-41b1-9a00-80ed7becde14	pg	e805056cc2c704ca2c2f7e0afe94ff1189f50de848d0106176dcdd3b035972ff	common-masters.IdFormat	{"format": "WS_AP/[CITY.CODE]/[fy:yyyy-yy]/DC-[SEQ_WS_APP_[TENANT_ID]]", "idname": "waterservice.disconnection.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5f34ff73-8808-4fe6-b305-f6d039421ee1	pg	cacd20eedda34571505935f30fc142c7393de5dfba1fb0a376ffeb73fca7c518	common-masters.IdFormat	{"format": "DT/[CITY.CODE]/[cb.name]/[fy:yyyy]/[SEQ_EGOV_COMMON]", "idname": "death_cert.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b4d4907f-b943-48a3-8977-1136e0a04454	pg	07012be27768de88aa411d12bb8b16f5b2ccaba1bf6ed00e16c89cadd84eec14	common-masters.IdFormat	{"format": "BR/[CITY.CODE]/[cb.name]/[fy:yyyy]/[SEQ_EGOV_COMMON]", "idname": "birth_cert.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8c5eec74-27ec-475f-a637-cc0b19d70505	pg	3679ab8544554bc0a964c7ba2054f0e8787914035ebbc47658a347b1b1fd8bfc	common-masters.IdFormat	{"format": "PG-BP-[cy:yyyy-MM-dd]-[SEQ_EG_BP_PN]", "idname": "bpa.permitnumber"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6f2c872f-a8dd-44af-90d6-79cabd8cd6fe	pg	45ad94c26d6ac3d6477c9ff48a8cb2fa3fa5eb2bd913a92a872ccec1632f95ab	common-masters.IdFormat	{"format": "PG-BP-[cy:yyyy-MM-dd]-[SEQ_EG_BP_APN]", "idname": "bpa.aplnumber"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
01c841f3-54de-488d-9e3a-cf748040762e	pg	96efcb22b85b21feeec751aa440aaf8efeba46b0bacfc2d4a8530ad18fecb335	common-masters.IdFormat	{"format": "PG-SK-[cy:yyyy-MM-dd]-[SEQ_EG_PT_LN]", "idname": "bpareg.licensenumber"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
812f280d-80df-42af-8c43-d50d1f420702	pg	711142638e04806c1d8e010c9a3c83d4a356a940d6e4b828cc28931324d04061	common-masters.IdFormat	{"format": "PG-SK-[cy:yyyy-MM-dd]-[SEQ_EG_TL_APL]", "idname": "bpareg.aplnumber"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
62ec82a9-3f3b-461b-ab4a-325fc8ca0a2e	pg	61ae877a52bb381fb512e783bfd483bd9367cbd3601d4a6cef7f30949a58170c	common-masters.IdFormat	{"format": "DOC-[cy:yyyy-MM-dd]-[SEQ_EG_DOC_ID]", "idname": "du.documentid"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1dd2ee4a-666f-4c1d-aad1-94ec54d65931	pg	b039ad1681c6c09391bbf2c27613c7c59651036cec21b87e6f058b6b37cf770d	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "lcf.trade_license_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8e905a06-9672-413b-9934-6fe40bcc4f33	pg	e9818b5c833991d9a6bbbdbe357c2f4c34491208b9ad0c358e364bb64e2b543b	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "lcf.rehri_rickshaw_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1e77e215-6493-42c8-890e-02c2d3fdd0ba	pg	5d1e80c351ccf39f9b2b1d45257bd56fdbcaabafc43e56af59337bf9c44ad5d5	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "other.swimming_pool_and_gymnactics_hall_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
81afb7c1-e0b4-4e6e-ba6e-59f1cc433a31	pg	dc1ece05578249f479c46d28b621ac1d8005f8708597261538d691ec78a02fdb	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "other.dog_registration.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
461d032f-d76a-40f0-adf7-5f2935e59578	pg	f5e5bf1e41e3c0719e76838178a73550f8e62fca0c55ed47b7921360b0f8e77c	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "other.sale_of_recyclable_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8b24ac42-bfdf-46af-a8db-b33ee4c3ae1a	pg	fa9b01fd6e7af761fde35bfef1c79ce5e470f9b97811e7fd986bd92c2f2a1fbe	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "other.sale_of_compost_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f7a8b812-cef7-494a-9f4b-6e8914c43dfa	pg	c324d81d76c9d92ec62ce74c66b521f3cc52a84ac77ccaf33ceb782a88400a54	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "other.street_light_pole_transfer_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7a4a1bb1-f7d7-40a1-9b72-6c759aa0ecee	pg	39481012e1e12a7519006b18929b031417ecbcd2a7db53e84b053921ca16e600	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "other.conservancy_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
05a51a3f-37f3-494c-9b9c-6fdfd43c0bc4	pg	5cddd16eaa97c197e897f44f9e1d214be00bac505d092d85656cc4692526f435	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "other.candy_fee_slaughter_house.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b86be8f9-8701-4153-b125-f11b4d6cb8dd	pg	c8ba693e2d1355f4e0691cc2bb0307075dd93e593d5283ec4e5d78f6019692e5	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "other.license_fee_slaughter_house.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
479fbbc0-c0fb-4467-b935-2f861794d6c4	pg	03c2cc3b90e0c04f5024d1db1bdccfc01673812fee6e316ac36cb2a27c07002a	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "other.dispensary_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
45e27127-1ac6-400d-8c64-5fa369d8d4e4	pg	555d13bfb7ead1a62eb9dc9c73729383dc8d40a18dee6080751202c44e7dee35	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "nks.building_safety_certificate_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1811a1fe-6595-4baf-a6e9-749a38e22071	pg	b6568ca045932965228f116ddf9ed4d3057b2d2b5fbbaccce7b2e494a4cea812	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "nks.information_certificate_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
c4c0715e-ddf6-4739-8e71-36d5120618a0	pg	417f96f0cb6d8849fdfc61657ef63e20e92ea56860a0dcae8d8fd1631aa1d610	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "nks.sub_division_charges_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
21f1ecd8-9a6f-4cc4-abdb-1a0f001d256d	pg	af6224a5b961b55c226873e79935f1f699b05c24da38ad54f4de974a6965fb9a	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "ch.burning_of_waste_challan_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
824c430b-853c-459f-bc15-f0e378c61f61	pg	69a3ee99d80a1f861f805fd1e12c0260b68c370f48f576ffd792652514823166	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "ch.collection_and_demolition_waste_challan_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d1814e6d-84d0-4a74-a64a-f37127b335f2	pg	0e7028d4c955198fa272ba49297b3d31e9dfdb807ed7bf48f299638b6431764a	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "fn.security_deposit_fee_refundable fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
72a8191b-b061-4c08-9d1a-3fd38c67c40f	pg	fd2e2165ced5f75d0a39d8cf8cc1e65a8be92c310a19abebef7dc7fd6dc444b8	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "fn.tender_earnest_money_deposit_refundable fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
235636f2-abb0-47d7-b0e6-ad220ecb6b7f	pg	4e23509096d9e86ead307e95c18e012ef082b535df13e450cff05e0dde30e46f	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "rt.street_vendor_icard_certificate_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
27307359-d8e9-4d42-8cf8-a513ece07e2d	pg	2a30f59c5ebac7c72f18dc1ee70a215919ea247dfc2c4c81876ae9eea5043be3	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "rt.service_tax_gst_of_rent_of_mc_properties.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
fdf47cb7-d5a9-4656-b99f-311c772ad3c5	pg	a0f28c1bdb99fefe2700bdf8e7109fb0d9ff9800e9a3664fed1278ec8c35746d	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "rt.sale_of_land.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
45ed66ae-342c-4d3b-9192-ff0ac8f3149b	pg	de35ab2503fcda3be1b929257b5d9d2fdc09f113c307003189810d6d0e4369d9	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "tx.property tax_dishonoured_cheque_payment.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d29c2ffd-d0d6-4c3c-af83-a7bb176a7af1	pg	efd0c2fce5e823a6d867857a988ef3a6430a08b61d961d7301576cfe91e1cd3b	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "tx.property_tax_2013_14.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d18d0e60-2400-457a-938e-0a1ad62df489	pg	55598e1d4884d0878b6e0140caa9be0ddb6c3bd0de3c6365cf92171e1a33b43f	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "advt.gas_balloon_advertisement.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e61a5cce-6c5d-4939-83a9-10618e16c074	pg	8f78719c2ab885c386885a1c579641282ffbb62b972f459dc94cd71a49a5063c	common-masters.IdFormat	{"format": "PG-CH-[cy:yyyy-MM-dd]-[SEQ_EG_CH_APL]", "idname": "echallan.aplnumber"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
91d7b654-69dc-4a00-baba-06ec3480007b	pg	89308384b79b068ec98a3ed2c673546a5a38b81d6a3435b0e30ea310a195d75a	common-masters.IdFormat	{"format": "[CITY.CODE]-FSM-[cy:yyyy-MM-dd]-[SEQ_EGOV_FSM]", "idname": "fsm.aplnumber"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
dddb0dc7-9704-41ea-b7e5-94c9fe734b74	pg	a167340366efcb04001c0b432cbbcdb5f88ea179e07e8ced87d4832a2295b1fd	common-masters.IdFormat	{"format": "FSM/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON[TENANT_ID]]", "idname": "fsm.trip_charges.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6fa2c87c-a913-40f9-ab1a-0ad6ec8254ca	pg	cf3fa24642ff42fafa6ed2c4ab631b91a14f471afa367cc3e90731a87c557fd6	common-masters.IdFormat	{"format": "NOTETYPE-CONSUMERCODE-[SEQ_BS_MUTATION_[tenant_id]]", "idname": "bs.amendment.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
67bac536-5402-4871-a8f0-be5360200cf3	pg	99ca5739ac392cbd869fbbc0d24c8b8240e3f89b13233fc545cca81cbaf47101	common-masters.IdFormat	{"format": "PG-PGR-[cy:yyyy-MM-dd]-[SEQ_EG_PGR_ID]", "idname": "pgr.servicerequestid"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6a9b1b1b-2a49-4c39-9e1b-0dc9e125f67f	pg	2f030290a24b9abb8f5c1efd978061b7167ceadf658fc82e5e78c203b076734c	common-masters.IdFormat	{"format": "PG-NOCSRV-[cy:yyyy-MM-dd]-[SEQ_EG_NOC_APN]", "idname": "noc.application.number"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
813c6397-4909-4af5-81a6-060abac719c9	pg	999bfe1427d5f45f3e6992f3f134a681bf883120ddc99226562a7f1b8ae3d842	common-masters.IdFormat	{"format": "BPA/OC/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "bpa.nc_oc_san_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f57cafbc-7508-4676-84e0-742caccd9605	pg	01c0c40d683cb380cecbd98b037d5fee445c3517441bcfbfeaf504442327f0c8	common-masters.IdFormat	{"format": "BPA/OC/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "bpa.nc_oc_app_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d5905e2f-917b-487f-807a-f7db987f4da2	pg	31f2f2827804590633a35ce18c26a0dd7c9cc08bf3a5518764532f4bcc0f7b47	common-masters.IdFormat	{"format": "PG-BP-[cy:yyyy-MM-dd]-[SEQ_EG_BP_APN]", "idname": "bpa.low_risk_permit_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0d2afe08-f8c7-4636-90b0-4adfccf83119	pg	490f1c37fac62b76329f5088f416c8fb9a6d5098d75af1b9b0e3573d0616c779	common-masters.IdFormat	{"format": "SW.OTP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_SW_FEE_RCPT_[TENANT_ID]]", "idname": "sw.one_time_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ec0929f8-e911-4df4-9ce3-9ee9a139ac16	pg	961d367f9eb5f382773ef0ed330523ea3bd81fe3f57adcf75b60ea0b4075304b	common-masters.IdFormat	{"format": "WS.OTP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_WS_FEE_RCPT_[TENANT_ID]]", "idname": "ws.one_time_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2c3007c1-41b4-48fb-a594-4aa12a4b325b	pg	9922bca69505e4398ba04c73261f2c6805ec7ed2c3d6fd4665bdead6996e97d5	common-masters.IdFormat	{"format": "SW_AP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_SW_APP_[TENANT_ID]]", "idname": "sewerageservice.application.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
41bb02e1-d30c-4f30-aa4f-56111244a547	pg	fb2600f74c12485b29a3e2347d78e3b75951f5bd11c27f0425889fdb97f2e76f	common-masters.IdFormat	{"format": "WS_AP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_WS_APP_[TENANT_ID]]", "idname": "waterservice.application.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1d3f45cd-baac-479c-911b-07c7406e9566	pg	9c21dcd054e033d002ebb1f09b12d72a0017a0e10555cae3b82b2ea0f0759c86	common-masters.IdFormat	{"format": "SW/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_SW_BILL_RCPT_[TENANT_ID]]", "idname": "sw.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
530028cf-2b14-48e4-b9b3-b3bf2d777a9a	pg	9db8b2306373347fc63ed807817ed19c2f3b7ae9365747e185389ca72d423419	common-masters.IdFormat	{"format": "WS/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_WS_BILL_RCPT_[TENANT_ID]]", "idname": "ws.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9ec26591-86d9-41c2-b010-2a9dbe8f23f6	pg	8e156056e39420642ca110b2c2898a674fe3cd64a8970645812254db48d8d18c	common-masters.IdFormat	{"format": "SW/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_SW_CON_[TENANT_ID]]", "idname": "sewerageservice.connection.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f5c52e42-2d24-42aa-af78-38435e52d0e9	pg	402ac3bbd9f94de5c76f6d0e4eb89dd41764abd3b66130caa7ebbe79968c983f	common-masters.IdFormat	{"format": "WS/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_WS_CON_[TENANT_ID]]", "idname": "waterservice.connection.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
c5f0e3d5-8799-4504-9f5b-61d75cb9803c	pg	2305af5e2362d9734897e4d94711ab9a36c780c1fa13dcdf86759fd18f6747f4	common-masters.IdFormat	{"format": "PG-MT-[CITY]-[SEQ_EG_PT_MUTATION]", "idname": "pt.mutation.number"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a1e5eb06-a08a-4917-8507-59a4636529a4	pg	95242d9e9604ddb8324257e53a6bdc9c47316c9128417e7825e8caedc7d0195b	common-masters.IdFormat	{"format": "PG-MU-[cy:yyyy-MM-dd]-[SEQ_EG_PT_ASSM]", "idname": "pt.mutation.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5c50dbab-64ed-495a-98f0-6da2cc5a1bab	pg	c045980618297bcb42ccb00594c0c69f06b97ff2d29cb82705affd8a657c4d53	common-masters.IdFormat	{"format": "BPA/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "bpa.nc_san_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0aca36d6-96d7-43a3-89f6-ea3e60614c12	pg	9b380ce793216129ab1b0636016f41b7cda82897db5b66d0d54140008c22ceea	common-masters.IdFormat	{"format": "BPA/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "bpa.nc_app_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b3662cdf-3917-4490-996f-ba37cb968dad	pg	f9701e67e31560dd4704f0bd9fb38f57324340812d6d94ba285df49cea2c49ac	common-masters.IdFormat	{"format": "BPAREG/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "bpareg.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8a5f2984-233d-417e-ad29-fedb62d5dd97	pg	e59f9662e9b4b9cccfa5bd866ddc19a9664a6c36b1acb2a612d0fd6bab844c9b	common-masters.IdFormat	{"format": "BR/BLD/[cy:yyyy]/[SEQ_EG_PT_LN]", "idname": "egov.idgen.bpa.bdlicensenumber"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
19258190-69c3-4567-bea8-2b0aed2b3860	pg	fc96b12d38e6d0e43e6bfb6baf4ea2aa9ee92fa92455186f98cc17d1c759f066	common-masters.IdFormat	{"format": "BR/ARCT/[cy:yyyy]/[SEQ_EG_PT_LN]", "idname": "egov.idgen.bpa.arlicensenumber"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a4805e92-9585-41d6-a82a-871c3d6dcebf	pg	ffdfcde58990cabe5de4a4a88444e4f6bf9b27c22ff83db6a3a728a588ddd25c	common-masters.IdFormat	{"format": "BR/SUP/[cy:yyyy]/[SEQ_EG_PT_LN]", "idname": "egov.idgen.bpa.suplicensenumber"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e71837f1-b810-4fcc-ad15-d14df78c9735	pg	7b478258536577d39e5db64bce94ca34c40d25f19a1eee0402afdfa32ad42821	egov-hrms.Specalization	{"code": "ARTS", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
74bad3d6-f0bc-46a8-8cd2-3b1bafb39878	pg	5994e2bb90a7f07e6def800b6a1394ac9d74e41c5402092b3531186969dbc5c0	common-masters.IdFormat	{"format": "BR/TP/[cy:yyyy]/[SEQ_EG_PT_LN]", "idname": "egov.idgen.bpa.tplicensenumber"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f3c8dd35-72a9-4354-8ba4-b2e95424520c	pg	10139e0b429aab54e2dfdce22f013ff89dc56be760415e960b2c9c3d1a7b8239	common-masters.IdFormat	{"format": "BR/STR/[cy:yyyy]/[SEQ_EG_PT_LN]", "idname": "egov.idgen.bpa.strlicensenumber"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a736c034-195f-4692-8208-dee0cfc83433	pg	bc9c50b691d31868b140db56143cfbaab03cf8c91f78939a6943227ae52533bb	common-masters.IdFormat	{"format": "BR/ENG/[cy:yyyy]/[SEQ_EG_PT_LN]", "idname": "egov.idgen.bpa.englicensenumber"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
84806e83-9d34-4cc4-9952-c09d56800845	pg	5d2b60c41550ada5b81f59ef16fdda0b07bdaf42f36a21bfda4a0f6b57e47152	common-masters.IdFormat	{"format": "PG-BP-[cy:yyyy-MM-dd]-[SEQ_EG_BP_APN]", "idname": "egov.idgen.bpa.applicationNum"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
05024202-a6fe-4201-9afa-f44df7ef0afa	pg	bc8a5b89c9a0ba51971058b24c84bb0d52cf33e126381396213aa61b406f8823	common-masters.IdFormat	{"format": "PG-PT-[cy:yyyy-MM-dd]-[SEQ_EG_PT_PTID]", "idname": "pt.propertyid"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
86ae06f7-b0cc-48c8-b61d-ef0a8a7bf637	pg	67107a4ff6cda728196c62f7e23e9a0d224d95939cc7a0a1e85ae6fbc3d606b7	common-masters.IdFormat	{"format": "PG-AS-[cy:yyyy-MM-dd]-[SEQ_EG_PT_ASSM]", "idname": "pt.assessmentnumber"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e34b73f6-6f05-44c3-bab6-9965acdb81e8	pg	4358a46a08206f100ee7f616f2745f61d243bca9dbe90bff2aa881ba220229ec	common-masters.IdFormat	{"format": "PG-AC-[cy:yyyy-MM-dd]-[SEQ_EG_PT_ACK]", "idname": "pt.acknowledgementnumber"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2a1cf2e6-d165-4641-9d7e-040ca1b8c218	pg	98851afd4070e40fd73950b731063dc7111919c5b39502ecd2a8943cbdec23d1	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "nks.rain_harvesting_charges.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5a42a503-e3cb-41f1-8b00-d6a132beb3ee	pg	5f380f9dca1af442c49761cf69103924fe9c175db68154b73c53f2744eef738a	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "other.bus_adda_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e05e0f14-25d1-476a-871a-448231021207	pg	06d9c5396b9ff3e53d565b5b4afa21f2aebe37d257e08ce2b52803215cb64d4d	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "other.fire_noc_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ec90a92f-0082-47ea-9451-406360793b86	pg	31fea66053548d07e60a49a027c2f44db920f14039077780c2f3cb74159399f8	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "other.fire_call_report_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9c515b40-9910-4512-bb54-40b1e58ff471	pg	5707279f9b8d11cedaa034fe4808db27ca62ea9cc43588e1b33282355dcb863c	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "other.fire_tender_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6fc8dcbc-f6a1-4dbd-b991-b23e5766c322	pg	3cc0e94e45ca485531172a4fa11e5db9469a83dd97392abf3eff0bcb098fe5b8	common-masters.IdFormat	{"format": "[cy:MM]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON", "idname": "rev_grants.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ec5464bd-30c9-4e0b-ac51-ae4f4bb81070	pg	fed5369c10dc5ed23adc4152f095244c4e12b6ca2846c94130e1918662691f8a	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "other.noc_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7931386b-930a-4709-9e27-01989781963f	pg	79fa9c624c750ce284aa111be0a6468ccc6131e72b78f79094ffd3893229a26a	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "tx.property_tax_2013-14.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
95a33f6d-6830-4264-aaf0-d4fbf549627a	pg	c23739e98862c66b594637c2767b085577f00b24a118a16b4d19c94fd9d4e1b7	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "advt.test_munadi_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
dcf8d7c0-c085-402b-b531-6d065e526900	pg	0f5ce9fbc28c1d98c4c006d3b7aed394dcf8ec22e22d4cec822e1ed86bb1fb56	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "advt.outdoor_media_display_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5184b1c2-1958-448d-b4d3-03960214de58	pg	82cf4344340b07ce4d7f7d1d6466669904e2dc48b5078961b8b9d10baddb749b	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "advt.canopy_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d1d19f48-545a-4db6-8c8e-9272d1c9629c	pg	890d42c8fade800970e13c2af5c43676caa66590ceaa11bf9360fecbda159ae6	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "admn.parking_booking_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
08c3da87-c678-4d8f-a1d2-581de7e2a6f9	pg	10e3cd67d1cb3b68a32e1364e6024503f6c70dfacfeafc795d56bcce1ae64dd2	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "om.road_cut_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
33743b08-24bd-4173-9fd9-6cd86370dba9	pg	eb543baf7971c2644ddb8a60718cceade883a646934ece05e10366f024388161	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "nks.building_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b1b2d71c-e315-4fe5-a458-e40dded1b590	pg	1fc02b429f5358d10fc0d0af813a80f5e8d3c62102f6b3af670834d51f19c190	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "nks.boundary_wall_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b259090c-7268-4136-ac6e-ef50cac7961b	pg	43ae9fdc15f5fafa99d7e9615f7e088d811b5e3508aea95abdb70466c0e52ec1	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "nks.malba_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9179b29e-7984-4b24-af71-445265a9a6ec	pg	5667429ca2325fedfbb34f4bc097e947db237c18c85d189f86f75d5b09317b8b	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "nks.development_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
cb8f12e0-65f6-4dbd-a992-5e4084abe65a	pg	65d4d845bea37f4b648ed1c6ec18ef06b8ba87b00f6281e96cebcd20b72c0936	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "nks.change_of_land_use_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
33ad5e8c-4599-403d-9efe-d1ec3b039f85	pg	526bf7290e8e640c695326eac7e244445f71ca423d14e8b4a79a19e7db74a22c	egov-hrms.Specalization	{"code": "SCIENCE", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6af8a3f8-197c-4c64-b421-e95464283f8d	pg	df6ab9f4f7a4da1f6d3ea5a1f0324c641c80403399dc2cb828a7893f6abcd252	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "nks.under_development_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7b3633fc-b31d-415f-a54a-8fcc929e1665	pg	e1b7b972e7bf5712dba978ddd3ece1d58bfcf463d268de1524d545843e45c2bb	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "other.water_charges.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2234af41-3d0f-49e5-97d2-e57eb7bb1c37	pg	330d956f36263ff1acfd25dc31fb96cb6937051ac38a60e2c16037c3d972322a	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "other.others_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ed549f8e-85e8-4abe-8bff-05eeb0aa2fc3	pg	fb483ccce9b5326d2ef59ceeed9c5a0083d0da0757ef9020fa48a55e5d80bc35	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "css.labor_cess.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1120a38f-0c9e-4934-a67d-027a3d0f02fc	pg	8a6fa3d9f82b674628841120b61ee9a588e976b45ee99605c796ceae470bcea4	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "fn.provident_fund_processing_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
78efaf7a-7e06-4875-b37f-95ab48d0171b	pg	dd3cddd6853276f9ac39635109653734ad029c25c35b123de6346d59f1689486	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "om.sewerage_disconnection_connection_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a02fe75a-2f1f-48fb-81dc-e4378939dfb0	pg	d5440a6cdfe8be68420601148f652bbad11bea2e81dc20bc67a01719a2681ea2	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "nks.economics_weaker_section_projects_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
3efc338b-a3e3-43c6-af2c-b6682739369f	pg	3196fe61d95bd3b9f7eafdf13557553c3aacf29fd3f5edc9ff8428164887bbf9	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "nks.economics_weaker_section_scheme_charges.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f024cebd-c713-4440-b45f-aa5753930f30	pg	02ea139dd286836403d4daf787e8f3c0328406344c473c70f36b3661eb6f73fd	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "wf.ofc_permission_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6ed09ec9-052c-4005-ab72-ae4b81865a8d	pg	50686b4e59bf4278689029e4aea56050ecb064ce58773541c910209d3bafb40a	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "nks.naksha_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9bc4b100-578b-4562-9472-c8de17354b8e	pg	0198084db59505022cecf50fb134967ef4c97702493d49c2c6f6d3d402bff429	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "nks.colony_sambandhi_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
99effddf-7713-4b92-9703-f15490f73cc3	pg	fdcdecdd2b3e8e3a14713e28a6da711ba2f60ed71da694d1950ea7e83e399aba	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "nks.no_due_certificate_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
3b5ebb57-e756-44a9-bde6-ef4cd40f2e59	pg	4a08a2d29fb07c9d88db15c8a9332b7d144accf012e5d139859ddbff868fe851	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "nks.hadud_certificate_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1408c0e9-4514-4c07-a644-8edf13645d4f	pg	2085e222ed0d5a841f49b74986619db74ba2a1496aeab1c3d9be74199a76161f	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "tx.house_tax.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
41e4b527-137f-4f3d-9e07-f265a0296e6f	pg	622848ad2f2d6304a5b83e57466a372c743ce30cb2811d4f4608ba804681c55c	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "fn.recovery_employee_contractor.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
25d25df4-93db-4b94-97f1-8ceb0636f176	pg	2cc0031a3bdfe1a165826f6b4d4a6a5b265628bd300131875735a5d942eb4021	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "nks.noc_completion_of_building_approval.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
17c607af-03b5-4ee8-91fc-f9e6b6f463e9	pg	28a663b51b55816e742454427f439323ced034969f3b9afbcbd10f73788158aa	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "om.water_connection_disconnection_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
4adf9d9a-df61-4506-9b49-fc01e243e12b	pg	bce429a2c591b7321b17496d2719619a4758344e80cce748df397825bb4cb08e	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "advt.wall_paint_advertisement.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7a15385b-ca44-4cab-89ab-cc4b87f74815	pg	3360deaaec552ec35ac619b357d016365ed6d57a9deb857e46f19ddb0fcca3bd	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "advt.light_wala_board.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
3499ee47-1796-4846-91c7-6bdab7c757c2	pg	d086d899fe020fd25751b4397edad7b765c305674dcd83d62d0a3985b618e7ef	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "om.plumber_license_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
57f74af6-5af4-4761-b1a4-256a480a2804	pg	0ac9109575b754fc4aa5a0f00beef0a58b636f0b6b9ebd59b4107c73c4d3a87e	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "snt.clean_safai_sanitation.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a09b82c6-1fa3-4fa4-9c9b-5bfe75580757	pg	c4733cce1ce08b662392d63d87e75de86583119641897543aa7e9b9ae6616113	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "ftp.demolition_waste.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0309f2c6-f80e-4965-950d-ff8da6c0380b	pg	4369ac23ff142becb4c16f60ab174a4a22ecf2dd7014487ff1ea02ed8607f217	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "ftp.construction_waste.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5f3b93aa-3613-4963-a05c-76b0b3383a82	pg	57925020e67b2d1c8bc6294914e56eb0992d6f46333f18c4db901c207b3c8603	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "rt.street_vendor.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
cb7a4277-e6c4-4348-aeea-8b00e1ebc9c7	pg	7abc0d52a6e9e69651b496f619f81bd26b29ee7486b141d14927022bb0dbec8a	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "rt.commercial_use_of_municipal_land.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
510ff279-848e-4603-b74a-852685356ac1	pg	aa908a2503e71933f233b9e34f096e451111947541e77ab909b7d03c49bee130	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "rt.community_centre_booking_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7a0e1bd6-65c3-4988-8b4c-83b0c3f832cb	pg	3873a4ca01e3dd8dc5a916a8aafde8048eaebf05252f9004e9007b2bb4830d12	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "ch.bidi_&_cigrette_challan.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
02eff04f-e653-4119-8a53-8a5ab629bc93	pg	be80519f9a5b6dfbebc38943c0b6185489d4a3f9bb86d250f92c0cc09a240851	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "ch.dairy_animals_challan.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d426e7f3-4428-4501-bd53-7abfc8714a4a	pg	33f167afb3924fa71dcefc849946943577fcd0b5b0aafbc9534ef3ee3d7530f9	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "lcf.manual_rikshaw.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0c5b89d5-2b11-4efd-ba81-3df30c8c52ed	pg	a70eee3d3a198f6cf06d3f9c09b818d35b983ee8e2c7e239ead8aeb512fb2ea5	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "tb.rehri_challan.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5ccc1740-d044-498b-b185-71a5d6654f96	pg	92418ce386226596382e6503b194db40422f3aaa0e4f160253873a13850e3991	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "ch.cattle_challan.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
50ae5e41-0828-4f59-b47c-79cc34d7f58c	pg	bad9d8c2964d9950751d6c479dedd6cf7e9f4152a548f37ae7d61ac52b5a4d78	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "css.cow_cess.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a77f8df4-5780-4977-9f58-842b84d5d787	pg	8cbee7a1b4c45cf5edb303413dbf2391b69ca805ab744936b97e65ca06ea5e9b	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "rt.tower_annual_rent.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
73a78e64-4bd0-49b9-bf09-8eb6c25852a9	pg	1a75d511c0656c2e2d0b5b712ecfc8297e1153f112e1574a5636c287d4c60813	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "rt.tower_installation.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
77c820cd-cd18-4136-93c8-5da5909b1df5	pg	7d8e7dcb4d07bca18329849a39abdfda96bc28607cd4a19662e77d855dbe9303	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "fn.cpf_received_check.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
19f881a7-b490-44bd-b741-6bf4f04b2204	pg	1ac1eb17139e3324d8b0979f332ad58aaf6838ca23465158e194a6523f0f12b0	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "fn.gpf.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
53c2c7ea-cdc6-4aa2-a7e1-8fb39b0fc4eb	pg	45d5f5e0b948a4d6a513493730f9cce45164beabf55ec7cce0459b5e30c85a92	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "snt.dead_animals_contract.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0a586b90-93e1-4645-b3e7-1db85d9439d0	pg	b92854eb5ed5f3668efdbc71549f65381a353146fd0abbd62400560315b5b12d	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "ch.sbm_garbage_plastic_polythene_challan.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
627917cc-c5d4-4516-b4ae-191d39133224	pg	058868945498672d375cfe95c92fa54c7a9d5ca8bc3ab308f33a61ed1ccd4a4a	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "other.registery_and_bank_loan.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
df4e0a0b-82a4-443b-a83e-b576d5bac6b8	pg	6e2ea9fdec56dcbbafbe32dd19af2764cc67085f0f0eba2dc1bb9b7a94cf8853	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "other.no_due_certificate_electriCITY.CODE.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
77959f56-bcc1-475a-9f3d-175c9001af2a	pg	bf1a037699fe82295c8d89c3dce2dbfc64bf12b7ab5aa9e924dc215de933d532	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "fn.grants_cheque.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
859451da-4cc8-4871-909d-3675d082ebff	pg	ba632a4fb62cf21e18f1cc4b383bdbf9879dcfb3b96266fea9835b0d1e1a93e4	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "tb.challan_under_section_156.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0da8e223-3f4d-4ea2-b6ee-4307f43e52d7	pg	d82c21a126b3ebbc44b59199ea409b70d38d6328ba82ab2c5c031ee87d575446	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "ftp.architect_license_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b135379f-0c88-499f-97ca-2113915c637a	pg	d8789baefba2d58a5094728fe8946def79852c484662e9faddf13a54c7e47e00	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "admn.no_dues_certificate.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
369a18cb-b138-4b81-a68c-551dcf2cc554	pg	e00ef63ab8cedd676abf2200e81452968a8a318910277ca6bafdda351b572d51	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "admn.rti.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
21597663-3df7-4a0a-b902-df1e87553b91	pg	ef0ac4d20a5b2b5cbfef97ce47b29559f1050deb2c7336d041bf989a648f2e73	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "tx.transfer_property_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
373669b2-8513-4739-9d42-6b521ec2e5fa	pg	a30a622017ea0087a1297f1fab744e8d0e6b83bbb6a64d6d0b5e8b34bd68838b	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "tx.ts1_copy_register_for_old_survey.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
dc76d2f3-a1bf-40f9-a7cc-8a28bc139f80	pg	a3377668f615eb333dd997764a2f8e0d4c89e840ee6a3a4e905677758d553b51	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "fn.pf_transfer_(accounts).receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
103a478d-1149-4636-93a6-f73447b44711	pg	9b5aa500f133b804075229f737850ae28220102c1a561d85303ade799b3f8be6	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "tb.tehbazaari.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
88b6f23a-219d-4017-baba-0dc0a8d3d386	pg	1921346fc4fcd5455c9001218f4395e7f94fa11245ab7d6306202bcb7fe0eea1	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "tb.advertisement_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d3e446a5-eb63-46f1-8510-e3d4f651e786	pg	546c062f893164256df202d41840c7089a6c664361d33affb48e01cccd992fdc	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "wf.tenderformfee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
c213ef1f-4bae-4775-bc99-0d4cd8e0360a	pg	87418da26196bbd4e9efa6e253886fe7170b7240fb9a70c25a129a8da47c5e66	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "wf.contractor_enlistment.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
115e6f90-423c-4a17-a1dd-0ca479cb4f5c	pg	1fcb20193720af8e2847ec2dbccec766233dc861dbf6cd047b3f30d0d011a870	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "nks.regularisation_of_buildings.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a0a6e529-3d4b-476c-a50c-7267acb8b4ce	pg	eca62b5216bd8da9fa6ecd828580043b59003c596e1de699afbda8e1e4d59ad3	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "other.misc_challans.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7af3d506-138a-43fa-950e-fd3efc74618f	pg	8baf9b4f1652d8bc8bcdc0a52a01c9a0957b13ea8a3adf249a28a4a4cc17a3fb	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "snt.licence_pure_food.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9ef4f7ca-8c49-40b2-aa57-cd1de26865b5	pg	6d95772378f84d8159e1ef35a4cbd87e84d047d973c60cf9450bb989310b96a3	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "ch.littering_challan.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f57fdb35-bf93-494d-9d2b-7d679e388b5e	pg	9bd15147e7c42cc742e909254dc4c17c3a386d30d917a6c8ddcc0a1bc3ba0730	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "ch.dengue_challan.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6f60e512-f387-4c32-bc60-6247a93f7a1c	pg	edc770b3d198a2a9558b074e5e2715156d55fa06509dac674b0be1c7d00922a0	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "ch.challan_for_misuse_of_water.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
784a768b-bfd6-4391-9239-db8429918e8b	pg	a9737226d0fecc780efe98cc180ea03acddd58c1e71f5fa05e933d56b6b49aa6	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "ch.rehri_challan.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8b1984e3-ad4a-4552-a866-31e2b2ea050b	pg	fc57df37000f86480ce6a1b1abd7d51ad797fab52addfb4a9f8485d9c33b9618	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "ch.plastic_challan.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0ab470e6-2ac5-4590-a4bd-16fe4eae1dd4	pg	dc5005262598abd8161765bb276bac76c8c6a6c95eb3745522072da5b55ef012	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "ftp.leave_encashment_and_gratuty.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
53708d46-e33e-4840-950c-e41f9ac26d4d	pg	ccb6185e1fff31d2087df9e5bd5cfd605b8a13cb47a5d24040a3eb3c45dfb82f	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "nks.2_year_time_limit_of_renewal_building_naksha.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2fd11c8b-69d2-4883-8bbd-b51f9ba01ada	pg	7c254d2ea68c248fbcee69c20daadc4c2d6d6a44be9446ef2ad06c6ffbc37446	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "nks.alteration_additional_charge.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2d334236-e082-4aa4-a374-09af16bf505f	pg	ea215030b4b75e8edeb2ccc92c2fd768d9967acbdc2c5e2adce5a40b3f49a2b2	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "nks.naksha_renew_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7bd32727-5a25-4cd5-bd79-ff0d4ab4fdb5	pg	8e6f31f2ba7290d58295daa686d4a996cb19d892b527b9246a128245e5c81f15	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "ftp.license_fees_building_branch.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
78e1fd09-d85c-410d-b6d0-5cb0dc0f9116	pg	f80636c8b9c2cb70da0c58ad21d67b0be6d77db73f08298e13f7893e8c550f0c	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "nks.naksha_changes.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7baa50e2-bdfe-4d7f-8d2d-1924bebe4ffc	pg	622ce08fab5c9ce968cd9a0527f58df655685505c6f7baae017feb89071bbbc4	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "nks.naksha_samjota_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
df6e3ab4-a7d1-4e9c-9fa5-91a400ced978	pg	a055ba78c5fe50f5305b787e135095fa3894f7c1fe3b230c8c93dd64c0962e72	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "ftp.building_planner_renew.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
db52bc33-a73a-4882-ad4a-89e84043e147	pg	6aae5370367fa17636f4927334fe7c06da89283eb7b57ebad9e3cdc66974e023	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "ftp.compremasing_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d1c9c5fd-1767-4b40-b850-0e7ee37c58af	pg	2dad0966dba4f8fd96c99dfadfea0e77e9fb074a9254c0accfa2314fb770fd30	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "ftp.draftsmen_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
c13e5ff8-8ee2-4e52-91de-5d33862ef3af	pg	c9623f058e787e1597d89aa572b508bec3bfde766d31ef62b7a8b8f27f1bea3c	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "tx.electricity.code_chungi.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
4cf44421-c207-4b2f-9e0c-1cb84771338d	pg	5cb63e3d56c3a3d5ec61ac9eec2b915f5d5881687f386a87ca1b762d91306d5b	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "ftp.telecom_tower_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
18f6918a-e37f-4eeb-975b-7c606690d164	pg	aeb22f937bc52cd70f41381b30f9b6ca116e30ce046db2f2d3aab86fc4dd4854	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "ch.santitation_dumping_garbage.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1ce47c4f-18af-417c-a126-17bbc25ecae0	pg	674e42f98c9558fbbeb7e566da1c147b60e8c876177017609e1b858b5fc58bcb	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "st.expenditure_santitation_not_income.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8857b034-f1d3-4788-9a79-e4b8b2148405	pg	b4b4bcfa068d625487d1879b3ff299d2b08984b4e8e2759985d3e62702a4b8d6	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "st.stationary_not_income.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
85deb3f3-0801-4877-a32b-2f4c9bb4f18b	pg	c628709f33c033322c23d6124da734559602aa9676d096a3269881f085944410	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "fn.advance_provident_fund.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a3230a92-37ac-4034-bbe8-ede665b5177a	pg	da5253f60647daa591dea5edfe80a9c738453ef3fb168c1402b9848630064eff	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "admn.road_show.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b3c58c21-9a28-4f70-8353-cd2eae6c4935	pg	64efccbd8b59da04cde218c1d3ffb1cdd881058f3aa07495fd486bd2ce04f271	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "admn.parking_during_election.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
4e95b6e4-9bcd-418b-9c32-6f46a636d866	pg	704a553fd304d1712d111f4045eb3f8bd2c71ee30c4e72131db60c24a3704f7e	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "admn.election_rally_fees.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
21e966ff-c16d-4f03-af4d-6d671196bba7	pg	c06cb116eb013c16f4ad17e418acd39db807163260af0c8d0ac40f4d6f8c712f	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "rt.jamin_theka.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
870b3d1f-1ad5-4611-bc50-9e1ce1db84fb	pg	55d578c433e2bd6718083fb0bd97c8444c6d6b34754c24e48fdcf8b77a612db1	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "rt.parking_fee.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9caec134-47f3-468a-9391-94d9a59a464c	pg	d2a87393cfe929bad9b90e7c7428689b63a68669a5ecb73e1f65896d0a61a915	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "rt.tower_rent.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
fdd95277-2620-41e9-bf65-5070f60116e8	pg	688b616248ad530f16a8e8af984c44c6dfbaefe521746e036858d38291d9e454	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "rt.land_rent.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
534c0753-1f74-4a8d-ab23-703134bb3246	pg	ff4c65b8acef8c45a76da28f3db43a76176ca638765a7250d015556134c27b5d	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "rt.municipal_shops_rent.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e0e309c7-d98b-4e35-9f55-e145cc0df90d	pg	8cdf92aba2685143f3479719e081a673a6fd700deef9e4575ec1ab6009b5f80b	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "advt.unipolls.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
26fcf099-2d54-47ae-a6dc-c76ce09b15d7	pg	e0508f2cfee4097a6da55bc4379a4b665b296c251bb57c2f0eabd48a36b302ad	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "advt.hoardings.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
c781ea56-a10c-4663-885e-fdd2dd9394a0	pg	6ed570bfa900a4b9ccc71782f3d0ab356620222f4529cbeb93efd48c59d529ee	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "tx.electricity_chungi.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
89783973-c7f0-4c43-9e16-bada9e6af28c	pg	7c4fdc9bf96ef1f14592ddb3e5b4e7ffcf6bc03e4e8ee38f53a8a1182d887712	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "tx.no_dues_certificate.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6a246725-2a30-41fb-8568-2d2cd395098f	pg	3655c73a92f813feee65b9fb9e9e88c3a38a2fc68ebcc691c8f309890eeb974f	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "firenoc.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
841f55e8-3d95-48e3-bdf2-069ed836e8b1	pg	d0746903df0397820f0830019f8b0f3483e810e7199f9534db86e842b9b1653c	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "watercharges.nonmetered.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2fd5b545-55ea-4858-883b-bf9c3ad5e66b	pg	1df55509c7f3eb6bd174059a7b42777e2ddc47b2672dd72461f67a57428c5596	common-masters.IdFormat	{"format": "TL/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "tl.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b2c51be0-2f87-40e9-8cad-a7702bde70be	pg	fc528cea62ecfe835605d41ed7adde43545ee193b4fe2aba88e3007340e5ce6b	common-masters.IdFormat	{"format": "PT/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "pt.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
20c24e6c-42e6-426b-b0a6-cd3bb0d15ed2	pg	fc0de4b31a6d0bd855c7b082ebef7368c2b4b66bd205967981c518015f10cb2c	common-masters.IdFormat	{"format": "BILL-[SEQ_EGOV_COMMON_TEST_AUTOCRE]", "idname": "billnumberid"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
38f44914-8507-4509-8707-69d3bd89b7d5	pg	1ae60d60013e6b133f1bff8d20b1f80c7e622d3333c77136a5471fadc65593fc	common-masters.IdFormat	{"format": "MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]", "idname": "watercharges.metered.receipt.id"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
467ecb87-9be4-4044-89a6-16d45f6adcc3	pg	2fd45638617790334c8733991fb1d798a2f1f2b683239a8c67ad2ac6c8fdb74b	common-masters.StateInfo	{"code": "pg", "name": "Demo", "logoUrl": "https://s3.ap-south-1.amazonaws.com/works-dev-asset/mseva-white-logo.png", "bannerUrl": "https://s3.ap-south-1.amazonaws.com/pb-egov-assets/pb.testing/Punjab-bg-QA.jpg", "languages": [{"label": "ENGLISH", "value": "en_IN"}, {"label": "ಕನ್ನಡ", "value": "ka_IN"}], "qrCodeURL": "https://lh3.googleusercontent.com/-311gz2-xcHw/X6KRNSQTkWI/AAAAAAAAAKU/JmHSj-6rKPMVFbo6oL5x4JhYTTg8-UHmwCK8BGAsYHg/s0/2020-11-04.png", "statelogo": "https://s3.ap-south-1.amazonaws.com/pg-egov-assets/pg.citya/logo.png", "defaultUrl": {"citizen": "/user/register", "employee": "/user/login"}, "logoUrlWhite": "https://egov-dev-assets.s3.ap-south-1.amazonaws.com/digit.png", "hasLocalisation": true, "localizationModules": [{"label": "rainmaker-abg", "value": "rainmaker-abg"}, {"label": "rainmaker-common", "value": "rainmaker-common"}, {"label": "rainmaker-noc", "value": "rainmaker-noc"}, {"label": "rainmaker-pt", "value": "rainmaker-pt"}, {"label": "rainmaker-uc", "value": "rainmaker-uc"}, {"label": "rainmaker-pgr", "value": "rainmaker-pgr"}, {"label": "rainmaker-tl", "value": "rainmaker-tl"}, {"label": "rainmaker-hr", "value": "rainmaker-hr"}, {"label": "rainmaker-test", "value": "rainmaker-test"}, {"label": "finance-erp", "value": "finance-erp"}, {"label": "rainmaker-receipt", "value": "rainmaker-receipt"}, {"label": "rainmaker-dss", "value": "rainmaker-dss"}, {"label": "rainmaker-fsm", "value": "rainmaker-fsm"}, {"label": "rainmaker-workbench", "value": "rainmaker-workbench"}, {"label": "rainmaker-schema", "value": "rainmaker-schema"}, {"label": "rainmaker-mdms", "value": "rainmaker-mdms"}, {"label": "rainmaker-im", "value": "rainmaker-im"}]}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
567adebd-9cab-4c22-b180-72fa99844167	pg	3b99e7f9ef22310d79294d0882ba37fdcdc5758912d9b52a4a367aa67eb69a8b	RAINMAKER-PGR.ServiceDefs	{"name": "Request spraying/ fogging operations", "active": true, "keywords": "mosquito, menace, fog, spray, kill, health, dengue, malaria, disease, clean", "menuPath": "Mosquitos", "slaHours": 336, "department": "DEPT_3", "serviceCode": "RequestSprayingOrFoggingOperation"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
dcb3f5bc-167f-468d-aecd-ad9f66a4c1af	pg	a31482c78e570b4458d2a380c2f1854461d4ef7e100f88e43349debfb946d4eb	common-masters.uiHomePage	{"redirectURL": "all-services", "appBannerMobile": {"code": "APP_BANNER_MOBILE", "name": "App Banner Mobile View", "enabled": true, "bannerUrl": "https://s3.ap-south-1.amazonaws.com/egov-qa-assets/app-banner-mobile.jpg"}, "appBannerDesktop": {"code": "APP_BANNER_DESKTOP", "name": "App Banner Desktop View", "enabled": true, "bannerUrl": "https://s3.ap-south-1.amazonaws.com/egov-qa-assets/app-banner-web.jpg"}, "citizenServicesCard": {"code": "HOME_CITIZEN_SERVICES_CARD", "name": "Home Citizen services Card", "props": [{"code": "ACTION_TEST_MCOLLECT", "name": "Miscellaneous Collection", "label": "ACTION_TEST_MCOLLECT", "enabled": true, "navigationUrl": "/digit-ui/citizen/mcollect-home"}, {"code": "CITIZEN_SERVICE_PT", "name": "Property Tax", "label": "MODULE_PT", "enabled": true, "navigationUrl": "/digit-ui/citizen/pt-home"}, {"code": "CITIZEN_SERVICE_TL", "name": "Trade Licence", "label": "MODULE_TL", "enabled": true, "navigationUrl": "/digit-ui/citizen/tl-home"}, {"code": "ACTION_TEST_BPA_STAKEHOLDER_HOME", "name": "Online Building Permit System", "label": "ACTION_TEST_BPA_STAKEHOLDER_HOME", "enabled": true, "navigationUrl": "/digit-ui/citizen/obps-home"}, {"code": "ACTION_TEST_WATER_AND_SEWERAGE", "name": "Water & Sewerage", "label": "ACTION_TEST_WATER_AND_SEWERAGE", "enabled": true, "navigationUrl": "/digit-ui/citizen/ws-home"}, {"code": "ACTION_TEST_FIRE_NOC", "name": "Fire No Objection Certificate", "label": "ACTION_TEST_FIRE_NOC", "enabled": true, "navigationUrl": "/citizen/fire-noc/home"}, {"code": "ACTION_TEST_BIRTH_CERTIFICATE", "name": "Birth Certificate", "label": "ACTION_TEST_BIRTH_CERTIFICATE", "enabled": true, "navigationUrl": "/digit-ui/citizen/birth-citizen/home"}, {"code": "ACTION_TEST_DEATH_CERTIFICATE", "name": "Death Certificate", "label": "ACTION_TEST_DEATH_CERTIFICATE", "enabled": true, "navigationUrl": "/digit-ui/citizen/death-citizen/home"}], "enabled": true, "sideOption": {"name": "DASHBOARD_VIEW_ALL_LABEL", "enabled": true, "navigationUrl": "/digit-ui/citizen/all-services"}, "headerLabel": "DASHBOARD_CITIZEN_SERVICES_LABEL"}, "whatsNewSection-disabled": {"code": "WHATSNEW", "name": "What's New", "enabled": true, "sideOption": {"name": "DASHBOARD_VIEW_ALL_LABEL", "enabled": true, "navigationUrl": "/digit-ui/citizen/engagement/whats-new"}, "headerLabel": "DASHBOARD_WHATS_NEW_LABEL"}, "informationAndUpdatesCard": {"code": "HOME_CITIZEN_INFO_UPDATE_CARD", "name": "Home Citizen Information and Updates card", "props": [{"code": "CITIZEN_MY_CITY", "name": "My City", "label": "CS_HEADER_MYCITY", "enabled": true, "navigationUrl": ""}, {"code": "CITIZEN_EVENTS", "name": "Events", "label": "EVENTS_EVENTS_HEADER", "enabled": true, "navigationUrl": "/digit-ui/citizen/engagement/events"}, {"code": "CITIZEN_DOCUMENTS", "name": "Documents", "label": "CS_COMMON_DOCUMENTS", "enabled": true, "navigationUrl": "/digit-ui/citizen/engagement/docs"}, {"code": "CITIZEN_SURVEYS", "name": "Surveys", "label": "CS_COMMON_SURVEYS", "enabled": true, "navigationUrl": "/digit-ui/citizen/engagement/surveys/list"}], "enabled": true, "sideOption": {"name": "DASHBOARD_VIEW_ALL_LABEL", "enabled": true, "navigationUrl": ""}, "headerLabel": "CS_COMMON_DASHBOARD_INFO_UPDATES"}, "whatsAppBannerMobile-disabled": {"code": "WHATSAPP_BANNER_MOBILE", "name": "WhatsApp Banner Mobile View", "enabled": true, "bannerUrl": "https://s3.ap-south-1.amazonaws.com/egov-qa-assets/whatsapp-mobile.jpg", "navigationUrl": "https://api.whatsapp.com/send?phone=918744060444&text=mSeva"}, "whatsAppBannerDesktop-disabled": {"code": "WHATSAPP_BANNER_DESKTOP", "name": "WhatsApp Banner Desktop View", "enabled": true, "bannerUrl": "https://s3.ap-south-1.amazonaws.com/egov-qa-assets/whatsapp-web.jpg", "navigationUrl": "https://api.whatsapp.com/send?phone=918744060444&text=mSeva"}}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b6928999-d759-467c-ac31-5ae772e78de6	pg	1a2bb136332122036861aec3d0c05826795bc6a12c46d44fe53d61e2b8e5a0bd	common-masters.wfSlaConfig	{"slotPercentage": 33, "middleSlabColor": "#EEA73A", "negativeSlabColor": "#F44336", "positiveSlabColor": "#4CAF50"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
13fbdb93-904b-4235-8e37-b196b4824786	pg	1cb6c2ba6cf789f083588eefdf3cb32179ea203803027ecb674c127bd451b088	egov-hrms.DeactivationReason	{"code": "OTHERS", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
af056165-4ac5-420d-ae99-da7607bbb4b3	pg	809e8672d4aa45315c892efdb2e3913ac2590bdc4d30973e5e3e501f2795e097	egov-hrms.DeactivationReason	{"code": "ORDERBYCOMMISSIONER", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
eb3eb801-86f6-4ad3-a628-45d8fc4f77a6	pg	71e3ba2f621a40b58555d7f6234911cf0718b3dc06fb85543e93635d04338548	egov-hrms.Degree	{"code": "MATRICULATION", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5ad3df1e-f0c3-4e8f-a858-f8c5b0c25164	pg	5630a0605e577dbb9b4a76648c6dfde85aca2912effb793dce6b27761596039a	egov-hrms.Degree	{"code": "10+2/EQUIVALENTDIPLOMA", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a6a2ef0c-efab-4166-8611-b1b833a85a49	pg	a3bd8357a82ff729164bc295497c6ebda1bc6c62803d6f3c3d6d82e652264926	egov-hrms.Degree	{"code": "B.A/B.SC./B.COM/BBA", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
45a1e960-5fef-4b39-8c72-c7a8c2e1a613	pg	2316bdafeb0a39c99e31bbfe849612e77c6a52d35c753aed828424b14978f0f0	egov-hrms.Degree	{"code": "LLB/LLM", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e46bc463-dab0-42c8-a9ed-9e88b94c6f53	pg	9936d7ef572848d2de5277009738078d2b03ac79672a5df2d8c507845f61e45d	egov-hrms.Degree	{"code": "B.E/B.TECH.", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b9757844-0e6f-4a4d-830b-1e422b02a7b0	pg	b2809648abbce98a1dc8d9d5d2ad74a3a7691cbc9d086a4f54732fd83ff3c4bb	egov-hrms.Degree	{"code": "M.A/M.COM./M.SC.", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e7e97848-bb1f-4296-9a2f-b91f927fa8a9	pg	7c0e68dcb015611f4f8dbe2c2783d2648cdbb1526f6096bf21a990e9ab4f0f2f	egov-hrms.Degree	{"code": "M.E/M.TECH.", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7e25b246-566e-4a3b-a696-66c5afe34dd5	pg	99f048938981f201fd17749059149f7a84e1d666dcf8148e5e300a79064d032d	egov-hrms.Degree	{"code": "MBA/PGDM", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8319fbcf-f953-4937-90a6-9fa48e72844a	pg	8d8ea339f664379d2bed11843310d6a2d0730ff301c7232b0090b43a68bdb4c9	egov-hrms.Degree	{"code": "DOCTORATE", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ba2656ff-031b-454c-b919-2ce1802f47eb	pg	4e9a04fd6b4b85999100b17d07177db10c98aa73705cf661d6d5d5a3583bc2eb	egov-hrms.Degree	{"code": "OTHER", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
cd9a9c7f-3584-4382-ac32-b91976b03c28	pg	8b411c00de85db3d1d4d80b70aba5249a8dc0dd7f7f60de90aa76f7298f9d8de	egov-hrms.EmployeeStatus	{"code": "EMPLOYED", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
225b32ed-8cd1-4848-9ddd-b0e31256ddf2	pg	8664f8ef4381c13badcb369b7dd65b5d49fd144af905711a3a42c17485d7a3c4	egov-hrms.EmployeeStatus	{"code": "RETIRED", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0fa12710-5c99-4a23-8782-bb35f65155e7	pg	a8b8663396602477fcdfc56b1e48c616e3e7eb4a161b5e1ec60dfd72ae00e66c	egov-hrms.EmployeeStatus	{"code": "RESIGNED", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
625af874-de45-4efe-911e-060c0d68d312	pg	7dd579237c4fd4692186342416cfa2eb56a47c596cdf6f59798ea4457a69d111	egov-hrms.EmployeeStatus	{"code": "TERMINATED", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1cc0642c-4ffe-4333-a39a-c8baf33c2b28	pg	23e5afe43927be2db2956474caeb24032cfa17cf67e71767e241528933cf808e	egov-hrms.EmployeeStatus	{"code": "DECEASED", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
94c6f8d3-7273-4fa8-8f63-fd413b7818c3	pg	9ca26b0b653416a237fd2763994ffce4f77e52610e5fb85ee380fa2d2724bbd9	egov-hrms.EmployeeStatus	{"code": "SUSPENDED", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
616e7fe2-7e3e-43e9-8330-bcf98e32d9b9	pg	76aa8231df2aa6682f49228aa1a1cea2e582b8430a9465148b026596924ab317	egov-hrms.EmployeeStatus	{"code": "TRANSFERRED", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
f7150848-3fc8-4209-97fe-d7b7edc37993	pg	2693ed6075326fa5afd36b63114b278bbe935d9616cc19a068106cf8c3d6011e	egov-hrms.EmployeeType	{"code": "PERMANENT", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6a7d6544-717b-4fef-9c68-95222c2e9f6e	pg	c919fff63c191a6083878f03e8a8ecb7d9484f36e13a89780ae992507048e54f	egov-hrms.EmployeeType	{"code": "TEMPORARY", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ff3764ff-3f27-492d-a86b-aba01f4359b3	pg	37ae153e3a32d927f9d7ffe84a53886bb41dbccbaa0814186f3758645d5c9f40	egov-hrms.EmployeeType	{"code": "DAILYWAGES", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b9a3710f-9f98-4c93-b51f-3a8d036fc919	pg	e0955c00cee8595331fc3dd3ba0e9f80245fbee0c530f8d44d5c0c045246ed9b	egov-hrms.EmployeeType	{"code": "CONTRACT", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
aae3f98d-7012-4b87-b60a-fdb6c132d591	pg	80ec82fb712442603a5a492f23fccac277323025739565479212186fa8f53f5b	egov-hrms.EmployeeType	{"code": "DEPUTATION", "active": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
80d0d0f6-0521-4f99-bde0-1926e51b35f7	pg	b7963f8371fea0aae1fb0be623c75d72ec11bfb258fbf2824e6bdae4b3378d99	INBOX.InboxQueryConfiguration	{"index": "inbox-pgr-services", "module": "RAINMAKER-PGR", "sortBy": {"path": "Data.service.auditDetails.createdTime", "defaultOrder": "ASC"}, "sourceFilterPathList": ["Data.currentProcessInstance", "Data.service.serviceRequestId", "Data.service.address.locality.code", "Data.service.applicationStatus", "Data.service.citizen", "Data.service.auditDetails.createdTime", "Data.auditDetails", "Data.tenantId"], "allowedSearchCriteria": [{"name": "area", "path": "Data.service.address.locality.code.keyword", "operator": "EQUAL", "isMandatory": false}, {"name": "status", "path": "Data.currentProcessInstance.state.uuid.keyword", "operator": "EQUAL", "isMandatory": false}, {"name": "assignedToMe", "path": "Data.workflow.assignes.*.uuid.keyword", "operator": "EQUAL", "isMandatory": false}, {"name": "fromDate", "path": "Data.service.auditDetails.createdTime", "operator": "GTE", "isMandatory": false}, {"name": "toDate", "path": "Data.service.auditDetails.createdTime", "operator": "LTE", "isMandatory": false}, {"name": "complaintNumber", "path": "Data.service.serviceRequestId.keyword", "operator": "EQUAL", "isMandatory": false}, {"name": "mobileNumber", "path": "Data.service.citizen.mobileNumber.keyword", "operator": "EQUAL", "isMandatory": false}, {"name": "tenantId", "path": "Data.service.tenantId.keyword", "operator": "EQUAL", "isMandatory": false}, {"name": "assignee", "path": "Data.currentProcessInstance.assignes.uuid.keyword", "operator": "EQUAL", "isMandatory": false}]}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0eb85ed7-fb61-4d86-a803-08ab1e4d86e6	pg	618236d9e50cae30d3ffc09509cce2d23c2f63cea5a2c402ef1022a634c5a928	RAINMAKER-PGR.ServiceDefs	{"name": "Others", "order": 6, "active": true, "keywords": "other, miscellaneous,ad,playgrounds,burial,slaughterhouse, misc, tax, revenue", "menuPath": "", "slaHours": 336, "department": "DEPT_10", "serviceCode": "Others"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
200a5d2c-6326-4465-ad50-1028ed9973d7	pg	3209714d2eb0424463febe037709d1a05dadcb2d44c56fac7ab0b2eb63f61b57	RAINMAKER-PGR.ServiceDefs	{"name": "Park requires maintenance", "active": true, "keywords": "open, defecation, waste, human, privy, toilet", "menuPath": "Parks", "slaHours": 336, "department": "DEPT_5", "serviceCode": "ParkRequiresMaintenance"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
4dddf16f-bb81-4b95-9aa6-a92fe084d9ba	pg	8b75d2734e008e4eeb3c01eb19b9fd620efc211c30f2528d07d6c5212074cc96	RAINMAKER-PGR.ServiceDefs	{"name": "Open Defecation", "active": true, "keywords": "open, defecation, waste, human, privy, toilet", "menuPath": "OpenDefecation", "slaHours": 336, "department": "DEPT_3", "serviceCode": "OpenDefecation"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
86cc3524-d84d-449a-93f2-2cb69c396bc1	pg	fde2581b6ae874a3ebfc7292873e1520d170d9bfda54b601b7bc132ecc12545a	RAINMAKER-PGR.ServiceDefs	{"name": "Cutting/trimming of tree required", "active": true, "keywords": "tree, remove, trim, fallen, cut, plant, branch", "menuPath": "Trees", "slaHours": 336, "department": "DEPT_5", "serviceCode": "CuttingOrTrimmingOfTreeRequired"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
3b801a2f-6a60-4174-8123-ebc770f0bb75	pg	c4c18a87679b920a67de5e2bcef58f2bf53cdc69b8007e69f1414dfa24e85283	RAINMAKER-PGR.ServiceDefs	{"name": "Illegal Cutting of trees", "active": true, "keywords": "tree, cut, illegal, unathourized, remove, plant", "menuPath": "Trees", "slaHours": 336, "department": "DEPT_5", "serviceCode": "IllegalCuttingOfTrees"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b7a02ea9-0715-4901-be05-87f13ddf123d	pg	d13784be2b06cb1f1fd02aaaf3955221081e1ea6cefc785b4331598489954a1c	RAINMAKER-PGR.ServiceDefs	{"name": "Illegal parking", "active": true, "keywords": "illegal, parking, car, vehicle, space, removal, road, street, vehicle", "menuPath": "LandViolations", "slaHours": 336, "department": "DEPT_6", "serviceCode": "IllegalParking"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a7b5ddea-e0e4-41d5-9e87-b914d8e9d254	pg	acfc88dcf316fb72ea7b8e7ab2fb75f3c9fd27d09da48ef948a9bb05f3e4f8cc	RAINMAKER-PGR.ServiceDefs	{"name": "Illegal constructions", "active": true, "keywords": "illegal, violation, property, public, space, land, unathourised, site, construction, wrong, build", "menuPath": "LandViolations", "slaHours": 336, "department": "DEPT_6", "serviceCode": "IllegalConstructions"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
4fc80e51-0213-4f32-9ad4-f5f7afe2f0c9	pg	08bcfcc187c07ab8360741ce8b415933386610b616aaa7b5a8e79e6215bd8e11	RAINMAKER-PGR.ServiceDefs	{"name": "Illegal shops on footpath", "active": true, "keywords": "illegal, shop, footpath, violation, property, public, space, land, unathourised, site, construction, wrong", "menuPath": "LandViolations", "slaHours": 336, "department": "DEPT_6", "serviceCode": "IllegalShopsOnFootPath"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
457ca570-3057-46f7-b393-ba9edddbdee5	pg	52c5dfbce2e9c8b2bd1a163fce7eedadba2c3ada55c2fa7dc60dda6c381c41ed	RAINMAKER-PGR.ServiceDefs	{"name": "No water/electricity in public toilet", "active": true, "keywords": "toilet, public, restroom, bathroom, urinal, electricity, water, working", "menuPath": "PublicToilets", "slaHours": 336, "department": "DEPT_3", "serviceCode": "NoWaterOrElectricityinPublicToilet"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
db69c436-afe4-415c-b769-98c42faa296f	pg	71a153d1fead021601206a7f75819c1290727db0480fff4362725cde18a28ccb	RAINMAKER-PGR.ServiceDefs	{"name": "Public toilet damaged", "active": true, "keywords": "toilet, public, restroom, bathroom, urinal, block, working", "menuPath": "PublicToilets", "slaHours": 336, "department": "DEPT_3", "serviceCode": "PublicToiletIsDamaged"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6289c23e-abde-4841-8c03-e967f73caa79	pg	98028661d2544afb899cfef5b3801d13d351f443affd7d21fc25077d3d923e57	RAINMAKER-PGR.ServiceDefs	{"name": "Dirty/smelly public toilet", "active": true, "keywords": "toilet, public, restroom, bathroom, urinal, smell, dirty", "menuPath": "PublicToilets", "slaHours": 336, "department": "DEPT_3", "serviceCode": "DirtyOrSmellyPublicToilets"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7d5c2e51-e2e2-44a1-993b-0d955e880471	pg	cd31f8eabdd1453409c4438fef3b64ad5a4537292442d6db0def4f3ead948d3b	RAINMAKER-PGR.ServiceDefs	{"name": "Dead animals", "active": true, "keywords": "stray, cow, cows, cattle, bull, bulls, graze, grazing, dung, menace", "menuPath": "Animals", "slaHours": 336, "department": "DEPT_3", "serviceCode": "DeadAnimals"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e2e4f1d4-2d36-43ec-bd4c-896aa60653f7	pg	6437703971569eb090fe603cdb6cf8d172e83eebb2d814089f330c68a90fe89c	RAINMAKER-PGR.ServiceDefs	{"name": "Stray animals", "active": true, "keywords": "stray, dog, dogs, menace, animal, animals, attack, attacking, bite, biting, bark, barking", "menuPath": "Animals", "slaHours": 336, "department": "DEPT_3", "serviceCode": "StrayAnimals"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
4a3a727a-59be-45cf-a4e1-15ef1a153cf1	pg	7369b4e6aaaac7c675933f7b6ed83ae430a7e838910ddff84593d97b776545f8	RAINMAKER-PGR.ServiceDefs	{"name": "Construction material lying on the road", "active": true, "keywords": "illegal, shop, footpath, walk, remove, occupy, path", "menuPath": "RoadsAndFootpaths", "slaHours": 336, "department": "DEPT_4", "serviceCode": "ConstructionMaterialLyingOntheRoad"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
cdcb74eb-81f0-4170-a6dd-c575537c52fc	pg	605198eb5c17c2730aaeda35f8e08af766816edc20108b2fa9e881737f4641a5	RAINMAKER-PGR.ServiceDefs	{"name": "Damaged/blocked footpath", "active": true, "keywords": "footpath, repair, broken, surface, damage, patch, hole, maintenance, walk, path", "menuPath": "RoadsAndFootpaths", "slaHours": 336, "department": "DEPT_4", "serviceCode": "DamagedOrBlockedFootpath"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2bea4554-0271-4eb6-86d0-5bbada247c50	pg	5108cd9845f39676ca27c01c9318e9bfa8f94b04e7134bfeb8a2021fce17e07a	RAINMAKER-PGR.ServiceDefs	{"name": "Manhole cover is missing/damaged", "active": true, "keywords": "road, street, manhole, hole, cover, lid, footpath, open, man, drainage, damage, repair, fix", "menuPath": "RoadsAndFootpaths", "slaHours": 336, "department": "DEPT_4", "serviceCode": "ManholeCoverMissingOrDamaged"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
fe672748-67f4-4bd9-8088-6b0963d66703	pg	a8e2093b11f4cf933c4793a107ee653069283ac886abc462ff157ac7169c6307	RAINMAKER-PGR.ServiceDefs	{"name": "Water logged road", "active": true, "keywords": "road, drainage, water, block, puddle, street, flood, overflow, rain", "menuPath": "RoadsAndFootpaths", "slaHours": 336, "department": "DEPT_4", "serviceCode": "WaterLoggedRoad"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
55c86529-f026-435a-94df-1c3fd9ad13a1	pg	dbd2af1cf0ecbcd6c1cc0ac53eb99e7189637d77bc978122a66806476d12cb26	RAINMAKER-PGR.ServiceDefs	{"name": "Damaged road", "active": true, "keywords": "road, damage, hole, surface, repair, patch, broken, maintenance, street, construction, fix", "menuPath": "RoadsAndFootpaths", "slaHours": 336, "department": "DEPT_4", "serviceCode": "DamagedRoad"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
fb47bf88-b426-42e4-87dc-32099b2bd608	pg	c1509b5e9b213a67458a8cf5e73b4442c48db2158f94e1da655d2f2064c61048	RAINMAKER-PGR.ServiceDefs	{"name": "Water pressure is very less", "active": true, "keywords": "water, supply, connection, damage, repair, broken, pipe, piping, tap", "menuPath": "WaterandSewage", "slaHours": 336, "department": "DEPT_4", "serviceCode": "WaterPressureisVeryLess"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
cebb1165-5568-469f-b23a-9dff215f7d2d	pg	acb340a9ff7ae2d77259c882dda51c5abc8bb142b486b1f26b1072e4cf8a8a44	RAINMAKER-PGR.ServiceDefs	{"name": "Broken water pipe / Leakage", "order": 3, "active": true, "keywords": "water, supply, connection, damage, repair, broken, pipe, piping, tap", "menuPath": "WaterandSewage", "slaHours": 336, "department": "DEPT_4", "serviceCode": "BrokenWaterPipeOrLeakage"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
3c57b210-9bf8-4e1e-a7df-e168db07c59c	pg	b5fb30535085de936a29538389630800739f8722ee3c60457a4bfc1e4b886b7c	RAINMAKER-PGR.ServiceDefs	{"name": "Dirty water supply", "active": true, "keywords": "water, supply, connection, drink, dirty, contaminated, impure, health, clean", "menuPath": "WaterandSewage", "slaHours": 336, "department": "DEPT_4", "serviceCode": "DirtyWaterSupply"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
9ac108de-8a8a-4784-bd26-3c285bb35038	pg	e546182e78b1205318256ac994a0f202f36b3ba4bbbe3bf06a165777fd34dc1b	RAINMAKER-PGR.ServiceDefs	{"name": "No water supply", "active": true, "keywords": "water, supply, connection, drink, tap", "menuPath": "WaterandSewage", "slaHours": 336, "department": "DEPT_4", "serviceCode": "NoWaterSupply"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
73a53952-75a2-435a-a54d-da5dedad4366	pg	8172c4f6af02aa670ff3988527fdd8e2431c493488d162d743f95ed91ce28cfb	RAINMAKER-PGR.ServiceDefs	{"name": "Shortage of water", "active": true, "keywords": "water, supply, shortage, drink, tap, connection,leakage,less", "menuPath": "WaterandSewage", "slaHours": 336, "department": "DEPT_4", "serviceCode": "ShortageOfWater"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
13a41f7e-65a7-4c45-87a8-b62ce3c327a4	pg	eaf8f7b12778e92822bc189d66eb68d32cf5452501a6f754a78d912fc9d8357e	RAINMAKER-PGR.ServiceDefs	{"name": "Block / Overflowing sewage", "order": 2, "active": true, "keywords": "water, supply, connection, damage, repair, broken, pipe, piping, tap", "menuPath": "WaterandSewage", "slaHours": 336, "department": "DEPT_4", "serviceCode": "BlockOrOverflowingSewage"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ce628b6c-6391-43d4-9f98-b38aefd8bf85	pg	e2fa26754783d193afe9f910b5552cdf8a7f4dba65500faa8ae4152c70424a93	RAINMAKER-PGR.ServiceDefs	{"name": "Illegal discharge of sewage", "active": true, "keywords": "water, supply, connection, damage, repair, broken, pipe, piping, tap", "menuPath": "WaterandSewage", "slaHours": 336, "department": "DEPT_4", "serviceCode": "illegalDischargeOfSewage"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
38f3867d-b46a-4827-8084-6a94e66b3f53	pg	fe3cc5febeca4a53e4d15fa0e81be3d6c69b5d5a8f466d3abb74eda04fbf827a	RAINMAKER-PGR.ServiceDefs	{"name": "Overflowing/Blocked drain", "active": true, "keywords": "drain, block, clean, debris, silt, drainage, water, clean, roadside, flow, remove, waste, garbage, clear, overflow, canal, fill, stagnate, rain, sanitation, sand, pipe, clog, stuck", "menuPath": "Drains", "slaHours": 336, "department": "DEPT_4", "serviceCode": "OverflowingOrBlockedDrain"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
78a8ff27-6009-43ba-99d7-8a2f8e517fc5	pg	be5eda57a41acf74b015df1a4b24e5a175eda088833515ec7825788715820de2	RAINMAKER-PGR.ServiceDefs	{"name": "Burning of garbage", "active": true, "keywords": "garbage, remove, burn, fire, health, waste, smoke, plastic, illegal", "menuPath": "Garbage", "slaHours": 336, "department": "DEPT_3", "serviceCode": "BurningOfGarbage"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8dc80e12-47c3-4abf-a460-304cf979e8d8	pg	d0d9fb62d6848179c23f4e4c9f0ff09f2156a1b47fe5b39b4e2a346056670f88	RAINMAKER-PGR.ServiceDefs	{"name": "Damaged garbage bin", "active": true, "keywords": "garbage, waste, bin, dustbin, clean, remove, sanitation, overflow, smell, health, throw, dispose", "menuPath": "Garbage", "slaHours": 336, "department": "DEPT_3", "serviceCode": "DamagedGarbageBin"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
49e6b340-f4b7-47dc-9f19-9917af943dd8	pg	e9a1b5b0512ce027fa62d39b67900dd216bd582ca85d08535f66ef4f45afe878	RAINMAKER-PGR.ServiceDefs	{"name": "Garbage needs to be cleared", "order": 4, "active": true, "keywords": "garbage, collect, litter, clean, door, waste, remove, sweeper, sanitation, dump, health, debris, throw", "menuPath": "Garbage", "slaHours": 336, "department": "DEPT_3", "serviceCode": "GarbageNeedsTobeCleared"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
c8e54525-c25a-4424-bb74-00e7429fb0fb	pg	e950e23e70f51e054882787770097f64e41352a334f02eb8d0545a57bf98a67c	RAINMAKER-PGR.ServiceDefs	{"name": "Streetlight not working", "order": 1, "active": true, "keywords": "streetlight, light, repair, work, pole, electric, power, repair, fix", "menuPath": "StreetLights", "slaHours": 336, "department": "DEPT_1", "serviceCode": "StreetLightNotWorking"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7117299d-5a8d-4617-8657-8ec06368bca1	pg	b222848808278f4f692118befce1e677df2c27e5bb963220aabacb88e0ecde48	RAINMAKER-PGR.ServiceDefs	{"name": "Non sweeping of road", "order": 5, "active": true, "keywords": "garbage, collect, litter, clean, door, waste, remove, sweeper, sanitation, dump, health, debris, throw", "menuPath": "Garbage", "slaHours": 336, "department": "DEPT_3", "serviceCode": "NonSweepingOfRoad"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
344495fc-c324-4923-b8b4-b8f44eda6093	pg	49b2ab679a5b95b6334884b2b0391f1cdd7cdab8dd476be8380a8c22f23e481a	RAINMAKER-PGR.ServiceDefs	{"name": "No streetlight", "active": true, "keywords": "streetlight, light, repair, work, pole, electric, power, repair, damage, fix", "menuPath": "StreetLights", "slaHours": 336, "department": "DEPT_1", "serviceCode": "NoStreetlight"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
bcbaec41-909d-47ff-b495-c43cd90f0095	pg	cc59ecfba912b1fa3df332fbf36038931503b17dfc8398bf2e04c35431d7bf0e	RAINMAKER-PGR.UIConstants	{"REOPENSLA": 432000000}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
8dc76ad4-dfc4-4ba6-9bb6-1b026ef1c69f	pg	43b53bde3abdfb2f034bbd43e5705add60fbdf6dafdd6201f021adbdca907834	tenant.citymodule	{"code": "Workbench", "order": 13, "active": true, "module": "Workbench", "tenants": [{"code": "pg.cityb"}, {"code": "pg.cityc"}, {"code": "pg.citya"}]}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b9e3602f-93a4-4bff-a33d-13c7a37d6ddd	pg	d9868411078f0cb5f54bbb65772a65786ad585ec888bdc465545205c6da22b1f	tenant.citymodule	{"code": "PGR", "order": 2, "active": true, "module": "PGR", "tenants": [{"code": "pg.citya"}, {"code": "pg.cityb"}]}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
abfd3107-2234-4df7-921b-dc270dbcecbb	pg	e8e4c0b369aec423c9f50a87e2e8adfb84115951ccb375583435681ea9a57158	tenant.citymodule	{"code": "HRMS", "order": 2, "active": true, "module": "HRMS", "tenants": [{"code": "pg"}, {"code": "pg.citya"}, {"code": "pg.cityb"}]}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
aa330faa-55c0-4b96-a936-b796f37a090a	pg	5190036c90bc19082e2a1cda0c8e3b30e40fbce184cebc12fac476dae11eaa88	tenant.tenants	{"city": {"code": "1013", "name": "City A", "captcha": null, "ddrName": "DDR A", "latitude": 31.3260152, "ulbGrade": "Municipal Corporation", "localName": null, "longitude": 75.5761829, "regionName": null, "districtCode": "CITYA", "districtName": null, "shapeFileLocation": null, "districtTenantCode": "pg.citya"}, "code": "pg.citya", "name": "City A", "type": "CITY", "logoId": "https://s3.ap-south-1.amazonaws.com/pg-egov-assets/pg.citya/logo.png", "address": "City A Municipal Corporation", "emailId": "citya@gmail.com", "imageId": null, "pincode": [143001, 143002, 143003, 143004, 143005], "domainUrl": "https://www.egovernments.org", "twitterUrl": null, "description": "City A", "facebookUrl": null, "OfficeTimings": {"Mon - Fri": "9.00 AM - 6.00 PM"}, "contactNumber": "001-2345876"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
c484e9d2-acf9-4aad-8af7-802f3e2771ac	pg	33552d7944d29db95d3abfda24a528d39c715f4852c7e4181f62271ccdc8c6ef	tenant.tenants	{"city": {"code": "107", "name": "City B", "captcha": null, "ddrName": "DDR A", "latitude": 31.6339793, "ulbGrade": "Municipal Corporation", "localName": null, "longitude": 74.8722642, "regionName": null, "districtCode": "CITYB", "districtName": null, "shapeFileLocation": null, "districtTenantCode": "pg.cityb"}, "code": "pg.cityb", "name": "City B", "type": "CITY", "logoId": "https://s3.ap-south-1.amazonaws.com/pg-egov-assets/pg.cityb/logo.png", "address": "City B Municipal Corporation Address", "emailId": "cityb@gmail.com", "imageId": null, "pincode": [143006, 143007, 143008, 143009, 143010], "domainUrl": "https://www.egovernments.org", "twitterUrl": null, "description": null, "facebookUrl": null, "OfficeTimings": {"Sat": "9.00 AM - 12.00 PM", "Mon - Fri": "9.00 AM - 6.00 PM"}, "contactNumber": "0978-7645345", "helpLineNumber": "0654-8734567"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
56039d41-c9f5-42f0-823c-8112e69fcc45	pg	c38ce6813d86df987616cc4d1a80b301c3141b0b71b73d76734e5beeda4fe3fc	Workflow.AutoEscalationStatesToIgnore	{"state": ["INITIATED", "PENDINGAPPROVAL"], "module": "TL", "businessService": "NewTL"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
47215ddc-cdc9-4021-81ef-9b6137c9123a	pg	e08f0fc8b81e33183a57e2d0fdf93aefb2a75b1c10208502e948a55ea39cd673	Workflow.BusinessService	{"uuid": "2b75575a-f84d-11e8-8eb2-f2801f1b9fd1", "getUri": "", "states": [{"uuid": "bf5fd4f4-f7df-11e8-8eb2-f2801f1b9fd1", "state": "INITIATED", "actions": [{"uuid": "4bd0f10a-f7d3-11e8-8eb2-f2801f1b9fd1", "roles": "CITIZEN,TL_CEMP", "action": "APPLY", "stateId": "bf5fd4f4-f7df-11e8-8eb2-f2801f1b9fd1", "tenantId": "pg", "nextStateId": "bf5fd8c8-f7df-11e8-8eb2-f2801f1b9fd1"}], "tenantId": "pg", "isStartState": "true", "UpdateAllowed": "false", "isTerminateState": "false", "applicableActions": "INITIATE", "businessServiceId": "NewTL", "docUploadRequired": "false", "applicableNextStates": "APPLIED"}, {"uuid": "bf5fd8c8-f7df-11e8-8eb2-f2801f1b9fd1", "state": "APPLIED", "actions": [{"uuid": "4bd0f2a4-f7d3-11e8-8eb2-f2801f1b9fd1", "roles": "SYSTEM_PAYMENT", "action": "PAY", "stateId": "bf5fd8c8-f7df-11e8-8eb2-f2801f1b9fd1", "tenantId": "pg", "nextStateId": "bf5fdaee-f7df-11e8-8eb2-f2801f1b9fd1"}, {"uuid": "4bd0f3ee-f7d3-11e8-8eb2-f2801f1b9fd1", "roles": "CLERK", "action": "CANCEL", "stateId": "bf5fd8c8-f7df-11e8-8eb2-f2801f1b9fd1", "tenantId": "pg", "nextStateId": "bf5fe0fc-f7df-11e8-8eb2-f2801f1b9fd1"}, {"uuid": "4bd0f524-f7d3-11e8-8eb2-f2801f1b9fd1", "roles": "CLERK", "action": "REJECT", "stateId": "bf5fd8c8-f7df-11e8-8eb2-f2801f1b9fd1", "tenantId": "pg", "nextStateId": "bf5fe318-f7df-11e8-8eb2-f2801f1b9fd1"}, {"uuid": "543f802e-f952-11e8-8eb2-f2801f1b9fd1", "roles": "TL_APPROVER", "action": "APPROVE", "stateId": "bf5fe444-f7df-11e8-8eb2-f2801f1b9fd1", "tenantId": "pg", "nextStateId": "bf5fdfbc-f7df-11e8-8eb2-f2801f1b9fd1"}], "tenantId": "pg", "isStartState": "false", "UpdateAllowed": "true", "isTerminateState": "false", "applicableActions": "Reject,Pay,Cancel,Mark", "businessServiceId": "NewTL", "docUploadRequired": "false", "applicableNextStates": "Paid,Cancelled,Rejected"}, {"uuid": "bf5fdaee-f7df-11e8-8eb2-f2801f1b9fd1", "state": "PAID", "actions": [{"uuid": "4bd0faa6-f7d3-11e8-8eb2-f2801f1b9fd1", "roles": "CLERK", "action": "CANCEL", "stateId": "bf5fdaee-f7df-11e8-8eb2-f2801f1b9fd1", "tenantId": "pg", "nextStateId": "bf5fe0fc-f7df-11e8-8eb2-f2801f1b9fd1"}, {"uuid": "4bd0fc54-f7d3-11e8-8eb2-f2801f1b9fd1", "roles": "CLERK", "action": "REJECT", "stateId": "bf5fdaee-f7df-11e8-8eb2-f2801f1b9fd1", "tenantId": "pg", "nextStateId": "bf5fe318-f7df-11e8-8eb2-f2801f1b9fd1"}, {"uuid": "4bd0feac-f7d3-11e8-8eb2-f2801f1b9fd1", "roles": "CLERK", "action": "MARK", "stateId": "bf5fdaee-f7df-11e8-8eb2-f2801f1b9fd1", "tenantId": "pg", "nextStateId": "bf5fdaee-f7df-11e8-8eb2-f2801f1b9fd1"}, {"uuid": "4bd10136-f7d3-11e8-8eb2-f2801f1b9fd1", "roles": "CLERK", "action": "FORWARD", "stateId": "bf5fdaee-f7df-11e8-8eb2-f2801f1b9fd1", "tenantId": "pg", "nextStateId": "bf5fdd28-f7df-11e8-8eb2-f2801f1b9fd1"}], "tenantId": "pg", "isStartState": "false", "UpdateAllowed": "true", "isTerminateState": "false", "applicableActions": "Approve,Cancel,Reject,Mark", "businessServiceId": "NewTL", "docUploadRequired": "false", "applicableNextStates": "Intermediate"}, {"uuid": "bf5fdd28-f7df-11e8-8eb2-f2801f1b9fd1", "state": "FIELDINSPECTION", "actions": [{"uuid": "4bd1041a-f7d3-11e8-8eb2-f2801f1b9fd1", "roles": "TL_FIELD_INSPECTOR", "action": "CANCEL", "stateId": "bf5fdd28-f7df-11e8-8eb2-f2801f1b9fd1", "tenantId": "pg", "nextStateId": "bf5fe0fc-f7df-11e8-8eb2-f2801f1b9fd1"}, {"uuid": "4bd1064a-f7d3-11e8-8eb2-f2801f1b9fd1", "roles": "TL_FIELD_INSPECTOR", "action": "REJECT", "stateId": "bf5fdd28-f7df-11e8-8eb2-f2801f1b9fd1", "tenantId": "pg", "nextStateId": "bf5fe318-f7df-11e8-8eb2-f2801f1b9fd1"}, {"uuid": "4bd108ac-f7d3-11e8-8eb2-f2801f1b9fd1", "roles": "TL_FIELD_INSPECTOR", "action": "MARK", "stateId": "bf5fdd28-f7df-11e8-8eb2-f2801f1b9fd1", "tenantId": "pg", "nextStateId": "bf5fdd28-f7df-11e8-8eb2-f2801f1b9fd1"}, {"uuid": "4bd10de8-f7d3-11e8-8eb2-f2801f1b9fd1", "roles": "TL_FIELD_INSPECTOR", "action": "FORWARD", "stateId": "bf5fdd28-f7df-11e8-8eb2-f2801f1b9fd1", "tenantId": "pg", "nextStateId": "bf5fe444-f7df-11e8-8eb2-f2801f1b9fd1"}], "tenantId": "pg", "isStartState": "false", "UpdateAllowed": "", "isTerminateState": "false", "applicableActions": "", "businessServiceId": "NewTL", "docUploadRequired": "", "applicableNextStates": "Approved,Cancelled,Rejected"}, {"uuid": "bf5fdfbc-f7df-11e8-8eb2-f2801f1b9fd1", "state": "APPROVED", "actions": [{"uuid": "4bd11770-f7d3-11e8-8eb2-f2801f1b9fd1", "roles": "TL_APPROVER", "action": "CANCEL", "stateId": "bf5fdfbc-f7df-11e8-8eb2-f2801f1b9fd1", "tenantId": "pg", "nextStateId": "bf5fe0fc-f7df-11e8-8eb2-f2801f1b9fd1"}], "tenantId": "pg", "isStartState": "false", "UpdateAllowed": "true", "isTerminateState": "true", "applicableActions": "CANCEL", "businessServiceId": "NewTL", "docUploadRequired": "true", "applicableNextStates": ""}, {"uuid": "bf5fe0fc-f7df-11e8-8eb2-f2801f1b9fd1", "state": "CANCELLED", "actions": [{"uuid": "4bd112e8-f7d3-11e8-8eb2-f2801f1b9fd1", "roles": "", "action": "", "stateId": "bf5fe0fc-f7df-11e8-8eb2-f2801f1b9fd1", "tenantId": "pg", "nextStateId": ""}], "tenantId": "pg", "isStartState": "false", "UpdateAllowed": "true", "isTerminateState": "true", "applicableActions": "", "businessServiceId": "NewTL", "docUploadRequired": "false", "applicableNextStates": ""}, {"uuid": "bf5fe318-f7df-11e8-8eb2-f2801f1b9fd1", "state": "REJECTED", "actions": [{"uuid": "4bd115fe-f7d3-11e8-8eb2-f2801f1b9fd1", "roles": "CITIZEN,TL_CEMP", "action": "REINITIATE", "stateId": "bf5fe318-f7df-11e8-8eb2-f2801f1b9fd1", "tenantId": "pg", "nextStateId": "bf5fd4f4-f7df-11e8-8eb2-f2801f1b9fd1"}], "tenantId": "pg", "isStartState": "false", "UpdateAllowed": "true", "isTerminateState": "true", "applicableActions": "Reapply", "businessServiceId": "NewTL", "docUploadRequired": "true", "applicableNextStates": "Initiated"}, {"uuid": "bf5fe444-f7df-11e8-8eb2-f2801f1b9fd1", "state": "PENDINGAPPROVAL", "actions": [{"uuid": "4bd10f50-f7d3-11e8-8eb2-f2801f1b9fd1", "roles": "TL_APPROVER", "action": "APPROVE", "stateId": "bf5fe444-f7df-11e8-8eb2-f2801f1b9fd1", "tenantId": "pg", "nextStateId": "bf5fdfbc-f7df-11e8-8eb2-f2801f1b9fd1"}, {"uuid": "4bd11086-f7d3-11e8-8eb2-f2801f1b9fd1", "roles": "TL_APPROVER", "action": "CANCEL", "stateId": "bf5fe444-f7df-11e8-8eb2-f2801f1b9fd1", "tenantId": "pg", "nextStateId": "bf5fe0fc-f7df-11e8-8eb2-f2801f1b9fd1"}, {"uuid": "4bd111a8-f7d3-11e8-8eb2-f2801f1b9fd1", "roles": "TL_APPROVER", "action": "REJECT", "stateId": "bf5fe444-f7df-11e8-8eb2-f2801f1b9fd1", "tenantId": "pg", "nextStateId": "bf5fe318-f7df-11e8-8eb2-f2801f1b9fd1"}], "tenantId": "pg", "isStartState": "false", "UpdateAllowed": "", "isTerminateState": "false", "applicableActions": "", "businessServiceId": "NewTL", "docUploadRequired": "", "applicableNextStates": ""}, {"uuid": "9d458700-f894-11e8-8eb2-f2801f1b9fd1", "state": "", "actions": [{"uuid": "2efb9036-f895-11e8-8eb2-f2801f1b9fd1", "roles": "CITIZEN,TL_CEMP", "action": "INITIATE", "stateId": "9d458700-f894-11e8-8eb2-f2801f1b9fd1", "tenantId": "pg", "nextStateId": "bf5fd4f4-f7df-11e8-8eb2-f2801f1b9fd1"}], "tenantId": "pg", "isStartState": "true", "UpdateAllowed": "true", "isTerminateState": "false", "applicableActions": "INITIATE", "businessServiceId": "NewTL", "docUploadRequired": "false", "applicableNextStates": "Initiated"}], "postUri": "", "tenantId": "pg", "businessService": "NewTL"}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
22fcc569-d23d-4e85-a2cb-1528123d8c0a	pg	9c1639a0d054ead7762c28dc39d4faace7bd3c2beb39dadf044bdd15a3662d5d	Workflow.BusinessServiceConfig	{"code": "NEWTL", "isStateLevel": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7a114c79-20af-4062-b49d-c6b8d8aae969	pg	0c5d9c83e755ff20012541233d8dec09a5bded28ac0007b76328de484bf77700	Workflow.BusinessServiceConfig	{"code": "FIRENOC", "isStateLevel": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
2a981f9a-0deb-41df-bdfd-aabeb4bd8ce3	pg.cidept	DEPT_36	common-masters.Department	{"code": "DEPT_36", "name": "WATER DEPARTMENT", "active": true}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655268080	1778655268080
1955a209-1eb1-42b9-b9cf-a2f5f2b4ee46	pg	pg.cidesig	tenant.tenants	{"city": {"code": "PG_CIDESIG", "name": "pg.cidesig", "districtName": "pg.cidesig"}, "code": "pg.cidesig", "name": "pg.cidesig", "type": "CITY", "tenantId": "pg.cidesig"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655265621	1778655265621
6e862420-f449-47a5-84ad-17784babf929	pg.cidesig	DEPT_36	common-masters.Department	{"code": "DEPT_36", "name": "WATER DEPARTMENT", "active": true}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655265842	1778655265842
f10fef67-41aa-42ee-80e3-bff4d22be1fd	pg.cidesig	DEPT_37	common-masters.Department	{"code": "DEPT_37", "name": "ELECTRIC DEPARTMENT", "active": true}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655265955	1778655265955
f3866e75-2679-4a7a-bb39-011575a0d587	pg.cidesig	DESIG_1002	common-masters.Designation	{"code": "DESIG_1002", "name": "engineer", "active": true, "department": ["DEPT_36"], "description": "engineer - WATER DEPARTMENT"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655266350	1778655266350
9d0a1085-37f8-4bd0-933b-4f4dccbb4348	pg.cidesig	DESIG_1003	common-masters.Designation	{"code": "DESIG_1003", "name": "LME", "active": true, "department": ["DEPT_37"], "description": "LME - ELECTRIC DEPARTMENT"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655266466	1778655266466
750ace7b-b081-4959-b76b-6cebe978abc3	pg	pg.cidept	tenant.tenants	{"city": {"code": "PG_CIDEPT", "name": "pg.cidept", "districtName": "pg.cidept"}, "code": "pg.cidept", "name": "pg.cidept", "type": "CITY", "tenantId": "pg.cidept"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655267847	1778655267847
715df078-b0ee-4cf9-b6e9-2c42928295ed	pg.cidept	DEPT_37	common-masters.Department	{"code": "DEPT_37", "name": "ELECTRIC DEPARTMENT", "active": true}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655268192	1778655268192
24d33ba2-cbb4-409a-8551-4fa3d57a2434	pg.cidept	DESIG_1002	common-masters.Designation	{"code": "DESIG_1002", "name": "engineer", "active": true, "department": ["DEPT_36"], "description": "engineer - WATER DEPARTMENT"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655268574	1778655268574
da86c43b-bf9f-4d12-87fc-5a8ba677c115	pg.cidept	DESIG_1003	common-masters.Designation	{"code": "DESIG_1003", "name": "LME", "active": true, "department": ["DEPT_37"], "description": "LME - ELECTRIC DEPARTMENT"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655268689	1778655268689
3ab2b9e0-ff04-4896-b9b7-e903e7f34844	pg	pg.cicounts	tenant.tenants	{"city": {"code": "PG_CICOUNTS", "name": "pg.cicounts", "districtName": "pg.cicounts"}, "code": "pg.cicounts", "name": "pg.cicounts", "type": "CITY", "tenantId": "pg.cicounts"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655272027	1778655272027
2ec131bb-bd06-4cc4-bc05-3f99c388fce1	pg.cicounts	DEPT_36	common-masters.Department	{"code": "DEPT_36", "name": "WATER DEPARTMENT", "active": true}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655272415	1778655272415
02ad42b4-46db-4f84-9bb2-e05ad2665b8a	pg.cicounts	DEPT_37	common-masters.Department	{"code": "DEPT_37", "name": "ELECTRIC DEPARTMENT", "active": true}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655272529	1778655272529
d2d3dd6d-e3d5-4e02-8f54-c1893cebb7a9	pg.cicounts	DEPT_38	common-masters.Department	{"code": "DEPT_38", "name": "CI_SCOPE_DEPT_55272", "active": true}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655272644	1778655272644
71ad7584-8f89-4fd9-93ec-2ae5d7f490e7	pg.cicounts	DESIG_1002	common-masters.Designation	{"code": "DESIG_1002", "name": "engineer", "active": true, "department": ["DEPT_36"], "description": "engineer - WATER DEPARTMENT"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655273039	1778655273039
3d35e286-aea9-4870-8c61-00c59a2b56fd	pg.cicounts	DESIG_1003	common-masters.Designation	{"code": "DESIG_1003", "name": "LME", "active": true, "department": ["DEPT_37"], "description": "LME - ELECTRIC DEPARTMENT"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655273152	1778655273152
0fba6867-a650-4c2e-aefd-872ce500ae47	pg.cicounts	DESIG_1004	common-masters.Designation	{"code": "DESIG_1004", "name": "CI_SCOPE_DESIG_55272", "active": true, "department": ["DEPT_38"], "description": "CI_SCOPE_DESIG_55272 - CI_SCOPE_DEPT_55272"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655273266	1778655273266
0da98128-edbb-4104-a62d-2b971b39ae8e	pg	pg.cibndauth	tenant.tenants	{"city": {"code": "PG_CIBNDAUTH", "name": "pg.cibndauth", "districtName": "pg.cibndauth"}, "code": "pg.cibndauth", "name": "pg.cibndauth", "type": "CITY", "tenantId": "pg.cibndauth"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655274100	1778655274100
4e9b3813-92cc-44b8-ad88-d31057588e79	pg	pg.circt55494	tenant.tenants	{"city": {"code": "PG_CIRCT55494", "name": "pg.circt55494", "districtName": "pg.circt55494"}, "code": "pg.circt55494", "name": "pg.circt55494", "type": "CITY", "tenantId": "pg.circt55494"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655494686	1778655494686
2f6c04e7-54c3-4a41-a286-a0d62b28aa85	pg.circt55494	CI_RCT_55494	common-masters.Department	{"code": "CI_RCT_55494", "name": "CI Reactivation Test Dept", "active": true}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655496851	1778655503983
5ac67ac9-a2c4-4b4d-8c49-730f4aacddc5	pg	pg.ciemp55505	tenant.tenants	{"city": {"code": "PG_CIEMP55505", "name": "pg.ciemp55505", "districtName": "pg.ciemp55505"}, "code": "pg.ciemp55505", "name": "pg.ciemp55505", "type": "CITY", "tenantId": "pg.ciemp55505"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655506003	1778655506003
a5003f21-a7aa-47c6-81f3-bbedd8fa9029	pg.ciemp55505	DEPT_36	common-masters.Department	{"code": "DEPT_36", "name": "WATER DEPARTMENT", "active": true}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655508234	1778655508234
b2709509-aaca-488c-869a-a29d0fdbb0d1	pg.ciemp55505	DEPT_37	common-masters.Department	{"code": "DEPT_37", "name": "ELECTRIC DEPARTMENT", "active": true}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655508345	1778655508345
b6c5014e-3b2a-4d1d-9fac-56393874cde0	pg.ciemp55505	DESIG_1002	common-masters.Designation	{"code": "DESIG_1002", "name": "engineer", "active": true, "department": ["DEPT_36"], "description": "engineer - WATER DEPARTMENT"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655508732	1778655508732
d6ab48ab-9312-47a4-933f-dc26897706d4	pg.ciemp55505	DESIG_1003	common-masters.Designation	{"code": "DESIG_1003", "name": "LME", "active": true, "department": ["DEPT_37"], "description": "LME - ELECTRIC DEPARTMENT"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655508847	1778655508847
50147c1d-f069-4596-a77c-b34bd3bb8079	pg	pg.ciadm55512	tenant.tenants	{"city": {"code": "PG_CIADM55512", "name": "pg.ciadm55512", "districtName": "pg.ciadm55512"}, "code": "pg.ciadm55512", "name": "pg.ciadm55512", "type": "CITY", "tenantId": "pg.ciadm55512"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778655512020	1778655512020
a5714d2a-2798-440e-8ae9-e4d0fa2a41be	pg.cicounts	DEPT_39	common-masters.Department	{"code": "DEPT_39", "name": "CI_SCOPE_DEPT_59014", "active": true}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778659014606	1778659014606
d4f6769a-f8ab-4dbc-802a-84adb54dfe49	pg.cicounts	DESIG_1005	common-masters.Designation	{"code": "DESIG_1005", "name": "CI_SCOPE_DESIG_59014", "active": true, "department": ["DEPT_39"], "description": "CI_SCOPE_DESIG_59014 - CI_SCOPE_DEPT_59014"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778659015055	1778659015055
55281ed7-8188-45e4-992c-f30d1b877581	pg	pg.circt59235	tenant.tenants	{"city": {"code": "PG_CIRCT59235", "name": "pg.circt59235", "districtName": "pg.circt59235"}, "code": "pg.circt59235", "name": "pg.circt59235", "type": "CITY", "tenantId": "pg.circt59235"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778659235636	1778659235636
bdbcffac-d9ce-42d4-9068-6dad09a83246	pg.circt59235	CI_RCT_59235	common-masters.Department	{"code": "CI_RCT_59235", "name": "CI Reactivation Test Dept", "active": true}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778659237817	1778659244949
0f7a36f4-b0eb-41d7-863f-4e63ce45a4fe	pg	pg.ciemp59246	tenant.tenants	{"city": {"code": "PG_CIEMP59246", "name": "pg.ciemp59246", "districtName": "pg.ciemp59246"}, "code": "pg.ciemp59246", "name": "pg.ciemp59246", "type": "CITY", "tenantId": "pg.ciemp59246"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778659246967	1778659246967
1dca0db9-634d-4c5c-8235-e146e32237cb	pg.ciemp59246	DEPT_36	common-masters.Department	{"code": "DEPT_36", "name": "WATER DEPARTMENT", "active": true}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778659249180	1778659249180
94bfd535-5e59-45db-bbb4-ada5b9fc99da	pg.ciemp59246	DEPT_37	common-masters.Department	{"code": "DEPT_37", "name": "ELECTRIC DEPARTMENT", "active": true}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778659249293	1778659249293
6a86bb8b-1a0e-4624-ab1e-799a612f98d6	pg.ciemp59246	DESIG_1002	common-masters.Designation	{"code": "DESIG_1002", "name": "engineer", "active": true, "department": ["DEPT_36"], "description": "engineer - WATER DEPARTMENT"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778659249682	1778659249682
56d40c34-64a8-494b-bfe6-8b6e92e5d716	pg.ciemp59246	DESIG_1003	common-masters.Designation	{"code": "DESIG_1003", "name": "LME", "active": true, "department": ["DEPT_37"], "description": "LME - ELECTRIC DEPARTMENT"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778659249795	1778659249795
74c93ef2-4fb6-4ccd-a303-9b6ffeaf28d0	pg	pg.ciadm59252	tenant.tenants	{"city": {"code": "PG_CIADM59252", "name": "pg.ciadm59252", "districtName": "pg.ciadm59252"}, "code": "pg.ciadm59252", "name": "pg.ciadm59252", "type": "CITY", "tenantId": "pg.ciadm59252"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778659252998	1778659252998
c4fc40a4-ab0a-4498-a9ba-17356361ee2f	pg.cicounts	DEPT_40	common-masters.Department	{"code": "DEPT_40", "name": "CI_SCOPE_DEPT_61700", "active": true}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778661701221	1778661701221
feaa8d28-6502-4440-b667-b13ed3ccec20	pg.cicounts	DESIG_1006	common-masters.Designation	{"code": "DESIG_1006", "name": "CI_SCOPE_DESIG_61700", "active": true, "department": ["DEPT_40"], "description": "CI_SCOPE_DESIG_61700 - CI_SCOPE_DEPT_61700"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778661701684	1778661701684
514c3ab7-55b5-41ed-a5be-5416a10d025d	pg	pg.circt61921	tenant.tenants	{"city": {"code": "PG_CIRCT61921", "name": "pg.circt61921", "districtName": "pg.circt61921"}, "code": "pg.circt61921", "name": "pg.circt61921", "type": "CITY", "tenantId": "pg.circt61921"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778661921979	1778661921979
0a5eb0c0-aeb7-40ba-a395-f708eff8461d	pg.circt61921	CI_RCT_61921	common-masters.Department	{"code": "CI_RCT_61921", "name": "CI Reactivation Test Dept", "active": true}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778661924145	1778661931278
9373f268-14d6-497b-bfe6-e8d2920e8b6d	pg	pg.ciemp61933	tenant.tenants	{"city": {"code": "PG_CIEMP61933", "name": "pg.ciemp61933", "districtName": "pg.ciemp61933"}, "code": "pg.ciemp61933", "name": "pg.ciemp61933", "type": "CITY", "tenantId": "pg.ciemp61933"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778661933297	1778661933297
bf8589d2-824e-40ae-926b-b26cfac3e03f	pg	pg.ciadm61935	tenant.tenants	{"city": {"code": "PG_CIADM61935", "name": "pg.ciadm61935", "districtName": "pg.ciadm61935"}, "code": "pg.ciadm61935", "name": "pg.ciadm61935", "type": "CITY", "tenantId": "pg.ciadm61935"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778661935468	1778661935468
778bacea-7679-49bc-b8e6-a8589774f526	pg.cicounts	DESIG_1007	common-masters.Designation	{"code": "DESIG_1007", "name": "CI_SCOPE_DESIG_61969", "active": true, "department": ["DEPT_41"], "description": "CI_SCOPE_DESIG_61969 - CI_SCOPE_DEPT_61969"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778661969753	1778661969753
bc95dd86-b305-4ebe-9505-4039747a2a30	pg.cicounts	TabBroken	RAINMAKER-PGR.ServiceDefs	{"name": "tab broken", "active": true, "keywords": "", "menuPath": "Water not coming", "slaHours": 1, "department": "DEPT_36", "serviceCode": "TabBroken"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778661970207	1778661970207
3142084a-4a7b-4b89-8dec-86d9c119c36d	pg.cidesig	TabBroken	RAINMAKER-PGR.ServiceDefs	{"name": "tab broken", "active": true, "keywords": "", "menuPath": "Water not coming", "slaHours": 1, "department": "DEPT_36", "serviceCode": "TabBroken"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778661965474	1778661965474
c7d75514-6033-4cbb-952a-0ffa06881920	pg.cidept	TabBroken	RAINMAKER-PGR.ServiceDefs	{"name": "tab broken", "active": true, "keywords": "", "menuPath": "Water not coming", "slaHours": 1, "department": "DEPT_36", "serviceCode": "TabBroken"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778661966395	1778661966395
00fa7cc9-a003-4ef5-8d3a-1e49a12300c0	pg.cicounts	DEPT_41	common-masters.Department	{"code": "DEPT_41", "name": "CI_SCOPE_DEPT_61969", "active": true}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778661969356	1778661969356
ebbddcc8-8628-4642-be12-30086e2259b7	pg	pg.circt62190	tenant.tenants	{"city": {"code": "PG_CIRCT62190", "name": "CI Reactivation Test", "districtName": "CI Reactivation Test"}, "code": "pg.circt62190", "name": "CI Reactivation Test", "type": "CITY", "tenantId": "pg.circt62190"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778662190094	1778662190094
2f393cbe-c57f-40a5-8fe9-4bf7afd7f28f	pg.circt62190	CI_RCT_62190	common-masters.Department	{"code": "CI_RCT_62190", "name": "CI Reactivation Test Dept", "active": true}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778662192263	1778662199399
cf4494a2-89eb-405d-84bc-9b7bc7f3b3ff	pg	pg.ciemp62201	tenant.tenants	{"city": {"code": "PG_CIEMP62201", "name": "CI Emp Test 62201", "districtName": "CI Emp Test 62201"}, "code": "pg.ciemp62201", "name": "CI Emp Test 62201", "type": "CITY", "tenantId": "pg.ciemp62201"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778662201420	1778662201420
f72228d6-3e7d-4585-aa77-0e408366d2b1	pg	pg.ciadm62203	tenant.tenants	{"city": {"code": "PG_CIADM62203", "name": "CI Admin Test 62203", "districtName": "CI Admin Test 62203"}, "code": "pg.ciadm62203", "name": "CI Admin Test 62203", "type": "CITY", "tenantId": "pg.ciadm62203"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778662203591	1778662203591
b7765898-60b4-4bac-9b8b-be09599166e3	pg.cicounts	DEPT_42	common-masters.Department	{"code": "DEPT_42", "name": "CI_SCOPE_DEPT_62321", "active": true}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778662321257	1778662321257
f9e0c4b9-a8e3-472b-956e-f9041d3d84a4	pg.cicounts	DESIG_1008	common-masters.Designation	{"code": "DESIG_1008", "name": "CI_SCOPE_DESIG_62321", "active": true, "department": ["DEPT_42"], "description": "CI_SCOPE_DESIG_62321 - CI_SCOPE_DEPT_62321"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778662321668	1778662321668
55d1f0eb-969c-4561-8668-36209e83360e	pg.circt62542	CI_RCT_62542	common-masters.Department	{"code": "CI_RCT_62542", "name": "CI Reactivation Test Dept", "active": true}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778662544701	1778662551838
6bb66ba2-2d30-45fe-bed6-debc20ddf245	pg	pg.circt62542	tenant.tenants	{"city": {"code": "PG_CIRCT62542", "name": "CI Reactivation Test", "districtName": "CI Reactivation Test"}, "code": "pg.circt62542", "name": "CI Reactivation Test", "type": "CITY", "tenantId": "pg.circt62542"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778662542538	1778662542538
ead4a6e1-0f2e-41f2-a4b6-ea167dd28e75	pg.ciemp62553	DESIG_1002	common-masters.Designation	{"code": "DESIG_1002", "name": "engineer", "active": true, "department": ["DEPT_36"], "description": "engineer - WATER DEPARTMENT"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778662556614	1778662556614
b26ec453-6bdd-45c4-b73f-c5a4e18472db	pg	pg.ciemp62553	tenant.tenants	{"city": {"code": "PG_CIEMP62553", "name": "CI Emp Test 62553", "districtName": "CI Emp Test 62553"}, "code": "pg.ciemp62553", "name": "CI Emp Test 62553", "type": "CITY", "tenantId": "pg.ciemp62553"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778662553859	1778662553859
6ede97f7-f2c3-45d6-8f09-410358532402	pg.ciemp62553	DEPT_36	common-masters.Department	{"code": "DEPT_36", "name": "WATER DEPARTMENT", "active": true}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778662556100	1778662556100
446d6df2-5cbb-42df-997b-033409252821	pg.ciemp62553	DEPT_37	common-masters.Department	{"code": "DEPT_37", "name": "ELECTRIC DEPARTMENT", "active": true}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778662556211	1778662556211
b8fcbe6d-166f-40aa-a2fe-c819cb005f15	pg.ciemp62553	DESIG_1003	common-masters.Designation	{"code": "DESIG_1003", "name": "LME", "active": true, "department": ["DEPT_37"], "description": "LME - ELECTRIC DEPARTMENT"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778662556727	1778662556727
68704ff3-88c8-4382-92d2-f7096cafe017	pg.ciemp62553	TabBroken	RAINMAKER-PGR.ServiceDefs	{"name": "tab broken", "active": true, "keywords": "", "menuPath": "Water not coming", "slaHours": 1, "department": "DEPT_36", "serviceCode": "TabBroken"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778662557146	1778662557146
d8e35d5b-7afb-4bab-8778-edd1503eb5de	pg	pg.ciadm62559	tenant.tenants	{"city": {"code": "PG_CIADM62559", "name": "CI Admin Test 62559", "districtName": "CI Admin Test 62559"}, "code": "pg.ciadm62559", "name": "CI Admin Test 62559", "type": "CITY", "tenantId": "pg.ciadm62559"}	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778662559841	1778662559841
0567bd73-cd4f-4228-a180-ed1b32312ea1	pg	pg.citest	tenant.tenants	{"city": {"code": "PG_CITEST", "name": "CI Test", "districtName": "CI Test"}, "code": "pg.citest", "name": "CI Test", "type": "CITY", "tenantId": "pg.citest"}	t	8155a8e1-86bb-4e5f-9450-f2f7ab2004de	8155a8e1-86bb-4e5f-9450-f2f7ab2004de	1778664445675	1778664445675
f9b4725c-cc90-422b-9511-6a9d8d5444d0	pg.citest	DEPT_36	common-masters.Department	{"code": "DEPT_36", "name": "WATER DEPARTMENT", "active": true}	t	8155a8e1-86bb-4e5f-9450-f2f7ab2004de	8155a8e1-86bb-4e5f-9450-f2f7ab2004de	1778664445960	1778664445960
d60fb222-278f-4082-888f-488f27022116	pg.citest	DEPT_37	common-masters.Department	{"code": "DEPT_37", "name": "ELECTRIC DEPARTMENT", "active": true}	t	8155a8e1-86bb-4e5f-9450-f2f7ab2004de	8155a8e1-86bb-4e5f-9450-f2f7ab2004de	1778664446073	1778664446073
f9913463-e26d-4184-ae20-a32131c44fbd	pg.citest	DESIG_1002	common-masters.Designation	{"code": "DESIG_1002", "name": "engineer", "active": true, "department": ["DEPT_36"], "description": "engineer - WATER DEPARTMENT"}	t	8155a8e1-86bb-4e5f-9450-f2f7ab2004de	8155a8e1-86bb-4e5f-9450-f2f7ab2004de	1778664446474	1778664446474
f5f27b3d-865c-4327-823c-65b2b359265b	pg.citest	DESIG_1003	common-masters.Designation	{"code": "DESIG_1003", "name": "LME", "active": true, "department": ["DEPT_37"], "description": "LME - ELECTRIC DEPARTMENT"}	t	8155a8e1-86bb-4e5f-9450-f2f7ab2004de	8155a8e1-86bb-4e5f-9450-f2f7ab2004de	1778664446586	1778664446586
81dd9ccb-61de-449d-bdf9-61bb19821484	pg.citest	TabBroken	RAINMAKER-PGR.ServiceDefs	{"name": "tab broken", "active": true, "keywords": "", "menuPath": "Water not coming", "slaHours": 1, "department": "DEPT_36", "serviceCode": "TabBroken"}	t	8155a8e1-86bb-4e5f-9450-f2f7ab2004de	8155a8e1-86bb-4e5f-9450-f2f7ab2004de	1778664446999	1778664446999
7030dafd-802c-42be-a222-93f15ee78e8a	pg.citest	DEPT_5	common-masters.Department	{"code": "DEPT_5", "name": "Horticulture", "active": true}	t	8155a8e1-86bb-4e5f-9450-f2f7ab2004de	8155a8e1-86bb-4e5f-9450-f2f7ab2004de	1778664447391	1778664447391
7e623113-912c-471c-90cd-a44b4fa05d61	pg	CFC	ACCESSCONTROL-ROLES.roles	{"code": "CFC", "name": "CFC", "description": "CFC"}	t	8155a8e1-86bb-4e5f-9450-f2f7ab2004de	8155a8e1-86bb-4e5f-9450-f2f7ab2004de	1778664447418	1778664447418
theme-config-data-001	pg	themeconfig	common-masters.ThemeConfig	{"id": "themeconfig", "code": "themeconfig", "name": "themeconfig", "version": "1", "colors": {"grey": {"bg": "#E6E6E6", "mid": "#EEEEEE", "dark": "#787878", "light": "#FAFAFA", "lighter": "#F2F2F2", "disabled": "#C5C5C5"}, "link": {"hover": "#204F37", "normal": "#204F37"}, "text": {"muted": "#787878", "heading": "#204F37", "primary": "#1D2433", "secondary": "#5F5C62"}, "error": "#E02D3A", "border": "#D6D5D4", "digitv2": {"chart-1": "#204F37", "chart-2": "#FEC931", "chart-3": "#2A5084", "chart-4": "#E02D3C", "chart-5": "#128F21", "alert-info": "#2A5084", "primary-bg": "#FFF4D6", "alert-info-bg": "#EAF1F5", "alert-error-bg": "#FEF1F2", "header-sidenav": "#204F37", "alert-success-bg": "#E0F2E1", "text-color-disabled": "#B1B4B6"}, "primary": {"dark": "#204F37", "main": "#FEC931", "light": "#FFF4D6", "accent": "#204F37", "selected-bg": "#FFF4D6"}, "success": "#128F21", "info-dark": "#2A5084", "secondary": "#1D2433", "error-dark": "#8B0000", "input-border": "#E1E6EF", "warning-dark": "#9E5F00"}}	t	system-mdms-seed	system-mdms-seed	1770614666000	1770614666000
14382e2e-9112-4902-95d5-56b1cf6109bc	pg	CMS|All	CMS-BOUNDARY.HierarchySchema	{"hierarchy": "ADMIN", "department": "All", "moduleName": "CMS", "lowestHierarchy": "Locality", "highestHierarchy": "Zone"}	t	system	system	1781073905029	1781073905029
19cef8a4-ac24-45ef-9c4e-19c9ece74d87	pg	HRMS|All	CMS-BOUNDARY.HierarchySchema	{"hierarchy": "ADMIN", "department": "All", "moduleName": "HRMS", "lowestHierarchy": "Locality", "highestHierarchy": "Zone"}	t	system	system	1781073905029	1781073905029
95952ec6-63c6-4b0d-a2c7-43c009d53a43	pg	CRS_BOUNDARY_DATA	CRS-ADMIN-CONSOLE.adminSchema	{"title": "CRS_BOUNDARY_DATA", "properties": {"numberProperties": [{"name": "CRS_LAT", "type": "number", "isRequired": true, "description": "Latitude", "orderNumber": 2}, {"name": "CRS_LONG", "type": "number", "isRequired": true, "description": "Longitude", "orderNumber": 3}], "stringProperties": [{"name": "CRS_BOUNDARY_CODE", "type": "string", "isRequired": true, "description": "Boundary Code", "orderNumber": 1, "freezeColumn": true}]}, "campaignType": "all"}	t	system	system	1781073905029	1781073905029
c674e5c2-7983-459b-bb0f-6929245fea2b	pg.citya	CMS|All	CMS-BOUNDARY.HierarchySchema	{"hierarchy": "ADMIN", "department": "All", "moduleName": "CMS", "lowestHierarchy": "Ward", "highestHierarchy": "Zone"}	t	system	system	1781074295688	1783641600000
a51e8099-4433-4409-b0ac-5b5873d78957	pg.citya	HRMS|All	CMS-BOUNDARY.HierarchySchema	{"hierarchy": "ADMIN", "department": "All", "moduleName": "HRMS", "lowestHierarchy": "Ward", "highestHierarchy": "Zone"}	t	system	system	1781074295688	1783641600000
91e3b381-dfc4-4dfd-9768-3f193e57c088	pg.citya	CRS_BOUNDARY_DATA	CRS-ADMIN-CONSOLE.adminSchema	{"title": "CRS_BOUNDARY_DATA", "properties": {"numberProperties": [{"name": "CRS_LAT", "type": "number", "isRequired": true, "description": "Latitude", "orderNumber": 2}, {"name": "CRS_LONG", "type": "number", "isRequired": true, "description": "Longitude", "orderNumber": 3}], "stringProperties": [{"name": "CRS_BOUNDARY_CODE", "type": "string", "isRequired": true, "description": "Boundary Code", "orderNumber": 1, "freezeColumn": true}]}, "campaignType": "all"}	t	system	system	1781074295688	1781074295688
956a5be3-d952-4291-842a-c94653946ac1	pg.citya	common-masters.Department.DEPT_1	common-masters.Department	{"code": "DEPT_1", "name": "Street Lighting & Electrical", "active": true}	t	system-mdms-seed	system-mdms-seed	1783555200000	1783555200000
2cade399-9d00-4423-8ddf-eda05af5c904	pg.citya	common-masters.Department.DEPT_2	common-masters.Department	{"code": "DEPT_2", "name": "Roads & Public Works", "active": true}	t	system-mdms-seed	system-mdms-seed	1783555200000	1783555200000
07da774b-1bc0-4154-b542-0ad17b645374	pg.citya	common-masters.Department.DEPT_3	common-masters.Department	{"code": "DEPT_3", "name": "Health & Sanitation", "active": true}	t	system-mdms-seed	system-mdms-seed	1783555200000	1783555200000
9c2e1397-8a1e-49ac-83c0-50c784db5133	pg.citya	common-masters.Department.DEPT_4	common-masters.Department	{"code": "DEPT_4", "name": "Water Supply & Sewerage", "active": true}	t	system-mdms-seed	system-mdms-seed	1783555200000	1783555200000
\.


--
-- Data for Name: eg_mdms_schema_definition; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime) FROM stdin;
tenant-schema-001	pg	tenant.tenants	Tenant master	{"type": "object", "title": "Tenant master", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["code", "name"], "x-unique": ["code"], "properties": {"city": {"type": "object", "properties": {"code": {"type": "string"}, "name": {"type": "string"}, "captcha": {"type": ["string", "null"]}, "ddrName": {"type": ["string", "null"]}, "latitude": {"type": "number"}, "ulbGrade": {"type": ["string", "null"]}, "blockCode": {"type": ["string", "null"]}, "localName": {"type": ["string", "null"]}, "longitude": {"type": "number"}, "regionName": {"type": ["string", "null"]}, "districtCode": {"type": ["string", "null"]}, "districtName": {"type": ["string", "null"]}, "shapeFileLocation": {"type": ["string", "null"]}, "districtTenantCode": {"type": ["string", "null"]}}}, "code": {"type": "string"}, "name": {"type": "string"}, "type": {"type": ["string", "null"]}, "logoId": {"type": ["string", "null"]}, "parent": {"type": ["string", "null"]}, "address": {"type": ["string", "null"]}, "emailId": {"type": ["string", "null"]}, "imageId": {"type": ["string", "null"]}, "pincode": {"type": "array", "items": {"type": "number"}}, "tenantId": {"type": "string"}, "domainUrl": {"type": ["string", "null"]}, "twitterUrl": {"type": ["string", "null"]}, "description": {"type": ["string", "null"]}, "facebookUrl": {"type": ["string", "null"]}, "OfficeTimings": {"type": "object", "properties": {"Sat": {"type": "string"}, "Mon - Fri": {"type": "string"}}}, "contactNumber": {"type": ["string", "null"]}, "helpLineNumber": {"type": ["string", "null"]}}}	t	system-mdms-seed	system-mdms-seed	1770614666000	1770614666000
tenant-schema-002	pg	tenant.citymodule	City module configuration	{"type": "object", "title": "City module configuration", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["module", "code", "active", "order", "tenants"], "x-unique": ["code"], "properties": {"code": {"type": "string"}, "order": {"type": "number"}, "active": {"type": "boolean"}, "module": {"type": "string"}, "tenants": {"type": "array", "items": {"type": "object", "required": ["code"], "properties": {"code": {"type": "string"}}}}}, "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1770614666000	1770614666000
64ba13dc-5b8b-47e0-9646-b2ab48fc81d1	pg	DataSecurity.DecryptionABAC	DataSecurity.DecryptionABAC	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["key", "roleAttributeAccessList"], "x-unique": ["key"], "properties": {"key": {"type": "string"}, "roleAttributeAccessList": {"type": "array", "items": {"type": "object", "required": ["roleCode", "attributeAccessList"], "properties": {"roleCode": {"type": "string"}, "attributeAccessList": {"type": "array", "items": {"type": "object", "required": ["attribute", "accessType"], "properties": {"attribute": {"type": "object", "required": ["jsonPath"], "properties": {"jsonPath": {"type": "string"}, "maskingTechnique": {"type": "string"}}}, "accessType": {"type": "string"}}}}}}}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b7779eca-1c6b-47dc-a448-c807055ad9bb	pg	DataSecurity.EncryptionPolicy	DataSecurity.EncryptionPolicy	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["key", "attributeList"], "x-unique": ["key"], "properties": {"key": {"type": "string"}, "attributeList": {"type": "array", "items": {"type": "object", "required": ["jsonPath", "type"], "properties": {"type": {"type": "string"}, "jsonPath": {"type": "string"}}}}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7d22588c-8704-45a0-8b2a-9d7dbe6a9606	pg	DataSecurity.MaskingPatterns	DataSecurity.MaskingPatterns	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["patternId", "pattern"], "x-unique": ["patternId"], "properties": {"pattern": {"type": "string"}, "patternId": {"type": "string"}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
ab2954d8-1bb5-4c01-a895-6ef95130e2d9	pg	DataSecurity.SecurityPolicy	DataSecurity.SecurityPolicy	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["model", "uniqueIdentifier", "attributes", "roleBasedDecryptionPolicy"], "x-unique": ["model"], "properties": {"model": {"type": "string"}, "attributes": {"type": "array", "items": {"type": "object", "required": ["name", "jsonPath", "patternId", "defaultVisibility"], "properties": {"name": {"type": "string"}, "jsonPath": {"type": "string"}, "patternId": {"type": ["string", "null"]}, "defaultVisibility": {"type": "string"}}}}, "uniqueIdentifier": {"type": "object", "required": ["name", "jsonPath"], "properties": {"name": {"type": "string"}, "jsonPath": {"type": "string"}}}, "roleBasedDecryptionPolicy": {"type": "array", "items": {"type": "object", "required": ["roles", "attributeAccessList"], "properties": {"roles": {"type": "array", "items": {"type": "string"}}, "attributeAccessList": {"type": "array", "items": {"type": "object", "required": ["attribute", "firstLevelVisibility", "secondLevelVisibility"], "properties": {"attribute": {"type": "string"}, "firstLevelVisibility": {"type": "string"}, "secondLevelVisibility": {"type": "string"}}}}}}}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
workflow-bsm-schema	pg	Workflow.BusinessServiceMasterConfig	Workflow.BusinessServiceMasterConfig	{"type": "object", "title": "Workflow business service state-level config", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["businessService", "isStatelevel", "active"], "properties": {"active": {"type": "string"}, "isStatelevel": {"type": "string"}, "businessService": {"type": "string"}}}	t	system-mdms-seed	system-mdms-seed	1770614667000	1770614667000
a759d955-8ce8-4191-9a41-7f7352d97642	pg	ACCESSCONTROL-ROLES.roles	ACCESSCONTROL-ROLES.roles	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["code", "name"], "x-unique": ["code"], "properties": {"code": {"type": "string"}, "name": {"type": "string"}, "description": {"type": "string"}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5641188f-b01c-4f3d-9d5d-b68a089d41ee	pg	common-masters.GenderType	  	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["code", "active"], "x-unique": ["code"], "properties": {"code": {"type": "string"}, "active": {"type": "boolean"}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7c7f7775-130f-4b14-a4a0-dd9b99a33715	pg	common-masters.IdFormat	  	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["format", "idname"], "x-unique": ["idname"], "properties": {"format": {"type": "string"}, "idname": {"type": "string"}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6f234e53-9093-4d52-9230-5d9363272d93	pg	ACCESSCONTROL-ACTIONS-TEST.actions-test	ACCESSCONTROL-ACTIONS-TEST.actions-test	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["id", "name", "url", "displayName", "orderNumber", "enabled", "serviceCode", "path"], "x-unique": ["id"], "properties": {"id": {"type": "number"}, "url": {"type": "string"}, "code": {"type": "string", "default": "null"}, "name": {"type": "string"}, "path": {"type": "string"}, "enabled": {"type": "boolean", "default": true}, "leftIcon": {"type": "string"}, "rightIcon": {"type": "string"}, "displayName": {"type": "string"}, "orderNumber": {"type": "number", "default": 0}, "serviceCode": {"type": "string", "default": ""}, "parentModule": {"type": "string"}, "navigationURL": {"type": "string"}}, "x-ref-schema": [], "additionalProperties": true}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
7d0afec9-2b73-493c-b31e-d69da0547ed9	pg	ACCESSCONTROL-ROLEACTIONS.roleactions	ACCESSCONTROL-ROLEACTIONS.roleactions	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["rolecode", "actionid", "tenantId"], "x-unique": ["rolecode", "actionid"], "properties": {"actionid": {"type": "number"}, "rolecode": {"type": "string"}, "tenantId": {"type": "string"}, "actioncode": {"type": "string"}}, "x-ref-schema": [{"fieldPath": "rolecode", "schemaCode": "ACCESSCONTROL-ROLES.roles"}, {"fieldPath": "actionid", "schemaCode": "ACCESSCONTROL-ACTIONS-TEST.actions-test"}]}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
e8f92cf4-a4f8-4b07-8934-df99df7aabc3	pg	common-masters.CronJobAPIConfig	  	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["jobName", "active", "method", "url", "payload", "header"], "x-unique": ["jobName", "url"], "properties": {"url": {"type": "string"}, "active": {"type": "string"}, "header": {"type": "object", "required": ["Content-Type"], "properties": {"Content-Type": {"type": "string"}}}, "method": {"type": "string"}, "jobName": {"type": "string"}, "payload": {"type": "object", "required": ["RequestInfo"], "properties": {"RequestInfo": {"type": "string"}}}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
b3706d92-2050-40cc-b485-e1a4a426da96	pg	common-masters.Department	  	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["name", "code", "active"], "x-unique": ["code"], "properties": {"code": {"type": "string"}, "name": {"type": "string"}, "active": {"type": "boolean", "default": true}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
4bba95a4-54ef-42f8-858e-d678eae8a2a3	pg	common-masters.Designation	  	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["code", "name", "description", "active"], "x-unique": ["code"], "properties": {"code": {"type": "string"}, "name": {"type": "string"}, "active": {"type": "boolean"}, "department": {"type": "array", "items": {"type": "string"}}, "description": {"type": "string"}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
0233d7a8-f57b-45f1-a0db-b2f97ae4b5f2	pg	common-masters.wfSlaConfig	  	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["slotPercentage", "positiveSlabColor", "negativeSlabColor", "middleSlabColor"], "x-unique": ["slotPercentage"], "properties": {"slotPercentage": {"type": "number"}, "middleSlabColor": {"type": "string"}, "negativeSlabColor": {"type": "string"}, "positiveSlabColor": {"type": "string"}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
5ecdde1c-62ed-40e6-9944-5efc4298e00a	pg	common-masters.StateInfo	  	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["name", "code"], "x-unique": ["name", "code"], "properties": {"code": {"type": "string"}, "name": {"type": "string"}, "logoUrl": {"type": "string"}, "bannerUrl": {"type": "string"}, "languages": {"type": "array", "items": {"type": "object"}}, "qrCodeURL": {"type": "string"}, "statelogo": {"type": "string"}, "defaultUrl": {"type": "object"}, "logoUrlWhite": {"type": "string"}, "enableWhatsApp": {"type": "boolean"}, "hasLocalisation": {"type": "boolean"}, "localizationModules": {"type": "array", "items": {"type": "object"}}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
236e18b9-1104-4e5d-b9d1-c1a935724cca	pg	common-masters.uiHomePage	  	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["redirectURL"], "x-unique": ["redirectURL"], "properties": {"redirectURL": {"type": "string"}, "appBannerMobile": {"type": "object", "required": ["code", "name", "bannerUrl", "enabled"], "properties": {"code": {"type": "string"}, "name": {"type": "string"}, "enabled": {"type": "boolean"}, "bannerUrl": {"type": "string"}}}, "whatsNewSection": {"type": "object", "required": ["code", "name", "enabled", "headerLabel", "sideOption"], "properties": {"code": {"type": "string"}, "name": {"type": "string"}, "enabled": {"type": "boolean"}, "sideOption": {"type": "object", "required": ["name", "enabled", "navigationUrl"], "properties": {"name": {"type": "string"}, "enabled": {"type": "boolean"}, "navigationUrl": {"type": "string"}}}, "headerLabel": {"type": "string"}}}, "appBannerDesktop": {"type": "object", "required": ["code", "name", "bannerUrl", "enabled"], "properties": {"code": {"type": "string"}, "name": {"type": "string"}, "enabled": {"type": "boolean"}, "bannerUrl": {"type": "string"}}}, "citizenServicesCard": {"type": "object", "required": ["code", "name", "enabled", "headerLabel", "sideOption", "props"], "properties": {"code": {"type": "string"}, "name": {"type": "string"}, "props": {"type": "array", "items": {"type": "object", "required": ["code", "name", "label", "enabled", "navigationUrl"], "properties": {"code": {"type": "string"}, "name": {"type": "string"}, "label": {"type": "string"}, "enabled": {"type": "boolean"}, "navigationUrl": {"type": "string"}}}}, "enabled": {"type": "boolean"}, "sideOption": {"type": "object", "required": ["name", "enabled", "navigationUrl"], "properties": {"name": {"type": "string"}, "enabled": {"type": "boolean"}, "navigationUrl": {"type": "string"}}}, "headerLabel": {"type": "string"}}}, "whatsAppBannerMobile": {"type": "object", "required": ["code", "name", "bannerUrl", "enabled", "navigationUrl"], "properties": {"code": {"type": "string"}, "name": {"type": "string"}, "enabled": {"type": "boolean"}, "bannerUrl": {"type": "string"}, "navigationUrl": {"type": "string"}}}, "whatsAppBannerDesktop": {"type": "object", "required": ["code", "name", "bannerUrl", "enabled", "navigationUrl"], "properties": {"code": {"type": "string"}, "name": {"type": "string"}, "enabled": {"type": "boolean"}, "bannerUrl": {"type": "string"}, "navigationUrl": {"type": "string"}}}, "informationAndUpdatesCard": {"type": "object", "required": ["code", "name", "enabled", "headerLabel", "sideOption", "props"], "properties": {"code": {"type": "string"}, "name": {"type": "string"}, "props": {"type": "array", "items": {"type": "object", "required": ["code", "name", "label", "enabled", "navigationUrl"], "properties": {"code": {"type": "string"}, "name": {"type": "string"}, "label": {"type": "string"}, "enabled": {"type": "boolean"}, "navigationUrl": {"type": "string"}}}}, "enabled": {"type": "boolean"}, "sideOption": {"type": "object", "required": ["name", "enabled", "navigationUrl"], "properties": {"name": {"type": "string"}, "enabled": {"type": "boolean"}, "navigationUrl": {"type": "string"}}}, "headerLabel": {"type": "string"}}}}}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d42fb05a-7250-4780-a87b-3455e01d061a	pg	egov-hrms.DeactivationReason	egov-hrms.DeactivationReason	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["code", "active"], "x-unique": ["code"], "properties": {"code": {"type": "string"}, "active": {"type": "boolean"}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
81d8e3d0-6edd-4dd0-b737-5e12e5e396ab	pg	egov-hrms.Degree	egov-hrms.Degree	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["code", "active"], "x-unique": ["code"], "properties": {"code": {"type": "string"}, "active": {"type": "boolean"}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
503b7082-b0b1-459a-9cf8-07e651ff54f9	pg	egov-hrms.EmployeeStatus	egov-hrms.EmployeeStatus	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["code", "active"], "x-unique": ["code"], "properties": {"code": {"type": "string"}, "active": {"type": "boolean"}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6b2371b7-f120-4677-9a9c-65e420202d84	pg	egov-hrms.EmployeeType	egov-hrms.EmployeeType	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["code", "active"], "x-unique": ["code"], "properties": {"code": {"type": "string"}, "active": {"type": "boolean"}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
fc912db2-1ce7-4479-8fb6-6b4429b86ed1	pg	egov-hrms.EmploymentTest	egov-hrms.EmploymentTest	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["code", "active"], "x-unique": ["code"], "properties": {"code": {"type": "string"}, "active": {"type": "boolean"}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
53a5242c-6116-4eae-add9-59226b16950f	pg	egov-hrms.Specalization	egov-hrms.Specalization	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["code", "active"], "x-unique": ["code"], "properties": {"code": {"type": "string"}, "active": {"type": "boolean"}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
1523552a-512b-4e18-8a9f-d10c95642711	pg	INBOX.InboxQueryConfiguration	  	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["module", "index"], "x-unique": ["module", "index"], "properties": {"index": {"type": "string"}, "module": {"type": "string"}, "sortBy": {"type": "object", "required": ["path", "defaultOrder"], "properties": {"path": {"type": "string"}, "defaultOrder": {"type": "string"}}}, "sourceFilterPathList": {"type": "array", "items": {"type": "string"}}, "allowedSearchCriteria": {"type": "array", "items": {"type": "object", "required": ["name", "path", "isMandatory", "operator"], "properties": {"name": {"type": "string"}, "path": {"type": "string"}, "operator": {"type": "string"}, "isMandatory": {"type": "boolean"}, "isHashingRequired": {"type": "boolean"}}}}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
22c1101e-c277-44f1-8c2d-4164641b6635	pg	RAINMAKER-PGR.ServiceDefs	RAINMAKER-PGR.ServiceDefs	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["serviceCode", "name", "keywords", "department", "slaHours", "active"], "x-unique": ["serviceCode"], "properties": {"name": {"type": "string"}, "order": {"type": "number"}, "active": {"type": "boolean"}, "keywords": {"type": "string"}, "menuPath": {"type": "string"}, "slaHours": {"type": "number"}, "department": {"type": "string"}, "serviceCode": {"type": "string"}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
c5f06aac-cb7f-4964-9f10-d0a934f66456	pg	RAINMAKER-PGR.UIConstants	RAINMAKER-PGR.UIConstants	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["REOPENSLA"], "x-unique": ["REOPENSLA"], "properties": {"REOPENSLA": {"type": "number"}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
d0163c8f-f303-4f7e-8c2b-b08b7090e968	pg	Workflow.AutoEscalation	Workflow.AutoEscalation	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["businessService", "module", "state", "action", "active", "stateSLA", "businessSLA", "topic"], "x-unique": ["state", "businessService"], "properties": {"state": {"type": "string"}, "topic": {"type": "string"}, "action": {"type": "string"}, "active": {"type": "string"}, "module": {"type": "string"}, "stateSLA": {"type": "number"}, "businessSLA": {"type": "number"}, "businessService": {"type": "string"}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
6e342785-460d-47ef-bd40-a2a1cfd21a80	pg	Workflow.AutoEscalationStatesToIgnore	Workflow.AutoEscalationStatesToIgnore	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["businessService", "module", "state"], "x-unique": ["businessService"], "properties": {"state": {"type": "array", "items": {"type": "string"}}, "module": {"type": "string"}, "businessService": {"type": "string"}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
316d40b8-adcd-4169-9ba4-b38e4e88c5c9	pg	Workflow.BusinessService	Workflow.BusinessService	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["tenantId", "uuid", "businessService", "getUri", "postUri", "states"], "x-unique": ["businessService"], "properties": {"uuid": {"type": "string"}, "getUri": {"type": "string"}, "states": {"type": "array", "items": {"type": "object", "required": ["businessServiceId", "state", "applicableNextStates", "applicableActions", "docUploadRequired", "UpdateAllowed", "isTerminateState", "isStartState", "uuid", "tenantId", "actions"], "properties": {"uuid": {"type": "string"}, "state": {"type": "string"}, "actions": {"type": "array", "items": {"type": "object", "required": ["stateId", "action", "nextStateId", "roles", "tenantId", "uuid"], "properties": {"uuid": {"type": "string"}, "roles": {"type": "string"}, "action": {"type": "string"}, "stateId": {"type": "string"}, "tenantId": {"type": "string"}, "nextStateId": {"type": "string"}}}}, "tenantId": {"type": "string"}, "isStartState": {"type": "string"}, "UpdateAllowed": {"type": "string"}, "isTerminateState": {"type": "string"}, "applicableActions": {"type": "string"}, "businessServiceId": {"type": "string"}, "docUploadRequired": {"type": "string"}, "applicableNextStates": {"type": "string"}}}}, "postUri": {"type": "string"}, "tenantId": {"type": "string"}, "businessService": {"type": "string"}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
a04cc6d7-c3cb-446a-a375-692acec18ed8	pg	Workflow.BusinessServiceConfig	Workflow.BusinessServiceConfig	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["code", "isStateLevel"], "x-unique": ["code"], "properties": {"code": {"type": "string"}, "isStateLevel": {"type": "boolean"}}, "x-ref-schema": [], "additionalProperties": false}	t	system-mdms-seed	system-mdms-seed	1766039437780	1766039437780
theme-config-schema-001	pg	common-masters.ThemeConfig	UI theme colour tokens	{"type": "object", "$schema": "http://json-schema.org/draft-07/schema#", "x-unique": ["code"], "required": ["code", "name", "version", "colors"], "properties": {"code": {"type": "string"}, "name": {"type": "string"}, "version": {"type": "string"}, "colors": {"type": "object"}}, "additionalProperties": true}	t	system-mdms-seed	system-mdms-seed	1770614666000	1770614666000
69453dca-fbd2-4eb9-a832-4de259739b4b	pg	CMS-BOUNDARY.HierarchySchema	Configuration to show boundary hierarchy levels in CMS UI	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["moduleName", "department", "hierarchy", "highestHierarchy", "lowestHierarchy"], "x-unique": ["moduleName", "department"], "properties": {"hierarchy": {"type": "string"}, "department": {"type": "string"}, "moduleName": {"type": "string"}, "lowestHierarchy": {"type": "string"}, "highestHierarchy": {"type": "string"}}, "x-ref-schema": [], "additionalProperties": false}	t	system	system	1781073674409	1781073674409
ad6bdc36-6445-4608-9a06-1786eb300e91	pg	CRS-ADMIN-CONSOLE.adminSchema	CRS Admin Console Schema for boundary management	{"type": "object", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["title", "campaignType"], "x-unique": ["title"], "properties": {"title": {"type": "string", "maxLength": 200, "minLength": 1}, "properties": {"type": "object", "properties": {"numberProperties": {"type": "array"}, "stringProperties": {"type": "array"}}, "additionalProperties": false}, "campaignType": {"type": "string", "maxLength": 100, "minLength": 1}}, "x-ref-schema": [], "additionalProperties": false}	t	system	system	1781073674409	1781073674409
16496067-588a-4d1c-871b-2955cea9e8d8	pg.citya	CMS-BOUNDARY.HierarchySchema	Configuration to show boundary hierarchy levels in CMS UI	{"type": "object", "title": "Generated schema for Root", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["moduleName", "department", "hierarchy", "highestHierarchy", "lowestHierarchy"], "x-unique": ["moduleName", "department"], "properties": {"hierarchy": {"type": "string"}, "department": {"type": "string"}, "moduleName": {"type": "string"}, "lowestHierarchy": {"type": "string"}, "highestHierarchy": {"type": "string"}}, "x-ref-schema": [], "additionalProperties": false}	t	system	system	1781074295688	1781074295688
f9ac4504-91dc-4e53-b8bf-dc25e4460687	pg.citya	CRS-ADMIN-CONSOLE.adminSchema	CRS Admin Console Schema for boundary management	{"type": "object", "$schema": "http://json-schema.org/draft-07/schema#", "required": ["title", "campaignType"], "x-unique": ["title"], "properties": {"title": {"type": "string", "maxLength": 200, "minLength": 1}, "properties": {"type": "object", "properties": {"numberProperties": {"type": "array"}, "stringProperties": {"type": "array"}}, "additionalProperties": false}, "campaignType": {"type": "string", "maxLength": 100, "minLength": 1}}, "x-ref-schema": [], "additionalProperties": false}	t	system	system	1781074295688	1781074295688
\.


--
-- Data for Name: eg_ms_role; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_ms_role (name, code, description, createddate, createdby, lastmodifiedby, lastmodifieddate, version) FROM stdin;
\.


--
-- Data for Name: eg_pgr_address_v2; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_pgr_address_v2 (tenantid, id, parentid, doorno, plotno, buildingname, street, landmark, city, pincode, locality, district, region, state, country, latitude, longitude, createdby, createdtime, lastmodifiedby, lastmodifiedtime, additionaldetails) FROM stdin;
pg.citest	d9a5d6a5-b455-492e-a5f4-b8251df2df15	9a36f8f0-747c-4d56-a0a1-5852a1395e9f	\N	\N	\N	\N	Test Landmark	City A		JLC477	City A	City A	\N	\N	\N	\N	79006ea0-100c-4332-8390-60edff9328c1	1778664552313	79006ea0-100c-4332-8390-60edff9328c1	1778664552834	null
pg.citest	ffc16bde-152f-4c00-8499-caf83f51b8a6	6a63f17f-7c15-4432-98ca-ea625840d56e	\N	\N	\N	\N	Test Landmark	City A		JLC477	City A	City A	\N	\N	\N	\N	79006ea0-100c-4332-8390-60edff9328c1	1778664524734	79006ea0-100c-4332-8390-60edff9328c1	1778664526028	null
\.


--
-- Data for Name: eg_pgr_service_v2; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_pgr_service_v2 (id, tenantid, servicecode, servicerequestid, description, accountid, additionaldetails, applicationstatus, rating, source, createdby, createdtime, lastmodifiedby, lastmodifiedtime, active) FROM stdin;
6a63f17f-7c15-4432-98ca-ea625840d56e	pg.citest	IllegalCuttingOfTrees	PG-PGR-2026-05-13-000185	Illegal Cutting of trees	f1a94c66-a4b5-46da-9492-07b7db54c69f	{"department": "DEPT_5"}	CLOSEDAFTERRESOLUTION	\N	web	79006ea0-100c-4332-8390-60edff9328c1	1778664524734	79006ea0-100c-4332-8390-60edff9328c1	1778664526028	t
9a36f8f0-747c-4d56-a0a1-5852a1395e9f	pg.citest	IllegalCuttingOfTrees	PG-PGR-2026-05-13-000186	Illegal Cutting of trees	f1a94c66-a4b5-46da-9492-07b7db54c69f	{"department": "DEPT_5"}	CLOSEDAFTERRESOLUTION	\N	web	79006ea0-100c-4332-8390-60edff9328c1	1778664552313	79006ea0-100c-4332-8390-60edff9328c1	1778664552834	t
\.


--
-- Data for Name: eg_role; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_role (name, code, description, createddate, createdby, lastmodifiedby, lastmodifieddate, version, tenantid, id) FROM stdin;
\.


--
-- Data for Name: eg_roleaction; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_roleaction (rolecode, actionid, tenantid) FROM stdin;
\.


--
-- Data for Name: eg_url_shortener; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_url_shortener (id, validform, validto, url) FROM stdin;
\.


--
-- Data for Name: eg_user; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_user (title, salutation, dob, locale, username, password, pwdexpirydate, mobilenumber, altcontactnumber, emailid, createddate, lastmodifieddate, createdby, lastmodifiedby, active, name, gender, pan, aadhaarnumber, type, version, guardian, guardianrelation, signature, accountlocked, bloodgroup, photo, identificationmark, tenantid, id, uuid, accountlockeddate, alternatemobilenumber) FROM stdin;
\N	\N	\N	\N	489366|G0/w3vPTuvMVAWkFYIgjXgs97GHSfarXKMKbCd4=	$2a$10$lVGJ27y7QRJ0f46z4d6uDeTml6nt9cMaoc7XpUZ.ZhrEranpNPQ8W	2026-05-10 05:25:11.553	489366|azidopikwoZzbcm1yBn29NfRpKFP6YulQdY=	\N	\N	2026-02-09 05:25:11.563	2026-02-09 05:25:11.563	\N	\N	t	489366|G2/Q/tPzmtNqGVMjQL+zclwglO6ImyjeulzdbteyJ/LZvBbUx2SFWEKY	2	\N	\N	SYSTEM	0	\N		\N	f		\N	\N	pg	3	f80147a7-9711-4a56-9bd3-da4733a59df4	\N	\N
\N	\N	\N	\N	489366|EUiJ1e7ftfszFz8XkJgHH5VEsgnjYtMf	$2a$10$vlULNoGcqrkZUwlVA3ctaePPXNUkc3fXbcRH1iAznPaPpxcsCqdcu	2026-08-11 06:54:34.388	489366|azidopity49zbXdWQCH/xz9r2fYjwnn2gJE=	\N	489366|MWiJ9c7/ldsKMFMnW6TueFwx+NGWFZtBc/em4fGtGo10xQ==	2026-05-13 06:54:34.396	2026-05-13 06:54:34.396	1	1	t	489366|HG6E2c7oldsrJkNgZ6OlZd95K0bZYSQTmI6Oyzwfqpw=	2	\N	\N	EMPLOYEE	0	\N		\N	f		\N	\N	pg.cibndauth	18	394d099c-1eb4-4543-ba08-5717c1bd2764	\N	\N
\N	\N	\N	\N	489366|azidopGtwoZzbe5t1+8lCqiXt891ZJ2s2P4=	$2a$10$bpX.KI6M/WMsvI.1GdX3HeuRKI9F6Pc3gsfGyMtmuvJlnILvNkjfS	2026-08-11 09:00:05.401	489366|azidopGtwoZzbe5t1+8lCqiXt891ZJ2s2P4=	\N	\N	2026-05-13 09:00:05.411	2026-05-13 09:00:05.411	1	1	t	489366|FmTK9cju7EANPhIaVBscUvwIL/2nOQ==	0	\N	\N	CITIZEN	0	\N		\N	f		\N	\N	pg	20	f1a94c66-a4b5-46da-9492-07b7db54c69f	\N	\N
\N	\N	\N	\N	489366|E0Xp0u9xguIYIEtxo8vkVboLM/Ku	$2a$10$opgEKfQzL.6wLhDP2B8lRecOXULN4/jbP98BZoqzE1CHncrNTCh8W	2026-08-11 09:13:47.739	489366|azidopikwoZzbcm1yBn29NfRpKFP6YulQdY=	\N	489366|M2XJ8s/dn9YtPU5uXaKnPPlR7p7fWgomRH6FKcUg4g==	2026-05-13 09:13:47.751	2026-05-13 09:13:47.751	\N	\N	t	489366|AXjX78Tw2/4uOVMuW6O0ZU8ikv+3vqdnrPqDLNOqg3BOKBcr	2	\N	\N	EMPLOYEE	0	\N		\N	f		\N	\N	pg	29	8155a8e1-86bb-4e5f-9450-f2f7ab2004de	\N	\N
\N	\N	\N	\N	489366|FVPrc8+W0tEEmddkOwLAZ8SpFw==	$2a$10$chtt2RDmJMpYdUM/e/s4pO9bDWiRnhFb2yVKm0hXTGtia76.iFL62	2026-08-11 09:13:47.87	489366|azmco5mlw4dybCPvBaRbi88jU/qEZG8nzpQ=	\N	489366|NXPL28X0nNY+elUyVWeN//gkQZ3g6/hN99nZqhA=	2026-05-13 09:13:47.879	2026-05-13 09:13:47.879	\N	\N	t	489366|FXPN/tf8ldwvdHUmVLmjclxXMWHIYelOp2vLJmx3Op4M	2	\N	\N	EMPLOYEE	0	\N		\N	f		\N	\N	pg	30	198368f3-d3ac-4e71-969d-6cb63417b312	\N	\N
\N	\N	\N	\N	489366|E0Xp0u9xguIYIEtxo8vkVboLM/Ku	$2a$10$4erG5jF0AYVzhraRcIFD8.ue8yQkzztjpXosWYmxthdPRbURfoPLG	2026-08-11 09:13:47.986	489366|azidopikwoZzbcm1yBn29NfRpKFP6YulQdY=	\N	489366|M2XJ8s/dn9YtPU5uXaKnPPlR7p7fWgomRH6FKcUg4g==	2026-05-13 09:13:47.995	2026-05-13 09:13:47.995	\N	\N	t	489366|AXjX78Tw2/4uOVMuW6O0ZU8ikv+3vqdnrPqDLNOqg3BOKBcr	2	\N	\N	EMPLOYEE	0	\N		\N	f		\N	\N	pg.citya	31	b2632798-952e-42cd-b896-0152c2847479	\N	\N
\N	\N	2000-01-01 00:00:00	\N	489366|EUiJ2uXQsvHEbcRjDh/UcPOGAzQmkeoS	$2a$10$NQAxOXiDx8KjjopRWWYhkOlz1NL.UcN8Z0rtqxsATpWtjwcIKF.hW	2026-08-11 09:27:27	489366|azidopity496ZQFBGUPKUnXL0+x/jdwIkKM=	\N	\N	2026-05-13 09:27:27.572	2026-05-13 09:27:28.041	29	29	t	489366|EUiE2sXwktGCnQMzpcVqpMu1YuSA0hyD	0	\N	\N	EMPLOYEE	0	\N		\N	f		\N	\N	pg.citest	35	79006ea0-100c-4332-8390-60edff9328c1	0	\N
\N	\N	\N	\N	489366|FVPrc8+W0tEEmddkOwLAZ8SpFw==	$2a$10$Xcm1/lgF.QkGzTRU0ojEd.R8fqgyrM65/4Cb3m4MTHuwOqBieQoFO	2026-08-11 09:13:48.129	489366|azmco5mlw4dybCPvBaRbi88jU/qEZG8nzpQ=	\N	489366|NXPL28X0nNY+elUyVWeN//gkQZ3g6/hN99nZqhA=	2026-05-13 09:13:48.138	2026-05-13 09:13:48.138	\N	\N	t	489366|FXPN/tf8ldwvdHUmVLmjclxXMWHIYelOp2vLJmx3Op4M	2	\N	\N	EMPLOYEE	0	\N		\N	f		\N	\N	pg.citya	32	4990dce4-66a4-4752-85a3-7999e81245e5	\N	\N
\N	\N	\N	\N	489366|E0Xp0u9xguIYIEtxo8vkVboLM/Ku	$2a$10$v0Zr0y8aZAnKyhV0lEkpdu4gpK1Ahv8F2ekdJ.wGBtE5N5DTvLbwq	2026-08-11 09:13:48.248	489366|azidopikwoZzbcm1yBn29NfRpKFP6YulQdY=	\N	489366|M2XJ8s/dn9YtPU5uXaKnPPlR7p7fWgomRH6FKcUg4g==	2026-05-13 09:13:48.258	2026-05-13 09:13:48.258	\N	\N	t	489366|AXjX78Tw2/4uOVMuW6O0ZU8ikv+3vqdnrPqDLNOqg3BOKBcr	2	\N	\N	EMPLOYEE	0	\N		\N	f		\N	\N	pg.cityb	33	717d427c-e470-4ffd-86ab-683d6c97e0e2	\N	\N
\N	\N	\N	\N	489366|FVPrc8+W0tEEmddkOwLAZ8SpFw==	$2a$10$gberk1ZRaqm7gb6/mGZcqOyHZ78h.PY2X52MSsSxhbvNCd2Mya3xq	2026-08-11 09:13:48.376	489366|azmco5mlw4dybCPvBaRbi88jU/qEZG8nzpQ=	\N	489366|NXPL28X0nNY+elUyVWeN//gkQZ3g6/hN99nZqhA=	2026-05-13 09:13:48.384	2026-05-13 09:13:48.384	\N	\N	t	489366|FXPN/tf8ldwvdHUmVLmjclxXMWHIYelOp2vLJmx3Op4M	2	\N	\N	EMPLOYEE	0	\N		\N	f		\N	\N	pg.cityb	34	2fca228c-6cc1-4f85-a82f-96d77d4cb61c	\N	\N
\.


--
-- Data for Name: eg_user_address; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_user_address (id, version, createddate, lastmodifieddate, createdby, lastmodifiedby, type, address, city, pincode, userid, tenantid) FROM stdin;
5	0	2026-02-09 05:25:11.574	2026-02-09 05:25:11.574	3	\N	CORRESPONDENCE	\N	\N	\N	3	pg
6	0	2026-02-09 05:25:11.577	2026-02-09 05:25:11.577	3	\N	PERMANENT	\N	\N	\N	3	pg
35	0	2026-05-13 06:54:34.404	2026-05-13 06:54:34.404	18	\N	CORRESPONDENCE	\N	\N	\N	18	pg.cibndauth
36	0	2026-05-13 06:54:34.407	2026-05-13 06:54:34.407	18	\N	PERMANENT	\N	\N	\N	18	pg.cibndauth
39	0	2026-05-13 09:00:05.417	2026-05-13 09:00:05.417	20	\N	CORRESPONDENCE	\N	\N	\N	20	pg
40	0	2026-05-13 09:00:05.42	2026-05-13 09:00:05.42	20	\N	PERMANENT	\N	\N	\N	20	pg
57	0	2026-05-13 09:13:47.76	2026-05-13 09:13:47.76	29	\N	CORRESPONDENCE	\N	\N	\N	29	pg
58	0	2026-05-13 09:13:47.764	2026-05-13 09:13:47.764	29	\N	PERMANENT	\N	\N	\N	29	pg
59	0	2026-05-13 09:13:47.885	2026-05-13 09:13:47.885	30	\N	CORRESPONDENCE	\N	\N	\N	30	pg
60	0	2026-05-13 09:13:47.887	2026-05-13 09:13:47.887	30	\N	PERMANENT	\N	\N	\N	30	pg
61	0	2026-05-13 09:13:48.004	2026-05-13 09:13:48.004	31	\N	CORRESPONDENCE	\N	\N	\N	31	pg.citya
62	0	2026-05-13 09:13:48.007	2026-05-13 09:13:48.007	31	\N	PERMANENT	\N	\N	\N	31	pg.citya
63	0	2026-05-13 09:13:48.144	2026-05-13 09:13:48.144	32	\N	CORRESPONDENCE	\N	\N	\N	32	pg.citya
64	0	2026-05-13 09:13:48.146	2026-05-13 09:13:48.146	32	\N	PERMANENT	\N	\N	\N	32	pg.citya
65	0	2026-05-13 09:13:48.267	2026-05-13 09:13:48.267	33	\N	CORRESPONDENCE	\N	\N	\N	33	pg.cityb
66	0	2026-05-13 09:13:48.27	2026-05-13 09:13:48.27	33	\N	PERMANENT	\N	\N	\N	33	pg.cityb
67	0	2026-05-13 09:13:48.391	2026-05-13 09:13:48.391	34	\N	CORRESPONDENCE	\N	\N	\N	34	pg.cityb
68	0	2026-05-13 09:13:48.393	2026-05-13 09:13:48.393	34	\N	PERMANENT	\N	\N	\N	34	pg.cityb
\.


--
-- Data for Name: eg_user_audit_table; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_user_audit_table (id, title, salutation, dob, locale, username, password, pwdexpirydate, mobilenumber, altcontactnumber, emailid, active, name, gender, pan, aadhaarnumber, type, version, guardian, guardianrelation, signature, accountlocked, bloodgroup, photo, identificationmark, tenantid, uuid, auditcreatedby, auditcreatedtime) FROM stdin;
35	\N	\N	2000-01-01 00:00:00	\N	489366|EUiJ2uXQsvHEbcRjDh/UcPOGAzQmkeoS	$2a$10$fp7f7HBQrPe/E5Ku.67wa.7gehydCqRwr2qNbhBOlZ663RakWLeXu	2026-08-11 09:27:27.564	489366|azidopity496ZQFBGUPKUnXL0+x/jdwIkKM=	\N	\N	t	489366|EUiE2sXwktGCnQMzpcVqpMu1YuSA0hyD	0	\N	\N	EMPLOYEE	0	\N		\N	f			\N	pg.citest	79006ea0-100c-4332-8390-60edff9328c1	8155a8e1-86bb-4e5f-9450-f2f7ab2004de	1778664448041
\.


--
-- Data for Name: eg_user_login_failed_attempts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_user_login_failed_attempts (user_uuid, ip, attempt_date, active) FROM stdin;
2c28d95f-136f-46b6-892f-49e5245ebc59	172.21.0.32	1778655658015	f
2c28d95f-136f-46b6-892f-49e5245ebc59	172.21.0.32	1778659398315	f
2c28d95f-136f-46b6-892f-49e5245ebc59	172.21.0.32	1778662081169	f
2c28d95f-136f-46b6-892f-49e5245ebc59	172.21.0.32	1778662349017	f
2c28d95f-136f-46b6-892f-49e5245ebc59	172.21.0.32	1778662705727	f
\.


--
-- Data for Name: eg_userrole; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_userrole (roleid, roleidtenantid, userid, tenantid, lastmodifieddate) FROM stdin;
\.


--
-- Data for Name: eg_userrole_v1; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_userrole_v1 (role_code, role_tenantid, user_id, user_tenantid, lastmodifieddate) FROM stdin;
INTERNAL_MICROSERVICE_ROLE	pg	3	pg	2026-02-09 05:25:11.571
EMPLOYEE	pg	18	pg.cibndauth	2026-05-13 06:54:34.402
CITIZEN	pg	20	pg	2026-05-13 09:00:05.415
PGR_VIEWER	pg	29	pg	2026-05-13 09:13:47.758
AUTO_ESCALATE	pg	29	pg	2026-05-13 09:13:47.758
EMPLOYEE	pg	29	pg	2026-05-13 09:13:47.758
GRO	pg	29	pg	2026-05-13 09:13:47.758
SUPERVISOR	pg	29	pg	2026-05-13 09:13:47.758
PGR_LME	pg	29	pg	2026-05-13 09:13:47.758
CSR	pg	29	pg	2026-05-13 09:13:47.758
SUPERUSER	pg	29	pg	2026-05-13 09:13:47.758
CITIZEN	pg	29	pg	2026-05-13 09:13:47.758
DGRO	pg	29	pg	2026-05-13 09:13:47.758
EMPLOYEE	pg	30	pg	2026-05-13 09:13:47.883
GRO	pg	30	pg	2026-05-13 09:13:47.883
DGRO	pg	30	pg	2026-05-13 09:13:47.883
EMPLOYEE	pg.citya	31	pg.citya	2026-05-13 09:13:48.001
DGRO	pg.citya	31	pg.citya	2026-05-13 09:13:48.001
PGR_VIEWER	pg.citya	31	pg.citya	2026-05-13 09:13:48.001
AUTO_ESCALATE	pg.citya	31	pg.citya	2026-05-13 09:13:48.001
SUPERVISOR	pg.citya	31	pg.citya	2026-05-13 09:13:48.001
PGR_LME	pg.citya	31	pg.citya	2026-05-13 09:13:48.001
CSR	pg.citya	31	pg.citya	2026-05-13 09:13:48.001
GRO	pg.citya	31	pg.citya	2026-05-13 09:13:48.001
SUPERUSER	pg.citya	31	pg.citya	2026-05-13 09:13:48.001
CITIZEN	pg.citya	31	pg.citya	2026-05-13 09:13:48.001
EMPLOYEE	pg.citya	32	pg.citya	2026-05-13 09:13:48.142
DGRO	pg.citya	32	pg.citya	2026-05-13 09:13:48.142
GRO	pg.citya	32	pg.citya	2026-05-13 09:13:48.142
PGR_VIEWER	pg.cityb	33	pg.cityb	2026-05-13 09:13:48.264
EMPLOYEE	pg.cityb	33	pg.cityb	2026-05-13 09:13:48.264
DGRO	pg.cityb	33	pg.cityb	2026-05-13 09:13:48.264
AUTO_ESCALATE	pg.cityb	33	pg.cityb	2026-05-13 09:13:48.264
SUPERVISOR	pg.cityb	33	pg.cityb	2026-05-13 09:13:48.264
CSR	pg.cityb	33	pg.cityb	2026-05-13 09:13:48.264
PGR_LME	pg.cityb	33	pg.cityb	2026-05-13 09:13:48.264
GRO	pg.cityb	33	pg.cityb	2026-05-13 09:13:48.264
SUPERUSER	pg.cityb	33	pg.cityb	2026-05-13 09:13:48.264
CITIZEN	pg.cityb	33	pg.cityb	2026-05-13 09:13:48.264
EMPLOYEE	pg.cityb	34	pg.cityb	2026-05-13 09:13:48.389
DGRO	pg.cityb	34	pg.cityb	2026-05-13 09:13:48.389
GRO	pg.cityb	34	pg.cityb	2026-05-13 09:13:48.389
PGR_VIEWER	pg	35	pg.citest	2026-05-13 09:27:27.577
EMPLOYEE	pg	35	pg.citest	2026-05-13 09:27:27.577
GRO	pg	35	pg.citest	2026-05-13 09:27:27.577
PGR_LME	pg	35	pg.citest	2026-05-13 09:27:27.577
CSR	pg	35	pg.citest	2026-05-13 09:27:27.577
CFC	pg	35	pg.citest	2026-05-13 09:27:27.577
SUPERUSER	pg	35	pg.citest	2026-05-13 09:27:27.577
DGRO	pg	35	pg.citest	2026-05-13 09:27:27.577
\.


--
-- Data for Name: eg_wf_action_v2; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_wf_action_v2 (uuid, tenantid, currentstate, action, nextstate, roles, createdby, createdtime, lastmodifiedby, lastmodifiedtime, active) FROM stdin;
ef191941-e2cb-4cc6-bd77-a13ef448904c	pg	eaf4ebb3-9a8e-4671-a82e-04c2fe73ac83	APPLY	c72ac8ac-4ed8-454f-9f1b-8e9baa85c7b3	CITIZEN,CSR	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	t
7e40dec6-56b9-4698-8a2a-952385dddf47	pg	c72ac8ac-4ed8-454f-9f1b-8e9baa85c7b3	ASSIGNEDBYAUTOESCALATION	9314d274-34ef-46d9-89e1-a337af700e94	AUTO_ESCALATE	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	t
5faa2d7d-8bcc-430b-8412-2054aebc13eb	pg	c72ac8ac-4ed8-454f-9f1b-8e9baa85c7b3	COMMENT	c72ac8ac-4ed8-454f-9f1b-8e9baa85c7b3	CITIZEN	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	t
4857d56d-1acf-43a9-af4f-062415d13f10	pg	c72ac8ac-4ed8-454f-9f1b-8e9baa85c7b3	ASSIGN	9314d274-34ef-46d9-89e1-a337af700e94	GRO,PGR_VIEWER	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	t
e57c2309-ea1c-49c3-b64c-bf99942d8641	pg	c72ac8ac-4ed8-454f-9f1b-8e9baa85c7b3	REJECT	fd16c395-bcaa-4f9c-a452-33e4a3d5acd0	GRO,PGR_VIEWER	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	t
159dca57-4178-4a65-9046-bcd4bef44a0b	pg	1d486301-4c34-4b19-bf40-da0ebf546bef	COMMENT	1d486301-4c34-4b19-bf40-da0ebf546bef	CITIZEN	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	t
41668123-c495-4049-b493-25df18307889	pg	1d486301-4c34-4b19-bf40-da0ebf546bef	REJECT	fd16c395-bcaa-4f9c-a452-33e4a3d5acd0	GRO,PGR_VIEWER	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	t
b249bdef-0265-46c5-b80f-b29c3c95c78d	pg	1d486301-4c34-4b19-bf40-da0ebf546bef	ASSIGN	9314d274-34ef-46d9-89e1-a337af700e94	GRO,PGR_VIEWER	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	t
9940896a-7b09-4659-8fe4-bd68fd2c5259	pg	9314d274-34ef-46d9-89e1-a337af700e94	REASSIGN	1d486301-4c34-4b19-bf40-da0ebf546bef	PGR_LME,PGR_VIEWER	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	t
f0c149fe-0de0-40b5-940c-4b0eeb7261fb	pg	9314d274-34ef-46d9-89e1-a337af700e94	COMMENT	9314d274-34ef-46d9-89e1-a337af700e94	CITIZEN	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	t
5c80da5c-6fde-4656-ab2a-af045bd30832	pg	9314d274-34ef-46d9-89e1-a337af700e94	RESOLVE	f4209bfa-9abe-4da9-b80f-3f43fced607c	PGR_LME,PGR_VIEWER	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	t
44f0bb87-f682-4392-b86f-0ad16f6622d7	pg	9314d274-34ef-46d9-89e1-a337af700e94	FORWARD	04752227-e267-43e3-bfd8-6e48bdbfd97a	AUTO_ESCALATE	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	t
882aa517-b5f2-4fb6-bfd2-b079a05c1eb2	pg	fd16c395-bcaa-4f9c-a452-33e4a3d5acd0	COMMENT	fd16c395-bcaa-4f9c-a452-33e4a3d5acd0	CITIZEN	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	t
d05728de-3da4-4887-ac13-db9fdcf053e4	pg	fd16c395-bcaa-4f9c-a452-33e4a3d5acd0	REOPEN	c72ac8ac-4ed8-454f-9f1b-8e9baa85c7b3	CFC,CITIZEN,CSR,PGR_VIEWER	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	t
7986cc6b-c15d-4d8c-9991-f6296a6338c9	pg	fd16c395-bcaa-4f9c-a452-33e4a3d5acd0	RATE	3211859d-a96f-49e7-ab8b-6a1f271fe456	CFC,CITIZEN	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	t
2badb34c-cb6d-489f-8abc-c606c9cd2c07	pg	f4209bfa-9abe-4da9-b80f-3f43fced607c	RATE	4e216e7b-d9cd-4328-ac8d-116c6e30fa3c	CFC,CITIZEN	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	t
70347fa2-f092-46cb-830c-698eb505d0b4	pg	f4209bfa-9abe-4da9-b80f-3f43fced607c	REOPEN	c72ac8ac-4ed8-454f-9f1b-8e9baa85c7b3	CFC,CITIZEN,CSR,PGR_VIEWER	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	t
016ba342-ae9c-480b-9364-e2618cb258b1	pg	f4209bfa-9abe-4da9-b80f-3f43fced607c	COMMENT	f4209bfa-9abe-4da9-b80f-3f43fced607c	CITIZEN	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	t
761ca2aa-dbc6-46cf-b257-3d8c2198e2ea	pg	09c5af9a-052f-4923-ae55-698b992cf7ec	RESOLVEBYSUPERVISOR	e80e3dd6-8336-4586-b84a-c191dcd80c98	SUPERVISOR	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	t
\.


--
-- Data for Name: eg_wf_assignee_v2; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_wf_assignee_v2 (processinstanceid, tenantid, assignee, createdby, lastmodifiedby, createdtime, lastmodifiedtime) FROM stdin;
3b6c9771-ca35-41e3-8a06-27fa0baa18ef	pg.citest	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664525350	1778664525350
790ab298-78a5-4e49-aaa9-9b26ec1ce694	pg.citest	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664525540	1778664525540
cc6bd1d2-cbc2-40b3-9ea2-c04c9eaf67b2	pg.citest	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664525716	1778664525716
e0a56869-1433-4d06-b8e7-04e132ea7279	pg.citest	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664525907	1778664525907
2adda6be-758d-4bdf-aaec-fa5cede93ebe	pg.citest	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664552529	1778664552529
8a840e0d-2623-456d-803b-c257500594ce	pg.citest	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664552714	1778664552714
\.


--
-- Data for Name: eg_wf_businessservice_v2; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_wf_businessservice_v2 (businessservice, business, tenantid, uuid, geturi, posturi, createdby, createdtime, lastmodifiedby, lastmodifiedtime, businessservicesla) FROM stdin;
PGR	pgr-services	pg	7b38c57c-ce17-43c5-91a8-1ef737a693b6	\N	\N	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	432000000
\.


--
-- Data for Name: eg_wf_document_v2; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_wf_document_v2 (id, tenantid, documenttype, documentuid, filestoreid, processinstanceid, active, createdby, lastmodifiedby, createdtime, lastmodifiedtime) FROM stdin;
d3aeb026-1af0-4584-a0f6-0d31838843bb	pg.citest	PHOTO			3b6c9771-ca35-41e3-8a06-27fa0baa18ef	\N	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664525350	1778664525350
790713e9-0663-4eeb-a31a-6c8ae14cbd83	pg.citest	PHOTO			790ab298-78a5-4e49-aaa9-9b26ec1ce694	\N	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664525540	1778664525540
934efd90-02aa-4462-9e84-5133eeab83b2	pg.citest	PHOTO			cc6bd1d2-cbc2-40b3-9ea2-c04c9eaf67b2	\N	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664525716	1778664525716
7798edef-1b4a-4bdb-8e3c-7f345e9e3309	pg.citest	PHOTO			e0a56869-1433-4d06-b8e7-04e132ea7279	\N	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664525907	1778664525907
dad7198a-d57a-4bd5-b832-638633b20b77	pg.citest	PHOTO			cb276065-655b-442a-a203-3d9731470804	\N	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664526063	1778664526063
5f1b09b0-f331-43a6-984d-244bdd9c37ec	pg.citest	PHOTO			2adda6be-758d-4bdf-aaec-fa5cede93ebe	\N	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664552529	1778664552529
e6cee572-a7a4-414d-abe3-888ee8679211	pg.citest	PHOTO			8a840e0d-2623-456d-803b-c257500594ce	\N	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664552714	1778664552714
957cb1cf-4ee8-49b8-be7d-8059bd34353f	pg.citest	PHOTO			0291b94b-30a8-4ff4-a5c4-4cd8a299d49a	\N	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664552865	1778664552865
\.


--
-- Data for Name: eg_wf_processinstance_v2; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_wf_processinstance_v2 (id, tenantid, businessservice, businessid, action, status, comment, assigner, assignee, statesla, previousstatus, createdby, lastmodifiedby, createdtime, lastmodifiedtime, modulename, businessservicesla, rating, escalated) FROM stdin;
4ff978f1-e042-4d82-b8aa-cc2311855127	pg.citya	PGR	PG-PGR-2026-05-13-000167	APPLY	c72ac8ac-4ed8-454f-9f1b-8e9baa85c7b3	\N	b2632798-952e-42cd-b896-0152c2847479	\N	\N	\N	b2632798-952e-42cd-b896-0152c2847479	b2632798-952e-42cd-b896-0152c2847479	1778663668117	1778663668117	pgr-services	432000000	\N	f
57946b29-9b60-48e5-a034-64734a341428	pg.citya	PGR	PG-PGR-2026-05-13-000180	APPLY	c72ac8ac-4ed8-454f-9f1b-8e9baa85c7b3	\N	b2632798-952e-42cd-b896-0152c2847479	\N	\N	\N	b2632798-952e-42cd-b896-0152c2847479	b2632798-952e-42cd-b896-0152c2847479	1778664367151	1778664367151	pgr-services	432000000	\N	f
5d38e62b-e6bc-4f0d-9189-60749f9032c3	pg.citest	PGR	PG-PGR-2026-05-13-000182	APPLY	c72ac8ac-4ed8-454f-9f1b-8e9baa85c7b3	\N	79006ea0-100c-4332-8390-60edff9328c1	\N	\N	\N	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664460570	1778664460570	pgr-services	432000000	\N	f
975f5c48-8dd5-4e96-a4bf-f9b2cd22c43f	pg.citest	PGR	PG-PGR-2026-05-13-000185	APPLY	c72ac8ac-4ed8-454f-9f1b-8e9baa85c7b3	\N	79006ea0-100c-4332-8390-60edff9328c1	\N	\N	\N	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664524769	1778664524769	pgr-services	432000000	\N	f
3b6c9771-ca35-41e3-8a06-27fa0baa18ef	pg.citest	PGR	PG-PGR-2026-05-13-000185	REJECT	fd16c395-bcaa-4f9c-a452-33e4a3d5acd0	Test Comment	79006ea0-100c-4332-8390-60edff9328c1	\N	300000	\N	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664525350	1778664525350	pgr-services	431999419	\N	f
790ab298-78a5-4e49-aaa9-9b26ec1ce694	pg.citest	PGR	PG-PGR-2026-05-13-000185	REOPEN	c72ac8ac-4ed8-454f-9f1b-8e9baa85c7b3	Test reopen comments	79006ea0-100c-4332-8390-60edff9328c1	\N	\N	\N	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664525540	1778664525540	pgr-services	431999229	\N	f
cc6bd1d2-cbc2-40b3-9ea2-c04c9eaf67b2	pg.citest	PGR	PG-PGR-2026-05-13-000185	ASSIGN	9314d274-34ef-46d9-89e1-a337af700e94	Test Comment	79006ea0-100c-4332-8390-60edff9328c1	\N	300000	\N	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664525716	1778664525716	pgr-services	431999053	\N	f
e0a56869-1433-4d06-b8e7-04e132ea7279	pg.citest	PGR	PG-PGR-2026-05-13-000185	RESOLVE	f4209bfa-9abe-4da9-b80f-3f43fced607c	Test Comment	79006ea0-100c-4332-8390-60edff9328c1	\N	300000	\N	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664525907	1778664525907	pgr-services	431998862	\N	f
cb276065-655b-442a-a203-3d9731470804	pg.citest	PGR	PG-PGR-2026-05-13-000185	RATE	4e216e7b-d9cd-4328-ac8d-116c6e30fa3c	Test citizen comment for closure	79006ea0-100c-4332-8390-60edff9328c1	\N	\N	\N	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664526063	1778664526063	pgr-services	431998706	\N	f
512c221a-1234-4788-aa38-9a6dc63e2a2b	pg.citest	PGR	PG-PGR-2026-05-13-000186	APPLY	c72ac8ac-4ed8-454f-9f1b-8e9baa85c7b3	\N	79006ea0-100c-4332-8390-60edff9328c1	\N	\N	\N	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664552347	1778664552347	pgr-services	432000000	\N	f
2adda6be-758d-4bdf-aaec-fa5cede93ebe	pg.citest	PGR	PG-PGR-2026-05-13-000186	ASSIGN	9314d274-34ef-46d9-89e1-a337af700e94	Test Comment	79006ea0-100c-4332-8390-60edff9328c1	\N	300000	\N	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664552529	1778664552529	pgr-services	431999818	\N	f
8a840e0d-2623-456d-803b-c257500594ce	pg.citest	PGR	PG-PGR-2026-05-13-000186	RESOLVE	f4209bfa-9abe-4da9-b80f-3f43fced607c	Test Comment	79006ea0-100c-4332-8390-60edff9328c1	\N	300000	\N	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664552714	1778664552714	pgr-services	431999633	\N	f
0291b94b-30a8-4ff4-a5c4-4cd8a299d49a	pg.citest	PGR	PG-PGR-2026-05-13-000186	RATE	4e216e7b-d9cd-4328-ac8d-116c6e30fa3c	Test citizen comment for closure	79006ea0-100c-4332-8390-60edff9328c1	\N	\N	\N	79006ea0-100c-4332-8390-60edff9328c1	79006ea0-100c-4332-8390-60edff9328c1	1778664552865	1778664552865	pgr-services	431999482	\N	f
\.


--
-- Data for Name: eg_wf_state_v2; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.eg_wf_state_v2 (uuid, tenantid, businessserviceid, state, applicationstatus, sla, docuploadrequired, isstartstate, isterminatestate, createdby, createdtime, lastmodifiedby, lastmodifiedtime, seq, isstateupdatable) FROM stdin;
eaf4ebb3-9a8e-4671-a82e-04c2fe73ac83	pg	7b38c57c-ce17-43c5-91a8-1ef737a693b6	\N	\N	\N	f	t	f	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	23	t
c72ac8ac-4ed8-454f-9f1b-8e9baa85c7b3	pg	7b38c57c-ce17-43c5-91a8-1ef737a693b6	PENDINGFORASSIGNMENT	PENDINGFORASSIGNMENT	\N	f	f	f	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	24	f
1d486301-4c34-4b19-bf40-da0ebf546bef	pg	7b38c57c-ce17-43c5-91a8-1ef737a693b6	PENDINGFORREASSIGNMENT	PENDINGFORREASSIGNMENT	300000	f	f	f	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	25	f
9314d274-34ef-46d9-89e1-a337af700e94	pg	7b38c57c-ce17-43c5-91a8-1ef737a693b6	PENDINGATLME	PENDINGATLME	300000	f	f	f	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	26	f
fd16c395-bcaa-4f9c-a452-33e4a3d5acd0	pg	7b38c57c-ce17-43c5-91a8-1ef737a693b6	REJECTED	REJECTED	300000	f	f	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	27	f
f4209bfa-9abe-4da9-b80f-3f43fced607c	pg	7b38c57c-ce17-43c5-91a8-1ef737a693b6	RESOLVED	RESOLVED	300000	f	f	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	28	f
3211859d-a96f-49e7-ab8b-6a1f271fe456	pg	7b38c57c-ce17-43c5-91a8-1ef737a693b6	CLOSEDAFTERREJECTION	CLOSEDAFTERREJECTION	\N	f	f	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	29	f
4e216e7b-d9cd-4328-ac8d-116c6e30fa3c	pg	7b38c57c-ce17-43c5-91a8-1ef737a693b6	CLOSEDAFTERRESOLUTION	CLOSEDAFTERRESOLUTION	\N	f	f	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	30	f
09c5af9a-052f-4923-ae55-698b992cf7ec	pg	7b38c57c-ce17-43c5-91a8-1ef737a693b6	PENDINGATSUPERVISOR	PENDINGATSUPERVISOR	300000	f	f	f	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	31	f
074a5ea3-c571-476e-9683-19fdfff04b56	pg	7b38c57c-ce17-43c5-91a8-1ef737a693b6	RESOLVEDBYSUPERVISOR	RESOLVEDBYSUPERVISOR	\N	f	f	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	32	f
38f17e64-c70b-42cb-8b20-358a829782c8	pg	7b38c57c-ce17-43c5-91a8-1ef737a693b6	CANCELLED	CANCELLED	\N	f	f	t	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	dc71bb18-4bb9-4f26-8746-56f6c68cd48a	1778663385019	33	f
\.


--
-- Data for Name: egov_idgen_schema_version; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.egov_idgen_schema_version (installed_rank, version, description, type, script, checksum, installed_by, installed_on, execution_time, success) FROM stdin;
1	1	<< Flyway Baseline >>	BASELINE	<< Flyway Baseline >>	\N	egov	2026-02-09 05:24:18.434683	0	t
2	20170614121459	DDL id generation create ddl	SQL	V20170614121459__DDL_id_generation_create_ddl.sql	-276506180	egov	2026-02-09 05:24:18.491978	15	t
3	20170630130913	create collection seq ddl	SQL	V20170630130913__create_collection_seq_ddl.sql	584536344	egov	2026-02-09 05:24:18.550469	5	t
4	20170713115259	create upicnum seq ddl	SQL	V20170713115259__create_upicnum_seq_ddl.sql	-226250147	egov	2026-02-09 05:24:18.571319	3	t
5	20170731222759	create noticeno seq ddl	SQL	V20170731222759__create_noticeno_seq_ddl.sql	1729453706	egov	2026-02-09 05:24:18.584096	5	t
6	20170816191759	create tl num seq ddl	SQL	V20170816191759__create_tl_num_seq_ddl.sql	-1703806072	egov	2026-02-09 05:24:18.59986	3	t
7	20170817164130	create employee code number seq ddl	SQL	V20170817164130__create_employee_code_number_seq_ddl.sql	-196105635	egov	2026-02-09 05:24:18.613793	2	t
8	20170826133659	create tl application num seq ddl	SQL	V20170826133659__create_tl_application_num_seq_ddl.sql	725879278	egov	2026-02-09 05:24:18.623792	2	t
9	20171020231917	create swm transaction num seq ddl	SQL	V20171020231917__create_swm_transaction_num_seq_ddl.sql	-267295984	egov	2026-02-09 05:24:18.632437	2	t
10	20171030111720	create lcms seq ddl	SQL	V20171030111720__create_lcms_seq_ddl.sql	-1131314050	egov	2026-02-09 05:24:18.64079	5	t
11	20171031140120	create lcms seq voucher ddl	SQL	V20171031140120__create_lcms_seq_voucher_ddl.sql	-898624016	egov	2026-02-09 05:24:18.654453	4	t
12	20171031155035	create lcms seq parawise comments	SQL	V20171031155035__create_lcms_seq_parawise_comments.sql	1312025724	egov	2026-02-09 05:24:18.669501	5	t
13	20171103163310	create swm contract num seq ddl	SQL	V20171103163310__create_swm_contract_num_seq_ddl.sql	200369660	egov	2026-02-09 05:24:18.684013	3	t
14	20171103163443	create swm vendor num seq ddl	SQL	V20171103163443__create_swm_vendor_num_seq_ddl.sql	-762706488	egov	2026-02-09 05:24:18.696332	2	t
15	20171103164912	create swm contractor num seq ddl	SQL	V20171103164912__create_swm_contractor_num_seq_ddl.sql	-631302095	egov	2026-02-09 05:24:18.70685	3	t
16	20171104162601	create swm vendor contract num seq ddl	SQL	V20171104162601__create_swm_vendor_contract_num_seq_ddl.sql	2110220476	egov	2026-02-09 05:24:18.718384	2	t
17	20171108112621	create reference evidence seq ddl	SQL	V20171108112621__create_reference_evidence_seq_ddl.sql	-129584516	egov	2026-02-09 05:24:18.729233	3	t
18	20171109001824	create swm vehicle schedule transaction num seq ddl	SQL	V20171109001824__create_swm_vehicle_schedule_transaction_num_seq_ddl.sql	-2021827066	egov	2026-02-09 05:24:18.740664	4	t
19	20171109145848	create swm supplier num seq ddl	SQL	V20171109145848__create_swm_supplier_num_seq_ddl.sql	583388728	egov	2026-02-09 05:24:18.754528	3	t
20	20171110163419	create swm trip num seq ddl	SQL	V20171110163419__create_swm_trip_num_seq_ddl.sql	-1570619200	egov	2026-02-09 05:24:18.767156	2	t
21	20171113174232	create swm vendor paymentdetails seq ddl	SQL	V20171113174232__create_swm_vendor_paymentdetails_seq_ddl.sql	762717103	egov	2026-02-09 05:24:18.777951	3	t
22	20171113175600	create swm sanitationstaff target number seq ddl	SQL	V20171113175600__create_swm_sanitationstaff_target_number_seq_ddl.sql	265986491	egov	2026-02-09 05:24:18.789782	4	t
23	20171113233008	create swm staff transaction number seq ddl	SQL	V20171113233008__create_swm_staff_transaction_number_seq_ddl.sql	2110317753	egov	2026-02-09 05:24:18.803276	3	t
24	20171114104545	create personal details seq	SQL	V20171114104545__create_personal_details_seq.sql	-1866233071	egov	2026-02-09 05:24:18.814415	2	t
25	20171114104620	create agency seq	SQL	V20171114104620__create_agency_seq.sql	-653967466	egov	2026-02-09 05:24:18.822647	3	t
26	20171115210014	create event seq	SQL	V20171115210014__create_event_seq.sql	-1138671054	egov	2026-02-09 05:24:18.832341	2	t
27	20171223074921	create egf bill default number format seq ddl	SQL	V20171223074921__create_egf_bill_default_number_format_seq_ddl.sql	1544476819	egov	2026-02-09 05:24:18.841319	2	t
28	20180206121802	create swm vehicle maintenance repair transaction number ddl	SQL	V20180206121802__create_swm_vehicle_maintenance_repair_transaction_number_ddl.sql	513099893	egov	2026-02-09 05:24:18.850668	2	t
29	20180207123336	create swm shift code ddl	SQL	V20180207123336__create_swm_shift_code_ddl.sql	1730375649	egov	2026-02-09 05:24:18.860894	2	t
30	20180531123523	create propertytax ack ddl	SQL	V20180531123523__create_propertytax_ack_ddl.sql	102790456	egov	2026-02-09 05:24:18.870472	3	t
31	20180607123336	create pg txn id ddl	SQL	V20180607123336__create_pg_txn_id_ddl.sql	936381812	egov	2026-02-09 05:24:18.881659	2	t
32	20180709180520	create propertytax assess ddl	SQL	V20180709180520__create_propertytax_assess_ddl.sql	1893633814	egov	2026-02-09 05:24:18.891172	2	t
33	20180920115635	create tl seq ddl	SQL	V20180920115635__create_tl_seq_ddl.sql	1504691701	egov	2026-02-09 05:24:18.89965	3	t
34	20181030123635	DELETE DUPLICATES AND ALTER PRIMARYKEY ID GEN ddl	SQL	V20181030123635__DELETE_DUPLICATES_AND_ALTER_PRIMARYKEY_ID_GEN_ddl.sql	-2137616238	egov	2026-02-09 05:24:18.909443	6	t
35	20190129174853	create hrms empcode ddl	SQL	V20190129174853__create_hrms_empcode_ddl.sql	-1425111802	egov	2026-02-09 05:24:18.923726	2	t
36	20190520164710	UC SEQ ddl	SQL	V20190520164710__UC_SEQ_ddl.sql	1153445194	egov	2026-02-09 05:24:18.932039	2	t
\.


--
-- Data for Name: egov_localization_schema_version; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.egov_localization_schema_version (installed_rank, version, description, type, script, checksum, installed_by, installed_on, execution_time, success) FROM stdin;
1	1	<< Flyway Baseline >>	BASELINE	<< Flyway Baseline >>	\N	egov	2026-02-09 05:24:20.539974	0	t
2	20170502122717	localization create message	SQL	V20170502122717__localization_create_message.sql	-651873868	egov	2026-02-09 05:24:20.581967	23	t
3	20170614170306	localization message alter add module	SQL	V20170614170306__localization_message_alter_add_module.sql	-1138292234	egov	2026-02-09 05:24:20.631429	7	t
4	20170625193803	add audit columns to message table	SQL	V20170625193803__add_audit_columns_to_message_table.sql	424158717	egov	2026-02-09 05:24:20.653787	5	t
5	20181218164449	alter msg alter id column ddl	SQL	V20181218164449__alter_msg_alter_id_column_ddl.sql	-1867784919	egov	2026-02-09 05:24:20.670128	10	t
\.


--
-- Data for Name: egov_url_shortening_schema_version; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.egov_url_shortening_schema_version (installed_rank, version, description, type, script, checksum, installed_by, installed_on, execution_time, success) FROM stdin;
1	1	<< Flyway Baseline >>	BASELINE	<< Flyway Baseline >>	\N	egov	2026-02-09 05:24:22.16261	0	t
2	20190624185601	eg  ddl	SQL	V20190624185601__eg__ddl.sql	1797967045	egov	2026-02-09 05:24:22.211192	24	t
\.


--
-- Data for Name: egov_user_schema_version; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.egov_user_schema_version (installed_rank, version, description, type, script, checksum, installed_by, installed_on, execution_time, success) FROM stdin;
1	20170223150524	create eg user table	SQL	V20170223150524__create_eg_user_table.sql	-473117120	egov	2026-02-09 05:24:16.26987	25	t
2	20170223151046	create eg address table	SQL	V20170223151046__create_eg_address_table.sql	-773357059	egov	2026-02-09 05:24:16.329698	10	t
3	20170223151145	create eg role table	SQL	V20170223151145__create_eg_role_table.sql	-1566976242	egov	2026-02-09 05:24:16.358567	9	t
4	20170223151229	create eg user role table	SQL	V20170223151229__create_eg_user_role_table.sql	-1457999063	egov	2026-02-09 05:24:16.385755	4	t
5	20170223151230	eg user drop FK PK recreate	SQL	V20170223151230__eg_user_drop_FK_PK_recreate.sql	-1065901777	egov	2026-02-09 05:24:16.401792	20	t
6	20170404154844	create role sequence	SQL	V20170404154844__create_role_sequence.sql	-674780019	egov	2026-02-09 05:24:16.439145	3	t
7	20170417165545	create unique username tenant constraint	SQL	V20170417165545__create_unique_username_tenant_constraint.sql	-1047782019	egov	2026-02-09 05:24:16.452819	7	t
8	20170417165956	create unique role code tenant constraint	SQL	V20170417165956__create_unique_role_code_tenant_constraint.sql	792682044	egov	2026-02-09 05:24:16.470862	7	t
9	20170423025220	alter table eg user to increase signature length	SQL	V20170423025220__alter_table_eg_user_to_increase_signature_length.sql	725199194	egov	2026-02-09 05:24:16.486629	4	t
10	20170423025221	alter table eg user to reset signature length	SQL	V20170423025221__alter_table_eg_user_to_reset_signature_length.sql	-2104479543	egov	2026-02-09 05:24:16.502066	23	t
11	20170428175632	recreate user address table	SQL	V20170428175632__recreate_user_address_table.sql	408456665	egov	2026-02-09 05:24:16.535846	17	t
12	20170509172805	recreate role and user role table with tenantid	SQL	V20170509172805__recreate_role_and_user_role_table_with_tenantid.sql	1202567563	egov	2026-02-09 05:24:16.565082	13	t
13	20170516145558	alter userrole add lastmodifieddate	SQL	V20170516145558__alter_userrole_add_lastmodifieddate.sql	-30454711	egov	2026-02-09 05:24:16.587947	3	t
14	20170823203553	dropping not null for mobilenumber in eg user	SQL	V20170823203553__dropping_not_null_for_mobilenumber_in_eg_user.sql	1587712007	egov	2026-02-09 05:24:16.599379	2	t
15	20180313150524	added uuid user table	SQL	V20180313150524__added_uuid_user_table.sql	-1031804668	egov	2026-02-09 05:24:16.610986	3	t
16	20180725165212	alter eg role name	SQL	V20180725165212__alter_eg_role_name.sql	682532180	egov	2026-02-09 05:24:16.623292	7	t
17	20180731215511	fix constraint names	SQL	V20180731215511__fix_constraint_names.sql	-1751041311	egov	2026-02-09 05:24:16.642367	6	t
18	20180731215512	alter eg role address fk	SQL	V20180731215512__alter_eg_role_address_fk.sql	1357995898	egov	2026-02-09 05:24:16.659903	12	t
19	20181108160312	create indices eg user role	SQL	V20181108160312__create_indices_eg_user_role.sql	93267122	egov	2026-02-09 05:24:16.681773	21	t
20	20190204144112	create eg userrole v1	SQL	V20190204144112__create_eg_userrole_v1.sql	1977171559	egov	2026-02-09 05:24:16.721341	9	t
21	20190222121612	create eg user failed login attempts	SQL	V20190222121612__create_eg_user_failed_login_attempts.sql	-1392078543	egov	2026-02-09 05:24:16.741215	8	t
22	20190313165702	alter eg user address extend	SQL	V20190313165702__alter_eg_user_address_extend.sql	-1928243385	egov	2026-02-09 05:24:16.758002	6	t
23	20190402123143	create indices eg user eg userrole v1 	SQL	V20190402123143__create_indices_eg_user_eg_userrole_v1 .sql	-1249412585	egov	2026-02-09 05:24:16.776195	15	t
24	20210908231720	alter table eg user alternate number	SQL	V20210908231720__alter_table_eg_user_alternate_number.sql	1743363820	egov	2026-02-09 05:24:16.79945	2	t
25	20211029155746	create table user audit	SQL	V20211029155746__create_table_user_audit.sql	-894464608	egov	2026-02-09 05:24:16.8096	6	t
26	20211029171730	modified auditby	SQL	V20211029171730__modified_auditby.sql	-672564999	egov	2026-02-09 05:24:16.823352	5	t
27	20211029175430	modified username audit	SQL	V20211029175430__modified_username_audit.sql	-1616300745	egov	2026-02-09 05:24:16.83662	6	t
\.


--
-- Data for Name: enc_schema_version; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.enc_schema_version (installed_rank, version, description, type, script, checksum, installed_by, installed_on, execution_time, success) FROM stdin;
1	1	<< Flyway Baseline >>	BASELINE	<< Flyway Baseline >>	\N	egov	2026-02-09 05:24:46.802907	0	t
2	20180607185601	eg enc	SQL	V20180607185601__eg_enc.sql	-710801463	egov	2026-02-09 05:24:46.975064	65	t
\.


--
-- Data for Name: filestore_schema_version; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.filestore_schema_version (installed_rank, version, description, type, script, checksum, installed_by, installed_on, execution_time, success) FROM stdin;
1	1	<< Flyway Baseline >>	BASELINE	<< Flyway Baseline >>	\N	egov	2026-02-09 05:24:48.602634	0	t
2	20170420135841	egfilestore tenant ddl	SQL	V20170420135841__egfilestore_tenant_ddl.sql	882190174	egov	2026-02-09 05:24:48.784481	38	t
3	20180319162241	eg filestore alter ddl	SQL	V20180319162241__eg_filestore_alter_ddl.sql	994763967	egov	2026-02-09 05:24:48.949942	5	t
4	20181126143300	egfilestore filename dml	SQL	V20181126143300__egfilestore_filename_dml.sql	-798099361	egov	2026-02-09 05:24:49.007027	9	t
5	20200712143311	egfilestore audit details	SQL	V20200712143311__egfilestore_audit_details.sql	749086971	egov	2026-02-09 05:24:49.049517	17	t
\.


--
-- Data for Name: hrms_schema_version; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.hrms_schema_version (installed_rank, version, description, type, script, checksum, installed_by, installed_on, execution_time, success) FROM stdin;
1	1	<< Flyway Baseline >>	BASELINE	<< Flyway Baseline >>	\N	egov	2026-02-09 05:25:17.779033	0	t
2	20190122152236	create hrms employee table ddl	SQL	V20190122152236__create_hrms_employee_table_ddl.sql	-1554243231	egov	2026-02-09 05:25:17.832158	55	t
3	20190130120650	alter assgnmt add currentassgmt ddl	SQL	V20190130120650__alter_assgnmt_add_currentassgmt_ddl.sql	-1748589821	egov	2026-02-09 05:25:17.915952	3	t
4	20190204154948	create position sequence ddl	SQL	V20190204154948__create_position_sequence_ddl.sql	1748624915	egov	2026-02-09 05:25:17.928502	2	t
5	20190204163735	alter deactivation rename remarks ddl	SQL	V20190204163735__alter_deactivation_rename_remarks_ddl.sql	447036466	egov	2026-02-09 05:25:17.939616	3	t
6	20190204172710	secondary indexes ddl	SQL	V20190204172710__secondary_indexes_ddl.sql	1918652612	egov	2026-02-09 05:25:17.953533	10	t
7	20190215120811	alter uk constraint dml	SQL	V20190215120811__alter_uk_constraint_dml.sql	-83927431	egov	2026-02-09 05:25:17.973588	9	t
8	20190219163221	alter remove phone name clm dml	SQL	V20190219163221__alter_remove_phone_name_clm_dml.sql	541612396	egov	2026-02-09 05:25:17.994063	4	t
9	20190301154105	alter add isactive ddl	SQL	V20190301154105__alter_add_isactive_ddl.sql	1284528784	egov	2026-02-09 05:25:18.009579	4	t
10	20201005230836	eg hrms employee index ddl	SQL	V20201005230836__eg_hrms_employee_index_ddl.sql	508211693	egov	2026-02-09 05:25:18.023397	4	t
11	20201223230836	eg hrms employee reactivation details index ddl	SQL	V20201223230836__eg_hrms_employee_reactivation_details_index_ddl.sql	-839388452	egov	2026-02-09 05:25:18.035858	8	t
12	20201228172710	reactivation indexes ddl	SQL	V20201228172710__reactivation_indexes_ddl.sql	-1000031729	egov	2026-02-09 05:25:18.056141	6	t
\.


--
-- Data for Name: id_generator; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.id_generator (id, idname, tenantid, format, sequencenumber) FROM stdin;
\.


--
-- Data for Name: mdms_schema_version; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.mdms_schema_version (installed_rank, version, description, type, script, checksum, installed_by, installed_on, execution_time, success) FROM stdin;
1	1	<< Flyway Baseline >>	BASELINE	<< Flyway Baseline >>	\N	egov	2026-02-09 05:24:20.751674	0	t
2	20230531114515	schema definition ddl	SQL	V20230531114515__schema_definition_ddl.sql	-2105460030	egov	2026-02-09 05:24:20.821189	11	t
3	20230531144020	mdms data create ddl	SQL	V20230531144020__mdms_data_create_ddl.sql	-1027512135	egov	2026-02-09 05:24:20.865694	9	t
\.


--
-- Data for Name: message; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.message (id, locale, code, message, tenantid, module, createdby, createddate, lastmodifiedby, lastmodifieddate) FROM stdin;
1cb9d62c-2800-4674-8d50-d2c5d85db269	en_IN	WBH_MDMS_MASTER_TRADELICENSE	TradeLicense	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
3d24aa56-ec80-46a5-ac9b-a565d082b941	en_IN	WBH_MDMS_TRADELICENSE_CALCULATIONTYPE	CalculationType	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
7d3237b1-9667-4105-9f07-b8c9bb04c8e3	en_IN	SCHEMA_TRADELICENSE_CALCULATIONTYPE	CalculationType	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
e672b84d-de12-4779-8d73-51f1b11c7140	en_IN	TRADELICENSE_CALCULATIONTYPE_ACCESSORY	accessory	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
9ca8ad30-cbc4-4a3d-a79b-7cb699486d20	en_IN	TRADELICENSE_CALCULATIONTYPE_FINANCIALYEAR	financialYear	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
db7e236f-d8f9-462e-962f-aa1ca6654351	en_IN	TRADELICENSE_CALCULATIONTYPE_ACTIVE	active	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
a9039698-16a8-4bb5-ad29-07ec9d96b854	en_IN	TRADELICENSE_CALCULATIONTYPE_TRADETYPE	tradeType	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
58ca58d7-4a23-4377-b5eb-26b027125612	en_IN	WBH_MDMS_TRADELICENSE_TRADETYPE	TradeType	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
7401cae9-bc18-4132-8f1a-22f559a71a51	en_IN	SCHEMA_TRADELICENSE_TRADETYPE	TradeType	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
fe2eec61-6edd-489e-b0b2-72899ce2cfd4	en_IN	TRADELICENSE_TRADETYPE_VALIDITYPERIOD	validityPeriod	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
aed31778-357a-42bf-bdfd-e87adc6efd63	en_IN	TRADELICENSE_TRADETYPE_ACTIVE	active	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
98ee80f7-93f4-4763-ba46-4a80ea33f5da	en_IN	TRADELICENSE_TRADETYPE_NAME	name	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
51247705-385f-4191-9988-17aa16d766eb	en_IN	TRADELICENSE_TRADETYPE_CODE	code	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
4eaeb47f-e297-4a91-a5e6-b21d5bd3e4eb	en_IN	TRADELICENSE_TRADETYPE_APPLICATIONTYPE	applicationType	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
f94022fb-8055-4eb4-b8ce-ed110e624249	en_IN	TRADELICENSE_TRADETYPE_VERIFICATIONDOCUMENT	verificationDocument	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
1de44c1b-cda9-4d75-a5df-beefd92f8a17	en_IN	TRADELICENSE_TRADETYPE_DOCUMENTLIST	documentList	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
434ebe42-6d00-4be3-8f5e-c97c0faba416	en_IN	TRADELICENSE_TRADETYPE_APPLICATIONDOCUMENT	applicationDocument	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
86ae1b08-39ea-4f54-9e6b-00951481b80e	en_IN	TRADELICENSE_TRADETYPE_TYPE	type	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
82793434-eaa3-4234-9317-7783743cc8d6	en_IN	TRADELICENSE_TRADETYPE_UOM	uom	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
1ba5474c-a703-42f0-82bb-109c9b81828c	en_IN	WBH_MDMS_TRADELICENSE_ACCESSORIESCATEGORY	AccessoriesCategory	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
9f4907dd-3621-4dcc-ae36-3d204abaf1b9	en_IN	SCHEMA_TRADELICENSE_ACCESSORIESCATEGORY	AccessoriesCategory	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
b84b698b-25a8-469a-92ed-3bc89cc5f11c	en_IN	TRADELICENSE_ACCESSORIESCATEGORY_ACTIVE	active	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
cf89dbe4-9882-4fdd-8a3e-5556655ee809	en_IN	TRADELICENSE_ACCESSORIESCATEGORY_CODE	code	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
f4c1961f-449c-4747-9205-e7063085c1de	en_IN	TRADELICENSE_ACCESSORIESCATEGORY_UOM	uom	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
33492b12-ad97-4916-a5db-787dbd46bf1f	en_IN	WBH_MDMS_TRADELICENSE_COMMONFIELDSCONFIG	CommonFieldsConfig	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
9dc5b21f-ee2f-478c-a43d-8e1e3952a50c	en_IN	SCHEMA_TRADELICENSE_COMMONFIELDSCONFIG	CommonFieldsConfig	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
6a161a71-a8fa-4dea-bd38-445ad9aa82c9	en_IN	TRADELICENSE_COMMONFIELDSCONFIG_BODY	body	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
628d7784-0038-4335-aac6-8422221ba159	en_IN	TRADELICENSE_COMMONFIELDSCONFIG_HEADER	header	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
35c0276b-8a69-4965-b8e8-9ff7ecbaad1d	en_IN	TRADELICENSE_COMMONFIELDSCONFIG_HIDEINEMPLOYEE	hideInEmployee	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
f89a4bd0-4647-49d5-b871-b43591bfb92b	en_IN	TRADELICENSE_COMMONFIELDSCONFIG_HEADERCAPTION	headerCaption	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
076cd703-c5be-4816-a027-c87d0d09dbcc	en_IN	TRADELICENSE_COMMONFIELDSCONFIG_KEY	key	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
2295d05e-ffe8-48bd-946d-a545bbaa6d79	en_IN	TRADELICENSE_COMMONFIELDSCONFIG_SUBMITBARLABEL	submitBarLabel	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
4e1cf5ba-8f25-4943-9428-b412dda5d92c	en_IN	TRADELICENSE_COMMONFIELDSCONFIG_NEXTSTEP	nextStep	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
b68b9a81-915d-4188-877d-8c9c8b73dbc2	en_IN	TRADELICENSE_COMMONFIELDSCONFIG_CARDTEXT	cardText	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
ec4b44fd-6d04-43ac-bba0-ce811091709c	en_IN	TRADELICENSE_COMMONFIELDSCONFIG_SKIPTEXT	skipText	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
20595eb6-758a-4fdb-8882-4751810ef197	en_IN	TRADELICENSE_COMMONFIELDSCONFIG_ROUTE	route	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
9b99d7a4-fcf4-4b4c-8614-916b8410e3e6	en_IN	TRADELICENSE_COMMONFIELDSCONFIG_COMPONENT	component	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
9077c61b-cb20-477e-b7c0-56c9f6304865	en_IN	TRADELICENSE_COMMONFIELDSCONFIG_TYPE	type	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
a7ff1d11-c8ba-4094-affb-9cf79e4acc52	en_IN	TRADELICENSE_COMMONFIELDSCONFIG_TEXTS	texts	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
1d354347-d39b-4c54-bddc-d0f936058085	en_IN	TRADELICENSE_COMMONFIELDSCONFIG_ISMANDATORY	isMandatory	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
10508235-82ba-453c-aeff-26cd528db509	en_IN	TRADELICENSE_COMMONFIELDSCONFIG_HEAD	head	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
601da028-113c-48ff-a6b9-7040c6d91cf3	en_IN	TRADELICENSE_COMMONFIELDSCONFIG_WITHOUTLABEL	withoutLabel	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
0dee605b-d2a8-49ad-b13b-efcbf8883d32	en_IN	WBH_MDMS_TRADELICENSE_DOCUMENTOBJ	documentObj	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
86383aee-e47a-4fba-adc8-91275d25821c	en_IN	SCHEMA_TRADELICENSE_DOCUMENTOBJ	documentObj	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
af6d172f-e41e-497e-9435-142a0b0c8038	en_IN	TRADELICENSE_DOCUMENTOBJ_ALLOWEDDOCS	allowedDocs	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
52617b05-0598-4837-bd21-48bed3cf1ba0	en_IN	TRADELICENSE_DOCUMENTOBJ_REQUIRED	required	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
4549daa0-efd2-4551-841a-78e9acfd6d11	en_IN	TRADELICENSE_DOCUMENTOBJ_APPLICATIONTYPE	applicationType	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
7842ee29-8ab6-4070-a988-9a89d2158d95	en_IN	TRADELICENSE_DOCUMENTOBJ_DOCUMENTTYPE	documentType	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
9c93d668-0ed5-4f4f-986b-c1d2f5af7724	en_IN	TRADELICENSE_DOCUMENTOBJ_TRADETYPE	tradeType	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
c9cc1b43-c558-4ff9-82c4-86e1730c035e	en_IN	WBH_MDMS_TRADELICENSE_REMINDERPERIODS	ReminderPeriods	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
5f7f4e4e-0e66-49de-ad54-2b963a5df2c7	en_IN	SCHEMA_TRADELICENSE_REMINDERPERIODS	ReminderPeriods	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
90a80ac4-0929-4307-97c6-91c143f17533	en_IN	TRADELICENSE_REMINDERPERIODS_TENANTID	tenantId	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
cfa2b33e-568d-48f9-a39c-3d6ec6cdca12	en_IN	TRADELICENSE_REMINDERPERIODS_REMINDERINTERVAL	reminderInterval	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
e52bbbf8-bd0c-48b8-a652-230011228a78	en_IN	WBH_MDMS_TRADELICENSE_PENALTY	Penalty	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
c0166034-b852-44f0-97f9-e9c22c7d46e0	en_IN	SCHEMA_TRADELICENSE_PENALTY	Penalty	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
84538a69-6e66-423e-bba3-767302516e72	en_IN	TRADELICENSE_PENALTY_RATE	rate	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
aaa6ae3b-e276-4ccf-b4de-8be6e4a1d377	en_IN	TRADELICENSE_PENALTY_FLATAMOUNT	flatAmount	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
f0809869-a6b3-42d5-943f-74be021fa1ff	en_IN	TRADELICENSE_PENALTY_STARTINGDAY	startingDay	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
2b68e634-a81d-42f8-a768-8f818525df9b	en_IN	TRADELICENSE_PENALTY_FROMFY	fromFY	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
38f83441-29a1-47c6-941c-7895f4efdd06	en_IN	TRADELICENSE_PENALTY_MINAMOUNT	minAmount	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
4dc94320-9f8d-400f-8713-334436e38c34	en_IN	WBH_MDMS_TRADELICENSE_DOCUMENTS	Documents	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
7c225e3a-7342-40f2-9d67-90489785e9f6	en_IN	SCHEMA_TRADELICENSE_DOCUMENTS	Documents	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
237fcacf-affc-412c-ad61-613b3213a126	en_IN	TRADELICENSE_DOCUMENTS_ACTIVE	active	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
dd5b6305-8c3e-490b-8913-dc32586915bc	en_IN	TRADELICENSE_DOCUMENTS_REQUIRED	required	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
952853af-08fa-44f4-855a-181b254982f3	en_IN	TRADELICENSE_DOCUMENTS_CODE	code	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
90717eb0-116f-4137-845b-1dbd3eca8564	en_IN	TRADELICENSE_DOCUMENTS_DROPDOWNDATA	dropdownData	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
30500c12-c7fe-41b2-966a-095c86a0ffbf	en_IN	TRADELICENSE_DOCUMENTS_DOCUMENTTYPE	documentType	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
25e54b8b-472b-49d8-9568-2e6d2af9b5ee	en_IN	TRADELICENSE_DOCUMENTS_DESCRIPTION	description	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
9ee3eacb-3c0e-4698-9b74-c0c602492e18	en_IN	WBH_MDMS_TRADELICENSE_APPLICATIONTYPE	ApplicationType	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
5da00d40-5ed8-4ea2-992d-c5168fc4b9ac	en_IN	SCHEMA_TRADELICENSE_APPLICATIONTYPE	ApplicationType	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
afe327ea-aafe-4258-8bfe-9b2770515144	en_IN	TRADELICENSE_APPLICATIONTYPE_CODE	code	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
ccd41d14-fcec-4538-890f-56183b6d03ca	en_IN	TRADELICENSE_APPLICATIONTYPE_ACTIVE	active	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
11d82cdc-8191-4f62-a809-51eb5db2e2f9	en_IN	WBH_MDMS_TRADELICENSE_TRADERENEWAL	TradeRenewal	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
596459ea-8dc6-47fe-a0d8-e5000b864ff5	en_IN	SCHEMA_TRADELICENSE_TRADERENEWAL	TradeRenewal	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
ac937710-a635-4b90-beaf-313cc591d579	en_IN	TRADELICENSE_TRADERENEWAL_RENEWALPERIOD	renewalPeriod	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
88b75b82-b1d2-4a03-848a-efdd7083145e	en_IN	WBH_MDMS_TRADELICENSE_REBATE	Rebate	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
424b8ec9-b4a3-4a06-ab5f-6feddd53d23d	en_IN	SCHEMA_TRADELICENSE_REBATE	Rebate	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
45c1894b-b03b-4cbb-b6d0-5311f74d6e6f	en_IN	TRADELICENSE_REBATE_RATE	rate	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
8c41f068-c13a-4065-a53a-4c9137e3781b	en_IN	TRADELICENSE_REBATE_FLATAMOUNT	flatAmount	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
9a289ebc-1bb0-496f-8cb9-444a5dfbeee3	en_IN	TRADELICENSE_REBATE_ENDINGDAY	endingDay	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
59853486-eaeb-4a12-a58d-df10d10d675b	en_IN	TRADELICENSE_REBATE_FROMFY	fromFY	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
54bf6d1e-b10d-40b0-a1cb-90c6349d2efa	en_IN	TRADELICENSE_REBATE_MAXAMOUNT	maxAmount	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
365046c4-be4c-4789-be90-e432ef78f279	en_IN	TRADELICENSE_TRADELICENSE_ALLOWEDDOCS	allowedDocs	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
acc93b4b-a4d4-4243-b7e7-1be38bb3568e	en_IN	TRADELICENSE_TRADELICENSE_BODY	body	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
aff819bb-80c7-4ea9-85c8-ef4a27f1c10a	en_IN	TRADELICENSE_TRADELICENSE_APPLICATIONTYPE	applicationType	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
acd4c0e9-ea0d-4cce-b660-6858c5c20c28	en_IN	TRADELICENSE_TRADELICENSE_DOCUMENTLIST	documentList	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
1ab03683-e3f3-4d10-914c-443cb969b27b	en_IN	TRADELICENSE_TRADELICENSE_DROPDOWNDATA	dropdownData	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
b6a96571-24a3-4f8d-af77-0de1a0e140f5	en_IN	TRADELICENSE_TRADELICENSE_APPLICATIONDOCUMENT	applicationDocument	pg	rainmaker-workbench	1	2026-02-09 05:25:03.639848	1	2026-02-09 05:25:03.639848
fd16872e-f180-4e22-ad89-47519e1b9ef9	en_IN	TENANT_TENANTS_PG_CIDESIG	pg.cidesig	pg	rainmaker-common	1	2026-05-13 06:54:25.754	\N	\N
f985a0ff-47f6-4a54-9975-cde8171c401a	en_IN	TENANT_TENANTS_PG_CIDEPT	pg.cidept	pg	rainmaker-common	1	2026-05-13 06:54:27.994	\N	\N
71d56f31-61b0-4cc5-8104-e5d0af1eeb89	en_IN	COMMON_MASTERS_DESIGNATION_DESIG_1002	engineer	pg	rainmaker-common	1	2026-05-13 06:54:26.653	1	2026-05-13 08:00:49.978
c23028f5-8bfc-4bd1-b40f-6eed6a0d35dc	en_IN	SERVICEDEFS_TABBROKEN	tab broken	pg	rainmaker-pgr	1	2026-05-13 06:54:27.142	1	2026-05-13 08:41:42.287
a9b063a0-68e0-4e76-8359-8cc3cbfd8aa1	en_IN	TENANT_TENANTS_PG_CIBNDAUTH	pg.cibndauth	pg	rainmaker-common	1	2026-05-13 06:54:34.236	\N	\N
eae6cb92-a2e7-4e42-b4e5-bd784ec1c9b3	en_IN	TENANT_TENANTS_PG_CICOUNTS	pg.cicounts	pg	rainmaker-common	1	2026-05-13 06:54:32.166	\N	\N
5e42234f-421b-474d-944b-8e3a76a1a391	en_IN	COMMON_MASTERS_DEPARTMENT_DEPT_38	CI_SCOPE_DEPT_55272	pg	rainmaker-common	1	2026-05-13 06:54:32.818	\N	\N
6bddf9f1-1349-47f0-b886-7bcd764e8e33	en_IN	COMMON_MASTERS_DESIGNATION_DESIG_1004	CI_SCOPE_DESIG_55272	pg	rainmaker-common	1	2026-05-13 06:54:33.445	\N	\N
00e121cb-74db-426a-838c-4bcec4cdb6c2	en_IN	COMMON_MASTERS_DESIGNATION_DESIG_1003	LME	pg	rainmaker-common	1	2026-05-13 06:54:26.653	1	2026-05-13 08:00:49.978
14287d2a-d4f6-4cf7-8e5d-49c39c9e9e7e	en_IN	SERVICEDEFS_TABBROKEN.DEPT_36	tab broken	pg	rainmaker-pgr	1	2026-05-13 06:54:27.142	1	2026-05-13 08:41:42.287
aaa90dd4-4de5-49c2-91dc-73684a023765	en_IN	TENANT_TENANTS_PG_CIRCT55494	pg.circt55494	pg	rainmaker-common	1	2026-05-13 06:58:14.814	\N	\N
57b1e581-d524-4cb5-a1eb-f00bcf84e087	en_IN	TENANT_TENANTS_PG_CIEMP55505	pg.ciemp55505	pg	rainmaker-common	1	2026-05-13 06:58:26.141	\N	\N
ccef1c0c-a9ed-4d88-af7f-9fa6d5475721	en_IN	TENANT_TENANTS_PG_CIADM55512	pg.ciadm55512	pg	rainmaker-common	1	2026-05-13 06:58:32.155	\N	\N
14f4375c-d73b-4b32-a567-6a064c7bd09b	en_IN	COMMON_MASTERS_DEPARTMENT_DEPT_37	ELECTRIC DEPARTMENT	pg	rainmaker-common	1	2026-05-13 06:54:26.132	1	2026-05-13 08:00:49.464
8d4d9543-4af7-4a16-bc33-38d13f763d6e	en_IN	SERVICEDEFS_WATER_NOT_COMING	Water not coming	pg	rainmaker-pgr	1	2026-05-13 06:54:27.142	1	2026-05-13 08:41:42.287
420352b0-563e-461e-ab88-4bb9a932d14c	en_IN	COMMON_MASTERS_DEPARTMENT_DEPT_36	WATER DEPARTMENT	pg	rainmaker-common	1	2026-05-13 06:54:26.132	1	2026-05-13 08:00:49.464
03b02807-f7c8-4921-879f-8cb3bc9291cd	en_IN	COMMON_MASTERS_DEPARTMENT_DEPT_39	CI_SCOPE_DEPT_59014	pg	rainmaker-common	1	2026-05-13 07:56:54.838	\N	\N
ae5cf5a9-5736-4e61-bcb5-f2903c9680c3	en_IN	COMMON_MASTERS_DESIGNATION_DESIG_1005	CI_SCOPE_DESIG_59014	pg	rainmaker-common	1	2026-05-13 07:56:55.218	\N	\N
d467d2cd-3d59-464c-a3bf-baffa4351dd8	en_IN	TENANT_TENANTS_PG_CIRCT59235	pg.circt59235	pg	rainmaker-common	1	2026-05-13 08:00:35.773	\N	\N
0c71f00a-b90c-4f6c-927d-65a02ae2c81c	en_IN	TENANT_TENANTS_PG_CIEMP59246	pg.ciemp59246	pg	rainmaker-common	1	2026-05-13 08:00:47.098	\N	\N
817fbb18-7510-403b-b77d-f663539c5373	en_IN	TENANT_TENANTS_PG_CIADM59252	pg.ciadm59252	pg	rainmaker-common	1	2026-05-13 08:00:53.14	\N	\N
180d334d-92f3-4376-8800-272eb058afca	en_IN	COMMON_MASTERS_DEPARTMENT_DEPT_40	CI_SCOPE_DEPT_61700	pg	rainmaker-common	1	2026-05-13 08:41:41.466	\N	\N
0e776c3c-015a-449e-98df-6b8ebf0549b4	en_IN	COMMON_MASTERS_DESIGNATION_DESIG_1006	CI_SCOPE_DESIG_61700	pg	rainmaker-common	1	2026-05-13 08:41:41.875	\N	\N
5f15c1b4-7956-4501-8eb2-cf3ca84dc999	en_IN	TENANT_TENANTS_PG_CIRCT61921	pg.circt61921	pg	rainmaker-common	1	2026-05-13 08:45:22.109	\N	\N
2bbdd9fb-67c4-4da6-98c4-3d3c815499fc	en_IN	TENANT_TENANTS_PG_CIEMP61933	pg.ciemp61933	pg	rainmaker-common	1	2026-05-13 08:45:33.427	\N	\N
7033ae6a-6fab-4822-94ab-5d104c88592c	en_IN	TENANT_TENANTS_PG_CIADM61935	pg.ciadm61935	pg	rainmaker-common	1	2026-05-13 08:45:35.598	\N	\N
35cb171c-5435-4ef3-b333-de587555b22b	en_IN	COMMON_MASTERS_DESIG_1007	CI_SCOPE_DESIG_61969	pg.cicounts	rainmaker-common	1	2026-05-13 08:46:09.965	\N	\N
d6beb211-03e3-46cf-b390-bfd9d00f9889	en_IN	SERVICEDFS.WATERNOTCOMING	Water not coming	pg.cicounts	rainmaker-pgr	1	2026-05-13 08:46:10.374	1	2026-05-13 08:52:02.242
510b3a5f-4555-4ab3-8309-36639b3c7034	en_IN	SERVICEDFS.TABBROKEN	tab broken	pg.cicounts	rainmaker-pgr	1	2026-05-13 08:46:10.374	1	2026-05-13 08:52:02.242
37f77b55-4e45-40d3-b133-c34069eb341b	en_IN	SERVICEDFS.WATERNOTCOMING	Water not coming	pg.cidept	rainmaker-pgr	1	2026-05-13 08:46:06.575	1	2026-05-13 08:52:00.807
c054f195-b3d0-432b-bc0d-abe95457f41f	en_IN	SERVICEDFS.TABBROKEN	tab broken	pg.cidept	rainmaker-pgr	1	2026-05-13 08:46:06.575	1	2026-05-13 08:52:00.807
b11a5db0-e2e7-4aec-aaba-fefb9a418cd2	en_IN	COMMON_MASTERS_DEPARTMENT_DEPT_41	CI_SCOPE_DEPT_61969	pg.cicounts	rainmaker-common	1	2026-05-13 08:46:09.537	\N	\N
dbc77c6e-c09c-40d9-b214-560e4cef67a4	en_IN	TENANT_TENANTS_PG_CIRCT62190	CI Reactivation Test	pg	rainmaker-common	1	2026-05-13 08:49:50.226	\N	\N
e8e19a86-72c4-47a5-8a33-6a4af549c2d8	en_IN	TENANT_TENANTS_PG_CIEMP62201	CI Emp Test 62201	pg	rainmaker-common	1	2026-05-13 08:50:01.552	\N	\N
12fc2e72-218e-4900-adfd-b4e8c2ae25e1	en_IN	TENANT_TENANTS_PG_CIADM62203	CI Admin Test 62203	pg	rainmaker-common	1	2026-05-13 08:50:03.721	\N	\N
272cac8c-e1c9-4e8b-a0f5-29dad89ad078	en_IN	SERVICEDFS.TABBROKEN	tab broken	pg.cidesig	rainmaker-pgr	1	2026-05-13 08:46:05.646	1	2026-05-13 08:51:58.066
b189c5e9-acc6-4e87-91f9-4de479b42cf8	en_IN	SERVICEDFS.WATERNOTCOMING	Water not coming	pg.cidesig	rainmaker-pgr	1	2026-05-13 08:46:05.646	1	2026-05-13 08:51:58.066
ef49c3c4-f090-4129-bb41-022d918abc44	en_IN	COMMON_MASTERS_DEPARTMENT_DEPT_42	CI_SCOPE_DEPT_62321	pg.cicounts	rainmaker-common	1	2026-05-13 08:52:01.452	\N	\N
9d778b72-23eb-4db3-bbdd-c7e6baa0baa5	en_IN	COMMON_MASTERS_DESIG_1008	CI_SCOPE_DESIG_62321	pg.cicounts	rainmaker-common	1	2026-05-13 08:52:01.936	\N	\N
ed90e862-ebe5-47e2-94c5-c6d8fe3a1f2e	en_IN	TENANT_TENANTS_PG_CIRCT62542	CI Reactivation Test	pg	rainmaker-common	1	2026-05-13 08:55:42.667	\N	\N
258ac11a-5dc3-453d-9d80-ef2d1b62d845	en_IN	TENANT_TENANTS_PG_CIEMP62553	CI Emp Test 62553	pg	rainmaker-common	1	2026-05-13 08:55:53.986	\N	\N
5ede8b3f-2995-480b-96d7-e0205cb53bb6	en_IN	COMMON_MASTERS_DEPARTMENT_DEPT_36	WATER DEPARTMENT	pg.ciemp62553	rainmaker-common	1	2026-05-13 08:55:56.398	\N	\N
992a5c22-faa9-4171-8d0e-f2a4be9faada	en_IN	COMMON_MASTERS_DEPARTMENT_DEPT_37	ELECTRIC DEPARTMENT	pg.ciemp62553	rainmaker-common	1	2026-05-13 08:55:56.398	\N	\N
057a2005-47ca-4c38-b064-9a572ae6d819	en_IN	COMMON_MASTERS_DESIG_1002	engineer	pg.ciemp62553	rainmaker-common	1	2026-05-13 08:55:56.898	\N	\N
d99c324e-8dcb-4efe-8236-ffeaf06a4aeb	en_IN	COMMON_MASTERS_DESIG_1003	LME	pg.ciemp62553	rainmaker-common	1	2026-05-13 08:55:56.898	\N	\N
fbe45839-0f9c-449a-9133-44cf8f59d67d	en_IN	SERVICEDFS.WATERNOTCOMING	Water not coming	pg.ciemp62553	rainmaker-pgr	1	2026-05-13 08:55:57.309	\N	\N
f3852b79-e30a-48f2-9810-8a0b62e15d6c	en_IN	SERVICEDFS.TABBROKEN	tab broken	pg.ciemp62553	rainmaker-pgr	1	2026-05-13 08:55:57.309	\N	\N
51ce6329-80c4-4e9f-ac74-50431acb3fef	en_IN	TENANT_TENANTS_PG_CIADM62559	CI Admin Test 62559	pg	rainmaker-common	1	2026-05-13 08:55:59.981	\N	\N
20ddcdbe-f158-4d97-9f6c-d5a0486222a7	en_IN	TENANT_TENANTS_PG_CITEST	CI Test	pg	rainmaker-common	29	2026-05-13 09:27:25.849	\N	\N
b08bd90e-55f0-4948-983e-880daea03553	en_IN	COMMON_MASTERS_DEPARTMENT_DEPT_36	WATER DEPARTMENT	pg.citest	rainmaker-common	29	2026-05-13 09:27:26.257	\N	\N
671b2f06-2106-4e46-9784-485c13162483	en_IN	COMMON_MASTERS_DEPARTMENT_DEPT_37	ELECTRIC DEPARTMENT	pg.citest	rainmaker-common	29	2026-05-13 09:27:26.257	\N	\N
1e5e7df0-0331-4331-8093-2294fba9aea9	en_IN	COMMON_MASTERS_DESIG_1002	engineer	pg.citest	rainmaker-common	29	2026-05-13 09:27:26.753	\N	\N
5b360c5b-de3b-47e8-85c4-264a278fd06b	en_IN	COMMON_MASTERS_DESIG_1003	LME	pg.citest	rainmaker-common	29	2026-05-13 09:27:26.753	\N	\N
ab210868-6c64-48ce-9788-6b3b4e5506ff	en_IN	SERVICEDFS.WATERNOTCOMING	Water not coming	pg.citest	rainmaker-pgr	29	2026-05-13 09:27:27.163	\N	\N
9747bd00-2eb4-4776-8939-889ec0603737	en_IN	SERVICEDFS.TABBROKEN	tab broken	pg.citest	rainmaker-pgr	29	2026-05-13 09:27:27.163	\N	\N
\.


--
-- Data for Name: pgr_services_schema; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pgr_services_schema (installed_rank, version, description, type, script, checksum, installed_by, installed_on, execution_time, success) FROM stdin;
1	1	<< Flyway Baseline >>	BASELINE	<< Flyway Baseline >>	\N	egov	2026-02-09 05:25:12.57243	0	t
2	20200717133931	create table	SQL	main/V20200717133931__create_table.sql	1132569897	egov	2026-02-09 05:25:12.655223	17	t
3	20200810112036	add index	SQL	main/V20200810112036__add_index.sql	418627729	egov	2026-02-09 05:25:12.709256	21	t
4	20201130165150	alter table ddl	SQL	main/V20201130165150__alter_table_ddl.sql	-1604861903	egov	2026-02-09 05:25:12.743597	8	t
\.


--
-- Data for Name: service; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.service (id, code, name, enabled, contextroot, displayname, ordernumber, parentmodule, tenantid) FROM stdin;
\.


--
-- Data for Name: workflow_schema_version; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.workflow_schema_version (installed_rank, version, description, type, script, checksum, installed_by, installed_on, execution_time, success) FROM stdin;
1	1	<< Flyway Baseline >>	BASELINE	<< Flyway Baseline >>	\N	egov	2026-02-09 05:25:00.918144	0	t
2	20181204120036	wf create ddl	SQL	V20181204120036__wf_create_ddl.sql	-943671309	egov	2026-02-09 05:25:00.974874	42	t
3	20181226133033	wf alter table ddl	SQL	V20181226133033__wf_alter_table_ddl.sql	-1846206951	egov	2026-02-09 05:25:01.06321	3	t
4	20190117125333	wf state action alter table ddl	SQL	V20190117125333__wf_state_action_alter_table_ddl.sql	-1913967942	egov	2026-02-09 05:25:01.076426	26	t
5	20190322143035	wf add seq ddl	SQL	V20190322143035__wf_add_seq_ddl.sql	327804453	egov	2026-02-09 05:25:01.115516	3	t
6	20190411170435	wf add isStateUpdatable ddl	SQL	V20190411170435__wf_add_isStateUpdatable_ddl.sql	457550658	egov	2026-02-09 05:25:01.129665	2	t
7	20191211105434	wf modified assignee ddl	SQL	V20191211105434__wf_modified_assignee_ddl.sql	1176859445	egov	2026-02-09 05:25:01.139524	3	t
8	20200925153931	wf missing index ddl	SQL	V20200925153931__wf_missing_index_ddl.sql	1207664085	egov	2026-02-09 05:25:01.151551	4	t
9	20201030131738	wf comment size ddl	SQL	V20201030131738__wf_comment_size_ddl.sql	-1475905560	egov	2026-02-09 05:25:01.164046	7	t
10	20210111134335	wf added assignee idx ddl	SQL	V20210111134335__wf_added_assignee_idx_ddl.sql	-2022994724	egov	2026-02-09 05:25:01.18104	4	t
11	20210203112523	wf alter table ddl	SQL	V20210203112523__wf_alter_table_ddl.sql	366659182	egov	2026-02-09 05:25:01.191404	1	t
12	20210423102936	wf alter table active ddl	SQL	V20210423102936__wf_alter_table_active_ddl.sql	-1560113142	egov	2026-02-09 05:25:01.200292	2	t
13	20210817103463	wf alter table escalated ddl	SQL	V20210817103463__wf_alter_table_escalated_ddl.sql	2103718292	egov	2026-02-09 05:25:01.210414	2	t
\.


--
-- Name: eg_address_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.eg_address_id_seq', 1, false);


--
-- Name: eg_enc_asymmetric_keys_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.eg_enc_asymmetric_keys_id_seq', 5, true);


--
-- Name: eg_enc_symmetric_keys_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.eg_enc_symmetric_keys_id_seq', 5, true);


--
-- Name: eg_hrms_position; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.eg_hrms_position', 13, true);


--
-- Name: eg_url_shorter_id; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.eg_url_shorter_id', 1, false);


--
-- Name: id_generator_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.id_generator_id_seq', 1, false);


--
-- Name: seq_ack_num; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_ack_num', 1, false);


--
-- Name: seq_advocate_code; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_advocate_code', 1, false);


--
-- Name: seq_advocatepayment_code; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_advocatepayment_code', 1, false);


--
-- Name: seq_agency; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_agency', 1, false);


--
-- Name: seq_assesmnt_num; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_assesmnt_num', 1, false);


--
-- Name: seq_case_advocate; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_case_advocate', 1, false);


--
-- Name: seq_case_reference; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_case_reference', 1, false);


--
-- Name: seq_coll_rcpt_num; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_coll_rcpt_num', 1, false);


--
-- Name: seq_eg_action; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_eg_action', 1, false);


--
-- Name: seq_eg_filestoremap; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_eg_filestoremap', 8, true);


--
-- Name: seq_eg_hrms_emp_code; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_eg_hrms_emp_code', 1, false);


--
-- Name: seq_eg_ms_role; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_eg_ms_role', 1, false);


--
-- Name: seq_eg_pg_txn; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_eg_pg_txn', 1, false);


--
-- Name: seq_eg_pgr_id; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_eg_pgr_id', 188, true);


--
-- Name: seq_eg_pt_ack; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_eg_pt_ack', 1, false);


--
-- Name: seq_eg_pt_assm; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_eg_pt_assm', 1, false);


--
-- Name: seq_eg_pt_ln; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_eg_pt_ln', 1, false);


--
-- Name: seq_eg_pt_ptid; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_eg_pt_ptid', 1, false);


--
-- Name: seq_eg_role; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_eg_role', 1, false);


--
-- Name: seq_eg_tl_apl; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_eg_tl_apl', 1, false);


--
-- Name: seq_eg_user; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_eg_user', 35, true);


--
-- Name: seq_eg_user_address; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_eg_user_address', 70, true);


--
-- Name: seq_eg_wf_state_v2; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_eg_wf_state_v2', 33, true);


--
-- Name: seq_egf_bill_dft_num; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_egf_bill_dft_num', 1, false);


--
-- Name: seq_employee_code; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_employee_code', 1, false);


--
-- Name: seq_event; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_event', 1, false);


--
-- Name: seq_hearing_details; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_hearing_details', 1, false);


--
-- Name: seq_message; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_message', 1, false);


--
-- Name: seq_notice; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_notice', 1, false);


--
-- Name: seq_opinion_code; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_opinion_code', 1, false);


--
-- Name: seq_parawise_comments; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_parawise_comments', 1, false);


--
-- Name: seq_personal_details; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_personal_details', 1, false);


--
-- Name: seq_reference_evidence; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_reference_evidence', 1, false);


--
-- Name: seq_register; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_register', 1, false);


--
-- Name: seq_service; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_service', 1, false);


--
-- Name: seq_summon_code; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_summon_code', 1, false);


--
-- Name: seq_summon_reference; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_summon_reference', 1, false);


--
-- Name: seq_swm_ctrt_num; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_swm_ctrt_num', 1, false);


--
-- Name: seq_swm_shift_code_num; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_swm_shift_code_num', 1, false);


--
-- Name: seq_swm_snts_trgt_num; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_swm_snts_trgt_num', 1, false);


--
-- Name: seq_swm_splr_num; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_swm_splr_num', 1, false);


--
-- Name: seq_swm_stf_trn_num; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_swm_stf_trn_num', 1, false);


--
-- Name: seq_swm_trn_num; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_swm_trn_num', 1, false);


--
-- Name: seq_swm_vendor_payment_num; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_swm_vendor_payment_num', 1, false);


--
-- Name: seq_swm_vhl_trip_num; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_swm_vhl_trip_num', 1, false);


--
-- Name: seq_swm_vmr_trn_num; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_swm_vmr_trn_num', 1, false);


--
-- Name: seq_swm_vndr_ctrt_num; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_swm_vndr_ctrt_num', 1, false);


--
-- Name: seq_swm_vndr_num; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_swm_vndr_num', 1, false);


--
-- Name: seq_swm_vs_trn_num; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_swm_vs_trn_num', 1, false);


--
-- Name: seq_tl_app_num; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_tl_app_num', 1, false);


--
-- Name: seq_tl_num; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_tl_num', 1, false);


--
-- Name: seq_uc_demand_consumer_code; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_uc_demand_consumer_code', 1, false);


--
-- Name: seq_ulb_code; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_ulb_code', 1, false);


--
-- Name: seq_upic_num; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_upic_num', 1, false);


--
-- Name: seq_voucher_code; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seq_voucher_code', 1, false);


--
-- Name: accesscontrol_schema_version accesscontrol_schema_version_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accesscontrol_schema_version
    ADD CONSTRAINT accesscontrol_schema_version_pk PRIMARY KEY (installed_rank);


--
-- Name: boundary boundary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boundary
    ADD CONSTRAINT boundary_pkey PRIMARY KEY (id);


--
-- Name: boundary_schema_version boundary_schema_version_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boundary_schema_version
    ADD CONSTRAINT boundary_schema_version_pk PRIMARY KEY (installed_rank);


--
-- Name: eg_action eg_action_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_action
    ADD CONSTRAINT eg_action_name_key UNIQUE (name);


--
-- Name: eg_action eg_action_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_action
    ADD CONSTRAINT eg_action_pkey PRIMARY KEY (id);


--
-- Name: eg_action eg_action_url_queryparams_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_action
    ADD CONSTRAINT eg_action_url_queryparams_key UNIQUE (url, queryparams);


--
-- Name: eg_address eg_address_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_address
    ADD CONSTRAINT eg_address_pkey PRIMARY KEY (id);


--
-- Name: eg_bm_generated_template eg_bm_generated_template_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_bm_generated_template
    ADD CONSTRAINT eg_bm_generated_template_pkey PRIMARY KEY (id);


--
-- Name: eg_bm_processed_template eg_bm_processed_template_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_bm_processed_template
    ADD CONSTRAINT eg_bm_processed_template_pkey PRIMARY KEY (id);


--
-- Name: eg_enc_asymmetric_keys eg_enc_asymmetric_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_enc_asymmetric_keys
    ADD CONSTRAINT eg_enc_asymmetric_keys_pkey PRIMARY KEY (id);


--
-- Name: eg_enc_symmetric_keys eg_enc_symmetric_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_enc_symmetric_keys
    ADD CONSTRAINT eg_enc_symmetric_keys_pkey PRIMARY KEY (id);


--
-- Name: eg_role eg_role_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_role
    ADD CONSTRAINT eg_role_pk PRIMARY KEY (id, tenantid);


--
-- Name: eg_roleaction eg_roleaction_ukey_tenantid; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_roleaction
    ADD CONSTRAINT eg_roleaction_ukey_tenantid PRIMARY KEY (rolecode, actionid, tenantid);


--
-- Name: eg_role eg_roles_code_tenant; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_role
    ADD CONSTRAINT eg_roles_code_tenant UNIQUE (code, tenantid);


--
-- Name: eg_ms_role eg_roles_role_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_ms_role
    ADD CONSTRAINT eg_roles_role_name_key UNIQUE (name);


--
-- Name: service eg_service_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service
    ADD CONSTRAINT eg_service_pkey PRIMARY KEY (id, tenantid);


--
-- Name: service eg_service_ukey_tenantid; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service
    ADD CONSTRAINT eg_service_ukey_tenantid UNIQUE (name, tenantid);


--
-- Name: eg_url_shortener eg_url_shortener_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_url_shortener
    ADD CONSTRAINT eg_url_shortener_pkey PRIMARY KEY (id);


--
-- Name: eg_user_address eg_user_address_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_user_address
    ADD CONSTRAINT eg_user_address_pkey PRIMARY KEY (id);


--
-- Name: eg_user_address eg_user_address_type_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_user_address
    ADD CONSTRAINT eg_user_address_type_unique UNIQUE (userid, tenantid, type);


--
-- Name: eg_user eg_user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_user
    ADD CONSTRAINT eg_user_pkey PRIMARY KEY (id, tenantid);


--
-- Name: eg_user eg_user_user_name_tenant; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_user
    ADD CONSTRAINT eg_user_user_name_tenant UNIQUE (username, type, tenantid);


--
-- Name: egov_idgen_schema_version egov_idgen_schema_version_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.egov_idgen_schema_version
    ADD CONSTRAINT egov_idgen_schema_version_pk PRIMARY KEY (installed_rank);


--
-- Name: egov_localization_schema_version egov_localization_schema_version_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.egov_localization_schema_version
    ADD CONSTRAINT egov_localization_schema_version_pk PRIMARY KEY (installed_rank);


--
-- Name: egov_url_shortening_schema_version egov_url_shortening_schema_version_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.egov_url_shortening_schema_version
    ADD CONSTRAINT egov_url_shortening_schema_version_pk PRIMARY KEY (installed_rank);


--
-- Name: egov_user_schema_version egov_user_schema_version_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.egov_user_schema_version
    ADD CONSTRAINT egov_user_schema_version_pk PRIMARY KEY (installed_rank);


--
-- Name: enc_schema_version enc_schema_version_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enc_schema_version
    ADD CONSTRAINT enc_schema_version_pk PRIMARY KEY (installed_rank);


--
-- Name: filestore_schema_version filestore_schema_version_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.filestore_schema_version
    ADD CONSTRAINT filestore_schema_version_pk PRIMARY KEY (installed_rank);


--
-- Name: hrms_schema_version hrms_schema_version_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_schema_version
    ADD CONSTRAINT hrms_schema_version_pk PRIMARY KEY (installed_rank);


--
-- Name: mdms_schema_version mdms_schema_version_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mdms_schema_version
    ADD CONSTRAINT mdms_schema_version_pk PRIMARY KEY (installed_rank);


--
-- Name: message message_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message
    ADD CONSTRAINT message_pkey PRIMARY KEY (id);


--
-- Name: pgr_services_schema pgr_services_schema_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pgr_services_schema
    ADD CONSTRAINT pgr_services_schema_pk PRIMARY KEY (installed_rank);


--
-- Name: boundary_hierarchy pk_boundary_hierarchy; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boundary_hierarchy
    ADD CONSTRAINT pk_boundary_hierarchy PRIMARY KEY (id);


--
-- Name: boundary_relationship pk_boundary_relationship; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boundary_relationship
    ADD CONSTRAINT pk_boundary_relationship PRIMARY KEY (tenantid, code, hierarchytype);


--
-- Name: eg_mdms_data pk_eg_mdms_data; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_mdms_data
    ADD CONSTRAINT pk_eg_mdms_data PRIMARY KEY (tenantid, schemacode, uniqueidentifier);


--
-- Name: eg_pgr_address_v2 pk_eg_pgr_address_v2; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_pgr_address_v2
    ADD CONSTRAINT pk_eg_pgr_address_v2 PRIMARY KEY (id);


--
-- Name: eg_pgr_service_v2 pk_eg_pgr_servicereq_v2; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_pgr_service_v2
    ADD CONSTRAINT pk_eg_pgr_servicereq_v2 PRIMARY KEY (tenantid, servicerequestid);


--
-- Name: eg_mdms_schema_definition pk_eg_schema_definition; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_mdms_schema_definition
    ADD CONSTRAINT pk_eg_schema_definition PRIMARY KEY (tenantid, code);


--
-- Name: eg_wf_businessservice_v2 pk_eg_wf_businessservice; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_wf_businessservice_v2
    ADD CONSTRAINT pk_eg_wf_businessservice PRIMARY KEY (uuid);


--
-- Name: eg_wf_state_v2 pk_eg_wf_state_v2; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_wf_state_v2
    ADD CONSTRAINT pk_eg_wf_state_v2 PRIMARY KEY (uuid);


--
-- Name: eg_hrms_assignment pk_eghrms_assignment; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_hrms_assignment
    ADD CONSTRAINT pk_eghrms_assignment PRIMARY KEY (uuid);


--
-- Name: eg_hrms_deactivationdetails pk_eghrms_deactivationdetails; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_hrms_deactivationdetails
    ADD CONSTRAINT pk_eghrms_deactivationdetails PRIMARY KEY (uuid);


--
-- Name: eg_hrms_departmentaltests pk_eghrms_departmentaltests; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_hrms_departmentaltests
    ADD CONSTRAINT pk_eghrms_departmentaltests PRIMARY KEY (uuid);


--
-- Name: eg_hrms_educationaldetails pk_eghrms_educationaldetails; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_hrms_educationaldetails
    ADD CONSTRAINT pk_eghrms_educationaldetails PRIMARY KEY (uuid);


--
-- Name: eg_hrms_empdocuments pk_eghrms_empdocuments; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_hrms_empdocuments
    ADD CONSTRAINT pk_eghrms_empdocuments PRIMARY KEY (uuid);


--
-- Name: eg_hrms_employee pk_eghrms_employee; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_hrms_employee
    ADD CONSTRAINT pk_eghrms_employee PRIMARY KEY (uuid);


--
-- Name: eg_hrms_jurisdiction pk_eghrms_jurisdiction; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_hrms_jurisdiction
    ADD CONSTRAINT pk_eghrms_jurisdiction PRIMARY KEY (uuid);


--
-- Name: eg_hrms_reactivationdetails pk_eghrms_reactivationdetails; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_hrms_reactivationdetails
    ADD CONSTRAINT pk_eghrms_reactivationdetails PRIMARY KEY (uuid);


--
-- Name: eg_hrms_servicehistory pk_eghrms_servicehistory; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_hrms_servicehistory
    ADD CONSTRAINT pk_eghrms_servicehistory PRIMARY KEY (uuid);


--
-- Name: eg_filestoremap pk_filestoremap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_filestoremap
    ADD CONSTRAINT pk_filestoremap PRIMARY KEY (id);


--
-- Name: id_generator pk_id_generator; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.id_generator
    ADD CONSTRAINT pk_id_generator PRIMARY KEY (idname, tenantid);


--
-- Name: boundary_hierarchy uk_boundary_hierarchy; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boundary_hierarchy
    ADD CONSTRAINT uk_boundary_hierarchy UNIQUE (tenantid, hierarchytype);


--
-- Name: boundary_relationship uk_boundary_relationship; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boundary_relationship
    ADD CONSTRAINT uk_boundary_relationship UNIQUE (id);


--
-- Name: eg_mdms_data uk_eg_mdms_data; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_mdms_data
    ADD CONSTRAINT uk_eg_mdms_data UNIQUE (id);


--
-- Name: eg_pgr_service_v2 uk_eg_pgr_service_v2; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_pgr_service_v2
    ADD CONSTRAINT uk_eg_pgr_service_v2 UNIQUE (id);


--
-- Name: eg_wf_action_v2 uk_eg_wf_action; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_wf_action_v2
    ADD CONSTRAINT uk_eg_wf_action PRIMARY KEY (uuid);


--
-- Name: eg_wf_businessservice_v2 uk_eg_wf_businessservice; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_wf_businessservice_v2
    ADD CONSTRAINT uk_eg_wf_businessservice UNIQUE (tenantid, businessservice);


--
-- Name: eg_wf_document_v2 uk_eg_wf_document; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_wf_document_v2
    ADD CONSTRAINT uk_eg_wf_document PRIMARY KEY (id);


--
-- Name: eg_wf_processinstance_v2 uk_eg_wf_processinstance; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_wf_processinstance_v2
    ADD CONSTRAINT uk_eg_wf_processinstance UNIQUE (id);


--
-- Name: eg_wf_state_v2 uk_eg_wf_state_v2; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_wf_state_v2
    ADD CONSTRAINT uk_eg_wf_state_v2 UNIQUE (state, businessserviceid);


--
-- Name: eg_hrms_employee uk_eghrms_employee_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_hrms_employee
    ADD CONSTRAINT uk_eghrms_employee_code UNIQUE (code, tenantid);


--
-- Name: eg_filestoremap uk_filestoremap_filestoreid; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_filestoremap
    ADD CONSTRAINT uk_filestoremap_filestoreid UNIQUE (filestoreid);


--
-- Name: eg_filestoremap uk_filestoremap_fsid_tenant; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_filestoremap
    ADD CONSTRAINT uk_filestoremap_fsid_tenant UNIQUE (filestoreid, tenantid);


--
-- Name: boundary unique_code_tenantid; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boundary
    ADD CONSTRAINT unique_code_tenantid UNIQUE (code, tenantid);


--
-- Name: message unique_message_entry; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message
    ADD CONSTRAINT unique_message_entry UNIQUE (tenantid, locale, module, code);


--
-- Name: workflow_schema_version workflow_schema_version_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_schema_version
    ADD CONSTRAINT workflow_schema_version_pk PRIMARY KEY (installed_rank);


--
-- Name: accesscontrol_schema_version_s_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accesscontrol_schema_version_s_idx ON public.accesscontrol_schema_version USING btree (success);


--
-- Name: active_tenant_asymmetric_keys; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX active_tenant_asymmetric_keys ON public.eg_enc_asymmetric_keys USING btree (tenant_id) WHERE (active IS TRUE);


--
-- Name: active_tenant_symmetric_keys; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX active_tenant_symmetric_keys ON public.eg_enc_symmetric_keys USING btree (tenant_id) WHERE (active IS TRUE);


--
-- Name: boundary_schema_version_s_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boundary_schema_version_s_idx ON public.boundary_schema_version USING btree (success);


--
-- Name: code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX code_idx ON public.eg_hrms_employee USING btree (code);


--
-- Name: dept_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dept_idx ON public.eg_hrms_assignment USING btree (department);


--
-- Name: desg_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX desg_idx ON public.eg_hrms_assignment USING btree (designation);


--
-- Name: eg_asymmetric_key_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX eg_asymmetric_key_id ON public.eg_enc_asymmetric_keys USING btree (key_id);


--
-- Name: eg_symmetric_key_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX eg_symmetric_key_id ON public.eg_enc_symmetric_keys USING btree (key_id);


--
-- Name: egov_idgen_schema_version_s_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX egov_idgen_schema_version_s_idx ON public.egov_idgen_schema_version USING btree (success);


--
-- Name: egov_localization_schema_version_s_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX egov_localization_schema_version_s_idx ON public.egov_localization_schema_version USING btree (success);


--
-- Name: egov_url_shortening_schema_version_s_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX egov_url_shortening_schema_version_s_idx ON public.egov_url_shortening_schema_version USING btree (success);


--
-- Name: egov_user_schema_version_s_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX egov_user_schema_version_s_idx ON public.egov_user_schema_version USING btree (success);


--
-- Name: enc_schema_version_s_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX enc_schema_version_s_idx ON public.enc_schema_version USING btree (success);


--
-- Name: filestore_schema_version_s_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX filestore_schema_version_s_idx ON public.filestore_schema_version USING btree (success);


--
-- Name: hrms_schema_version_s_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hrms_schema_version_s_idx ON public.hrms_schema_version USING btree (success);


--
-- Name: idx_bm_gen_template_tenant_hierarchy; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bm_gen_template_tenant_hierarchy ON public.eg_bm_generated_template USING btree (tenantid, hierarchytype);


--
-- Name: idx_bm_proc_template_tenant_hierarchy; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bm_proc_template_tenant_hierarchy ON public.eg_bm_processed_template USING btree (tenantid, hierarchytype);


--
-- Name: idx_boundary_hierarchy_tenantid_hierarchytype; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_boundary_hierarchy_tenantid_hierarchytype ON public.boundary_hierarchy USING btree (tenantid, hierarchytype);


--
-- Name: idx_boundary_tenantid_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_boundary_tenantid_code ON public.boundary USING btree (tenantid, code);


--
-- Name: idx_eg_hrms_employee_tenantid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eg_hrms_employee_tenantid ON public.eg_hrms_employee USING btree (tenantid);


--
-- Name: idx_eg_role_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eg_role_code ON public.eg_role USING btree (code);


--
-- Name: idx_eg_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eg_user_active ON public.eg_user USING btree (active);


--
-- Name: idx_eg_user_address_tenantid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eg_user_address_tenantid ON public.eg_user_address USING btree (tenantid);


--
-- Name: idx_eg_user_failed_attempts_user_attemptdate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eg_user_failed_attempts_user_attemptdate ON public.eg_user_login_failed_attempts USING btree (attempt_date);


--
-- Name: idx_eg_user_failed_attempts_user_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eg_user_failed_attempts_user_uuid ON public.eg_user_login_failed_attempts USING btree (user_uuid);


--
-- Name: idx_eg_user_mobile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eg_user_mobile ON public.eg_user USING btree (mobilenumber);


--
-- Name: idx_eg_user_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eg_user_name ON public.eg_user USING btree (name);


--
-- Name: idx_eg_user_tenantid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eg_user_tenantid ON public.eg_user USING btree (tenantid);


--
-- Name: idx_eg_user_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eg_user_type ON public.eg_user USING btree (type);


--
-- Name: idx_eg_user_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eg_user_username ON public.eg_user USING btree (username);


--
-- Name: idx_eg_user_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eg_user_uuid ON public.eg_user USING btree (uuid);


--
-- Name: idx_eg_userrole_v1_rolecode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eg_userrole_v1_rolecode ON public.eg_userrole_v1 USING btree (role_code);


--
-- Name: idx_eg_userrole_v1_roletenantid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eg_userrole_v1_roletenantid ON public.eg_userrole_v1 USING btree (role_tenantid);


--
-- Name: idx_eg_userrole_v1_userid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eg_userrole_v1_userid ON public.eg_userrole_v1 USING btree (user_id);


--
-- Name: idx_eg_userrole_v1_usertenantid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eg_userrole_v1_usertenantid ON public.eg_userrole_v1 USING btree (user_tenantid);


--
-- Name: idx_eg_wf_assignee_v2_assignee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eg_wf_assignee_v2_assignee ON public.eg_wf_assignee_v2 USING btree (tenantid, assignee);


--
-- Name: idx_pi_wf_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pi_wf_action ON public.eg_wf_action_v2 USING btree (action);


--
-- Name: idx_pi_wf_businessservice_v2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pi_wf_businessservice_v2 ON public.eg_wf_businessservice_v2 USING btree (businessservice);


--
-- Name: idx_pi_wf_processinstance_v2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pi_wf_processinstance_v2 ON public.eg_wf_processinstance_v2 USING btree (businessid, lastmodifiedtime);


--
-- Name: idx_pi_wf_state_v2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pi_wf_state_v2 ON public.eg_wf_state_v2 USING btree (state);


--
-- Name: idx_processinstanceid_eg_wf_assignee_v2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_processinstanceid_eg_wf_assignee_v2 ON public.eg_wf_assignee_v2 USING btree (processinstanceid);


--
-- Name: idx_tenant_status_eg_wf_processinstance_v2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_status_eg_wf_processinstance_v2 ON public.eg_wf_processinstance_v2 USING btree (((((tenantid)::text || ':'::text) || (status)::text)));


--
-- Name: index_eg_pgr_address_v2_locality; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_eg_pgr_address_v2_locality ON public.eg_pgr_address_v2 USING btree (locality);


--
-- Name: index_eg_pgr_service_v2_accountid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_eg_pgr_service_v2_accountid ON public.eg_pgr_service_v2 USING btree (accountid);


--
-- Name: index_eg_pgr_service_v2_applicationstatus; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_eg_pgr_service_v2_applicationstatus ON public.eg_pgr_service_v2 USING btree (applicationstatus);


--
-- Name: index_eg_pgr_service_v2_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_eg_pgr_service_v2_id ON public.eg_pgr_service_v2 USING btree (id);


--
-- Name: index_eg_pgr_service_v2_servicecode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_eg_pgr_service_v2_servicecode ON public.eg_pgr_service_v2 USING btree (servicecode);


--
-- Name: index_eg_pgr_service_v2_tenantid_servicerequestid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_eg_pgr_service_v2_tenantid_servicerequestid ON public.eg_pgr_service_v2 USING btree (tenantid, servicerequestid);


--
-- Name: mdms_schema_version_s_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mdms_schema_version_s_idx ON public.mdms_schema_version USING btree (success);


--
-- Name: message_locale_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX message_locale_tenant ON public.message USING btree (locale, tenantid);


--
-- Name: pgr_services_schema_s_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pgr_services_schema_s_idx ON public.pgr_services_schema USING btree (success);


--
-- Name: posn_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX posn_idx ON public.eg_hrms_assignment USING btree ("position");


--
-- Name: reactivation_employeeid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reactivation_employeeid_idx ON public.eg_hrms_reactivationdetails USING btree (employeeid);


--
-- Name: workflow_schema_version_s_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_schema_version_s_idx ON public.workflow_schema_version USING btree (success);


--
-- Name: eg_user_address eg_user_address_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_user_address
    ADD CONSTRAINT eg_user_address_user_fkey FOREIGN KEY (userid, tenantid) REFERENCES public.eg_user(id, tenantid) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: eg_userrole eg_userrole_roleid_roleidtenantid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_userrole
    ADD CONSTRAINT eg_userrole_roleid_roleidtenantid_fkey FOREIGN KEY (roleid, roleidtenantid) REFERENCES public.eg_role(id, tenantid);


--
-- Name: eg_userrole eg_userrole_userid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_userrole
    ADD CONSTRAINT eg_userrole_userid_fkey FOREIGN KEY (userid, tenantid) REFERENCES public.eg_user(id, tenantid) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: eg_pgr_address_v2 fk_eg_pgr_address_v2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_pgr_address_v2
    ADD CONSTRAINT fk_eg_pgr_address_v2 FOREIGN KEY (parentid) REFERENCES public.eg_pgr_service_v2(id);


--
-- Name: eg_wf_action_v2 fk_eg_wf_action_v2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_wf_action_v2
    ADD CONSTRAINT fk_eg_wf_action_v2 FOREIGN KEY (currentstate) REFERENCES public.eg_wf_state_v2(uuid);


--
-- Name: eg_wf_assignee_v2 fk_eg_wf_assignee_v2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_wf_assignee_v2
    ADD CONSTRAINT fk_eg_wf_assignee_v2 FOREIGN KEY (processinstanceid) REFERENCES public.eg_wf_processinstance_v2(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: eg_wf_document_v2 fk_eg_wf_document; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_wf_document_v2
    ADD CONSTRAINT fk_eg_wf_document FOREIGN KEY (processinstanceid) REFERENCES public.eg_wf_processinstance_v2(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: eg_wf_state_v2 fk_eg_wf_state; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_wf_state_v2
    ADD CONSTRAINT fk_eg_wf_state FOREIGN KEY (businessserviceid) REFERENCES public.eg_wf_businessservice_v2(uuid) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: eg_hrms_assignment fk_eghrms_assignment_employeeid; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_hrms_assignment
    ADD CONSTRAINT fk_eghrms_assignment_employeeid FOREIGN KEY (employeeid) REFERENCES public.eg_hrms_employee(uuid) ON DELETE CASCADE;


--
-- Name: eg_hrms_deactivationdetails fk_eghrms_deactivationdetails_employeeid; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_hrms_deactivationdetails
    ADD CONSTRAINT fk_eghrms_deactivationdetails_employeeid FOREIGN KEY (employeeid) REFERENCES public.eg_hrms_employee(uuid) ON DELETE CASCADE;


--
-- Name: eg_hrms_departmentaltests fk_eghrms_departmentaltests_employeeid; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_hrms_departmentaltests
    ADD CONSTRAINT fk_eghrms_departmentaltests_employeeid FOREIGN KEY (employeeid) REFERENCES public.eg_hrms_employee(uuid) ON DELETE CASCADE;


--
-- Name: eg_hrms_educationaldetails fk_eghrms_educationaldetails_employeeid; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_hrms_educationaldetails
    ADD CONSTRAINT fk_eghrms_educationaldetails_employeeid FOREIGN KEY (employeeid) REFERENCES public.eg_hrms_employee(uuid) ON DELETE CASCADE;


--
-- Name: eg_hrms_empdocuments fk_eghrms_empdocuments_employeeid; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_hrms_empdocuments
    ADD CONSTRAINT fk_eghrms_empdocuments_employeeid FOREIGN KEY (employeeid) REFERENCES public.eg_hrms_employee(uuid) ON DELETE CASCADE;


--
-- Name: eg_hrms_jurisdiction fk_eghrms_jurisdiction_employeeid; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_hrms_jurisdiction
    ADD CONSTRAINT fk_eghrms_jurisdiction_employeeid FOREIGN KEY (employeeid) REFERENCES public.eg_hrms_employee(uuid) ON DELETE CASCADE;


--
-- Name: eg_hrms_reactivationdetails fk_eghrms_reactivationdetails_employeeid; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_hrms_reactivationdetails
    ADD CONSTRAINT fk_eghrms_reactivationdetails_employeeid FOREIGN KEY (employeeid) REFERENCES public.eg_hrms_employee(uuid) ON DELETE CASCADE;


--
-- Name: eg_hrms_servicehistory fk_eghrms_servicehistory_employeeid; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_hrms_servicehistory
    ADD CONSTRAINT fk_eghrms_servicehistory_employeeid FOREIGN KEY (employeeid) REFERENCES public.eg_hrms_employee(uuid) ON DELETE CASCADE;


--
-- Name: eg_userrole_v1 fk_user_role_v1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_userrole_v1
    ADD CONSTRAINT fk_user_role_v1 FOREIGN KEY (user_id, user_tenantid) REFERENCES public.eg_user(id, tenantid);


--
-- Name: eg_token; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eg_token (
    id character(36) NOT NULL,
    tenantid character varying(256) NOT NULL,
    tokennumber character varying(128) NOT NULL,
    tokenidentity character varying(100) NOT NULL,
    validated character(1) DEFAULT 'N'::bpchar NOT NULL,
    ttlsecs bigint NOT NULL,
    createddate timestamp without time zone NOT NULL,
    lastmodifieddate timestamp without time zone,
    createdby bigint NOT NULL,
    lastmodifiedby bigint,
    version bigint,
    createddatenew bigint
);


--
-- Name: eg_token eg_token_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eg_token
    ADD CONSTRAINT eg_token_pkey PRIMARY KEY (id);


--
-- Name: idx_token_number_identity_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_token_number_identity_tenant ON public.eg_token USING btree (tokennumber, tokenidentity, tenantid);


--
-- PostgreSQL database dump complete
--

\unrestrict XCN8W99QyqbCXmfs0qAeFgB8W0g9mhulyxVgFl6MmobAdASkh4xR96gpgnjnR3i

