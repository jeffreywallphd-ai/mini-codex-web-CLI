const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CONTEXT_BUNDLES_JS_PATH = path.resolve(__dirname, "context-bundles.js");
const CONTEXT_BUNDLES_HTML_PATH = path.resolve(__dirname, "context-bundles.html");
const INDEX_HTML_PATH = path.resolve(__dirname, "index.html");

function readScript() {
  return fs.readFileSync(CONTEXT_BUNDLES_JS_PATH, "utf8");
}

function readHtml(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("context bundles authoring UI supports in-page create/edit flow with title and description validation", () => {
  const source = readScript();

  assert.match(source, /fetch\("\/api\/context-bundles\?includeParts=false"\)/);
  assert.match(source, /fetch\("\/api\/context-bundles",\s*\{\s*method:\s*"POST"/m);
  assert.match(source, /fetch\(`\/api\/context-bundles\/\$\{encodeURIComponent\(String\(selectedBundleId\)\)\}`,\s*\{\s*method:\s*"PATCH"/m);
  assert.match(source, /function validateBundlePayload\(payload\)/);
  assert.match(source, /if \(!payload\.title\)/);
  assert.match(source, /if \(!payload\.description\)/);
  assert.match(source, /setValidation\(error\.message\)/);
  assert.match(source, /const createdBundle = bundles\.find\(\(bundle\) => bundle\.id === result\.id\);/);
  assert.match(source, /const refreshedBundle = bundles\.find\(\(bundle\) => bundle\.id === result\.id\);/);
  assert.match(source, /intendedUse:\s*bundleIntendedUseInput\.value\.trim\(\)\s*\|\|\s*null/);
  assert.match(source, /projectName:\s*bundleProjectNameInput\.value\.trim\(\)\s*\|\|\s*null/);
  assert.match(source, /tags:\s*parseTags\(bundleTagsInput\.value\)/);
  assert.match(source, /summary:\s*bundleSummaryInput\.value\.trim\(\)\s*\|\|\s*null/);
});

test("context bundles authoring UI supports part add/edit/delete/reorder controls", () => {
  const source = readScript();

  assert.match(source, /const PART_TYPE_OPTIONS = \[/);
  assert.match(source, /fetch\(`\/api\/context-bundles\/\$\{encodeURIComponent\(String\(bundleId\)\)\}\/parts`\)/);
  assert.match(source, /fetch\(`\/api\/context-bundles\/\$\{encodeURIComponent\(String\(bundleId\)\)\}\/parts`,\s*\{\s*method:\s*"POST"/m);
  assert.match(source, /fetch\(`\/api\/context-bundles\/\$\{encodeURIComponent\(String\(bundleId\)\)\}\/parts\/\$\{encodeURIComponent\(String\(partId\)\)\}`,\s*\{\s*method:\s*"PATCH"/m);
  assert.match(source, /fetch\(`\/api\/context-bundles\/\$\{encodeURIComponent\(String\(bundleId\)\)\}\/parts\/\$\{encodeURIComponent\(String\(partId\)\)\}`,\s*\{\s*method:\s*"DELETE"/m);
  assert.match(source, /moveUpButton\.textContent = "Move Up"/);
  assert.match(source, /moveDownButton\.textContent = "Move Down"/);
  assert.match(source, /savePartButton\.textContent = "Save Part"/);
  assert.match(source, /deletePartButton\.textContent = "Delete Part"/);
  assert.match(source, /includeCopy\.textContent = "Include in compiled output"/);
  assert.match(source, /await persistPartOrder\(reordered\)/);
  assert.match(source, /await loadBundlePreview\(bundleId\)/);
  assert.match(source, /fetch\(`\/api\/context-bundles\/\$\{encodeURIComponent\(String\(bundleId\)\)\}\/preview`\)/);
  assert.match(source, /function setPreviewWarnings\(warnings\)/);
  assert.match(source, /setPreviewWarnings\(preview\.qualityWarnings\)/);
  assert.match(source, /Context quality advisories:/);
});

test("context bundles authoring UI renders metadata fields including freshness indicator", () => {
  const source = readScript();

  assert.match(source, /Status:\s*\$\{formatMetadataValue\(bundle\.status\)\}\s*\|\s*Updated:\s*\$\{formatMetadataValue\(bundle\.updated_at\)\}/);
  assert.match(source, /Description:\s*\$\{formatMetadataValue\(bundle\.description\)\}/);
  assert.match(source, /Intended use:\s*\$\{formatMetadataValue\(bundle\.intended_use\)\}/);
  assert.match(source, /Project affinity:\s*\$\{formatMetadataValue\(bundle\.project_name\)\}/);
  assert.match(source, /Tags:\s*\$\{Array\.isArray\(bundle\.tags\)/);
  assert.match(source, /Summary:\s*\$\{formatMetadataValue\(bundle\.summary\)\}/);
});

test("context bundles authoring UI exposes bundle maintenance actions in list cards", () => {
  const source = readScript();

  assert.match(source, /editButton\.textContent = "Edit Bundle"/);
  assert.match(source, /duplicateButton\.textContent = "Duplicate Bundle"/);
  assert.match(source, /deleteButton\.textContent = "Delete Bundle"/);
  assert.match(source, /fetch\(`\/api\/context-bundles\/\$\{encodeURIComponent\(String\(bundleId\)\)\}\/duplicate`,\s*\{\s*method:\s*"POST"/m);
  assert.match(source, /window\.confirm\(`Delete \$\{label\}\? This permanently removes the bundle and all of its parts\.`\)/);
  assert.match(source, /await deleteBundle\(bundle\.id,\s*bundle\.title\)/);
  assert.match(source, /await deleteBundle\(selectedBundleId,\s*bundleTitleInput\.value\)/);
});

test("index page includes navigation to context bundles page", () => {
  const source = readHtml(INDEX_HTML_PATH);

  assert.match(source, /href="\/context-bundles\.html"/);
  assert.match(source, />Manage Context Bundles</);
});

test("context bundles page provides central authoring and management sections", () => {
  const source = readHtml(CONTEXT_BUNDLES_HTML_PATH);

  assert.match(source, /<h1>Context Bundles<\/h1>/);
  assert.match(source, /<h2>Bundle Metadata Authoring<\/h2>/);
  assert.match(source, /id="bundleValidationBox"/);
  assert.match(source, /id="saveBundleButton"/);
  assert.match(source, /Create Bundle/);
  assert.match(source, /<h3>Bundle Parts<\/h3>/);
  assert.match(source, /id="addBundlePartButton"/);
  assert.match(source, /id="bundlePartsList"/);
  assert.match(source, /<h3>Compiled Preview<\/h3>/);
  assert.match(source, /id="refreshBundlePreviewButton"/);
  assert.match(source, /id="bundlePreviewStatus"/);
  assert.match(source, /id="bundlePreviewWarnings"/);
  assert.match(source, /id="bundlePreviewBox"/);
  assert.match(source, /<h2>Saved Bundles<\/h2>/);
  assert.match(source, /id="contextBundlesList"/);
});
