const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticate, requireRole } = require('../middleware/auth');
const { pool } = require('../config/database');

// ── Paths ──────────────────────────────────────────────────────────────────────
const BE_PUBLIC      = path.join(__dirname, '../../public');
const FE_PUBLIC      = path.join(__dirname, '../../../cognimap-fe-main/public');
const MANIFEST_PATH  = path.join(FE_PUBLIC, 'sprites/shapes-manifest.json');
const CUSTOM_SPRITES = path.join(FE_PUBLIC, 'sprites/custom');
const CUSTOM_DIR     = path.join(BE_PUBLIC, 'custom');

// Ensure custom sprites directory exists
if (!fs.existsSync(CUSTOM_SPRITES)) fs.mkdirSync(CUSTOM_SPRITES, { recursive: true });

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Read and parse the sprite manifest, returning a mutable copy */
function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return { version: 1, sheets: {}, tokens: {} };
  }
}

/** Write manifest back to disk (pretty-printed) */
function writeManifest(manifest) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
}

// ── Multer: legacy sprite uploads (→ /public/) ─────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, FE_PUBLIC),
  filename: (req, file, cb) => {
    const filename = file.originalname.toLowerCase().replace(/\s+/g, '-');
    cb(null, filename);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

// ── Multer: custom shape sprites (→ /public/sprites/custom/) ──────────────────
const customSpriteStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, CUSTOM_SPRITES),
  filename: (req, file, cb) => {
    // Use the tokenName from req.body if available; fall back to original name
    // Use + quantifier so consecutive non-alphanumeric chars collapse to a single _
    const base = (req.body && req.body.tokenName)
      ? req.body.tokenName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
      : path.parse(file.originalname.toLowerCase()).name.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    cb(null, `${base}.png`);
  }
});

const customSpriteUpload = multer({
  storage: customSpriteStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png' || file.mimetype === 'image/jpeg' || file.mimetype === 'image/webp')
      cb(null, true);
    else cb(new Error('Only PNG/JPEG/WebP images are allowed'));
  }
});

// ── POST /api/tokens/upload-sprite ── Upload PNG sprite
router.post('/upload-sprite', authenticate, requireRole('super_admin', 'psychologist'), upload.single('sprite'), async (req, res) => {
  try {
    console.log("upload-sprite")
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filename = req.file.filename;
    const name = path.parse(filename).name; // Remove extension

    await req.audit('token.sprite_upload', 'token', null, {
      description: `Uploaded sprite: ${filename}`,
      filename,
      size: req.file.size
    });

    res.json({
      success: true,
      filename,
      name,
      path: `/public/${filename}`,
      size: req.file.size,
      usage: `img_sprite_${name}_5`
    });
  } catch (err) {
    console.error('Sprite upload error:', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// ── GET /api/tokens/sprites ── List all sprite files
router.get('/sprites', authenticate, async (req, res) => {
  try {
    const publicPath = path.join(__dirname, '../../../cognimap-fe-main/public');
    const files = fs.readdirSync(publicPath);
    
    // Filter for image files only
    const sprites = files
      .filter(f => /\.(png|jpg|jpeg|gif|svg)$/i.test(f))
      .map(f => ({
        filename: f,
        name: path.parse(f).name,
        usage: `img_sprite_${path.parse(f).name}_5`
      }));

    res.json({ sprites });
  } catch (err) {
    console.error('List sprites error:', err);
    res.status(500).json({ error: 'Failed to list sprites' });
  }
});

// ── DELETE /api/tokens/sprite/:filename ── Delete sprite file
router.delete('/sprite/:filename', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const filename = req.params.filename;
    const publicPath = path.join(__dirname, '../../../cognimap-fe-main/public');
    const filePath = path.join(publicPath, filename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Delete file
    fs.unlinkSync(filePath);

    await req.audit('token.sprite_delete', 'token', null, {
      description: `Deleted sprite: ${filename}`,
      filename
    });

    res.json({ success: true, message: 'Sprite deleted' });
  } catch (err) {
    console.error('Delete sprite error:', err);
    res.status(500).json({ error: 'Failed to delete sprite' });
  }
});

// ═══════════════════════════════════════════════════════════════
// CUSTOM SPRITE SHAPES  (individual PNG files + manifest entries)
// ═══════════════════════════════════════════════════════════════

// ── POST /api/tokens/sprite-shape ── Upload individual PNG and register in manifest
// Body (multipart/form-data): tokenName (string), sprite (file)
router.post('/sprite-shape', authenticate, requireRole('super_admin', 'psychologist'),
  customSpriteUpload.single('sprite'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      // Use + quantifier to collapse consecutive non-alphanumeric chars into a single _
      // e.g. "Reflection: horizontal reflection" → "reflection_horizontal_reflection"
      const rawName = (req.body.tokenName || '').trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (!rawName) return res.status(400).json({ error: 'tokenName is required' });

      // Validate naming convention
      if (!/^[a-z][a-z0-9_]*$/.test(rawName)) {
        return res.status(400).json({
          error: 'tokenName must start with a letter and contain only lowercase letters, digits, and underscores'
        });
      }

      // Rename the uploaded file to match the final tokenName (multer may have used a temp name)
      const finalFilename = `${rawName}.png`;
      const finalPath     = path.join(CUSTOM_SPRITES, finalFilename);
      if (req.file.path !== finalPath) {
        fs.renameSync(req.file.path, finalPath);
      }

      // Update the manifest
      const manifest = readManifest();
      if (!manifest.tokens) manifest.tokens = {};

      if (manifest.tokens[rawName]) {
        // Overwrite — file is already replaced on disk
        manifest.tokens[rawName] = { file: `/sprites/custom/${finalFilename}` };
      } else {
        manifest.tokens[rawName] = { file: `/sprites/custom/${finalFilename}` };
      }
      writeManifest(manifest);

      await req.audit('token.sprite_shape_uploaded', 'token', null, {
        description: `Uploaded custom sprite shape: ${rawName}`,
        tokenName: rawName,
        filename: finalFilename,
        size: req.file.size
      });

      res.json({
        success: true,
        tokenName: rawName,
        filename: finalFilename,
        filePath: `/sprites/custom/${finalFilename}`,
        size: req.file.size,
        usage: rawName,
        message: `Shape "${rawName}" is now available. Use it in items as: ${rawName}`
      });
    } catch (err) {
      console.error('Sprite shape upload error:', err);
      res.status(500).json({ error: err.message || 'Upload failed' });
    }
  }
);

// ── POST /api/tokens/upload-item-image ── Upload an image to public/custom/<subfolder>/
// Used by Missing Images page to fix skipped items inline (GQ → gq_visual/, GWM → gwm_svg/, etc.)
const itemImageTmpDir = path.join(CUSTOM_DIR, '_tmp');
if (!fs.existsSync(itemImageTmpDir)) fs.mkdirSync(itemImageTmpDir, { recursive: true });
const itemImageUpload = multer({ dest: itemImageTmpDir });
router.post('/upload-item-image', authenticate, requireRole('super_admin', 'psychologist'),
  itemImageUpload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const targetPath = (req.body.targetPath || '').trim().replace(/\\/g, '/');
      if (!targetPath || targetPath.includes('..') || path.isAbsolute(targetPath)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Invalid targetPath' });
      }
      const destDir = path.join(CUSTOM_DIR, path.dirname(targetPath));
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const finalPath = path.join(CUSTOM_DIR, targetPath);
      fs.renameSync(req.file.path, finalPath);

      await req.audit('token.item_image_uploaded', 'token', null, {
        description: `Uploaded item image: ${targetPath}`,
        targetPath,
        size: req.file.size,
      });

      res.json({ success: true, path: targetPath, message: `Uploaded to custom/${targetPath}` });
    } catch (err) {
      if (req.file?.path && fs.existsSync(req.file.path)) try { fs.unlinkSync(req.file.path); } catch {}
      console.error('Item image upload error:', err);
      res.status(500).json({ error: err.message || 'Upload failed' });
    }
  }
);

// ── GET /api/tokens/folders ── List all top-level subfolders in public/custom/
router.get('/folders', authenticate, requireRole('super_admin', 'psychologist'), (req, res) => {
  try {
    if (!fs.existsSync(CUSTOM_DIR)) return res.json({ folders: [] });
    const entries = fs.readdirSync(CUSTOM_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('_'))
      .sort((a, b) => a.name.localeCompare(b.name));
    const folders = entries.map(e => {
      const dir = path.join(CUSTOM_DIR, e.name);
      const files = fs.readdirSync(dir).filter(f => /\.(svg|png|jpg|jpeg|webp)$/i.test(f));
      return { name: e.name, fileCount: files.length };
    });
    res.json({ folders });
  } catch (err) {
    console.error('List folders error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/tokens/folders ── Create a new folder
router.post('/folders', authenticate, requireRole('super_admin', 'psychologist'), (req, res) => {
  try {
    const name = (req.body.name || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
    if (!name) return res.status(400).json({ error: 'Folder name is required' });
    if (name.includes('..')) return res.status(400).json({ error: 'Invalid name' });
    const dir = path.join(CUSTOM_DIR, name);
    if (fs.existsSync(dir)) return res.status(409).json({ error: 'Folder already exists' });
    fs.mkdirSync(dir, { recursive: true });
    res.json({ success: true, name });
  } catch (err) {
    console.error('Create folder error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/tokens/folders/:name ── Rename a folder
router.put('/folders/:name', authenticate, requireRole('super_admin', 'psychologist'), (req, res) => {
  try {
    const oldName = req.params.name;
    const newName = (req.body.name || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
    if (!newName) return res.status(400).json({ error: 'New name is required' });
    if (oldName.includes('..') || newName.includes('..')) return res.status(400).json({ error: 'Invalid name' });
    const oldDir = path.join(CUSTOM_DIR, oldName);
    const newDir = path.join(CUSTOM_DIR, newName);
    if (!fs.existsSync(oldDir)) return res.status(404).json({ error: 'Folder not found' });
    if (fs.existsSync(newDir)) return res.status(409).json({ error: 'A folder with that name already exists' });
    fs.renameSync(oldDir, newDir);
    res.json({ success: true, oldName, newName });
  } catch (err) {
    console.error('Rename folder error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/tokens/folders/:name ── Delete an empty folder
router.delete('/folders/:name', authenticate, requireRole('super_admin', 'psychologist'), (req, res) => {
  try {
    const name = req.params.name;
    if (name.includes('..')) return res.status(400).json({ error: 'Invalid name' });
    const dir = path.join(CUSTOM_DIR, name);
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Folder not found' });
    const files = fs.readdirSync(dir);
    if (files.length > 0) return res.status(400).json({ error: `Folder is not empty (${files.length} files). Remove files first.` });
    fs.rmdirSync(dir);
    res.json({ success: true, name });
  } catch (err) {
    console.error('Delete folder error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/tokens/list-folder ── Browse existing images in a custom subfolder
router.get('/list-folder', authenticate, requireRole('super_admin', 'psychologist'), (req, res) => {
  try {
    console.log("inside riyteeeeeeeeeeeeeeeeeeeeeeeeeeeeeee")
    const subfolder = (req.query.folder || '').trim().replace(/\\/g, '/');
    if (subfolder.includes('..')) return res.status(400).json({ error: 'Invalid folder' });
    const dir = path.join(CUSTOM_DIR, subfolder);
    if (!fs.existsSync(dir)) return res.json({ files: [], folder: subfolder });
    const entries = fs.readdirSync(dir).filter(f => /\.(svg|png|jpg|jpeg|webp)$/i.test(f)).sort();
    const files = entries.map(name => ({
      name,
      path: subfolder ? `${subfolder}/${name}` : name,
      url: `/custom/${subfolder ? subfolder + '/' : ''}${name}`,
      size: fs.statSync(path.join(dir, name)).size,
    }));
    res.json({ files, folder: subfolder });
  } catch (err) {
    console.error('List folder error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/tokens/rename-file ── Rename an image file within a folder
router.put('/rename-file', authenticate, requireRole('super_admin', 'psychologist'), (req, res) => {
  try {
    const { folder, oldName, newName } = req.body;
    if (!folder || !oldName || !newName) return res.status(400).json({ error: 'folder, oldName, newName required' });
    if (folder.includes('..') || oldName.includes('..') || newName.includes('..')) return res.status(400).json({ error: 'Invalid path' });
    if (oldName.includes('/') || newName.includes('/')) return res.status(400).json({ error: 'Name cannot contain /' });
    const oldPath = path.join(CUSTOM_DIR, folder, oldName);
    const newPath = path.join(CUSTOM_DIR, folder, newName);
    if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'File not found' });
    if (fs.existsSync(newPath)) return res.status(409).json({ error: 'A file with that name already exists' });
    fs.renameSync(oldPath, newPath);
    res.json({ success: true, oldName, newName, folder });
  } catch (err) {
    console.error('Rename file error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/tokens/delete-file ── Delete an image file
router.delete('/delete-file', authenticate, requireRole('super_admin', 'psychologist'), (req, res) => {
  try {
    const folder = (req.query.folder || '').trim();
    const name = (req.query.name || '').trim();
    if (!folder || !name) return res.status(400).json({ error: 'folder and name required' });
    if (folder.includes('..') || name.includes('..') || name.includes('/')) return res.status(400).json({ error: 'Invalid path' });
    const filePath = path.join(CUSTOM_DIR, folder, name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    fs.unlinkSync(filePath);
    res.json({ success: true, name, folder });
  } catch (err) {
    console.error('Delete file error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/tokens/sprite-shapes ── List all custom sprite shapes from manifest
router.get('/sprite-shapes', authenticate, async (req, res) => {
  try {
    const manifest = readManifest();
    const tokens   = manifest.tokens || {};

    // Return only individual-file entries (not sheet-based entries)
    const shapes = Object.entries(tokens)
      .filter(([, entry]) => entry.file && !entry.sheet)
      .map(([name, entry]) => ({
        tokenName: name,
        file: entry.file,
        w: entry.w || 64,
        h: entry.h || 64,
      }));

    res.json({ shapes, total: shapes.length });
  } catch (err) {
    console.error('List sprite shapes error:', err);
    res.status(500).json({ error: 'Failed to list sprite shapes' });
  }
});

// ── DELETE /api/tokens/sprite-shape/:tokenName ── Remove custom sprite from manifest (and disk)
router.delete('/sprite-shape/:tokenName', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const name = req.params.tokenName.toLowerCase();
    const manifest = readManifest();
    const entry    = (manifest.tokens || {})[name];

    if (!entry) return res.status(404).json({ error: 'Shape not found in manifest' });
    if (entry.sheet) return res.status(400).json({ error: 'Cannot delete built-in sheet sprite via this endpoint' });

    // Remove from manifest
    delete manifest.tokens[name];
    writeManifest(manifest);

    // Optionally delete the file from disk
    const localPath = path.join(FE_PUBLIC, entry.file);
    if (fs.existsSync(localPath)) {
      try { fs.unlinkSync(localPath); } catch { /* non-fatal */ }
    }

    await req.audit('token.sprite_shape_deleted', 'token', null, {
      description: `Deleted custom sprite shape: ${name}`,
      tokenName: name
    });

    res.json({ success: true, message: `Shape "${name}" removed` });
  } catch (err) {
    console.error('Delete sprite shape error:', err);
    res.status(500).json({ error: 'Failed to delete sprite shape' });
  }
});

// ═══════════════════════════════════════════════════════════════
// CUSTOM SVG SHAPES
// ═══════════════════════════════════════════════════════════════

// ── POST /api/tokens/svg-shape ── Create custom SVG shape
router.post('/svg-shape', authenticate, requireRole('super_admin', 'psychologist'), async (req, res) => {
  try {
    console.log("req.bodyreq.bodyreq.body", req.body)
    const { shapeName, displayName, svgCode, defaultColor, category, description } = req.body;

    if (!shapeName || !svgCode) {
      return res.status(400).json({ error: 'shapeName and svgCode are required' });
    }

    // Validate shape name (alphanumeric, underscore, hyphen only)
    if (!/^[a-z0-9_-]+$/i.test(shapeName)) {
      return res.status(400).json({ error: 'shapeName must be alphanumeric (underscores and hyphens allowed)' });
    }

    // Check if shape name already exists
    const existing = await pool.query(
      'SELECT id FROM custom_svg_shapes WHERE shape_name = $1',
      [shapeName]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Shape name already exists' });
    }

    // Insert new shape
    const result = await pool.query(
      `INSERT INTO custom_svg_shapes 
       (shape_name, display_name, svg_code, default_color, category, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [shapeName, displayName || shapeName, svgCode, defaultColor || '#8B5CF6', category, description, req.user.id]
    );

    await req.audit('token.svg_shape_created', 'custom_svg_shape', result.rows[0].id, {
      description: `Created custom SVG shape: ${shapeName}`,
      shapeName
    });

    res.json({
      success: true,
      shape: result.rows[0],
      usage: `${shapeName}`
    });
  } catch (err) {
    console.error('Create SVG shape error:', err);
    res.status(500).json({ error: err.message || 'Failed to create shape' });
  }
});

// ── GET /api/tokens/svg-shapes ── List all custom SVG shapes
router.get('/svg-shapes', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, shape_name, display_name, svg_code, default_color, category, description, is_active, created_at
       FROM custom_svg_shapes
       WHERE is_active = true
       ORDER BY shape_name ASC`
    );

    res.json({ shapes: result.rows });
  } catch (err) {
    console.error('List SVG shapes error:', err);
    res.status(500).json({ error: 'Failed to list shapes' });
  }
});

// ── GET /api/tokens/svg-shape/:shapeName ── Get single SVG shape
router.get('/svg-shape/:shapeName', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM custom_svg_shapes WHERE shape_name = $1 AND is_active = true',
      [req.params.shapeName]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Shape not found' });
    }

    res.json({ shape: result.rows[0] });
  } catch (err) {
    console.error('Get SVG shape error:', err);
    res.status(500).json({ error: 'Failed to get shape' });
  }
});

// ── PUT /api/tokens/svg-shape/:shapeName ── Update custom SVG shape
router.put('/svg-shape/:shapeName', authenticate, requireRole('super_admin', 'psychologist'), async (req, res) => {
  try {
    const { displayName, svgCode, defaultColor, category, description } = req.body;

    const result = await pool.query(
      `UPDATE custom_svg_shapes
       SET display_name = COALESCE($1, display_name),
           svg_code = COALESCE($2, svg_code),
           default_color = COALESCE($3, default_color),
           category = COALESCE($4, category),
           description = COALESCE($5, description)
       WHERE shape_name = $6 AND is_active = true
       RETURNING *`,
      [displayName, svgCode, defaultColor, category, description, req.params.shapeName]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Shape not found' });
    }

    await req.audit('token.svg_shape_updated', 'custom_svg_shape', result.rows[0].id, {
      description: `Updated custom SVG shape: ${req.params.shapeName}`,
      shapeName: req.params.shapeName
    });

    res.json({ success: true, shape: result.rows[0] });
  } catch (err) {
    console.error('Update SVG shape error:', err);
    res.status(500).json({ error: 'Failed to update shape' });
  }
});

// ── DELETE /api/tokens/svg-shape/:shapeName ── Delete (deactivate) custom SVG shape
router.delete('/svg-shape/:shapeName', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE custom_svg_shapes SET is_active = false WHERE shape_name = $1 RETURNING id',
      [req.params.shapeName]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Shape not found' });
    }

    await req.audit('token.svg_shape_deleted', 'custom_svg_shape', result.rows[0].id, {
      description: `Deleted custom SVG shape: ${req.params.shapeName}`,
      shapeName: req.params.shapeName
    });

    res.json({ success: true, message: 'Shape deleted' });
  } catch (err) {
    console.error('Delete SVG shape error:', err);
    res.status(500).json({ error: 'Failed to delete shape' });
  }
});

// ═══════════════════════════════════════════════════════════════
// PENDING ITEMS  — items skipped during upload (unresolvable tokens)
// ═══════════════════════════════════════════════════════════════

// ── GET /api/tokens/pending-items ── List all pending items
router.get('/pending-items', authenticate, requireRole('super_admin', 'psychologist'), async (req, res) => {
  try {
    console.log("penidnggggggggggggggggggggggggggggggggggggg")
    const { status = 'pending', domain } = req.query;
    let query = `SELECT * FROM pending_items WHERE 1=1`;
    const params = [];
    if (status)  { params.push(status);  query += ` AND status = $${params.length}`; }
    if (domain)  { params.push(domain);  query += ` AND domain = $${params.length}`; }
    query += ` ORDER BY created_at DESC`;
    const result = await pool.query(query, params);
    res.json({ items: result.rows, total: result.rows.length });
  } catch (err) {
    console.error('List pending items error:', err);
    res.status(500).json({ error: 'Failed to fetch pending items' });
  }
});

// ── DELETE /api/tokens/pending-items/:id ── Remove a pending item
router.delete('/pending-items/:id', authenticate, requireRole('super_admin', 'psychologist'), async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM pending_items WHERE id = $1 RETURNING item_code`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    await req.audit('token.pending_item_deleted', 'pending_item', req.params.id, {
      description: `Deleted pending item: ${result.rows[0].item_code}`
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete pending item' });
  }
});

// ── POST /api/tokens/pending-items/retry-for-token ──
// After uploading a PNG/SVG for a token, find all pending items that had that token
// as unresolved and auto-retry them. Called by the frontend after every sprite upload.
// Body: { tokenName: "Reflection: horizontal reflection" }  (original or sanitized form)
router.post('/pending-items/retry-for-token', authenticate, requireRole('super_admin', 'psychologist'), async (req, res) => {
  try {
    const { tokenName } = req.body;
    if (!tokenName) return res.status(400).json({ error: 'tokenName is required' });

    // Build both exact and sanitized forms so we can match either way
    const tokenLower = tokenName.trim().toLowerCase();
    const tokenSanitized = tokenLower.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

    // Fetch all pending items
    const allPending = await pool.query(`SELECT * FROM pending_items WHERE status = 'pending'`);
    if (allPending.rows.length === 0) return res.json({ resolved: 0, message: 'No pending items' });

    // Filter to items that have this token in their unresolved_tokens list
    const affected = allPending.rows.filter(item => {
      const unresolved = item.unresolved_tokens || [];
      return unresolved.some(u => {
        const t = (u.token || '').trim();
        const tLower = t.toLowerCase();
        const tSanitized = tLower.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        return tLower === tokenLower || tSanitized === tokenSanitized;
      });
    });

    if (affected.length === 0) return res.json({ resolved: 0, message: 'No pending items affected by this token' });

    // Load known tokens from DB + manifest (same as retry route)
    const knownTokensRetry = new Set();
    try {
      const svgRows = await pool.query(`SELECT shape_name FROM custom_svg_shapes WHERE is_active = true`);
      svgRows.rows.forEach(r => knownTokensRetry.add(r.shape_name));
      if (fs.existsSync(MANIFEST_PATH)) {
        const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
        Object.keys(manifest.tokens || {}).forEach(k => knownTokensRetry.add(k));
      }
    } catch (e) { console.warn('Could not load known tokens for retry-for-token:', e.message); }

    const SHAPES_CHECK = [
      'triangle','circle','square','star','diamond','hexagon','pentagon',
      'arrow','octagon','cross','dot','heart','oval','rectangle','crescent',
      'hourglass','wavy','moon','nested','inner_square','shaded',
    ];
    function isTemplatePlaceholderRFT(val) {
      if (!val) return false;
      const s = String(val).trim();
      if (s.includes(',')) return false;
      if (s.endsWith('?')) return false;
      if (s.length > 80) return false;
      if (/^(which|what|how|who|where|when|does|is|are|can|select|choose|find|identify|complete|fill|pick)\b/i.test(s)) return false;
      if (/\b\w+\s+stimulus:\s*\w+/i.test(s)) return true;
      if (/^[A-Za-z][A-Za-z\s_]+:\s+[A-Za-z]/.test(s)) return true;
      return false;
    }
    function checkTokenRFT(token) {
      if (!token || token === '?' || token === '') return null;
      const t = String(token).trim();
      if (/^-?\d+\.?\d*$/.test(t)) return null;
      if (knownTokensRetry.has(t) || knownTokensRetry.has(t.toLowerCase())) return null;
      const sanitized = t.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (knownTokensRetry.has(sanitized)) return null;
      if (isTemplatePlaceholderRFT(t)) return `Visual asset required: "${t}"`;
      if (t.startsWith('ratio:') || t.startsWith('pos_') || t.startsWith('img_') || t.includes(' ')) return null;
      if (t.startsWith('label:')) return null;
      if (/^pos_\d+$/.test(t)) return null;
      if (t.includes('_')) {
        const lc = t.toLowerCase();
        if (!SHAPES_CHECK.some(s => lc.includes(s))) return `Unknown shape in token "${t}"`;
      }
      return null;
    }

    // Helper: build item DB row and insert
    async function insertItem(row, userId) {
      const ageBandParsed = (() => {
        const v = row.ageBand;
        if (!v) return { min: 8, max: 18 };
        const m = String(v).match(/(\d+)\s*[-–]\s*(\d+)/);
        return m ? { min: parseInt(m[1]), max: parseInt(m[2]) } : { min: 8, max: 18 };
      })();
      const correctIdx0 = (() => {
        const v = row.correctIdx;
        if (v === null || v === undefined || v === '') return 0;
        const n = parseInt(v); return isNaN(n) ? 0 : Math.max(0, n - 1);
      })();
      const options = [row.optionA, row.optionB, row.optionC].map((val, i) => {
        if (!val) return null;
        return { value: String(val), label: String(val), tag: i === correctIdx0 ? 'correct' : 'distractor' };
      }).filter(Boolean);
      const domain = (row.domain || 'gc').toLowerCase();
      const content = {
        promptText: row.promptText || null, stimulusRow1: row.stimulusRow1 || null,
        stimulusRow2: row.stimulusRow2 || null, display: row.display || null,
        format: row.format || null, narrowAbility: row.narrowAbility || null,
        chcCode: row.chcCode || null, ruleType: row.ruleType || null,
        subtype: row.subtype || null, options, correctIndex: correctIdx0,
        correctAns: row.correctAns || null,
      };
      const diffLvl = (() => {
        const s = String(row.difficulty || '').toLowerCase().trim();
        return s === 'hard' ? 3 : s === 'medium' ? 2 : 1;
      })();
      await pool.query(`
        INSERT INTO items (item_code,domain,audience,difficulty_level,age_band_min,age_band_max,
          role,anchor_group,template,content,time_limit_sec,timer_mode,is_practice,
          irt_a,irt_b,irt_c,irt_calibrated,is_active,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        ON CONFLICT (item_code) DO UPDATE SET
          content=EXCLUDED.content, difficulty_level=EXCLUDED.difficulty_level,
          is_practice=EXCLUDED.is_practice, version=items.version+1
      `, [
        row.itemId, domain, 'student', diffLvl, ageBandParsed.min, ageBandParsed.max,
        'core', row.anchorGroup || null, row.template, JSON.stringify(content),
        row.timeSec ? parseInt(row.timeSec) : 20,
        domain === 'gs' ? 'hard' : 'soft',
        row.isPractice === true || row.isPractice === 'TRUE' || row.isPractice === 'true',
        row.irtA ? parseFloat(row.irtA) : null,
        row.irtB ? parseFloat(row.irtB) : null,
        row.irtC ? parseFloat(row.irtC) : 0.33,
        false, true, userId
      ]);
    }

    let resolved = 0;
    let stillPending = 0;
    const details = [];

    for (const pending of affected) {
      const row = pending.raw_data;
      // Re-check all tokens
      const unresolvedTokens = [];
      [['Stimulus Row 1', row.stimulusRow1],['Stimulus Row 2', row.stimulusRow2],
       ['Option A', row.optionA],['Option B', row.optionB],['Option C', row.optionC]].forEach(([field, val]) => {
        if (!val) return;
        const s = String(val).trim();
        let parts;
        if (s.includes('→')) parts = s.split(/\s*→\s*/);
        else if (s.includes('::')) parts = s.split(/\s*::\s*/).flatMap(h => h.split(/\s*:\s*/));
        else if (s.includes('|')) parts = s.split(/\s*\|\s*/);
        else parts = [s];
        for (const raw of parts) {
          const token = raw.trim().replace(/^\[/,'').replace(/\]$/,'').trim();
          if (!token || token === '?') continue;
          const err = checkTokenRFT(token);
          if (err) unresolvedTokens.push({ field, token, reason: err });
        }
      });

      if (unresolvedTokens.length > 0) {
        // Still has other unresolved tokens — update the list (the target token is now gone)
        await pool.query(
          `UPDATE pending_items SET unresolved_tokens=$1, updated_at=NOW() WHERE id=$2`,
          [JSON.stringify(unresolvedTokens), pending.id]
        );
        stillPending++;
        details.push({ itemCode: pending.item_code, status: 'still_pending', remaining: unresolvedTokens.length });
      } else {
        // All tokens resolved — insert and mark uploaded
        try {
          await insertItem(row, req.user.id);
          await pool.query(
            `UPDATE pending_items SET status='uploaded', unresolved_tokens='[]', updated_at=NOW() WHERE id=$1`,
            [pending.id]
          );
          resolved++;
          details.push({ itemCode: pending.item_code, status: 'uploaded' });
        } catch (insertErr) {
          console.error(`retry-for-token insert error (${pending.item_code}):`, insertErr.message);
          details.push({ itemCode: pending.item_code, status: 'error', reason: insertErr.message });
        }
      }
    }

    res.json({
      success: true,
      affected: affected.length,
      resolved,
      stillPending,
      details,
      message: resolved > 0
        ? `${resolved} item(s) automatically uploaded after token was resolved`
        : `Token registered — ${stillPending} item(s) still need other tokens fixed`
    });
  } catch (err) {
    console.error('retry-for-token error:', err);
    res.status(500).json({ error: err.message || 'Failed' });
  }
});

// ── POST /api/tokens/pending-items/:id/retry ──
// Re-validate and insert a pending item into the items table
router.post('/pending-items/:id/retry', authenticate, requireRole('super_admin', 'psychologist'), async (req, res) => {
  try {
    const pendingResult = await pool.query(
      `SELECT * FROM pending_items WHERE id = $1`, [req.params.id]
    );
    if (pendingResult.rows.length === 0) return res.status(404).json({ error: 'Pending item not found' });
    const pending = pendingResult.rows[0];
    const row = pending.raw_data;

    // Re-run validation — load known tokens from DB + manifest first
    const knownTokensRetry = new Set();
    try {
      const svgRows = await pool.query(`SELECT shape_name FROM custom_svg_shapes WHERE is_active = true`);
      svgRows.rows.forEach(r => knownTokensRetry.add(r.shape_name));
      const FE_PUBLIC = path.join(__dirname, '../../../cognimap-fe-main/public');
      const MANIFEST_PATH = path.join(FE_PUBLIC, 'sprites/shapes-manifest.json');
      if (fs.existsSync(MANIFEST_PATH)) {
        const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
        Object.keys(manifest.tokens || {}).forEach(k => knownTokensRetry.add(k));
      }
    } catch (e) { console.warn('Could not load known tokens for retry:', e.message); }

    const SHAPES_CHECK = [
      'triangle','circle','square','star','diamond','hexagon','pentagon',
      'arrow','octagon','cross','dot','heart','oval','rectangle','crescent',
      'hourglass','wavy','moon','nested','inner_square','shaded',
    ];
    function isTemplatePlaceholderRetry(val) {
      if (!val) return false;
      const s = String(val).trim();
      if (s.includes(',')) return false;
      if (s.endsWith('?')) return false;
      if (s.length > 80) return false;
      if (/^(which|what|how|who|where|when|does|is|are|can|select|choose|find|identify|complete|fill|pick)\b/i.test(s)) return false;
      if (/\b\w+\s+stimulus:\s*\w+/i.test(s)) return true;
      if (/^[A-Za-z][A-Za-z\s_]+:\s+[A-Za-z]/.test(s)) return true;
      return false;
    }
    function checkTokenRetry(token) {
      if (!token || token === '?' || token === '') return null;
      const t = String(token).trim();
      if (/^-?\d+\.?\d*$/.test(t)) return null;
      // If registered in DB/manifest → always valid
      if (knownTokensRetry.has(t) || knownTokensRetry.has(t.toLowerCase())) return null;
      // Also check sanitized form — handles tokens like "Reflection: horizontal reflection"
      // that were uploaded via sprite-shape as "reflection_horizontal_reflection"
      const sanitized = t.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (knownTokensRetry.has(sanitized)) return null;
      if (isTemplatePlaceholderRetry(t)) return `Visual asset required: "${t}"`;
      if (t.startsWith('ratio:') || t.startsWith('pos_') || t.startsWith('img_') || t.includes(' ')) return null;
      if (t.startsWith('label:')) return null;
      if (/^pos_\d+$/.test(t)) return null;
      if (t.includes('_')) {
        const lc = t.toLowerCase();
        if (!SHAPES_CHECK.some(s => lc.includes(s))) return `Unknown shape in token "${t}"`;
      }
      return null;
    }
    const unresolvedTokens = [];
    [['Stimulus Row 1', row.stimulusRow1],['Stimulus Row 2', row.stimulusRow2],
     ['Option A', row.optionA],['Option B', row.optionB],['Option C', row.optionC]].forEach(([field, val]) => {
      if (!val) return;
      const s = String(val).trim();
      let parts;
      if (s.includes('→')) parts = s.split(/\s*→\s*/);
      else if (s.includes('::')) parts = s.split(/\s*::\s*/).flatMap(h => h.split(/\s*:\s*/));
      else if (s.includes('|')) parts = s.split(/\s*\|\s*/);
      else parts = [s];
      for (const raw of parts) {
        const token = raw.trim().replace(/^\[/,'').replace(/\]$/,'').trim();
        if (!token || token === '?') continue;
        const err = checkTokenRetry(token);
        if (err) unresolvedTokens.push({ field, token, reason: err });
      }
    });

    if (unresolvedTokens.length > 0) {
      // Still has issues — update the record and return details
      await pool.query(
        `UPDATE pending_items SET unresolved_tokens=$1, status='pending', updated_at=NOW() WHERE id=$2`,
        [JSON.stringify(unresolvedTokens), req.params.id]
      );
      return res.json({
        success: false,
        message: `Item still has ${unresolvedTokens.length} unresolved token(s) — add the missing assets first`,
        unresolvedTokens
      });
    }

    // Tokens are resolved — insert into items table
    const XLSX_LIB = require('xlsx');
    const itemsRouter = require('./items');   // just to reuse helpers if exported; otherwise inline
    // Build the DB row directly
    const ageBandParsed = (() => {
      const v = row.ageBand;
      if (!v) return { min: 8, max: 18 };
      const m = String(v).match(/(\d+)\s*[-–]\s*(\d+)/);
      return m ? { min: parseInt(m[1]), max: parseInt(m[2]) } : { min: 8, max: 18 };
    })();
    const correctIdx0 = (() => {
      const v = row.correctIdx;
      if (v === null || v === undefined || v === '') return 0;
      const n = parseInt(v);
      return isNaN(n) ? 0 : Math.max(0, n - 1);
    })();
    const rawOptions = [row.optionA, row.optionB, row.optionC];
    const options = rawOptions.map((val, i) => {
      if (!val) return null;
      return { value: String(val), label: String(val), tag: i === correctIdx0 ? 'correct' : 'distractor' };
    }).filter(Boolean);
    const domain = (row.domain || 'gc').toLowerCase();
    const content = {
      promptText: row.promptText || null,
      stimulusRow1: row.stimulusRow1 || null,
      stimulusRow2: row.stimulusRow2 || null,
      display: row.display || null, format: row.format || null,
      narrowAbility: row.narrowAbility || null, chcCode: row.chcCode || null,
      ruleType: row.ruleType || null, subtype: row.subtype || null,
      options, correctIndex: correctIdx0, correctAns: row.correctAns || null,
    };
    const diffLvl = (() => {
      const s = String(row.difficulty || '').toLowerCase().trim();
      return s === 'hard' ? 3 : s === 'medium' ? 2 : 1;
    })();
    await pool.query(`
      INSERT INTO items (item_code,domain,audience,difficulty_level,age_band_min,age_band_max,
        role,anchor_group,template,content,time_limit_sec,timer_mode,is_practice,
        irt_a,irt_b,irt_c,irt_calibrated,is_active,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      ON CONFLICT (item_code) DO UPDATE SET
        content=EXCLUDED.content, difficulty_level=EXCLUDED.difficulty_level,
        is_practice=EXCLUDED.is_practice, version=items.version+1
    `, [
      row.itemId, domain, 'student', diffLvl, ageBandParsed.min, ageBandParsed.max,
      'core', row.anchorGroup || null, row.template,
      JSON.stringify(content), row.timeSec ? parseInt(row.timeSec) : 20,
      domain === 'gs' ? 'hard' : 'soft',
      row.isPractice === true || row.isPractice === 'TRUE' || row.isPractice === 'true',
      row.irtA ? parseFloat(row.irtA) : null,
      row.irtB ? parseFloat(row.irtB) : null,
      row.irtC ? parseFloat(row.irtC) : 0.33,
      false, true, req.user.id
    ]);

    // Mark pending item as uploaded
    await pool.query(
      `UPDATE pending_items SET status='uploaded', updated_at=NOW() WHERE id=$1`,
      [req.params.id]
    );
    await req.audit('token.pending_item_retried', 'pending_item', req.params.id, {
      description: `Retried and uploaded pending item: ${pending.item_code}`
    });
    res.json({ success: true, message: `${pending.item_code} uploaded successfully` });
  } catch (err) {
    console.error('Retry pending item error:', err);
    res.status(500).json({ error: err.message || 'Retry failed' });
  }
});

// ── POST /api/tokens/pending-items/:id/fix-token ──
// Upload a PNG for a specific unresolved token, patch the item's raw_data,
// then auto-retry insertion. All in one step.
// Body: multipart/form-data  { field, oldToken, sprite (file) }
router.post('/pending-items/:id/fix-token',
  authenticate, requireRole('super_admin', 'psychologist'),
  customSpriteUpload.single('sprite'),
  async (req, res) => {
    try {
      const { field, oldToken } = req.body;
      if (!oldToken) return res.status(400).json({ error: 'oldToken is required' });
      if (!req.file)  return res.status(400).json({ error: 'No sprite file uploaded' });

      // Derive a clean token name from the placeholder string
      // e.g. "Spatial sequence: movement pattern" → "spatial_sequence_movement_pattern"
      const newTokenName = oldToken
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64);

      // Rename the uploaded file to the derived token name
      const finalFilename = `${newTokenName}.png`;
      const finalPath     = path.join(CUSTOM_SPRITES, finalFilename);
      if (req.file.path !== finalPath) fs.renameSync(req.file.path, finalPath);

      // Register in manifest
      const manifest = readManifest();
      if (!manifest.tokens) manifest.tokens = {};
      manifest.tokens[newTokenName] = { file: `/sprites/custom/${finalFilename}` };
      writeManifest(manifest);

      // Load the pending item
      const pendingResult = await pool.query(
        `SELECT * FROM pending_items WHERE id = $1`, [req.params.id]
      );
      if (pendingResult.rows.length === 0) return res.status(404).json({ error: 'Pending item not found' });
      const pending = pendingResult.rows[0];

      // Patch raw_data — replace every occurrence of oldToken with newTokenName
      const rawData = pending.raw_data || {};
      const FIELDS  = ['stimulusRow1','stimulusRow2','optionA','optionB','optionC','promptText'];
      for (const f of FIELDS) {
        if (rawData[f] && String(rawData[f]).includes(oldToken)) {
          rawData[f] = String(rawData[f]).split(oldToken).join(newTokenName);
        }
      }

      // Remove this token from unresolved_tokens list
      const remaining = (pending.unresolved_tokens || []).filter(
        t => t.token !== oldToken
      );

      // Save patched raw_data back
      await pool.query(
        `UPDATE pending_items SET raw_data=$1, unresolved_tokens=$2, updated_at=NOW() WHERE id=$3`,
        [JSON.stringify(rawData), JSON.stringify(remaining), req.params.id]
      );

      // If no more unresolved tokens, auto-retry insertion
      if (remaining.length === 0) {
        // Build and insert the item (same logic as retry route)
        const row = rawData;
        const ageBandParsed = (() => {
          const v = row.ageBand;
          if (!v) return { min: 8, max: 18 };
          const m = String(v).match(/(\d+)\s*[-–]\s*(\d+)/);
          return m ? { min: parseInt(m[1]), max: parseInt(m[2]) } : { min: 8, max: 18 };
        })();
        const correctIdx0 = (() => {
          const v = row.correctIdx;
          if (v === null || v === undefined || v === '') return 0;
          const n = parseInt(v); return isNaN(n) ? 0 : Math.max(0, n - 1);
        })();
        const options = [row.optionA, row.optionB, row.optionC].map((val, i) => {
          if (!val) return null;
          return { value: String(val), label: String(val), tag: i === correctIdx0 ? 'correct' : 'distractor' };
        }).filter(Boolean);
        const domain = (row.domain || 'gv').toLowerCase();
        const content = {
          promptText: row.promptText || null, stimulusRow1: row.stimulusRow1 || null,
          stimulusRow2: row.stimulusRow2 || null, display: row.display || null,
          format: row.format || null, narrowAbility: row.narrowAbility || null,
          chcCode: row.chcCode || null, ruleType: row.ruleType || null,
          subtype: row.subtype || null, options, correctIndex: correctIdx0,
          correctAns: row.correctAns || null,
        };
        const diffLvl = (() => {
          const s = String(row.difficulty || '').toLowerCase().trim();
          return s === 'hard' ? 3 : s === 'medium' ? 2 : 1;
        })();
        await pool.query(`
          INSERT INTO items (item_code,domain,audience,difficulty_level,age_band_min,age_band_max,
            role,anchor_group,template,content,time_limit_sec,timer_mode,is_practice,
            irt_a,irt_b,irt_c,irt_calibrated,is_active,created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
          ON CONFLICT (item_code) DO UPDATE SET
            content=EXCLUDED.content, difficulty_level=EXCLUDED.difficulty_level,
            is_practice=EXCLUDED.is_practice, version=items.version+1
        `, [
          row.itemId, domain, 'student', diffLvl, ageBandParsed.min, ageBandParsed.max,
          'core', row.anchorGroup || null, row.template, JSON.stringify(content),
          row.timeSec ? parseInt(row.timeSec) : 20,
          domain === 'gs' ? 'hard' : 'soft',
          row.isPractice === true || row.isPractice === 'TRUE' || row.isPractice === 'true',
          row.irtA ? parseFloat(row.irtA) : null,
          row.irtB ? parseFloat(row.irtB) : null,
          row.irtC ? parseFloat(row.irtC) : 0.33,
          false, true, req.user.id
        ]);
        await pool.query(
          `UPDATE pending_items SET status='uploaded', updated_at=NOW() WHERE id=$1`,
          [req.params.id]
        );
        return res.json({
          success: true, autoUploaded: true, newTokenName,
          message: `Token fixed and item "${row.itemId}" uploaded successfully`
        });
      }

      res.json({
        success: true, autoUploaded: false, newTokenName,
        remaining: remaining.length,
        message: `Token "${oldToken}" → "${newTokenName}" fixed. ${remaining.length} token(s) still need fixing.`
      });
    } catch (err) {
      console.error('fix-token error:', err);
      res.status(500).json({ error: err.message || 'Fix failed' });
    }
  }
);

// ── POST /api/tokens/auto-generate ── Auto-generate SVG shapes for missing tokens
// Body: { tokens: string[] }  — list of token names that failed validation
router.post('/auto-generate', authenticate, requireRole('super_admin', 'psychologist'), async (req, res) => {
  const { tokens = [] } = req.body;
  if (!tokens.length) return res.status(400).json({ error: 'No tokens provided' });

  // ── SVG generator: derives geometry from token name ──────────────────────────
  function generateSVG(token) {
    const t = token.toLowerCase();

    // Helpers
    const filled  = !t.includes('hollow') && !t.includes('outline') && !t.includes('empty');
    const dotted  = t.includes('dotted') || t.includes('dot');
    const striped = t.includes('striped') || t.includes('stripe');
    const lined   = t.includes('lined') || t.includes('line');
    const nested  = t.includes('nested');
    const rotated = t.includes('rotated') || t.includes('rotate');
    const mirror  = t.includes('mirror');
    const crack   = t.includes('crack');
    const ringed  = t.includes('ring') || t.includes('ringed');
    const wavy    = t.includes('wavy');
    const alt     = t.includes('alt') || t.includes('open');

    const fillAttr  = filled ? 'fill="{fill}"' : 'fill="none"';
    const sw = 3;

    // ── Shape families ──────────────────────────────────────────────────────────
    if (t.includes('circle')) {
      let svg = `<circle cx="50" cy="50" r="42" ${fillAttr} stroke="{fill}" stroke-width="${sw}"/>`;
      if (dotted)  svg += `<circle cx="50" cy="50" r="10" fill="white"/>`;
      if (striped) svg = `<circle cx="50" cy="50" r="42" fill="none" stroke="{fill}" stroke-width="${sw}"/>` +
                         `<line x1="8" y1="50" x2="92" y2="50" stroke="{fill}" stroke-width="2"/>` +
                         `<line x1="50" y1="8" x2="50" y2="92" stroke="{fill}" stroke-width="2"/>`;
      if (nested)  svg += `<circle cx="50" cy="50" r="24" fill="none" stroke="{fill}" stroke-width="${sw}"/>`;
      if (ringed)  svg += `<circle cx="50" cy="50" r="48" fill="none" stroke="{fill}" stroke-width="2"/>`;
      if (crack)   svg += `<path d="M50,8 L45,30 L55,50 L48,70" fill="none" stroke="white" stroke-width="2"/>`;
      if (wavy)    svg = `<path d="M8,50 Q20,30 32,50 Q44,70 56,50 Q68,30 80,50 Q86,58 92,50" fill="none" stroke="{fill}" stroke-width="${sw}"/>`;
      return svg;
    }

    if (t.includes('square') || t.includes('rectangle')) {
      const rx = t.includes('rectangle') ? 2 : 4;
      const w = t.includes('rectangle') ? 70 : 80;
      const h = t.includes('rectangle') ? 50 : 80;
      const x = (100 - w) / 2, y = (100 - h) / 2;
      let svg = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" ${fillAttr} stroke="{fill}" stroke-width="${sw}"/>`;
      if (dotted)  svg += `<circle cx="50" cy="50" r="8" fill="white"/>`;
      if (striped) svg += `<line x1="${x+10}" y1="${y}" x2="${x+10}" y2="${y+h}" stroke="white" stroke-width="3"/>` +
                          `<line x1="${x+25}" y1="${y}" x2="${x+25}" y2="${y+h}" stroke="white" stroke-width="3"/>` +
                          `<line x1="${x+40}" y1="${y}" x2="${x+40}" y2="${y+h}" stroke="white" stroke-width="3"/>`;
      if (nested)  svg += `<rect x="${x+12}" y="${y+12}" width="${w-24}" height="${h-24}" rx="${rx}" fill="none" stroke="{fill}" stroke-width="${sw}"/>`;
      if (alt)     svg = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="none" stroke="{fill}" stroke-width="${sw}" stroke-dasharray="6 3"/>`;
      return svg;
    }

    if (t.includes('triangle')) {
      const down = t.includes('down');
      const pts  = down ? '50,88 10,12 90,12' : '50,12 90,88 10,88';
      let svg = `<polygon points="${pts}" ${fillAttr} stroke="{fill}" stroke-width="${sw}" stroke-linejoin="round"/>`;
      if (dotted)  svg += `<circle cx="50" cy="50" r="8" fill="white"/>`;
      if (striped) svg += `<line x1="25" y1="70" x2="75" y2="70" stroke="white" stroke-width="2"/>` +
                          `<line x1="35" y1="55" x2="65" y2="55" stroke="white" stroke-width="2"/>`;
      if (nested)  svg += `<polygon points="${down ? '50,72 22,28 78,28' : '50,28 78,72 22,72'}" fill="none" stroke="{fill}" stroke-width="${sw}" stroke-linejoin="round"/>`;
      if (mirror)  svg += `<polygon points="${down ? '50,12 10,88 90,88' : '50,88 10,12 90,12'}" fill="none" stroke="{fill}" stroke-width="2" stroke-linejoin="round" opacity="0.4"/>`;
      return svg;
    }

    if (t.includes('star')) {
      const pts = [];
      const or = 42, ir = or * 0.4;
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + Math.PI * i / 5;
        const r = i % 2 === 0 ? or : ir;
        pts.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`);
      }
      let svg = `<polygon points="${pts.join(' ')}" ${fillAttr} stroke="{fill}" stroke-width="${sw}" stroke-linejoin="round"/>`;
      if (ringed)  svg += `<circle cx="50" cy="50" r="48" fill="none" stroke="{fill}" stroke-width="2"/>`;
      if (dotted)  svg += `<circle cx="50" cy="50" r="8" fill="white"/>`;
      if (crack)   svg += `<path d="M50,8 L46,22 L54,36" fill="none" stroke="white" stroke-width="2"/>`;
      return svg;
    }

    if (t.includes('diamond')) {
      let svg = `<polygon points="50,8 92,50 50,92 8,50" ${fillAttr} stroke="{fill}" stroke-width="${sw}" stroke-linejoin="round"/>`;
      if (dotted)  svg += `<circle cx="50" cy="50" r="8" fill="white"/>`;
      if (rotated) svg = `<polygon points="50,8 92,50 50,92 8,50" ${fillAttr} stroke="{fill}" stroke-width="${sw}" stroke-linejoin="round" transform="rotate(45,50,50)"/>`;
      if (nested)  svg += `<polygon points="50,22 78,50 50,78 22,50" fill="none" stroke="{fill}" stroke-width="${sw}" stroke-linejoin="round"/>`;
      return svg;
    }

    if (t.includes('hexagon')) {
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 6 + Math.PI * i / 3;
        pts.push(`${(50 + 42 * Math.cos(a)).toFixed(1)},${(50 + 42 * Math.sin(a)).toFixed(1)}`);
      }
      let svg = `<polygon points="${pts.join(' ')}" ${fillAttr} stroke="{fill}" stroke-width="${sw}" stroke-linejoin="round"/>`;
      if (alt) svg = `<polygon points="${pts.join(' ')}" fill="none" stroke="{fill}" stroke-width="${sw}" stroke-dasharray="6 3" stroke-linejoin="round"/>`;
      return svg;
    }

    if (t.includes('pentagon')) {
      const pts = [];
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + 2 * Math.PI * i / 5;
        pts.push(`${(50 + 42 * Math.cos(a)).toFixed(1)},${(50 + 42 * Math.sin(a)).toFixed(1)}`);
      }
      let svg = `<polygon points="${pts.join(' ')}" ${fillAttr} stroke="{fill}" stroke-width="${sw}" stroke-linejoin="round"/>`;
      if (alt) svg = `<polygon points="${pts.join(' ')}" fill="none" stroke="{fill}" stroke-width="${sw}" stroke-dasharray="6 3" stroke-linejoin="round"/>`;
      return svg;
    }

    if (t.includes('heart')) {
      let svg = `<path d="M50,85 C8,50 8,18 50,35 C92,18 92,50 50,85Z" ${fillAttr} stroke="{fill}" stroke-width="${sw}"/>`;
      if (mirror) svg += `<path d="M50,85 C8,50 8,18 50,35 C92,18 92,50 50,85Z" fill="none" stroke="{fill}" stroke-width="2" transform="scale(-1,1) translate(-100,0)" opacity="0.4"/>`;
      if (crack)  svg += `<path d="M50,35 L46,55 L54,65" fill="none" stroke="white" stroke-width="2"/>`;
      return svg;
    }

    if (t.includes('arrow')) {
      const dir = t.includes('left') ? 270 : t.includes('down') ? 180 : t.includes('right') ? 90 : 0;
      return `<path d="M50,10 L85,50 L65,50 L65,88 L35,88 L35,50 L15,50 Z" ${fillAttr} stroke="{fill}" stroke-width="${sw}" stroke-linejoin="round" transform="rotate(${dir},50,50)"/>`;
    }

    if (t.includes('crescent') || t.includes('moon')) {
      return `<circle cx="50" cy="50" r="38" ${fillAttr} stroke="{fill}" stroke-width="${sw}"/>` +
             `<circle cx="62" cy="50" r="32" fill="white"/>`;
    }

    if (t.includes('cross') || t.includes('plus')) {
      return `<path d="M35,10 L65,10 L65,35 L90,35 L90,65 L65,65 L65,90 L35,90 L35,65 L10,65 L10,35 L35,35 Z" ${fillAttr} stroke="{fill}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    }

    if (t.includes('oval') || t.includes('ellipse')) {
      return `<ellipse cx="50" cy="50" rx="44" ry="28" ${fillAttr} stroke="{fill}" stroke-width="${sw}"/>`;
    }

    if (t.includes('octagon')) {
      const pts = [];
      for (let i = 0; i < 8; i++) {
        const a = Math.PI * i / 4 - Math.PI / 8;
        pts.push(`${(50 + 44 * Math.cos(a)).toFixed(1)},${(50 + 44 * Math.sin(a)).toFixed(1)}`);
      }
      return `<polygon points="${pts.join(' ')}" ${fillAttr} stroke="{fill}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    }

    if (t.includes('bell')) {
      return `<path d="M50,10 C30,10 20,25 20,45 L15,70 L85,70 L80,45 C80,25 70,10 50,10Z" ${fillAttr} stroke="{fill}" stroke-width="${sw}"/>` +
             `<rect x="42" y="70" width="16" height="8" rx="2" ${fillAttr} stroke="{fill}" stroke-width="${sw}"/>` +
             `<circle cx="50" cy="82" r="5" ${fillAttr} stroke="{fill}" stroke-width="${sw}"/>` +
             (crack ? `<path d="M50,30 L46,50 L54,60" fill="none" stroke="white" stroke-width="2"/>` : '');
    }

    if (t.includes('flag')) {
      const altPole = t.includes('alt');
      return `<line x1="${altPole ? 60 : 20}" y1="10" x2="${altPole ? 60 : 20}" y2="90" stroke="{fill}" stroke-width="${sw}"/>` +
             `<polygon points="${altPole ? '60,10 90,25 60,40' : '20,10 80,25 20,40'}" ${fillAttr} stroke="{fill}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    }

    if (t.includes('shield')) {
      return `<path d="M50,10 L85,25 L85,55 C85,72 68,85 50,92 C32,85 15,72 15,55 L15,25 Z" ${fillAttr} stroke="{fill}" stroke-width="${sw}" stroke-linejoin="round"/>` +
             (dotted ? `<circle cx="50" cy="50" r="8" fill="white"/>` : '');
    }

    if (t.includes('flower')) {
      const extra = t.includes('extra');
      const petals = extra ? 6 : 5;
      let svg = '';
      for (let i = 0; i < petals; i++) {
        const a = (2 * Math.PI * i) / petals;
        const cx = (50 + 22 * Math.cos(a)).toFixed(1);
        const cy = (50 + 22 * Math.sin(a)).toFixed(1);
        svg += `<ellipse cx="${cx}" cy="${cy}" rx="14" ry="10" ${fillAttr} stroke="{fill}" stroke-width="2" transform="rotate(${(a * 180 / Math.PI).toFixed(0)},${cx},${cy})"/>`;
      }
      svg += `<circle cx="50" cy="50" r="12" fill="{fill}" stroke="{fill}" stroke-width="2"/>`;
      return svg;
    }

    if (t.includes('hourglass')) {
      return `<polygon points="10,10 90,10 50,50 90,90 10,90 50,50" ${fillAttr} stroke="{fill}" stroke-width="${sw}" stroke-linejoin="round"/>` +
             (dotted ? `<circle cx="50" cy="10" r="5" fill="white"/>` : '');
    }

    // Generic fallback — labeled rectangle
    return null;
  }

  const results = { generated: [], skipped: [] };

  for (const token of tokens) {
    // Skip if already exists
    const existing = await pool.query(
      'SELECT id FROM custom_svg_shapes WHERE shape_name = $1 AND is_active = true',
      [token]
    );
    if (existing.rows.length > 0) {
      results.generated.push({ token, status: 'already_exists' });
      continue;
    }

    const svgCode = generateSVG(token);
    if (!svgCode) {
      results.skipped.push({ token, reason: 'Cannot auto-generate — too complex, add manually as SVG or PNG sprite' });
      continue;
    }

    try {
      await pool.query(
        `INSERT INTO custom_svg_shapes (shape_name, display_name, svg_code, default_color, category, description, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [token, token, svgCode, '#8B5CF6', 'auto_generated', `Auto-generated from token name`, req.user.id]
      );
      results.generated.push({ token, status: 'created' });
    } catch (err) {
      results.skipped.push({ token, reason: err.message });
    }
  }

  res.json({
    success: true,
    generated: results.generated.length,
    skipped: results.skipped.length,
    details: results
  });
});

// ── GET /api/tokens/item-images ── List all files in public/item-images
router.get('/item-images', authenticate, async (req, res) => {
  try {
    const dir = path.join(__dirname, '../../public/item-images');
    if (!fs.existsSync(dir)) return res.json({ files: [] });
    const files = fs.readdirSync(dir).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/tokens/item-images ── Upload one or more PNGs to public/item-images
const itemImgUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '../../public/item-images');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, file.originalname),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.(png|jpg|jpeg|webp)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Only image files allowed'));
  },
});

router.post('/item-images', authenticate, requireRole('super_admin', 'psychologist'),
  itemImgUpload.array('images', 300),
  async (req, res) => {
    try {
      const uploaded = (req.files || []).map(f => f.filename);
      res.json({ success: true, uploaded, count: uploaded.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── DELETE /api/tokens/item-images/:filename ── Delete a single item image
router.delete('/item-images/:filename', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const filename = path.basename(req.params.filename); // prevent path traversal
    const filePath = path.join(__dirname, '../../public/item-images', filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
