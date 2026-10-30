-- Biaya tambahan per ad account (Pengaturan › Sinkronisasi Meta Ads), dalam persen dari spend.
-- tax_pct = pajak iklan (mis. PPN 11%), admin_pct = biaya admin / top-up (mis. agensi 2%). NULL = belum diisi.
ALTER TABLE ad_accounts ADD COLUMN tax_pct REAL;
ALTER TABLE ad_accounts ADD COLUMN admin_pct REAL;
