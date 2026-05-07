-- Create id_generator table and seed data for egov-idgen service
-- Flyway is disabled for egov-idgen, so this seed creates everything needed

BEGIN;

-- Create the main table
CREATE TABLE IF NOT EXISTS id_generator (
    id BIGSERIAL PRIMARY KEY,
    idname VARCHAR(256) NOT NULL,
    tenantid VARCHAR(256) NOT NULL,
    format VARCHAR(256),
    sequencenumber BIGINT DEFAULT 1,
    CONSTRAINT uk_id_generator UNIQUE (idname, tenantid)
);

-- Create sequences that may be referenced by id formats
CREATE SEQUENCE IF NOT EXISTS seq_swm_trn_num START 1;
CREATE SEQUENCE IF NOT EXISTS seq_eg_pt_ptid START 1;
CREATE SEQUENCE IF NOT EXISTS seq_eg_tl_apl START 1;
CREATE SEQUENCE IF NOT EXISTS seq_eg_pg_rcpt START 1;
CREATE SEQUENCE IF NOT EXISTS seq_eg_bs_apl START 1;
CREATE SEQUENCE IF NOT EXISTS seq_egf_bill_dft_num START 1;
CREATE SEQUENCE IF NOT EXISTS seq_eg_pgr_complaint START 1;
CREATE SEQUENCE IF NOT EXISTS seq_eg_ws_connection START 1;
CREATE SEQUENCE IF NOT EXISTS seq_eg_sw_connection START 1;
CREATE SEQUENCE IF NOT EXISTS seq_eg_pt_assessment START 1;
CREATE SEQUENCE IF NOT EXISTS seq_eg_fn_firenoc START 1;
CREATE SEQUENCE IF NOT EXISTS seq_eg_bpa_application START 1;

-- Insert seed data for id_generator
-- Using ON CONFLICT to handle re-runs safely

INSERT INTO id_generator (idname, tenantid, format, sequencenumber)
VALUES
  ('egf.bill.default.number.format.name', 'default', 'MH-BILL-NUM-[SEQ_EGF_BILL_DFT_NUM]', 1),
  ('swm.transaction.num', 'default', 'SWM-TRN-[SEQ_SWM_TRN_NUM]', 1),
  ('pgr.complaint.id', 'pg', 'PGR-[cy:yyyy-MM-dd]-[SEQ_EG_PGR_COMPLAINT]', 1),
  ('pgr.complaint.id', 'pg.citya', 'PGR-[cy:yyyy-MM-dd]-[SEQ_EG_PGR_COMPLAINT]', 1),
  ('ws.connection.id', 'pg', 'WS/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EG_WS_CONNECTION]', 1),
  ('sw.connection.id', 'pg', 'SW/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EG_SW_CONNECTION]', 1),
  ('pt.propertyid', 'pg', 'PB-PT-[cy:yyyy-MM-dd]-[SEQ_EG_PT_PTID]', 1),
  ('pt.assessmentnumber', 'pg', 'AS/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EG_PT_ASSESSMENT]', 1),
  ('tl.aplnumber', 'pg', 'PB-TL-[cy:yyyy-MM-dd]-[SEQ_EG_TL_APL]', 1),
  ('firenoc.id', 'pg', 'PB-FN-[cy:yyyy-MM-dd]-[SEQ_EG_FN_FIRENOC]', 1),
  ('bpa.id', 'pg', 'PB-BP-[cy:yyyy-MM-dd]-[SEQ_EG_BPA_APPLICATION]', 1)
ON CONFLICT (idname, tenantid) DO NOTHING;

COMMIT;
