-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Custom SVG Shapes
-- ═══════════════════════════════════════════════════════════════
-- Allows admins to add custom SVG shapes via UI without code changes
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS custom_svg_shapes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shape_name      VARCHAR(50) UNIQUE NOT NULL,
    display_name    VARCHAR(100),
    svg_code        TEXT NOT NULL,
    default_color   VARCHAR(7) DEFAULT '#8B5CF6',
    category        VARCHAR(50),
    tags            JSONB DEFAULT '[]',
    description     TEXT,
    is_active       BOOLEAN DEFAULT true,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_svg_shapes_name ON custom_svg_shapes(shape_name);

CREATE INDEX IF NOT EXISTS idx_custom_svg_shapes_active ON custom_svg_shapes(is_active) WHERE is_active = true;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_custom_svg_shapes_updated') THEN
        CREATE TRIGGER trg_custom_svg_shapes_updated 
            BEFORE UPDATE ON custom_svg_shapes 
            FOR EACH ROW 
            EXECUTE FUNCTION update_updated_at();
    END IF;
END $$;

INSERT INTO custom_svg_shapes (shape_name, display_name, svg_code, default_color, category, description) 
SELECT 'hexagram', 'Six-Pointed Star', '<polygon points="50,15 65,40 90,40 70,55 80,80 50,65 20,80 30,55 10,40 35,40" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />', '#8B5CF6', 'geometric', 'Six-pointed star shape'
WHERE NOT EXISTS (SELECT 1 FROM custom_svg_shapes WHERE shape_name = 'hexagram');

INSERT INTO custom_svg_shapes (shape_name, display_name, svg_code, default_color, category, description) 
SELECT 'octastar', 'Eight-Pointed Star', '<polygon points="50,5 60,35 90,35 65,55 75,85 50,65 25,85 35,55 10,35 40,35" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />', '#A855F7', 'geometric', 'Eight-pointed star shape'
WHERE NOT EXISTS (SELECT 1 FROM custom_svg_shapes WHERE shape_name = 'octastar');
