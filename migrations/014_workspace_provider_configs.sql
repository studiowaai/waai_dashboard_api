-- Migration: Workspace-level integration provider configs
-- Description: Allows workspace admins to configure their own app credentials
--              (e.g. Shopify client_id/secret) per integration provider.
-- Date: 2026-03-17

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- 1. Per-workspace provider configuration
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS workspace_provider_configs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider_id   TEXT NOT NULL REFERENCES integration_providers(id),
    config        JSONB NOT NULL DEFAULT '{}',
    configured_by UUID REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(workspace_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_wpc_workspace ON workspace_provider_configs(workspace_id);

CREATE TRIGGER update_wpc_updated_at BEFORE UPDATE ON workspace_provider_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ══════════════════════════════════════════════════════════════
-- 2. Add description + icon columns to integration_providers
-- ══════════════════════════════════════════════════════════════
ALTER TABLE integration_providers
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS icon        TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS website     TEXT NOT NULL DEFAULT '';

-- ══════════════════════════════════════════════════════════════
-- 3. Update existing providers + seed new ones (re:amaze-style catalog)
-- ══════════════════════════════════════════════════════════════
UPDATE integration_providers SET
  description = 'Lees en verstuur e-mails vanuit je zakelijke Gmail-account.',
  icon = 'mail',
  website = 'https://mail.google.com'
WHERE id = 'gmail';

UPDATE integration_providers SET
  description = 'Zoek bestellingen en klantgegevens op vanuit je Shopify-winkel.',
  icon = 'shopping-bag',
  website = 'https://www.shopify.com',
  auth_type = 'api_key',
  config = '{"scopes": ["read_orders", "read_customers", "read_products"], "fields": [{"key": "shop_domain", "label": "Shop domein", "type": "text", "required": true, "placeholder": "jouw-winkel.myshopify.com"}, {"key": "access_token", "label": "Admin API Toegangstoken", "type": "password", "required": true, "placeholder": "shpat_..."}]}'
WHERE id = 'shopify';

-- New providers (not yet functional — shown as "binnenkort beschikbaar")
INSERT INTO integration_providers (id, name, category, auth_type, config, description, icon, website, is_active) VALUES
  ('slack',      'Slack',         'messaging', 'oauth2',  '{"scopes": ["channels:read","chat:write"], "fields": []}',     'Ontvang meldingen en stuur berichten naar Slack-kanalen.',                   'message-square', 'https://slack.com',                true),
  ('whatsapp',   'WhatsApp Business', 'messaging', 'api_key', '{"fields": [{"key": "phone_number_id", "label": "Telefoonnummer ID", "type": "text", "required": true}, {"key": "access_token", "label": "Access Token", "type": "password", "required": true}]}', 'Ontvang en beantwoord WhatsApp-berichten van klanten.', 'phone', 'https://business.whatsapp.com', true),
  ('woocommerce','WooCommerce',   'ecommerce', 'api_key', '{"fields": [{"key": "store_url", "label": "Winkel URL", "type": "text", "required": true, "placeholder": "https://jouwwinkel.nl"}, {"key": "consumer_key", "label": "Consumer Key", "type": "text", "required": true}, {"key": "consumer_secret", "label": "Consumer Secret", "type": "password", "required": true}]}', 'Zoek bestellingen en klantgegevens op vanuit je WooCommerce-winkel.', 'shopping-cart', 'https://woocommerce.com', true),
  ('notion',     'Notion',        'productivity', 'oauth2', '{"scopes": ["read_content"], "fields": []}', 'Synchroniseer kennisbank-artikelen vanuit Notion.',                          'book-open',       'https://www.notion.so',            true),
  ('hubspot',    'HubSpot',       'crm',       'oauth2',  '{"scopes": ["crm.objects.contacts.read"], "fields": []}', 'Synchroniseer contacten en deals vanuit HubSpot CRM.',                     'users',           'https://www.hubspot.com',          true)
ON CONFLICT (id) DO NOTHING;

COMMIT;
