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

test("context bundles authoring UI sends metadata fields to create and update APIs", () => {
  const source = readScript();

  assert.match(source, /fetch\("\/api\/context-bundles\?includeParts=false"\)/);
  assert.match(source, /fetch\("\/api\/context-bundles",\s*\{\s*method:\s*"POST"/m);
  assert.match(source, /fetch\(`\/api\/context-bundles\/\$\{encodeURIComponent\(String\(selectedBundleId\)\)\}`,\s*\{\s*method:\s*"PATCH"/m);
  assert.match(source, /intendedUse:\s*bundleIntendedUseInput\.value\.trim\(\)\s*\|\|\s*null/);
  assert.match(source, /projectName:\s*bundleProjectNameInput\.value\.trim\(\)\s*\|\|\s*null/);
  assert.match(source, /tags:\s*parseTags\(bundleTagsInput\.value\)/);
  assert.match(source, /summary:\s*bundleSummaryInput\.value\.trim\(\)\s*\|\|\s*null/);
});

test("context bundles authoring UI renders metadata fields including freshness indicator", () => {
  const source = readScript();

  assert.match(source, /Status:\s*\$\{formatMetadataValue\(bundle\.status\)\}\s*\|\s*Updated:\s*\$\{formatMetadataValue\(bundle\.updated_at\)\}/);
  assert.match(source, /Intended use:\s*\$\{formatMetadataValue\(bundle\.intended_use\)\}/);
  assert.match(source, /Project affinity:\s*\$\{formatMetadataValue\(bundle\.project_name\)\}/);
  assert.match(source, /Tags:\s*\$\{Array\.isArray\(bundle\.tags\)/);
  assert.match(source, /Summary:\s*\$\{formatMetadataValue\(bundle\.summary\)\}/);
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
  assert.match(source, /id="saveBundleButton"/);
  assert.match(source, /Create Bundle/);
  assert.match(source, /<h2>Saved Bundles<\/h2>/);
  assert.match(source, /id="contextBundlesList"/);
});
